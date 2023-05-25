/* ************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2023 Adobe
* All Rights Reserved.
*
* NOTICE: All information contained herein is, and remains
* the property of Adobe and its suppliers, if any. The intellectual
* and technical concepts contained herein are proprietary to Adobe
* and its suppliers and are protected by all applicable intellectual
* property laws, including trade secret and copyright laws.
* Dissemination of this information or reproduction of this material
* is strictly forbidden unless prior written permission is obtained
* from Adobe.
************************************************************************* */

const AioLogger = require('@adobe/aio-lib-core-logging');
const stateLib = require('@adobe/aio-lib-state');
const fetch = require('node-fetch');
const crypto = require('crypto');

const STATUS_FORMAT = {
    action: {
        type: '',
        status: '',
        message: '',
        activationId: ''
    }
};
const COPY_ACTION = 'copyAction';
const PROMOTE_ACTION = 'promoteAction';
const PREVIEW = 'preview';
const PUBLISH = 'live';

const MAX_RETRIES = 5;

function getAioLogger(loggerName = 'main', logLevel = 'info') {
    return AioLogger(loggerName, { level: logLevel });
}

function getUrlInfo(adminPageUri) {
    const location = new URL(adminPageUri);
    function getParam(name) {
        return location.searchParams.get(name);
    }
    const projectName = getParam('project');
    const sub = projectName ? projectName.split('--') : [];

    const sp = getParam('referrer');
    const owner = getParam('owner') || sub[1];
    const repo = getParam('repo') || sub[0];
    const ref = getParam('ref') || 'main';

    const urlInfo = {
        sp,
        owner,
        repo,
        ref,
        origin: `https://${ref}--${repo}--${owner}.hlx.page`,
        isValid() {
            return sp && owner && repo && ref;
        },
    };
    return urlInfo;
}

// eslint-disable-next-line default-param-last
async function simulatePreviewPublish(path, operation, retryAttempt = 1, isFloodgate, adminPageUri) {
    const previewStatus = { success: true, path };
    try {
        const urlInfo = getUrlInfo(adminPageUri);
        const repo = isFloodgate ? `${urlInfo.repo}-pink` : urlInfo.repo;
        const previewUrl = `https://admin.hlx.page/${operation}/${urlInfo.owner}/${repo}/${urlInfo.ref}${path}`;
        const response = await fetch(
            `${previewUrl}`,
            { method: 'POST' },
        );
        if (!response.ok && retryAttempt <= MAX_RETRIES) {
            await simulatePreviewPublish(path, operation, retryAttempt + 1, isFloodgate, adminPageUri);
        }
        previewStatus.responseJson = await response.json();
    } catch (error) {
        previewStatus.success = false;
    }
    return previewStatus;
}

function handleExtension(path) {
    if (path.endsWith('.xlsx')) {
        return path.replace('.xlsx', '.json');
    }
    return path.substring(0, path.lastIndexOf('.'));
}

function getPathFromUrl(url) {
    return new URL(url).pathname;
}

function getDocPathFromUrl(url) {
    let path = getPathFromUrl(url);
    if (!path) {
        return undefined;
    }
    if (path.endsWith('.json')) {
        path = path.slice(0, -5);
        return `${path}.xlsx`;
    }

    if (path.endsWith('/')) {
        path += 'index';
    } else if (path.endsWith('.html')) {
        path = path.slice(0, -5);
    }

    return `${path}.docx`;
}

async function updateStatusToStateLib(storeKey, status, statusMessage, activationId, action) {
    const logger = getAioLogger();
    let storeStatus = STATUS_FORMAT;
    try {
        await getStatusFromStateLib(storeKey).then((result) => {
            if (result?.action) {
                storeStatus = result;
                if (status) {
                    storeStatus.action.status = status;
                }
                if (statusMessage) {
                    storeStatus.action.message = statusMessage;
                }
                if (activationId) {
                    storeStatus.action.activationId = activationId;
                }
                logger.info(`Updating status to state store  -- value :   ${JSON.stringify(storeStatus)}`);
                updateStateStatus(storeKey, storeStatus);
            } else {
                logger.info(`Updating status to state store  -- value :   ${JSON.stringify(storeStatus)}`);
                storeStatus.action.type = action;
                storeStatus.action.status = status;
                storeStatus.action.message = statusMessage;
                storeStatus.action.activationId = activationId;
                updateStateStatus(storeKey, storeStatus);
            }
        });
    } catch (err) {
        logger.error(`Error creating state store ${err}`);
    }
    return storeStatus;
}

async function updateStateStatus(storeKey, storeValue) {
    const logger = getAioLogger();
    const hash = crypto.createHash('md5').update(storeKey).digest('hex');
    logger.info(`Adding status to aio state lib with hash -- ${hash} - ${JSON.stringify(storeValue)}`);
    // get the hash value if its available
    try {
        const state = await stateLib.init();
        // save it
        await state.put(hash, storeValue, {
            // 30day expiration...
            ttl: 2592000
        });
    } catch (err) {
        logger.error(`Error creating state store ${err}`);
    }
}

async function getStatusFromStateLib(storeKey) {
    const logger = getAioLogger();
    let status;
    try {
        // md5 hash of the config file
        const hash = crypto.createHash('md5').update(storeKey).digest('hex');
        logger.info(`Project excel path and hash value -- ${storeKey} and ${hash}`);
        // init when running in an Adobe I/O Runtime action (OpenWhisk) (uses env vars __OW_API_KEY and __OW_NAMESPACE automatically)
        const state = await stateLib.init();
        // getting activation id data from io state
        const res = await state.get(hash); // res = { value, expiration }
        if (res) {
            status = res.value;
            logger.info(`Status from the store ${JSON.stringify(status)}`);
        }
    } catch (err) {
        logger.error(`Error getting data from state store ${err}`);
    }
    return status;
}

async function delay(milliseconds = 100) {
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

module.exports = {
    getAioLogger,
    getUrlInfo,
    simulatePreviewPublish,
    handleExtension,
    getDocPathFromUrl,
    updateStatusToStateLib,
    getStatusFromStateLib,
    delay,
    COPY_ACTION,
    PROMOTE_ACTION,
    PREVIEW,
    PUBLISH
};

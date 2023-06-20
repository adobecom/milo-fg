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
const fetch = require('node-fetch');
const events = require('events');
const urlInfo = require('./urlInfo');

const COPY_ACTION = 'copyAction';
const PROMOTE_ACTION = 'promoteAction';
const PROMOTE_BATCH = 'promoteBatch';
const PREVIEW = 'preview';
const PUBLISH = 'live';

const MAX_RETRIES = 5;
let eventEmitter = null;

function getAioLogger(loggerName = 'main', logLevel = 'info') {
    return AioLogger(loggerName, { level: logLevel });
}

// eslint-disable-next-line default-param-last
async function simulatePreviewPublish(path, operation, retryAttempt = 1, isFloodgate) {
    let previewStatus = { success: true, path };
    try {
        const repo = isFloodgate ? `${urlInfo.getRepo()}-pink` : urlInfo.getRepo();
        const previewUrl = `https://admin.hlx.page/${operation}/${urlInfo.getOwner()}/${repo}/${urlInfo.getBranch()}${path}`;
        const response = await fetch(
            `${previewUrl}`,
            { method: 'POST' },
        );
        if (!response.ok && retryAttempt <= MAX_RETRIES) {
            previewStatus = await simulatePreviewPublish(path, operation, retryAttempt + 1, isFloodgate);
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

async function delay(milliseconds = 100) {
    // eslint-disable-next-line no-promise-executor-return
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function actInProgress(ow, actId, svInProg = true) {
    const logger = getAioLogger();
    const finStatuses = ['success', 'failure', 'skipped', 'developer_error',
        'system_error', 'invocation_error', 'application_error', 'timeout',
        'action developer error', 'application error'];
    if (svInProg && actId) {
        let owAct = {};
        try {
            owAct = await ow.activations.get({
                activationId: actId
            });
            // logger.info(`Job status response for ${actId} is ${JSON.stringify(owAct)}`);
            return owAct?.response?.status ? !finStatuses.includes(owAct.response.status) : svInProg;
        } catch (err) {
            logger.error(err?.stack);
            logger.error(`Job status of ${actId} failed response ${JSON.stringify(owAct)}`);
        }
    }
    return svInProg;
}

function logMemUsage() {
    const logger = getAioLogger();
    const memStr = JSON.stringify(process.memoryUsage());
    logger.info(`Memory Usage : ${memStr}`);
}

function logMemUsageIter() {
    logMemUsage();
    if (!eventEmitter) {
        eventEmitter = new events.EventEmitter();
        eventEmitter.on('logMemUsage', logMemUsage);
    }
    setTimeout(() => eventEmitter.emit('logMemUsage'), 400);
}

module.exports = {
    getAioLogger,
    simulatePreviewPublish,
    handleExtension,
    getDocPathFromUrl,
    delay,
    COPY_ACTION,
    PROMOTE_ACTION,
    PROMOTE_BATCH,
    PREVIEW,
    PUBLISH,
    logMemUsage,
    logMemUsageIter,
    actInProgress
};

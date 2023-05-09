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

const MAX_RETRIES = 5;

function getAioLogger(loggerName = 'main', logLevel = 'info') {
    return AioLogger(loggerName, { level: logLevel });
}

function getUrlInfo(adminPageUri) {
    const logger = getAioLogger();
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

    logger.info(`sp:: ${sp} :: owner :: ${owner} :: repo :: ${repo} :: ref :: ${ref}`);

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
async function simulatePreview(path, retryAttempt = 1, isFloodgate, adminPageUri) {
    const previewStatus = { success: true, path };
    try {
        const urlInfo = getUrlInfo(adminPageUri);
        const repo = isFloodgate ? `${urlInfo.repo}-pink` : urlInfo.repo;
        const previewUrl = `https://admin.hlx.page/preview/${urlInfo.owner}/${repo}/${urlInfo.ref}${path}`;
        const response = await fetch(
            `${previewUrl}`,
            { method: 'POST' },
        );
        if (!response.ok && retryAttempt <= MAX_RETRIES) {
            await simulatePreview(path, retryAttempt + 1, isFloodgate, adminPageUri);
        }
        previewStatus.responseJson = await response.json();
    } catch (error) {
        previewStatus.success = false;
    }
    return previewStatus;
}

function getFloodgateUrl(url) {
    if (!url) {
        return undefined;
    }
    const urlArr = url.split('--');
    urlArr[1] += '-pink';
    return urlArr.join('--');
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

module.exports = {
    getAioLogger,
    getUrlInfo,
    getFloodgateUrl,
    simulatePreview,
    handleExtension,
    getDocPathFromUrl
};

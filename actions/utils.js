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
const events = require('events');

const COPY_ACTION = 'copyAction';
const PROMOTE_ACTION = 'promoteAction';
const PROMOTE_BATCH = 'promoteBatch';
const DELETE_ACTION = 'deleteAction';
const PREVIEW = 'preview';
const PUBLISH = 'live';

let eventEmitter = null;

function getAioLogger(loggerName = 'main', logLevel = 'info') {
    return AioLogger(loggerName, { level: logLevel });
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
    if (path.endsWith('.svg') || path.endsWith('.pdf')) {
        return path;
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

function getInstanceKey(params) {
    return params?.fgRootFolder?.replace(/[^a-zA-Z0-9_]/g, '_') || 'default';
}

module.exports = {
    getAioLogger,
    handleExtension,
    getDocPathFromUrl,
    delay,
    COPY_ACTION,
    PROMOTE_ACTION,
    PROMOTE_BATCH,
    DELETE_ACTION,
    PREVIEW,
    PUBLISH,
    logMemUsage,
    logMemUsageIter,
    actInProgress,
    getInstanceKey
};

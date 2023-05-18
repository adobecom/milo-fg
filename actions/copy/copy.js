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

// eslint-disable-next-line import/no-extraneous-dependencies
const openwhisk = require('openwhisk');
const { PROJECT_STATUS } = require('../project');
const {
    getAioLogger, updateStatusToStateLib, COPY_ACTION, getStatusFromStateLib
} = require('../utils');
const appConfig = require('../appConfig');

// This returns the activation ID of the action that it called
async function main(args) {
    const logger = getAioLogger();
    let payload;
    const {
        adminPageUri, projectExcelPath, projectRoot
    } = args;
    appConfig.setAppConfig(args);
    const projectPath = `${projectRoot}${projectExcelPath}`;
    try {
        if (!projectRoot || !projectExcelPath) {
            payload = 'Could not determine the project path. Try reloading the page and trigger the action again.';
            logger.error(payload);
        } else if (!adminPageUri) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            updateStatusToStateLib(projectPath, PROJECT_STATUS.COMPLETED_WITH_ERROR, payload, '', COPY_ACTION);
            logger.error(payload);
        } else {
            const storeValue = await getStatusFromStateLib(projectPath);
            if (!appConfig.getSkipInProgressCheck() &&
                storeValue?.action?.status === PROJECT_STATUS.IN_PROGRESS) {
                payload = 'A copy action project is already in progress.';
                logger.error(payload);
            } else {
                await updateStatusToStateLib(projectPath, PROJECT_STATUS.IN_PROGRESS, 'Triggering copy action', '', COPY_ACTION);
                const ow = openwhisk();
                return ow.actions.invoke({
                    name: 'milo-fg/copy-worker',
                    blocking: false, // this is the flag that instructs to execute the worker asynchronous
                    result: false,
                    params: args
                }).then((result) => {
                    logger.info(result);
                    //  attaching activation id to the status
                    updateStatusToStateLib(projectPath, PROJECT_STATUS.IN_PROGRESS, undefined, result.activationId, COPY_ACTION);
                    return {
                        code: 200,
                        body: { Success: result },
                    };
                }).catch((err) => {
                    updateStatusToStateLib(projectPath, PROJECT_STATUS.COMPLETED_WITH_ERROR, `Failed to invoke actions ${err.message}`, undefined, COPY_ACTION);
                    logger.error('Failed to invoke actions', err);
                    return {
                        code: 500,
                        body: { Error: err }
                    };
                });
            }
            return {
                code: 500,
                body: { Error: payload },
            };
        }
    } catch (err) {
        updateStatusToStateLib(projectPath, PROJECT_STATUS.COMPLETED_WITH_ERROR, `Failed to invoke actions ${err.message}`, undefined, COPY_ACTION);
        logger.error(err);
        payload = err;
    }

    return { payload };
}

exports.main = main;

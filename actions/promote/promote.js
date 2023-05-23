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
    getAioLogger, updateStatusToStateLib, getStatusFromStateLib, PROMOTE_ACTION
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
    try {
        if (!projectRoot) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
            payload = await updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, payload, '', PROMOTE_ACTION);
        } else {
            const storeValue = await getStatusFromStateLib(projectRoot);
            if (!appConfig.getSkipInProgressCheck() &&
            (storeValue?.action?.status === PROJECT_STATUS.IN_PROGRESS ||
                storeValue?.action?.status === PROJECT_STATUS.STARTED)) {
                payload = `A promote action project with activationid: ${storeValue?.action?.activationId} is already in progress. 
                Not triggering this action. And the previous action can be retrieved by refreshing the console page`;
                storeValue.action.status = PROJECT_STATUS.FAILED;
                storeValue.action.message = payload;
                payload = storeValue;
            } else {
                payload = await updateStatusToStateLib(projectRoot, PROJECT_STATUS.STARTED, 'Triggering promote action', '', PROMOTE_ACTION);
                const ow = openwhisk();
                return ow.actions.invoke({
                    name: 'milo-fg/promote-worker',
                    blocking: false, // this is the flag that instructs to execute the worker asynchronous
                    result: false,
                    params: args
                }).then(async (result) => {
                    logger.info(result);
                    //  attaching activation id to the status
                    payload = await updateStatusToStateLib(projectRoot, PROJECT_STATUS.IN_PROGRESS, undefined, result.activationId, PROMOTE_ACTION);
                    return {
                        code: 200,
                        payload
                    };
                }).catch(async (err) => {
                    payload = await updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
                    return {
                        code: 500,
                        payload
                    };
                });
            }
            return {
                code: 500,
                payload
            };
        }
    } catch (err) {
        logger.error(err);
        payload = updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
    }

    return {
        code: 500,
        payload,
    };
}

exports.main = main;

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
const { projectInProgress, PROJECT_STATUS } = require('../project');
const {
    getAioLogger, updateStatusToStateLib, getStatusFromStateLib, PROMOTE_ACTION, actInProgress
} = require('../utils');
const appConfig = require('../appConfig');
const { isAuthorizedUser } = require('../sharepoint');

// This returns the activation ID of the action that it called
async function main(args) {
    const logger = getAioLogger();
    let payload;
    const {
        spToken, adminPageUri, projectExcelPath, fgRootFolder
    } = args;
    appConfig.setAppConfig(args);
    try {
        if (!fgRootFolder) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
            payload = await updateStatusToStateLib(fgRootFolder, PROJECT_STATUS.FAILED, payload, '', PROMOTE_ACTION);
        } else {
            const ow = openwhisk();
            const storeValue = await getStatusFromStateLib(fgRootFolder);
            const actId = storeValue?.action?.activationId;
            const svStatus = storeValue?.action?.status;
            const accountDtls = await isAuthorizedUser(spToken);
            if (!accountDtls) {
                payload = 'Could not determine the user.';
                logger.error(payload);
            } else if (!appConfig.getSkipInProgressCheck() && await actInProgress(ow, actId, projectInProgress(svStatus))) {
                payload = `A promote action project with activationid: ${storeValue?.action?.activationId} is already in progress. 
                Not triggering this action. And the previous action can be retrieved by refreshing the console page`;
                storeValue.action.status = PROJECT_STATUS.FAILED;
                storeValue.action.message = payload;
                payload = storeValue;
            } else {
                payload = await updateStatusToStateLib(fgRootFolder, PROJECT_STATUS.STARTED, 'Triggering promote action', '', PROMOTE_ACTION);
                return ow.actions.invoke({
                    name: 'milo-fg/promote-worker',
                    blocking: false, // this is the flag that instructs to execute the worker asynchronous
                    result: false,
                    params: args
                }).then(async (result) => {
                    logger.info(result);
                    //  attaching activation id to the status
                    payload = await updateStatusToStateLib(fgRootFolder, PROJECT_STATUS.IN_PROGRESS, undefined, result.activationId, PROMOTE_ACTION);
                    return {
                        code: 200,
                        payload
                    };
                }).catch(async (err) => {
                    payload = await updateStatusToStateLib(fgRootFolder, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
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
        payload = updateStatusToStateLib(fgRootFolder, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
    }

    return {
        code: 500,
        payload,
    };
}

exports.main = main;

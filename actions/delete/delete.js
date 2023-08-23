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
const {
    getAioLogger, actInProgress, DELETE_ACTION
} = require('../utils');
const appConfig = require('../appConfig');
const sharepointAuth = require('../sharepointAuth');
const FgStatus = require('../fgStatus');
const FgUser = require('../fgUser');

// This returns the activation ID of the action that it called
async function main(args) {
    const logger = getAioLogger();
    let payload;
    const {
        spToken, adminPageUri, projectExcelPath, rootFolder
    } = args;
    appConfig.setAppConfig(args);
    const projectPath = `${rootFolder}${projectExcelPath}`;
    const userDetails = sharepointAuth.getUserDetails(spToken);
    const fgStatus = new FgStatus({ action: DELETE_ACTION, statusKey: `${DELETE_ACTION}~${projectPath}`, userDetails });
    logger.info(`Delete action for ${projectPath} triggered by ${JSON.stringify(userDetails)}`);
    try {
        if (!rootFolder || !projectExcelPath) {
            payload = 'Could not determine the project path. Try reloading the page and trigger the action again.';
            logger.error(payload);
        } else if (!adminPageUri) {
            payload = 'Required data is not available to proceed with Delete action.';
            logger.error(payload);
            payload = await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: payload
            });
        } else {
            const ow = openwhisk();
            const storeValue = await fgStatus.getStatusFromStateLib();
            const actId = storeValue?.action?.activationId;
            const svStatus = storeValue?.action?.status;
            const fgUser = new FgUser({ at: args.spToken });
            if (!await fgUser.isUser()) {
                payload = 'Could not determine the user.';
                logger.error(payload);
            } else if (!appConfig.getSkipInProgressCheck() &&
                await actInProgress(ow, actId, FgStatus.isInProgress(svStatus))) {
                payload = `A delete action with activationid: ${storeValue?.action?.activationId} is already in progress. 
                Not triggering this action. And the previous action can be retrieved by refreshing the console page`;
                storeValue.action.status = FgStatus.PROJECT_STATUS.FAILED;
                storeValue.action.message = payload;
                payload = storeValue;
            } else {
                payload = await fgStatus.updateStatusToStateLib({
                    status: FgStatus.PROJECT_STATUS.STARTED,
                    statusMessage: 'Triggering delete action'
                });
                return ow.actions.invoke({
                    name: 'milo-fg/delete-worker',
                    blocking: false, // this is the flag that instructs to execute the worker asynchronous
                    result: false,
                    params: args
                }).then(async (result) => {
                    logger.info(result);
                    //  attaching activation id to the status
                    payload = await fgStatus.updateStatusToStateLib({
                        status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                        activationId: result.activationId
                    });
                    return {
                        code: 200,
                        payload
                    };
                }).catch(async (err) => {
                    payload = await fgStatus.updateStatusToStateLib({
                        status: FgStatus.PROJECT_STATUS.FAILED,
                        statusMessage: `Failed to invoke actions ${err.message}`
                    });
                    logger.error('Failed to invoke actions', err);
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
        payload = fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.FAILED,
            statusMessage: `Failed to invoke actions ${err.message}`
        });
        logger.error(err);
    }

    return {
        code: 500,
        payload,
    };
}

exports.main = main;

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

// This returns the activation ID of the action that it called
async function main(args) {
    const logger = getAioLogger();
    let payload;
    const {
        spToken, adminPageUri, projectExcelPath, projectRoot
    } = args;
    try {
        if (!projectRoot) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!spToken || !adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, payload, '', PROMOTE_ACTION);
            logger.error(payload);
        } else {
            const storeValue = await getStatusFromStateLib(projectRoot);
            if (storeValue?.action?.status === PROJECT_STATUS.IN_PROGRESS) {
                payload = 'A promote action project is already in progress.';
                logger.error(payload);
            } else {
                updateStatusToStateLib(projectRoot, PROJECT_STATUS.IN_PROGRESS, 'Triggering promote action', '', PROMOTE_ACTION);
                const ow = openwhisk();
                return ow.actions.invoke({
                    name: 'milo-fg/promote-worker',
                    blocking: false, // this is the flag that instructs to execute the worker asynchronous
                    result: false,
                    params: args
                }).then((result) => {
                    logger.info(result);
                    //  attaching activation id to the status
                    updateStatusToStateLib(projectRoot, PROJECT_STATUS.IN_PROGRESS, undefined, result.activationId, PROMOTE_ACTION);
                    return {
                        code: 200,
                        body: { Success: result },
                    };
                }).catch((err) => {
                    updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
                    logger.error('failed to invoke actions', err);
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
        logger.error(err);
        updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, `Failed to invoke actions ${err.message}`, undefined, PROMOTE_ACTION);
        payload = err;
    }

    return {
        body: payload,
    };
}

exports.main = main;

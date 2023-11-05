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
    getAioLogger, DELETE_ACTION
} = require('../utils');
const FgStatus = require('../fgStatus');
const FgAction = require('../FgAction');
const appConfig = require('../appConfig');

// This returns the activation ID of the action that it called
async function main(args) {
    const logger = getAioLogger();
    let respPayload;
    const valParams = {
        statParams: ['fgRootFolder', 'projectExcelPath'],
        actParams: ['adminPageUri'],
        checkUser: true,
        checkStatus: true,
        checkActivation: true
    };
    const ow = openwhisk();
    // Initialize action
    const fgAction = new FgAction(DELETE_ACTION, args);
    fgAction.init({ ow });
    const { fgStatus } = fgAction.getActionParams();
    try {
        // Validations
        const vStat = await fgAction.validateAction(valParams);
        if (vStat && vStat.code !== 200) {
            return exitAction(vStat);
        }
        fgAction.logStart();

        respPayload = await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.STARTED,
            statusMessage: 'Triggering delete action'
        });
        return exitAction(ow.actions.invoke({
            name: 'milo-fg/delete-worker',
            blocking: false, // this is the flag that instructs to execute the worker asynchronous
            result: false,
            params: args
        }).then(async (result) => {
            logger.info(result);
            //  attaching activation id to the status
            respPayload = await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                activationId: result.activationId
            });
            return {
                code: 200,
                payload: respPayload
            };
        }).catch(async (err) => {
            respPayload = await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: `Failed to invoke actions ${err.message}`
            });
            logger.error('Failed to invoke actions', err);
            return {
                code: 500,
                payload: respPayload
            };
        }));
    } catch (err) {
        respPayload = fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.FAILED,
            statusMessage: `Failed to invoke actions ${err.message}`
        });
        logger.error(err);
    }

    return exitAction({
        code: 500,
        payload: respPayload,
    });
}

function exitAction(resp) {
    appConfig.removePayload();
    return resp;
}

exports.main = main;

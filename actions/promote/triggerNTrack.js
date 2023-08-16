/* eslint-disable no-await-in-loop */
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

const openwhisk = require('openwhisk');
const { updateExcelTable } = require('../sharepoint');
const {
    getAioLogger, PROMOTE_ACTION, PROMOTE_BATCH, actInProgress
} = require('../utils');
const appConfig = require('../appConfig');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');
const BatchManager = require('../batchManager');

const logger = getAioLogger();

async function main(params) {
    let stepMsg;
    appConfig.setAppConfig(params);

    const batchManager = new BatchManager({ key: PROMOTE_ACTION });
    await batchManager.init();
    // Read instance_info.json
    const instanceContent = await batchManager.getInstanceData();
    if (!instanceContent || !instanceContent.dtls) {
        return { body: 'None to run!' };
    }

    const { batchesInfo } = instanceContent.dtls;

    const ow = openwhisk();
    // Reset with inputs
    appConfig.setAppConfig({
        ...params, ...instanceContent.dtls
    });
    const payload = appConfig.getPayload();

    const fgStatus = new FgStatus({ action: PROMOTE_ACTION, statusKey: payload.fgRootFolder });
    try {
        if (!payload.fgRootFolder) {
            stepMsg = 'Required data is not available to proceed with FG Promote action.';
            logger.error(stepMsg);
        } else if (!payload.adminPageUri || !payload.projectExcelPath) {
            stepMsg = 'Required data is not available to proceed with FG Promote action.';
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: stepMsg
            });
            logger.error(stepMsg);
        } else {
            urlInfo.setUrlInfo(payload.adminPageUri);
            stepMsg = 'Getting status of all reference activation.';
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: stepMsg
            });

            // Check to see all batches are complete
            const batchCheckResp = await checkBatchesInProg(payload.fgRootFolder, batchesInfo, ow);
            const { anyInProg, allDone } = batchCheckResp;
            await batchManager.writeToInstanceFile(instanceContent);

            // Collect status and mark as complete
            if (allDone) {
                await completePromote(payload.projectExcelPath, batchesInfo, batchManager, fgStatus);
                await batchManager.writeToInstanceFile(instanceContent);
            } else if (!anyInProg) {
                // Trigger next activation
                const nextItem = batchesInfo.find((b) => !b.activationId);
                const batchNumber = nextItem?.batchNumber;
                if (batchNumber) {
                    const newActDtls = await triggerPromoteWorkerAction(ow,
                        {
                            ...appConfig.getPassthruParams(),
                            batchNumber
                        },
                        fgStatus);
                    nextItem.activationId = newActDtls?.activationId;
                }
                await batchManager.writeToInstanceFile(instanceContent);
            }

            stepMsg = 'Promote trigger and track completed.';
            logger.info(stepMsg);
        }
    } catch (err) {
        logger.error(err);
        stepMsg = err;
        // In case of error log status with end time
        try {
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
                statusMessage: err.message,
            });
        } catch (err2) {
            logger.info('Error while updatnig failed status');
        }
    }
    return {
        body: stepMsg,
    };
}

/**
 * Checks if activation is in progress by inspecting state and activations
 * @param {*} fgRootFolder Root folder
 * @param {*} actDtls activation details like activation id
 * @param {*} ow Openwisk api interface
 * @returns flag if any activation is in progress
 */
async function checkBatchesInProg(fgRootFolder, actDtls, ow) {
    let fgStatus;
    let batchInProg = false;
    let allDone = true;
    let counter = 0;
    for (; counter < actDtls?.length && !batchInProg; counter += 1) {
        const { batchNumber, activationId, done } = actDtls[counter];
        if (activationId && !done) {
            fgStatus = new FgStatus({
                action: `${PROMOTE_BATCH}_${batchNumber}`,
                statusKey: `${fgRootFolder}~Batch_${batchNumber}`
            });
            batchInProg = await fgStatus?.getStatusFromStateLib().then((result) => {
                if (result.action && FgStatus.isInProgress(result.action.status)) {
                    return true;
                }
                return false;
            });
            if (batchInProg) batchInProg = await actInProgress(ow, activationId, batchInProg);
            actDtls[counter].done = !batchInProg;
            allDone &&= !batchInProg;
        } else {
            allDone &&= done;
        }
    }

    return { anyInProg: batchInProg, allDone };
}

async function triggerPromoteWorkerAction(ow, params, fgStatus) {
    return ow.actions.invoke({
        name: 'milo-fg/promote-worker',
        blocking: false, // this is the flag that instructs to execute the worker asynchronous
        result: false,
        params
    }).then(async (result) => {
        // attaching activation id to the status
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            activationId: result.activationId
        });
        return {
            batchNumber: params.batchNumber,
            activationId: result.activationId
        };
    }).catch(async (err) => {
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.FAILED,
            statusMessage: `Failed to invoke actions ${err.message} for batch ${params.batchNumber}`
        });
        logger.error('Failed to invoke actions', err);
        return {
            batchNumber: params.batchNumber
        };
    });
}

/**
 * Marks the proocess as complete and collects all errors and updates excel.
 * @param {*} projectExcelPath Project excel where status needs to be updated
 * @param {*} actDtls activation details like id
 * @param {*} batchManager BatchManager to get batch details like path
 * @param {*} fgStatus Floodgate status instance to update state
 */
async function completePromote(projectExcelPath, actDtls, batchManager, fgStatus) {
    let batchNumber;
    let results;
    const failedPromotes = [];
    const failedPreviews = [];
    const failedPublishes = [];
    for (let i = 0; i < actDtls?.length || 0; i += 1) {
        batchNumber = actDtls[i].batchNumber;
        try {
            batchManager.initBatch({ batchNumber });
            const batch = await batchManager.getCurrentBatch();
            results = await batch.getResultsContent();
            if (results?.failedPromotes?.length > 0) {
                failedPromotes.push(...results.failedPromotes);
            }
            if (results?.failedPreviews?.length > 0) {
                failedPreviews.push(...results.failedPreviews);
            }
            if (results?.failedPublishes?.length > 0) {
                failedPublishes.push(...results.failedPublishes);
            }
        } catch (err) {
            logger.error(`Error while reading batch content in tracker ${err}`);
        }
    }

    const fgErrors = failedPromotes.length > 0 || failedPreviews.length > 0 ||
        failedPublishes.length > 0;

    // Write to Excel
    await fgStatus.updateStatusToStateLib({
        status: fgErrors ? FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR : FgStatus.PROJECT_STATUS.COMPLETED,
        statusMessage: fgErrors ?
            'Error occurred when promoting floodgated content. Check project excel sheet for additional information.' :
            'Promoted floodgate tree successfully.'
    });

    const { startTime: startPromote, endTime: endPromote } = fgStatus.getStartEndTime();
    const excelValues = [['PROMOTE', startPromote, endPromote, failedPromotes.join('\n'), failedPreviews.join('\n'), failedPublishes.join('\n')]];
    await updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues);
    logger.info('Project excel file updated with promote status.');

    await batchManager.markComplete();
    logger.info('Marked complete in batch manager.');
}

exports.main = main;

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
const { getProjectDetails, updateProjectWithDocs } = require('../project');
const {
    updateExcelTable, getFile, saveFile, copyFile, bulkCreateFolders
} = require('../sharepoint');
const {
    getAioLogger, handleExtension, delay, PREVIEW, logMemUsage, COPY_ACTION
} = require('../utils');
const helixUtils = require('../helixUtils');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');
const FgAction = require('../FgAction');
const sharepointAuth = require('../sharepointAuth');

const BATCH_REQUEST_COPY = 20;
const DELAY_TIME_COPY = 3000;
const ENABLE_HLX_PREVIEW = false;

async function main(params) {
    logMemUsage();
    const logger = getAioLogger();
    let respPayload;
    const valParams = {
        statParams: ['rootFolder', 'projectExcelPath'],
        actParams: ['adminPageUri'],
    };
    const ow = openwhisk();
    // Initialize action
    const fgAction = new FgAction(COPY_ACTION, params);
    fgAction.init({ ow, skipUserDetails: true });
    const { fgStatus, appConfig } = fgAction.getActionParams();
    const { adminPageUri, projectExcelPath, fgColor } = appConfig.getPayload();
    try {
        // Validations
        const vStat = await fgAction.validateAction(valParams);
        if (vStat && vStat.code !== 200) {
            return vStat;
        }

        urlInfo.setUrlInfo(adminPageUri);
        respPayload = 'Getting all files to be floodgated from the project excel file';
        logger.info(respPayload);
        fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            statusMessage: respPayload
        });

        const projectDetail = await getProjectDetails(projectExcelPath);

        respPayload = 'Injecting sharepoint data';
        logger.info(respPayload);
        fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            statusMessage: respPayload
        });
        await updateProjectWithDocs(projectDetail);

        respPayload = 'Start floodgating content';
        logger.info(respPayload);
        fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            statusMessage: respPayload
        });

        respPayload = await floodgateContent(projectExcelPath, projectDetail, fgStatus, fgColor);
    } catch (err) {
        fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
            statusMessage: err.message
        });
        logger.error(err);
        respPayload = err;
    }
    logMemUsage();
    return {
        body: respPayload,
    };
}

async function floodgateContent(projectExcelPath, projectDetail, fgStatus, fgColor) {
    const logger = getAioLogger();
    logger.info('Floodgating content started.');

    async function copyFilesToFloodgateTree(fileInfo) {
        const status = { success: false };
        if (!fileInfo?.doc) return status;

        try {
            const srcPath = fileInfo.doc.filePath;
            logger.info(`Copying ${srcPath} to floodgated folder`);

            let copySuccess = false;
            const destinationFolder = `${srcPath.substring(0, srcPath.lastIndexOf('/'))}`;
            copySuccess = await copyFile(srcPath, destinationFolder, undefined, true);
            if (copySuccess === false) {
                logger.info(`Copy was not successful for ${srcPath}. Alternate copy option will be used`);
                const file = await getFile(fileInfo.doc);
                if (file) {
                    const destination = fileInfo.doc.filePath;
                    if (destination) {
                        // Save the file in the floodgate destination location
                        const saveStatus = await saveFile(file, destination, true);
                        if (saveStatus.success) {
                            copySuccess = true;
                        }
                    }
                }
            }
            status.success = copySuccess;
            status.srcPath = srcPath;
            status.url = fileInfo.doc.url;
        } catch (error) {
            logger.error(`Error occurred when trying to copy files to floodgated content folder ${error.message}`);
        }
        return status;
    }

    // create batches to process the data
    const contentToFloodgate = [...projectDetail.urls];
    const batchArray = [];
    for (let i = 0; i < contentToFloodgate.length; i += BATCH_REQUEST_COPY) {
        const arrayChunk = contentToFloodgate.slice(i, i + BATCH_REQUEST_COPY);
        batchArray.push(arrayChunk);
    }

    // process data in batches
    const copyStatuses = [];
    // Get the access token to cache, avoidid parallel hits to this in below loop.
    await sharepointAuth.getAccessToken();
    for (let i = 0; i < batchArray.length; i += 1) {
        // Log memory usage per batch as copy is a heavy operation. Can be removed after testing are done.
        // Can be replaced with logMemUsageIter for regular logging
        logMemUsage();
        logger.info(`Batch create folder ${i} in progress`);
        // eslint-disable-next-line no-await-in-loop
        await bulkCreateFolders(batchArray[i], true);
        logger.info(`Batch copy ${i} in progress`);
        // eslint-disable-next-line no-await-in-loop
        copyStatuses.push(...await Promise.all(
            batchArray[i].map((files) => copyFilesToFloodgateTree(files[1])),
        ));
        logger.info(`Batch copy ${i} completed`);
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await delay(DELAY_TIME_COPY);
    }
    logger.info('Completed floodgating documents listed in the project excel');

    logger.info('Previewing floodgated files... ');
    const previewStatuses = [];
    if (ENABLE_HLX_PREVIEW) {
        for (let i = 0; i < copyStatuses.length; i += 1) {
            if (copyStatuses[i].success) {
                const extn = handleExtension(copyStatuses[i].srcPath);
                // eslint-disable-next-line no-await-in-loop
                const result = await helixUtils.simulatePreviewPublish(extn, PREVIEW, true, fgColor);
                previewStatuses.push(result);
            }
            // eslint-disable-next-line no-await-in-loop
            await delay();
        }
    }
    logger.info('Completed generating Preview for floodgated files.');
    const failedCopies = copyStatuses.filter((status) => !status.success)
        .map((status) => status.srcPath || 'Path Info Not available');
    const failedPreviews = previewStatuses.filter((status) => !status.success)
        .map((status) => status.path);
    const fgErrors = failedCopies.length > 0 || failedPreviews.length > 0;
    const payload = fgErrors ?
        'Error occurred when floodgating content. Check project excel sheet for additional information.' :
        'All tasks for Floodgate Copy completed';
    await fgStatus.updateStatusToStateLib({
        status: fgErrors ? FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR : FgStatus.PROJECT_STATUS.COMPLETED,
        statusMessage: payload
    });

    const { startTime: startCopy, endTime: endCopy } = fgStatus.getStartEndTime();
    const excelValues = [['COPY', startCopy, endCopy, failedCopies.join('\n'), failedPreviews.join('\n')]];
    await updateExcelTable(projectExcelPath, 'COPY_STATUS', excelValues);
    logger.info('Project excel file updated with copy status.');

    return payload;
}

exports.main = main;

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

const { getProjectDetails, updateProjectWithDocs } = require('../project');
const {
    updateExcelTable, getFile, saveFile, copyFile, bulkCreateFolders
} = require('../sharepoint');
const {
    getAioLogger, simulatePreviewPublish, handleExtension, delay, PREVIEW, logMemUsage, COPY_ACTION
} = require('../utils');
const appConfig = require('../appConfig');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');

const BATCH_REQUEST_COPY = 20;
const DELAY_TIME_COPY = 3000;
const ENABLE_HLX_PREVIEW = false;

async function main(params) {
    const logger = getAioLogger();
    logMemUsage();
    let payload;
    const {
        adminPageUri, projectExcelPath, rootFolder
    } = params;
    appConfig.setAppConfig(params);
    const projectPath = `${rootFolder}${projectExcelPath}`;
    const fgStatus = new FgStatus({ action: COPY_ACTION, statusKey: projectPath });
    try {
        if (!rootFolder || !projectExcelPath) {
            payload = 'Could not determine the project path. Try reloading the page and trigger the action again.';
            logger.error(payload);
        } else if (!adminPageUri) {
            payload = 'Required data is not available to proceed with FG Copy action.';
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: payload
            });
            logger.error(payload);
        } else {
            urlInfo.setUrlInfo(adminPageUri);
            payload = 'Getting all files to be floodgated from the project excel file';
            logger.info(payload);
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });

            const projectDetail = await getProjectDetails(projectExcelPath);

            payload = 'Injecting sharepoint data';
            logger.info(payload);
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });
            await updateProjectWithDocs(projectDetail);

            payload = 'Start floodgating content';
            logger.info(payload);
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });

            payload = await floodgateContent(projectExcelPath, projectDetail, fgStatus);
        }
    } catch (err) {
        fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
            statusMessage: err.message
        });
        logger.error(err);
        payload = err;
    }
    logMemUsage();
    return {
        body: payload,
    };
}

async function floodgateContent(projectExcelPath, projectDetail, fgStatus) {
    const logger = getAioLogger();
    logger.info('Floodgating content started.');

    async function copyFilesToFloodgateTree(fileInfo) {
        const status = { success: false };
        if (!fileInfo?.doc) return status;

        try {
            const srcPath = fileInfo.doc.filePath;
            logger.info(`Copying ${srcPath} to pink folder`);

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
                // eslint-disable-next-line no-await-in-loop
                const result = await simulatePreviewPublish(handleExtension(copyStatuses[i].srcPath), PREVIEW, 1, true);
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

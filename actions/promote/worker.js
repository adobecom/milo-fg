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

const { getConfig } = require('../config');
const { PROJECT_STATUS } = require('../project');
const {
    getAuthorizedRequestOption, saveFile, updateExcelTable, getFileUsingDownloadUrl, fetchWithRetry
} = require('../sharepoint');
const {
    getAioLogger, simulatePreview, handleExtension, updateStatusToStateLib, PROMOTE_ACTION, delay
} = require('../utils');
const appConfig = require('../appConfig');

const BATCH_REQUEST_PROMOTE = 20;
const DELAY_TIME_PROMOTE = 3000;
const MAX_CHILDREN = 1000;

async function main(params) {
    const logger = getAioLogger();
    let payload;
    const {
        adminPageUri, projectExcelPath, projectRoot
    } = params;
    appConfig.setAppConfig(params);

    try {
        if (!projectRoot) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.FAILED, payload, undefined, PROMOTE_ACTION);
            logger.error(payload);
        } else {
            payload = 'Getting all files to be promoted';
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.IN_PROGRESS, payload, undefined, PROMOTE_ACTION);
            logger.info(payload);

            payload = await promoteFloodgatedFiles(adminPageUri, projectExcelPath);
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.COMPLETED, payload, undefined, PROMOTE_ACTION);
        }
    } catch (err) {
        updateStatusToStateLib(projectRoot, PROJECT_STATUS.COMPLETED_WITH_ERROR, err.message, undefined, PROMOTE_ACTION);
        logger.error(err);
        payload = err;
    }

    return {
        body: payload,
    };
}

/**
 * Find all files in the pink tree to promote.
 */
async function findAllFiles(adminPageUri) {
    const { sp } = await getConfig(adminPageUri);
    const baseURI = `${sp.api.excel.update.fgBaseURI}`;
    const rootFolder = baseURI.split('/').pop();
    const options = await getAuthorizedRequestOption({ method: 'GET' });

    return findAllFloodgatedFiles(baseURI, options, rootFolder, [], ['']);
}

/**
 * Iteratively finds all files under a specified root folder.
 */
async function findAllFloodgatedFiles(baseURI, options, rootFolder, fgFiles, fgFolders) {
    while (fgFolders.length !== 0) {
        const uri = `${baseURI}${fgFolders.shift()}:/children?$top=${MAX_CHILDREN}`;
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchWithRetry(uri, options);
        if (res.ok) {
            // eslint-disable-next-line no-await-in-loop
            const json = await res.json();
            const driveItems = json.value;
            driveItems?.forEach((item) => {
                const itemPath = `${item.parentReference.path.replace(`/drive/root:/${rootFolder}`, '')}/${item.name}`;
                if (item.folder) {
                    // it is a folder
                    fgFolders.push(itemPath);
                } else {
                    const downloadUrl = item['@microsoft.graph.downloadUrl'];
                    fgFiles.push({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                }
            });
        }
    }

    return fgFiles;
}

/**
 * Copies the Floodgated files back to the main content tree.
 * Creates intermediate folders if needed.
 */
async function promoteCopy(adminPageUri, srcPath, destinationFolder) {
    const { sp } = await getConfig(adminPageUri);
    const { baseURI } = sp.api.file.copy;
    const rootFolder = baseURI.split('/').pop();
    const payload = { ...sp.api.file.copy.payload, parentReference: { path: `${rootFolder}${destinationFolder}` } };
    const options = await getAuthorizedRequestOption({
        method: sp.api.file.copy.method,
        body: JSON.stringify(payload),
    });

    // copy source is the pink directory for promote
    const copyStatusInfo = await fetchWithRetry(`${sp.api.file.copy.fgBaseURI}${srcPath}:/copy?@microsoft.graph.conflictBehavior=replace`, options);
    const statusUrl = copyStatusInfo.headers.get('Location');
    let copySuccess = false;
    let copyStatusJson = {};
    while (statusUrl && !copySuccess && copyStatusJson.status !== 'failed') {
        // eslint-disable-next-line no-await-in-loop
        const status = await fetchWithRetry(statusUrl);
        if (status.ok) {
            // eslint-disable-next-line no-await-in-loop
            copyStatusJson = await status.json();
            copySuccess = copyStatusJson.status === 'completed';
        }
    }
    return copySuccess;
}

async function promoteFloodgatedFiles(adminPageUri, projectExcelPath) {
    const logger = getAioLogger();

    async function promoteFile(downloadUrl, filePath) {
        const status = { success: false };
        try {
            let promoteSuccess = false;
            logger.info(`Promoting ${filePath}`);
            const destinationFolder = `${filePath.substring(0, filePath.lastIndexOf('/'))}`;
            const copyFileStatus = await promoteCopy(adminPageUri, filePath, destinationFolder);
            if (copyFileStatus) {
                promoteSuccess = true;
            } else {
                const file = await getFileUsingDownloadUrl(downloadUrl);
                const saveStatus = await saveFile(adminPageUri, file, filePath);
                if (saveStatus.success) {
                    promoteSuccess = true;
                }
            }
            status.success = promoteSuccess;
            status.srcPath = filePath;
        } catch (error) {
            const errorMessage = `Error occurred when trying to promote files to main content tree ${error.message}`;
            logger.error(errorMessage);
            throw new Error(errorMessage, error);
        }
        return status;
    }

    const startPromote = new Date();
    let payload = 'Getting all floodgated files to promote';
    // Iterate the floodgate tree and get all files to promote
    const allFloodgatedFiles = await findAllFiles(adminPageUri);
    // create batches to process the data
    const batchArray = [];
    for (let i = 0; i < allFloodgatedFiles.length; i += BATCH_REQUEST_PROMOTE) {
        const arrayChunk = allFloodgatedFiles.slice(i, i + BATCH_REQUEST_PROMOTE);
        batchArray.push(arrayChunk);
    }

    // process data in batches
    const promoteStatuses = [];
    for (let i = 0; i < batchArray.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        promoteStatuses.push(...await Promise.all(
            batchArray[i].map((file) => promoteFile(file.fileDownloadUrl, file.filePath)),
        ));
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await delay(DELAY_TIME_PROMOTE);
    }
    const endPromote = new Date();
    payload = 'Completed promoting all documents in the pink folder';
    logger.info(payload);

    logger.info('Previewing promoted files.');
    const previewStatuses = [];
    for (let i = 0; i < promoteStatuses.length; i += 1) {
        if (promoteStatuses[i].success) {
            // eslint-disable-next-line no-await-in-loop
            const result = await simulatePreview(handleExtension(promoteStatuses[i].srcPath), 1, false, adminPageUri);
            previewStatuses.push(result);
        }
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await delay();
    }
    payload = 'Completed generating Preview for promoted files.';
    logger.info(payload);

    const failedPromotes = promoteStatuses.filter((status) => !status.success)
        .map((status) => status.srcPath || 'Path Info Not available');
    const failedPreviews = previewStatuses.filter((status) => !status.success)
        .map((status) => status.path);

    const excelValues = [['PROMOTE', startPromote, endPromote, failedPromotes.join('\n'), failedPreviews.join('\n')]];
    await updateExcelTable(adminPageUri, projectExcelPath, 'PROMOTE_STATUS', excelValues);
    payload = 'Project excel file updated with promote status.';
    logger.info(payload);

    if (failedPromotes.length > 0 || failedPreviews.length > 0) {
        payload = 'Error occurred when promoting floodgated content. Check project excel sheet for additional information.';
        logger.info(payload);
        throw new Error(payload);
    } else {
        payload = 'Promoted floodgate tree successfully.';
        logger.info('Promoted floodgate tree successfully.');
    }

    payload = 'All tasks for Floodgate Promote completed';
    return payload;
}

exports.main = main;

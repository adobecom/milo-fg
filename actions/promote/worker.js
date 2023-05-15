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
    getAuthorizedRequestOption, createFolder, saveFile, updateExcelTable, getFileUsingDownloadUrl, fetchWithRetry
} = require('../sharepoint');
const {
    getAioLogger, simulatePreview, handleExtension, updateStatusToStateLib, PROMOTE_ACTION
} = require('../utils');
const appConfig = require('../appConfig');

const BATCH_REQUEST_PROMOTE = 20;
const DELAY_TIME_PROMOTE = 3000;
const MAX_CHILDREN = 1000;

async function main(params) {
    const logger = getAioLogger();
    appConfig.setAppConfig(params);
    let payload;
    const {
        spToken, adminPageUri, projectExcelPath, projectRoot
    } = params;
    try {
        if (!projectRoot) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!spToken || !adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.COMPLETED_WITH_ERROR, payload, undefined, PROMOTE_ACTION);
            logger.error(payload);
        } else {
            payload = 'Getting all files to be promoted';
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.IN_PROGRESS, payload, undefined, PROMOTE_ACTION);
            logger.info(payload);
            payload = await promoteFloodgatedFiles(spToken, adminPageUri, projectExcelPath);
            updateStatusToStateLib(projectRoot, PROJECT_STATUS.COMPLETED, '', undefined, PROMOTE_ACTION);
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
async function findAllFiles(spToken, adminPageUri) {
    const { sp } = await getConfig(adminPageUri);
    const baseURI = `${sp.api.excel.update.fgBaseURI}`;
    const rootFolder = baseURI.split('/').pop();
    const options = getAuthorizedRequestOption(spToken, { method: 'GET' });

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
async function promoteCopy(spToken, adminPageUri, srcPath, destinationFolder) {
    await createFolder(spToken, adminPageUri, destinationFolder);
    const { sp } = await getConfig(adminPageUri);
    const destRootFolder = `${sp.api.file.copy.baseURI}`.split('/').pop();

    const payload = { ...sp.api.file.copy.payload, parentReference: { path: `${destRootFolder}${destinationFolder}` } };
    const options = getAuthorizedRequestOption(spToken, {
        method: sp.api.file.copy.method,
        body: JSON.stringify(payload),
    });

    // copy source is the pink directory for promote
    const copyStatusInfo = await fetchWithRetry(`${sp.api.file.copy.fgBaseURI}${srcPath}:/copy`, options);
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

async function promoteFloodgatedFiles(spToken, adminPageUri, projectExcelPath) {
    const logger = getAioLogger();

    async function promoteFile(downloadUrl, filePath) {
        const status = { success: false };
        try {
            let promoteSuccess = false;
            logger.info(`Promoting ${filePath}`);
            const { sp } = await getConfig(adminPageUri);
            const options = getAuthorizedRequestOption(spToken);
            const res = await fetchWithRetry(`${sp.api.file.get.baseURI}${filePath}`, options);
            if (res.ok) {
                // File exists at the destination (main content tree)
                // Get the file in the pink directory using downloadUrl
                const file = await getFileUsingDownloadUrl(downloadUrl);
                if (file) {
                    // Save the file in the main content tree
                    const saveStatus = await saveFile(spToken, adminPageUri, file, filePath);
                    if (saveStatus.success) {
                        promoteSuccess = true;
                    }
                }
            } else {
                // File does not exist at the destination (main content tree)
                // File can be copied directly
                const destinationFolder = `${filePath.substring(0, filePath.lastIndexOf('/'))}`;
                promoteSuccess = await promoteCopy(spToken, adminPageUri, filePath, destinationFolder);
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
    // Iterate the floodgate tree and get all files to promote
    const allFloodgatedFiles = await findAllFiles(spToken, adminPageUri);
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
        await new Promise((resolve) => setTimeout(resolve, DELAY_TIME_PROMOTE));
    }
    const endPromote = new Date();
    logger.info('Completed promoting all documents in the pink folder');

    logger.info('Previewing promoted files.');
    const previewStatuses = await Promise.all(
        promoteStatuses
            .filter((status) => status.success)
            .map((status) => simulatePreview(handleExtension(status.srcPath), 1, false, adminPageUri)),
    );
    logger.info('Completed generating Preview for promoted files.');

    const failedPromotes = promoteStatuses.filter((status) => !status.success)
        .map((status) => status.srcPath || 'Path Info Not available');
    const failedPreviews = previewStatuses.filter((status) => !status.success)
        .map((status) => status.path);

    const excelValues = [['PROMOTE', startPromote, endPromote, failedPromotes.join('\n'), failedPreviews.join('\n')]];
    await updateExcelTable(spToken, adminPageUri, projectExcelPath, 'PROMOTE_STATUS', excelValues);
    logger.info('Project excel file updated with promote status.');

    if (failedPromotes.length > 0 || failedPreviews.length > 0) {
        logger.info('Error occurred when promoting floodgated content. Check project excel sheet for additional information.');
    } else {
        logger.info('Promoted floodgate tree successfully.');
    }

    return 'All tasks for Floodgate Promote completed';
}

exports.main = main;

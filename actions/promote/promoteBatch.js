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
const filesLib = require('@adobe/aio-lib-files');
const { getConfig } = require('../config');
const {
    getAuthorizedRequestOption, fetchWithRetry
} = require('../sharepoint');
const {
    getAioLogger, logMemUsage, delay, PROMOTE_ACTION
} = require('../utils');
const appConfig = require('../appConfig');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');
const BatchManager = require('../batchManager');

const logger = getAioLogger();
const MAX_CHILDREN = 5000;

/**
 * This is action interfacing method. The worker is split into two promoteBatch and worker.
 * This promoteBatch has following
 * 1. Searches for the files to be promoted (using msal search api)
 * 2. Using the batchmanger adds the files and this batchmanager splits into batches.
 * The batch information is also stored in manifest files and the actions are triggered
 * Following parameters are used and needs to be tweaked
 * 1. Number of files per batch - Assume 10k
 * 2. Number of activation per container - Assume 5
 * 3. Number of parallel copies - Assume 20
 * Assuming avg 5MB/file and assume that all parallel copies are loaded (i.e 20) total size is 100mb
 * and 5 container total is about 0.5gb and below treshold and can be tweaked.
 */
async function main(params) {
    const ow = openwhisk();
    logMemUsage();
    let payload;
    const {
        adminPageUri, projectExcelPath, fgRootFolder
    } = params;
    appConfig.setAppConfig(params);
    const fgStatus = new FgStatus({ action: PROMOTE_ACTION, statusKey: fgRootFolder });
    const filesSdk = await filesLib.init();
    const batchManager = new BatchManager({ action: PROMOTE_ACTION, filesSdk });
    // For current cleanup files before starting
    await batchManager.cleanupFiles();
    try {
        if (!fgRootFolder) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            logger.error(payload);
        } else if (!adminPageUri || !projectExcelPath) {
            payload = 'Required data is not available to proceed with FG Promote action.';
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: payload
            });
        } else {
            urlInfo.setUrlInfo(adminPageUri);
            payload = 'Getting all files to be promoted.';
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });
            logger.info(payload);
            payload = 'Creating batches.';
            payload = await createBatch(batchManager);
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });
            logger.info(payload);
            payload = 'Triggering activation.';
            payload = await triggerBatches(ow, params, batchManager, fgStatus);
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });
            logger.info(payload);
        }
    } catch (err) {
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
            statusMessage: err.message,
        });
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
async function findAllFiles() {
    const { sp } = await getConfig();
    const baseURI = `${sp.api.excel.update.fgBaseURI}`;
    const rootFolder = baseURI.split('/').pop();
    const options = await getAuthorizedRequestOption({ method: 'GET' });
    const promoteIgnoreList = appConfig.getPromoteIgnorePaths();
    logger.info(`Promote ignore list: ${promoteIgnoreList.toString()}`);

    // Temporarily restricting the iteration for promote to under /drafts folder only
    return findAllFloodgatedFiles(baseURI, options, rootFolder, [], ['/drafts'], promoteIgnoreList);
}

/**
 * Iteratively finds all files under a specified root folder.
 */
async function findAllFloodgatedFiles(baseURI, options, rootFolder, fgFiles, fgFolders, promoteIgnoreList) {
    while (fgFolders.length !== 0) {
        const uri = `${baseURI}${fgFolders.shift()}:/children?$top=${MAX_CHILDREN}`;
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchWithRetry(uri, options);
        if (res.ok) {
            // eslint-disable-next-line no-await-in-loop
            const json = await res.json();
            // eslint-disable-next-line no-await-in-loop
            const driveItems = json.value;
            driveItems?.forEach((item) => {
                const itemPath = `${item.parentReference.path.replace(`/drive/root:/${rootFolder}`, '')}/${item.name}`;
                if (!promoteIgnoreList.includes(itemPath)) {
                    if (item.folder) {
                        // it is a folder
                        fgFolders.push(itemPath);
                    } else {
                        const downloadUrl = item['@microsoft.graph.downloadUrl'];
                        fgFiles.push({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                    }
                } else {
                    logger.info(`Ignored from promote: ${itemPath}`);
                }
            });
        }
    }

    return fgFiles;
}

/**
 * Create batches based on configs and files to process
 * @param {*} batchManager BatchManager for creating batches.
 */
async function createBatch(batchManager) {
    let payload = 'Getting all floodgated files to promote.';
    // Iterate the floodgate tree and get all files to promote
    const allFgFiles = await findAllFiles();
    logger.info(`Total files to process ${allFgFiles?.length}`);
    // create batches to process the data
    for (let i = 0; i < allFgFiles.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        await batchManager.addFile(allFgFiles[i]);
    }
    await batchManager.saveRemainig();
    payload = 'Completed creating batches';
    return payload;
}

/**
 * The batches created by the BatchManager are pulled and manifest are updated along with trigger the actions.
 * @param {*} ow Openwish interface instance
 * @param {*} args args the this action (e.g. projectPath)
 * @param {*} batchManager BatchManager instance
 * @param {*} fgStatus Floodgate status to store the fields
 * @returns status with details of activations
 */
async function triggerBatches(ow, args, batchManager, fgStatus) {
    const batches = batchManager.getBatches();
    const actDtls = [];
    for (let i = 0; i < batches.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        actDtls.push(await triggerActivation(ow, args, batches[i], fgStatus));
    }
    await batchManager.addToManifest({ actDtls });
    await delay(60000); // Delay a bit
    const resp = await triggerTrackerActivation(ow, args, actDtls, fgStatus);
    // logger.info(`All actions triggered ${JSON.stringify(resp)}`);
    await fgStatus.updateStatusToStateLib({ batches: resp });
    return {
        status: 200,
        payload: { ...resp }
    };
}

/**
  * The batch for which the activation is triggered.
 * @param {*} ow Openwish interface instance
 * @param {*} args args the this action (e.g. projectPath)
 * @param {*} batch Batch for which activation is triggered
 * @param {*} fgStatus Floodgate status to store the fields
 * @returns status with details of activations
 * @returns status of activation
 */
async function triggerActivation(ow, args, batch, fgStatus) {
    return ow.actions.invoke({
        name: 'milo-fg/promote-worker',
        blocking: false, // this is the flag that instructs to execute the worker asynchronous
        result: false,
        params: { batchNumber: batch.getBatchNumber(), ...args }
    }).then(async (result) => {
        // attaching activation id to the status
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            activationId: result.activationId
        });
        return {
            batchNumber: batch.getBatchNumber(),
            activationId: result.activationId
        };
    }).catch(async (err) => {
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            statusMessage: `Failed to invoke actions ${err.message} for batch ${batch.getBatchNumber()}`
        });
        logger.error('Failed to invoke actions', err);
        return {
            batchNumber: batch.getBatchNumber()
        };
    });
}

/**
 * A tracker activation is triggered to track the progress of the batches and update accordingly
 * @param {*} ow Openwish interface instance
 * @param {*} args args the this action (e.g. projectPath)
 * @param {*} batchManager BatchManager instance
 * @param {*} fgStatus Floodgate status to store the fields
 * @returns Tracker activation details
 */
async function triggerTrackerActivation(ow, args, actDtls, fgStatus) {
    return ow.actions.invoke({
        name: 'milo-fg/promote-tracker',
        blocking: false, // this is the flag that instructs to execute the worker asynchronous
        result: false,
        params: { ...args, actDtls }
    }).then(async (result) => ({
        activationId: result.activationId,
        actDtls
    })).catch(async (err) => {
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
            statusMessage: `Failed to invoke actions ${err.message} for tracker`
        });
        return { actDtls };
    });
}

exports.main = main;

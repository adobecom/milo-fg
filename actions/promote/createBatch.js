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
const {
    getAuthorizedRequestOption, fetchWithRetry
} = require('../sharepoint');
const {
    getAioLogger, logMemUsage, getInstanceKey, PROMOTE_ACTION
} = require('../utils');
const appConfig = require('../appConfig');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');
const BatchManager = require('../batchManager');

const logger = getAioLogger();
const MAX_CHILDREN = 5000;

/**
 * This createBatch has following functions
 * 1. Searches for the files to be promoted (using msal search api)
 * 2. Splits these files to be promoted into batches based on maxFilesPerBatch parameter
 * The batch information are stored across files
 * promoteAction/tracker.json - Tracker file that stores the batching instances that needs to be processed. e.g. milo_pink or cc_pink
 * promoteAction/instance<instance e.g. _milo_pink>/instance.json - This stores the information of the batches and respective activation ids
 * promoteAction/instance_milo_pink/batch_<n>>/batch_info.json - This stores the files that needs to be processed by the batch
 * promoteAction/instance_milo_pink/batch_<n>/results.json - After the batch is process is completed results are stored (e.g. failed promotes)
 * Following parameters are used and needs to be tweaked
 * 1. Number of files per batch - Assume 10k
 * 2. Number of activation per container - Assume 5
 * 3. Number of parallel copies - Assume 20
 * Assuming avg 5MB/file and assume that all parallel copies are loaded (i.e 20) total size is 100mb
 * and 5 container total is about 0.5gb and below treshold and can be tweaked.
 */
async function main(params) {
    logMemUsage();
    let stepMsg;
    appConfig.setAppConfig(params);
    const payload = appConfig.getPayload();
    const fgStatus = new FgStatus({ action: PROMOTE_ACTION, statusKey: payload.fgRootFolder });
    const batchManager = new BatchManager({ key: PROMOTE_ACTION, instanceKey: getInstanceKey({ fgRootFolder: payload.fgRootFolder }) });
    await batchManager.init();
    // For current cleanup files before starting
    await batchManager.cleanupFiles();
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
        } else {
            urlInfo.setUrlInfo(payload.adminPageUri);
            stepMsg = 'Getting all files to be promoted.';
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: stepMsg
            });
            logger.info(stepMsg);
            stepMsg = 'Creating batches.';
            logger.info(stepMsg);
            stepMsg = await createBatch(batchManager);
            await fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: stepMsg,
                batchesInfo: batchManager.getBatchesInfo()
            });
            logger.info(stepMsg);

            // Finalize and Trigger N Track the batches
            await batchManager.finalizeInstance(appConfig.getPassthruParams());
            logger.info('Instance finalized and started');
        }
    } catch (err) {
        await fgStatus.updateStatusToStateLib({
            status: FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
            statusMessage: err.message,
        });
        logger.error(err);
        stepMsg = err;
    }

    return {
        body: stepMsg,
    };
}

/**
 * Find all files in the pink tree to promote. Add to batches
 */
async function createBatch(batchManager) {
    const { sp } = await getConfig();
    const options = await getAuthorizedRequestOption({ method: 'GET' });
    const promoteIgnoreList = appConfig.getPromoteIgnorePaths();
    logger.info(`Promote ignore list: ${promoteIgnoreList}`);

    // Temporarily restricting the iteration for promote to under /drafts folder only
    return findAndBatchFGFiles({
        baseURI: sp.api.file.get.fgBaseURI,
        options,
        fgFolders: ['/drafts'],
        promoteIgnoreList,
        downloadBaseURI: sp.api.file.download.baseURI
    }, batchManager);
}

/**
 * Iteratively finds all files under a specified root folder. Add them to batches
 */
async function findAndBatchFGFiles(
    {
        baseURI, options, fgFolders, promoteIgnoreList, downloadBaseURI
    }, batchManager
) {
    const fgRoot = baseURI.split(':').pop();
    const pPathRegExp = new RegExp(`.*:${fgRoot}`);
    while (fgFolders.length !== 0) {
        const uri = `${baseURI}${fgFolders.shift()}:/children?$top=${MAX_CHILDREN}`;
        // eslint-disable-next-line no-await-in-loop
        const res = await fetchWithRetry(uri, options);
        if (res.ok) {
            // eslint-disable-next-line no-await-in-loop
            const json = await res.json();
            // eslint-disable-next-line no-await-in-loop
            const driveItems = json.value;
            for (let di = 0; di < driveItems?.length; di += 1) {
                const item = driveItems[di];
                const itemPath = `${item.parentReference.path.replace(pPathRegExp, '')}/${item.name}`;
                if (!promoteIgnoreList?.includes(itemPath)) {
                    if (item.folder) {
                        // it is a folder
                        fgFolders.push(itemPath);
                    } else {
                        const downloadUrl = `${downloadBaseURI}/${item.id}/content`;
                        // eslint-disable-next-line no-await-in-loop
                        await batchManager.addFile({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                    }
                } else {
                    logger.info(`Ignored from promote: ${itemPath}`);
                }
            }
        }
    }
}

exports.main = main;

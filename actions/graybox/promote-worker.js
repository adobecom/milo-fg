/* ************************************************************************
* ADOBE CONFIDENTIAL
* ___________________
*
* Copyright 2024 Adobe
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

const { getAioLogger, isFilePatternMatched, toUTCStr } = require('../utils');
const { isGrayboxParamsValid } = require('./utils');
const appConfig = require('../appConfig');
const { getAuthorizedRequestOption, fetchWithRetry, updateExcelTable } = require('../sharepoint');
const { getConfig } = require('../config');

const logger = getAioLogger();
const MAX_CHILDREN = 1000;
const IS_GRAYBOX = true;

async function main(params) {
    let responsePayload;
    logger.info('Graybox Promote Worker invoked');

    if (!isGrayboxParamsValid(params)) {
        responsePayload = 'Required data is not available to proceed with Graybox Promote action.';
        logger.error(responsePayload);
        return exitAction({
            code: 400,
            payload: responsePayload
        });
    }

    appConfig.setAppConfig(params);
    const { fgRootFolder, experienceName } = appConfig.getPayload();

    logger.info(`GB ROOT FOLDER ::: ${fgRootFolder}`);
    logger.info(`GB EXP NAME ::: ${experienceName}`);

    // TODO - Get all files in the graybox folder for the specific experience name that need to be promoted
    // TODO - Bulk Preview docx files
    // TODO - GET markdown files using preview-url.md
    // TODO - Process markdown - process MDAST by cleaning it up
    // TODO - Generate updated Docx file using md2docx lib
    // TODO - copy updated docx file to the default content tree
    // TODO - run the bulk preview action on the list of files that were copied to default content tree
    // TODO - update the project excel file as and when necessary to update the status of the promote action

    // Get all files in the graybox folder for the specific experience name
    // NOTE: This does not capture content inside the locale/expName folders yet
    const fgFiles = await findAllFiles(experienceName, appConfig);
    logger.info(`Files in graybox folder in ${experienceName}`);
    logger.info(JSON.stringify(fgFiles));

    // Update project excel file with status (sample)
    logger.info('Updating project excel file with status');
    const curreDateTime = new Date();
    const { projectExcelPath } = appConfig.getPayload();
    const excelValues = [['Sample Excel Update', toUTCStr(curreDateTime), 'sukamat@adobe.com', '']];
    await updateExcelTable(projectExcelPath, 'PROMOTE_STATUS', excelValues, IS_GRAYBOX);
    logger.info('Project excel file updated with copy status.');

    responsePayload = 'Graybox Promote Worker action completed.';
    return exitAction({
        body: responsePayload,
    });
}

/**
 * Find all files in the Graybox tree to promote.
 */
async function findAllFiles(experienceName, appConf) {
    logger.info('inside findAllFiles');
    const { sp } = await getConfig();
    const options = await getAuthorizedRequestOption({ method: 'GET' });
    const promoteIgnoreList = appConf.getPromoteIgnorePaths();
    logger.info(`Promote ignore list: ${promoteIgnoreList}`);

    return findAllGrayboxFiles({
        baseURI: sp.api.file.get.fgBaseURI,
        options,
        fgFolders: appConf.isDraftOnly() ? [`/${experienceName}/drafts`] : [`/${experienceName}`],
        promoteIgnoreList,
        downloadBaseURI: sp.api.file.download.baseURI
    });
}

/**
 * Iteratively finds all files under a specified root folder. Add them to batches
 */
async function findAllGrayboxFiles({
    baseURI, options, fgFolders, promoteIgnoreList, downloadBaseURI
}) {
    const fgRoot = baseURI.split(':').pop();
    const pPathRegExp = new RegExp(`.*:${fgRoot}`);
    const fgFiles = [];
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
                if (!isFilePatternMatched(itemPath, promoteIgnoreList)) {
                    logger.info(`Item Path: ${itemPath}`);
                    if (item.folder) {
                        // it is a folder
                        fgFolders.push(itemPath);
                    } else {
                        const downloadUrl = `${downloadBaseURI}/${item.id}/content`;
                        // eslint-disable-next-line no-await-in-loop
                        fgFiles.push({ fileDownloadUrl: downloadUrl, filePath: itemPath });
                    }
                } else {
                    logger.info(`Ignored from promote: ${itemPath}`);
                }
            }
        }
    }
    return fgFiles;
}

function exitAction(resp) {
    appConfig.removePayload();
    return resp;
}

exports.main = main;

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

const { getExcelTable, getFilesData } = require('./sharepoint');
const {
    getAioLogger, getDocPathFromUrl
} = require('./utils');

const PROJECT_URL_TBL = 'URL';

async function getProjectDetails(projectExcelPath) {
    const logger = getAioLogger();
    logger.info('Getting paths from project excel worksheet');

    const urlsData = await getExcelTable(projectExcelPath, PROJECT_URL_TBL);
    const urls = new Map();
    const filePaths = new Map();
    urlsData.forEach((cols) => {
        const url = cols?.length && cols[0];
        const docPath = getDocPathFromUrl(url);
        urls.set(url, { doc: { filePath: docPath, url } });
        // Add urls data to filePaths map
        if (filePaths.has(docPath)) {
            filePaths.get(docPath).push(url);
        } else {
            filePaths.set(docPath, [url]);
        }
    });

    return {
        urls, filePaths
    };
}

/**
 * Makes the sharepoint file data part of `projectDetail` per URL.
 */
function injectSharepointData(projectUrls, filePaths, docPaths, spFiles) {
    for (let i = 0; i < spFiles.length; i += 1) {
        let fileBody = {};
        let status = 404;
        if (spFiles[i].fileSize) {
            fileBody = spFiles[i];
            status = 200;
        }
        const filePath = docPaths[i];
        const urls = filePaths.get(filePath);
        urls.forEach((key) => {
            const urlObjVal = projectUrls.get(key);
            urlObjVal.doc.sp = fileBody;
            urlObjVal.doc.sp.status = status;
        });
    }
}

async function updateProjectWithDocs(projectDetail) {
    const logger = getAioLogger();
    if (!projectDetail || !projectDetail.filePaths) {
        const errorMessage = 'Error occurred when injecting sharepoint data';
        logger.error(errorMessage);
        throw new Error(errorMessage);
    }
    const { filePaths } = projectDetail;
    const docPaths = [...filePaths.keys()];
    const spFiles = await getFilesData(docPaths);
    injectSharepointData(projectDetail.urls, filePaths, docPaths, spFiles);
}

module.exports = {
    getProjectDetails,
    updateProjectWithDocs,
};

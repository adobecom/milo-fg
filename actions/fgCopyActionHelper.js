/* ***********************************************************************
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
const {
    handleExtension,
    toUTCStr,
    inParallel,
    getAioLogger,
    logMemUsage
} = require('./utils');
const FgStatus = require('./fgStatus');

const BATCH_REQUEST_COPY = 20;

/**
 * Floodgate action helper routines
 */
class FloodgateActionHelper {
    async floodgateContent(projectExcelPath, projectDetail, fgStatus, fgColor, { sharepoint, helixUtils, spConfig }) {
        const logger = getAioLogger();
        logger.info('Floodgating content started.');

        async function copyFilesToFloodgateTree(fileInfo) {
            const status = { success: false };
            if (!fileInfo?.doc) return status;
            const filePath = fileInfo.doc.filePath;
            status.srcPath = filePath;
            status.url = fileInfo.doc.url;
            logger.info(`Copying ${filePath} to floodgated folder`);

            try {
                const content = await sharepoint.getFile(fileInfo.doc);
                const copyStatus = await sharepoint.uploadFileByPath(spConfig, filePath, { content, mimeType: fileInfo.doc.mimeType }, true);
                status.success = copyStatus.success;
                status.locked = copyStatus.locked;
            } catch (error) {
                logger.error(`Error copying files ${filePath} to fg content tree ${error.message}`);
            }
            return status;
        }

        logMemUsage();
        const projectUrlDetailsArr = [...projectDetail.urls];
        await projectUrlDetailsArr.reduce(async (previous, current) => {
            await previous;
            await sharepoint.bulkCreateFolders(current, true);
        }, Promise.resolve());

        const copyStatuses = await inParallel(projectUrlDetailsArr, (item) => copyFilesToFloodgateTree(item[1]), logger, false, null, BATCH_REQUEST_COPY);
        logger.info('Completed floodgating documents listed in the project excel');

        logger.info('Previewing floodgated files... ');
        let previewStatuses = [];
        if (helixUtils.canBulkPreviewPublish(true, fgColor)) {
            const paths = copyStatuses.filter((ps) => ps.success).map((ps) => handleExtension(ps.srcPath));
            previewStatuses = await helixUtils.bulkPreviewPublish(paths, helixUtils.getOperations().PREVIEW, { isFloodgate: true, fgColor });
        }
        logger.info('Completed generating Preview for floodgated files.');
        const failedCopies = copyStatuses.filter((status) => !status.success)
            .map((status) => `${status.srcPath || 'Path Info Not available'}${status.locked ? ' (locked)': ''}`);
        const failedPreviews = previewStatuses.filter((status) => !status.success)
            .map((status) => status.path);
        const fgErrors = failedCopies.length > 0 || failedPreviews.length > 0;
        const payload = fgErrors ?
            'Error occurred when floodgating content. Check project excel sheet for additional information.' :
            'All tasks for Floodgate Copy completed';
        let status = fgErrors ? FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR : FgStatus.PROJECT_STATUS.COMPLETED;
        status = fgErrors && failedCopies.length === copyStatuses.length ? FgStatus.PROJECT_STATUS.FAILED : status;
        await fgStatus.updateStatusToStateLib({
            status,
            statusMessage: payload
        });

        const { startTime: startCopy, endTime: endCopy } = fgStatus.getStartEndTime();
        const excelValues = [['COPY', toUTCStr(startCopy), toUTCStr(endCopy), failedCopies.join('\n'), failedPreviews.join('\n')]];
        await sharepoint.updateExcelTable(projectExcelPath, 'COPY_STATUS', excelValues);
        logger.info('Project excel file updated with copy status.');

        return payload;
    }
}

module.exports = FloodgateActionHelper;

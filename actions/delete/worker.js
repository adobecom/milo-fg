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

const { deleteFloodgateDir, updateExcelTable } = require('../sharepoint');
const {
    getAioLogger, logMemUsage, DELETE_ACTION
} = require('../utils');
const appConfig = require('../appConfig');
const urlInfo = require('../urlInfo');
const FgStatus = require('../fgStatus');

async function main(params) {
    const logger = getAioLogger();
    logMemUsage();
    let payload;
    const {
        adminPageUri, projectExcelPath, rootFolder,
    } = params;
    appConfig.setAppConfig(params);
    const projectPath = `${rootFolder}${projectExcelPath}`;
    const { fgRootFolder } = appConfig.getPayload();
    const fgStatus = new FgStatus({ action: DELETE_ACTION, statusKey: `${DELETE_ACTION}~${fgRootFolder}` });
    try {
        if (!rootFolder || !projectExcelPath) {
            payload = 'Could not determine the project path. Try reloading the page and trigger the action again.';
            logger.error(payload);
        } else if (!adminPageUri) {
            payload = 'Required data is not available to proceed with Delete action.';
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: payload
            });
            logger.error(payload);
        } else {
            urlInfo.setUrlInfo(adminPageUri);
            payload = 'Started deleting content';
            logger.info(payload);
            fgStatus.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.IN_PROGRESS,
                statusMessage: payload
            });

            const deleteStatus = await deleteFloodgateDir(fgRootFolder);
            payload = deleteStatus === false ?
                'Error occurred when deleting content. Check project excel sheet for additional information.' :
                'Delete action was completed';
            await fgStatus.updateStatusToStateLib({
                status: deleteStatus === false ? FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR : FgStatus.PROJECT_STATUS.COMPLETED,
                statusMessage: payload
            });
            const { startTime: startDelete, endTime: endDelete } = fgStatus.getStartEndTime();
            const excelValues = [['DELETE', startDelete, endDelete, payload]];
            await updateExcelTable(projectExcelPath, 'DELETE_STATUS', excelValues);
            logger.info('Project excel file updated with delete status.');
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

exports.main = main;

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

const { deleteAll } = require('../sharepoint');
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
    const fgStatus = new FgStatus({ action: DELETE_ACTION, statusKey: '${DELETE_ACTION}~${projectPath}' });
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

            payload = await deleteAll(projectExcelPath, fgStatus);
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

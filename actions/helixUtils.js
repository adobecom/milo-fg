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

const fetch = require('node-fetch');
const appConfig = require('./appConfig');
const urlInfo = require('./urlInfo');

const MAX_RETRIES = 5;

class HelixUtils {
    async simulatePreviewPublish(path, operation, isFloodgate, fgColor, retryAttempt = 1) {
        let previewStatus = { success: true, path };
        try {
            const repo = isFloodgate ? `${urlInfo.getRepo()}-${fgColor}` : urlInfo.getRepo();
            const previewUrl = `https://admin.hlx.page/${operation}/${urlInfo.getOwner()}/${repo}/${urlInfo.getBranch()}${path}`;
            const options = { method: 'POST' };
            const { helixAdminApiKeys } = appConfig.getConfig();
            if (helixAdminApiKeys && helixAdminApiKeys[repo]) {
                options.headers = new fetch.Headers();
                options.headers.append('Authorization', `token ${helixAdminApiKeys[repo]}`);
            }
            const response = await fetch(
                `${previewUrl}`,
                options,
            );
            if (!response.ok && retryAttempt <= MAX_RETRIES) {
                previewStatus = await this.simulatePreviewPublish(path, operation, isFloodgate, fgColor, retryAttempt + 1);
            }
            previewStatus.responseJson = await response.json();
        } catch (error) {
            previewStatus.success = false;
        }
        return previewStatus;
    }
}

module.exports = new HelixUtils();

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

class AppConfig {
    appConfig = {};

    setAppConfig(params) {
        this.appConfig.fgSite = params.fgSite;
        this.appConfig.fgClientId = params.fgClientId;
        this.appConfig.fgAuthority = params.fgAuthority;
        this.appConfig.shareUrl = params.shareUrl;
        this.appConfig.fgShareUrl = params.fgShareUrl;
        this.appConfig.rootFolder = params.rootFolder;
        this.appConfig.fgRootFolder = params.fgRootFolder;
    }

    getConfig() {
        return this.appConfig;
    }
}

module.exports = new AppConfig();

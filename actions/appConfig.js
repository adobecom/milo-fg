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

const crypto = require('crypto');

class AppConfig {
    configMap = {};

    setAppConfig(params) {
        this.configMap.fgSite = params.fgSite;
        this.configMap.fgClientId = params.fgClientId;
        this.configMap.fgAuthority = params.fgAuthority;
        this.configMap.shareUrl = params.shareUrl;
        this.configMap.fgShareUrl = params.fgShareUrl;
        this.configMap.rootFolder = params.rootFolder;
        this.configMap.fgRootFolder = params.fgRootFolder;
        this.configMap.clientId = params.clientId;
        this.configMap.tenantId = params.tenantId;
        this.configMap.driveId = params.driveId;
        this.configMap.certPassword = params.certPassword;
        this.configMap.certKey = params.certKey;
        this.configMap.certThumbprint = params.certThumbprint;
        this.configMap.testAccessToken = params.testAccessToken;
        this.configMap.skipInProg = (params.skipInProgressCheck || '').toLowerCase() === 'true';
        this.extractPrivateKey();
        // Test token in base64
        if (this.configMap.testAccessToken) {
            this.configMap.testAccessToken = Buffer.from(this.configMap.testAccessToken, 'base64');
        }
    }

    getConfig() {
        return this.configMap;
    }

    extractPrivateKey() {
        if (!this.configMap.certKey) return;
        const decodedKey = Buffer.from(
            this.configMap.certKey,
            'base64'
        ).toString('utf-8');
        this.configMap.pvtKey = crypto
            .createPrivateKey({
                key: decodedKey,
                passphrase: this.configMap.certPassword,
                format: 'pem',
            })
            .export({
                format: 'pem',
                type: 'pkcs8',
            });
    }

    getSkipInProgressCheck() {
        return true && this.configMap.skipInProg;
    }

    getTestAccessToken() {
        return this.configMap.testAccessToken;
    }
}

module.exports = new AppConfig();

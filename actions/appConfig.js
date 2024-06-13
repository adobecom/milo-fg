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
const { strToArray, strToBool, getAioLogger } = require('./utils');
const UrlInfo = require('./urlInfo');

// Max activation is 1hrs, set to 2hrs
const GRAPH_API = 'https://graph.microsoft.com/v1.0';

/**
 * This store the Floodate configs.
 * Common Configs - Parameters like Batch
 */
class AppConfig {
    constructor(params) {
        this.configMap = { payload: {} };
        if (params) {
            this.setAppConfig(params);
        }
    }

    setAppConfig(params) {
        const payload = this.getPayload();

        // These are payload parameters
        // eslint-disable-next-line no-underscore-dangle
        const headers = params.__ow_headers;
        payload.spToken = headers?.['user-token'] || params.spToken;
        payload.adminPageUri = params.adminPageUri;
        payload.projectExcelPath = params.projectExcelPath;
        payload.shareUrl = params.shareUrl;
        payload.fgShareUrl = params.fgShareUrl;
        payload.rootFolder = params.rootFolder;
        payload.fgRootFolder = params.fgRootFolder;
        payload.promoteIgnorePaths = strToArray(params.promoteIgnorePaths) || [];
        payload.doPublish = params.doPublish;
        payload.driveId = params.driveId;
        payload.fgColor = params.fgColor || 'pink';
        payload.draftsOnly = params.draftsOnly;
        payload.enablePromote = params.enablePromote;
        payload.enableDelete = params.enableDelete;
        payload.spSite = params.spSite;

        // These are from configs and not activation related
        this.configMap.fgSite = payload.spSite || params.fgSite;
        this.configMap.fgClientId = params.fgClientId;
        this.configMap.fgAuthority = params.fgAuthority;
        this.configMap.clientId = params.clientId;
        this.configMap.tenantId = params.tenantId;
        this.configMap.certPassword = params.certPassword;
        this.configMap.certKey = params.certKey;
        this.configMap.certThumbprint = params.certThumbprint;
        this.configMap.skipInProg = (params.skipInProgressCheck || '').toLowerCase() === 'true';
        this.configMap.batchFilesPath = params.batchFilesPath || 'milo-floodgate/batching';
        this.configMap.maxFilesPerBatch = parseInt(params.maxFilesPerBatch || '200', 10);
        this.configMap.numBulkReq = parseInt(params.numBulkReq || '20', 10);
        this.configMap.groupCheckUrl = params.groupCheckUrl || 'https://graph.microsoft.com/v1.0/groups/{groupOid}/members?$count=true';
        this.configMap.fgUserGroups = this.getJsonFromStr(params.fgUserGroups, []);
        this.configMap.fgAdminGroups = this.getJsonFromStr(params.fgAdminGroups, []);
        this.configMap.fgDirPattern = params.fgDirPattern || '-(pink|blue|purple)$';
        this.configMap.siteRootPathRex = this.siteRootPathRex || '.*/sites(/.*)<';
        this.configMap.helixAdminApiKeys = this.getJsonFromStr(params.helixAdminApiKeys);
        this.configMap.bulkPreviewCheckInterval = parseInt(params.bulkPreviewCheckInterval || '30', 10);
        this.configMap.maxBulkPreviewChecks = parseInt(params.maxBulkPreviewChecks || '30', 10);
        this.configMap.enablePreviewPublish = this.getJsonFromStr(params.enablePreviewPublish, []);
        this.extractPrivateKey();

        payload.ext = {
            siteRootPath: this.extractSiteRootPath(params.shareUrl),
            siteFgRootPath: this.extractSiteRootPath(params.fgShareUrl),
            urlInfo: payload.adminPageUri ? new UrlInfo(payload.adminPageUri) : null
        };
    }

    getPayload() {
        return this.configMap.payload;
    }

    // Configs related methods
    getConfig() {
        const { payload, ...configMap } = this.configMap;
        return { ...configMap, payload: this.getPayload() };
    }

    getJsonFromStr(str, def = {}) {
        try {
            return JSON.parse(str);
        } catch (err) {
            // Mostly bad string ignored
            getAioLogger().debug(`Error while parsing ${str}`);
        }
        return def;
    }

    /**
     * Parameter that was part of payload.
     * Avoid access tokens, No PASS or SECRET Keys to be passed
     * @returns key-value
     */
    getPassthruParams() {
        const {
            spToken,
            ext,
            payloadAccessedOn,
            ...payloadParams
        } = this.getPayload();
        return payloadParams;
    }

    getMsalConfig() {
        const {
            clientId, tenantId, certPassword, pvtKey, certThumbprint,
        } = this.configMap;
        return {
            clientId, tenantId, certPassword, pvtKey, certThumbprint,
        };
    }

    getFgSite() {
        return this.configMap.fgSite;
    }

    getPromoteIgnorePaths() {
        const pips = this.getPayload().promoteIgnorePaths;
        return [...pips, '/.milo', '/.helix', '/metadata.xlsx', '*/query-index.xlsx'];
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

    getBatchConfig() {
        return {
            batchFilesPath: this.configMap.batchFilesPath,
            maxFilesPerBatch: this.configMap.maxFilesPerBatch,
        };
    }

    getNumBulkReq() {
        return this.configMap.numBulkReq;
    }

    extractSiteRootPath(shareUrl) {
        try {
            return shareUrl.match(new RegExp(this.configMap.siteRootPathRex))[1];
        } catch (err) {
            return '/';
        }
    }

    getSiteFgRootPath() {
        return this.getPayload().ext.siteFgRootPath;
    }

    getUrlInfo() {
        return this.getPayload().ext.urlInfo;
    }

    isDraftOnly() {
        const { draftsOnly } = this.getPayload();
        if (draftsOnly === undefined) {
            return true;
        }
        if (typeof draftsOnly === 'string') {
            return draftsOnly.trim().toLowerCase() !== 'false';
        }
        return draftsOnly;
    }

    getDoPublish() {
        return strToBool(this.getPayload().doPublish);
    }

    getEnablePromote() {
        return strToBool(this.getPayload().enablePromote);
    }

    getEnableDelete() {
        return strToBool(this.getPayload().enableDelete);
    }

    getUserToken() {
        return this.getPayload().spToken;
    }

    getSpConfig() {
        if (!this.getUrlInfo().isValid()) {
            return undefined;
        }

        const config = this.getConfig();

        // get drive id if available
        const { driveId, rootFolder, fgRootFolder } = this.getPayload();
        const drive = driveId ? `/drives/${driveId}` : '/drive';

        const baseURI = `${config.fgSite}${drive}/root:${rootFolder}`;
        const fgBaseURI = `${config.fgSite}${drive}/root:${fgRootFolder}`;
        const baseItemsURI = `${config.fgSite}${drive}/items`;
        return {
            api: {
                url: GRAPH_API,
                file: {
                    get: { baseURI, fgBaseURI },
                    download: { baseURI: `${config.fgSite}${drive}/items` },
                    upload: {
                        baseURI,
                        fgBaseURI,
                        method: 'PUT',
                    },
                    delete: {
                        baseURI,
                        fgBaseURI,
                        method: 'DELETE',
                    },
                    update: {
                        baseURI,
                        fgBaseURI,
                        method: 'PATCH',
                    },
                    createUploadSession: {
                        baseURI,
                        fgBaseURI,
                        method: 'POST',
                        payload: { '@microsoft.graph.conflictBehavior': 'replace' },
                    },
                    copy: {
                        baseURI,
                        fgBaseURI,
                        method: 'POST',
                        payload: { '@microsoft.graph.conflictBehavior': 'replace' },
                    },
                },
                directory: {
                    create: {
                        baseURI,
                        fgBaseURI,
                        method: 'PATCH',
                        payload: { folder: {} },
                    },
                },
                excel: {
                    get: { baseItemsURI },
                    update: {
                        baseItemsURI,
                        method: 'POST',
                    },
                },
                batch: { uri: `${GRAPH_API}/$batch` },
            },
        };
    }
}

module.exports = AppConfig;

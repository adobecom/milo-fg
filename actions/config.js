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

const appConfig = require('./appConfig');
const urlInfo = require('./urlInfo');

const GRAPH_API = 'https://graph.microsoft.com/v1.0';

function getSharepointConfig(applicationConfig) {
    // get drive id if available
    const { driveId } = applicationConfig.payload;
    const drive = driveId ? `/drives/${driveId}` : '/drive';

    const baseURI = `${applicationConfig.fgSite}${drive}/root:${applicationConfig.payload.rootFolder}`;
    const fgBaseURI = `${applicationConfig.fgSite}${drive}/root:${applicationConfig.payload.fgRootFolder}`;
    const baseItemsURI = `${applicationConfig.fgSite}${drive}/items`;
    const fgBaseItemsURI = `${applicationConfig.fgSite}${drive}/items`;
    return {
        ...applicationConfig,
        clientApp: {
            auth: {
                clientId: applicationConfig.fgClientId,
                authority: applicationConfig.fgAuthority,
            },
            cache: { cacheLocation: 'sessionStorage' },
        },
        shareUrl: applicationConfig.shareurl,
        fgShareUrl: applicationConfig.fgShareUrl,
        login: { redirectUri: '/tools/loc/spauth' },
        api: {
            url: GRAPH_API,
            file: {
                get: { baseURI, fgBaseURI },
                download: { baseURI: `${applicationConfig.fgSite}${drive}/items` },
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
                get: { baseItemsURI, fgBaseItemsURI },
                update: {
                    baseItemsURI,
                    fgBaseItemsURI,
                    method: 'POST',
                },
            },
            batch: { uri: `${GRAPH_API}/$batch` },
        },
    };
}

function getHelixAdminConfig() {
    const adminServerURL = 'https://admin.hlx.page';
    return {
        api: {
            status: { baseURI: `${adminServerURL}/status` },
            preview: { baseURI: `${adminServerURL}/preview` },
        },
    };
}

async function getConfig() {
    if (urlInfo.isValid()) {
        const applicationConfig = appConfig.getConfig();
        return {
            sp: getSharepointConfig(applicationConfig),
            admin: getHelixAdminConfig(),
        };
    }
    return undefined;
}

module.exports = {
    getConfig,
};

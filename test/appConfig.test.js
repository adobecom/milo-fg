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

const AppConfig = require('../actions/appConfig');

// Mock the 'crypto' module
jest.mock('crypto', () => ({
    createPrivateKey: jest.fn().mockReturnValue({
        export: jest.fn().mockReturnValue('mocked')
    })
}));

let params = {
    spToken: 'eyJ0eXAi',
    adminPageUri: 'https://floodgateui--milo--adobecom.hlx.page/tools/floodgate?ref=floodgateui&repo=milo&owner=adobecom&host=milo.adobe.com&project=Milo' +
    '&referrer=https%3A%2F%2Fadobe.sharepoint.com%2F%3Ax%3A%2Fr%2Fsites%2Fadobecom%2F_layouts%2F15%2FDoc.aspx' +
    '%3Fsourcedoc%3D%257B442C005E-8094-4EB8-A78F-48BF427A04ED%257D%26file%3DBook5.xlsx%26action%3Ddefault%26mobileredirect%3Dtrue',
    projectExcelPath: '/drafts/floodgate/projects/raga/fgtest1.xlsx',
    shareUrl: 'https://site.sharepoint.com/:f:/r/sites/adobecom/Shared%20Documents/milo<relativePath>?web=1',
    fgShareUrl: 'https://site.sharepoint.com/:f:/r/sites/adobecom/Shared%20Documents/milo-pink<relativePath>?web=1',
    rootFolder: '/milo',
    fgRootFolder: '/milo-pink',
    promoteIgnorePaths: '/gnav.docx,/.milo',
    doPublish: 'false',
    driveId: 'drive',
    fgColor: 'purple',
    draftsOnly: 'true',
    spSite: 'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21',
};
// Add config
params = {
    ...params,
    fgSite: 'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21',
    fgClientId: '008626ae-1',
    fgAuthority: 'https://login.microsoftonline.com/fa7b1b5a-',
    clientId: '008626ae-1',
    tenantId: 'a',
    certPassword: 'a',
    certKey: 'a',
    certThumbprint: 'a',
    skipInProgressCheck: 'true',
    batchFilesPath: 'milo-floodgate/batching',
    maxFilesPerBatch: '200',
    numBulkReq: '20',
    groupCheckUrl: 'https://graph.microsoft.com/v1.0/groups/{groupOid}/members?$count=true',
    fgUserGroups: '["1"]',
    fgAdminGroups: '["2"]',
    fgDirPattern: '.*/sites(/.*)<',
    siteRootPathRex: '(pink)$',
    helixAdminApiKeys: '{"milo": "ey:","milo-pink": "dy"}',
    bulkPreviewCheckInterval: '8',
    maxBulkPreviewChecks: '100',
    enablePreviewPublish: 'true'
};
const appConfig = new AppConfig();
describe('appConfig', () => {
    test('set parameters', () => {
        appConfig.setAppConfig(params);
        expect(appConfig.getPayload()).toBeDefined();
        expect(appConfig.getConfig()).toBeDefined();
        expect(appConfig.getPassthruParams()).toBeDefined();
        expect(appConfig.getPassthruParams().spToken).not.toBeDefined();
        appConfig.extractPrivateKey();
        const {
            clientId, tenantId, certPassword, pvtKey = 'mocked', certThumbprint
        } = params;
        expect({ ...appConfig.getMsalConfig() }).toMatchObject({
            clientId, tenantId, certPassword, pvtKey, certThumbprint
        });
        expect(appConfig.getFgSite()).toBe(params.fgSite);
        expect(appConfig.getPromoteIgnorePaths().length).toBe(6);
        expect(appConfig.getSkipInProgressCheck()).toBeTruthy();
        expect({ ...appConfig.getBatchConfig() }).toMatchObject({ batchFilesPath: params.batchFilesPath, maxFilesPerBatch: 200 });
        expect(appConfig.getNumBulkReq()).toBe(20);
        expect(appConfig.extractSiteRootPath()).toBe('/');
        expect(appConfig.getSiteFgRootPath()).toBe('/adobecom/Shared%20Documents/milo-pink');
        expect(appConfig.getUrlInfo()).toMatchObject({
            urlInfoMap: {
                branch: 'floodgateui',
                origin: 'https://floodgateui--milo--adobecom.hlx.page',
                owner: 'adobecom',
                repo: 'milo',
                sp: 'https://adobe.sharepoint.com/:x:/r/sites/adobecom/_layouts/15/Doc.aspx?sourcedoc=%7B442C005E-8094-4EB8-A78F-48BF427A04ED%7D' +
                '&file=Book5.xlsx&action=default&mobileredirect=true',
            }
        });
        expect(appConfig.isDraftOnly()).toBeTruthy();
        expect(appConfig.getDoPublish()).not.toBeTruthy();
        expect(!!appConfig.getEnablePromote()).toBeFalsy();
        expect(!!appConfig.getEnableDelete()).toBeFalsy();
    });

    test('isDraftOnly would be true when not passed', () => {
        const { draftsOnly, ...remParams } = params;
        appConfig.setAppConfig(remParams);
        expect(appConfig.isDraftOnly()).toBeTruthy();
    });

    test('isDraftOnly is false when parameter is passed', () => {
        const { draftsOnly, ...remParams } = params;
        appConfig.setAppConfig({ draftsOnly: 'false', ...remParams });
        expect(appConfig.isDraftOnly()).toBeFalsy();
    });

    test('Test sharepoint config is populated', async () => {
        appConfig.setAppConfig(params);
        const sp = await appConfig.getSpConfig();
        expect(sp).toMatchObject({});
    });

    test('Test enable delete action flags', () => {
        appConfig.setAppConfig({ ...params, enableDelete: 'true' });
        expect(appConfig.getEnablePromote()).toBeFalsy();
        expect(appConfig.getEnableDelete()).toBeTruthy();
    });

    test('Test enable promote action flags', () => {
        appConfig.setAppConfig({ ...params, enablePromote: 'true' });
        expect(appConfig.getEnablePromote()).toBeTruthy();
        expect(appConfig.getEnableDelete()).toBeFalsy();
    });

    test('Test enable delete and promote action flags', () => {
        appConfig.setAppConfig({ ...params, enableDelete: true, enablePromote: 'true' });
        expect(appConfig.getEnablePromote()).toBeTruthy();
        expect(appConfig.getEnableDelete()).toBeTruthy();
    });

    test('test sptoken in param', () => {
        appConfig.setAppConfig(params);
        expect(appConfig.getPayload().spToken).toBe(params.spToken);
    });

    test('test sptoken in header', () => {
        appConfig.setAppConfig({ ...params, __ow_headers: { 'user-token': 'usertoken' } });
        expect(appConfig.getPayload().spToken).toBe('usertoken');
    });
});

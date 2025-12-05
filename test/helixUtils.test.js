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
/* eslint-disable global-require */
jest.mock('node-fetch', () => {
    const { FetchMock } = require('fetch-mock');
    const nodeFetchActual = jest.requireActual('node-fetch');
    const mockFetch = new FetchMock({
        Headers: nodeFetchActual.Headers,
        Request: nodeFetchActual.Request,
        Response: nodeFetchActual.Response,
        fetch: nodeFetchActual.default
    });
    // Return the callable fetchHandler with all FetchMock methods bound to mockFetch
    const { fetchHandler } = mockFetch;
    // Copy all methods from mockFetch (including prototype methods) and bind them
    Object.getOwnPropertyNames(Object.getPrototypeOf(mockFetch)).forEach(key => {
        if (key !== 'constructor' && typeof mockFetch[key] === 'function') {
            fetchHandler[key] = mockFetch[key].bind(mockFetch);
        }
    });
    Object.keys(mockFetch).forEach(key => {
        if (typeof mockFetch[key] === 'function') {
            fetchHandler[key] = mockFetch[key].bind(mockFetch);
        } else {
            fetchHandler[key] = mockFetch[key];
        }
    });
    fetchHandler.Headers = nodeFetchActual.Headers;
    fetchHandler.Request = nodeFetchActual.Request;
    fetchHandler.Response = nodeFetchActual.Response;
    // Add reset() method for backwards compatibility
    fetchHandler.reset = () => {
        mockFetch.clearHistory();
        mockFetch.removeRoutes();
        return fetchHandler;
    };
    return fetchHandler;
});
const fetch = require('node-fetch');
const UrlInfo = require('../actions/urlInfo');

describe('HelixUtils', () => {
    let HelixUtils;
    let helixUtils;
    let appConfigMock;

    beforeAll(() => {
        jest.mock('../actions/utils', () => ({
            getAioLogger: () => ({
                info: jest.fn(),
                debug: jest.fn(),
                error: jest.fn(),
            }),
        }));

        appConfigMock = {
            getUrlInfo: jest.fn().mockReturnValue(
                new UrlInfo('https://example.com/admin?project=p&referrer=https://sp/&owner=o&repo=rp&ref=main')
            ),
            getConfig: jest.fn().mockReturnValue({
                maxBulkPreviewChecks: 2,
                helixAdminApiKeys: { rp: 'key', 'rp-pink': 'key-pink' },
                enablePreviewPublish: ['rp', 'rp-pink']
            }),
            getFgFolderToDelete: jest.fn().mockReturnValue({ suffix: '/drafts', url: 'http://example/com/drafts' }),
        };
        HelixUtils = require('../actions/helixUtils');
        helixUtils = new HelixUtils(appConfigMock);

        fetch.post('*', () => ({
            messageId: 'a',
            job: {
                name: 'JN',
            },
            links: {
                self: 'https://admin.hlx.page/job/adobecom/cc-pink/main/publish/job-2024-09-21t13-38-15-348z'
            }
        }));
        fetch.get('*', () => ({
            progress: 'stopped',
            data: {
                resources: [
                    { path: '/a', status: 200 },
                    { path: '/b', status: 200 },
                ],
            }
        }));
    });

    afterAll(() => {
        jest.clearAllMocks();
    });

    it('should return PREVIEW and LIVE', () => {
        const operations = helixUtils.getOperations();
        expect(operations).toEqual({ PREVIEW: 'preview', PUBLISH: 'publish', UNPUBLISH: 'unpublish' });
    });

    it('should return repo without floodgate', () => {
        const repo = helixUtils.getRepo();
        expect(repo).toBe('rp');
    });

    it('should return repo with floodgate', () => {
        const repo = helixUtils.getRepo(true, 'blue');
        expect(repo).toBe('rp-blue');
    });

    it('should return admin api key without floodgate', () => {
        const adminApiKey = helixUtils.getAdminApiKey();
        expect(adminApiKey).toBe('key');
    });

    it('should return admin api key with floodgate', () => {
        const adminApiKey = helixUtils.getAdminApiKey(true, 'pink');
        expect(adminApiKey).toBe('key-pink');
    });

    it('should return true if preview is enabled', () => {
        const canPreview = helixUtils.canBulkPreviewPublish();
        expect(canPreview).toBeTruthy();
    });

    it('submits bulk preview and publish request', async () => {
        const resp = await helixUtils.bulkPreviewPublish(
            ['/a', '/b'],
            'preivew',
            { isFloodgate: false },
            1
        );
        expect(resp).toEqual([{ path: '/a', success: true },
            { path: '/b', success: true }]);
    });

    it('gets the files to unpublish', async () => {
        const resp = await helixUtils.getFilesToUnpublish('pink', 1);
        expect(resp).toEqual([]);
    });
});

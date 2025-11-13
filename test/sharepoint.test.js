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
const { Headers } = fetch;

describe('sharepoint', () => {
    let Sharepoint = null;
    const baseURI = 'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21/drives/123/root:/milo';
    const fgBaseURI = 'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21/drives/123/root:/milo-pink';

    const appConfig = {
        getMsalConfig: () => ({
            clientId: 'CLIENT_ID',
            tenantId: 'TENANT_ID',
            certThumbprint: 'CERT_THUMB_PRINT',
            pvtKey: 'PRIVATE_KEY',
        }),
        getFgSite: () => 'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21',
        getSpConfig: () => ({
            api: {
                directory: {
                    create: {
                        baseURI,
                        fgBaseURI,
                        method: 'PATCH',
                        payload: { folder: {} },
                    },
                },
                file: {
                    get: {
                        baseURI,
                        fgBaseURI,
                    },
                    copy: {
                        baseURI,
                        fgBaseURI,
                        method: 'POST',
                        payload: { '@microsoft.graph.conflictBehavior': 'replace' },
                    },
                    createUploadSession: {
                        baseURI,
                        fgBaseURI,
                        method: 'POST',
                        payload: { '@microsoft.graph.conflictBehavior': 'replace' },
                    },
                    delete: {
                        fgBaseURI
                    },
                    update: {
                        fgBaseURI,
                    },
                    upload: {
                        baseURI,
                        fgBaseURI,
                        method: 'PUT',
                    },
                },
                excel: {
                    get: { baseItemsURI: 'https://gql/base' },
                    update: { baseItemsURI: 'https://gql/base', method: 'POST' }
                }
            }
        }),
        getConfig: () => ({
            fgDirPattern: 'pink'
        }),
        getFgFolderToDelete: () => ({ suffix: '/drafts', url: 'http://example/com/drafts' }),
    };

    beforeAll(() => {
        jest.mock('../actions/utils', () => ({
            getAioLogger: () => ({
                info: jest.fn(),
                debug: jest.fn(),
                warn: jest.fn(),
                error: jest.fn(),
            }),
            delay: () => {},
        }));

        jest.mock('../actions/sharepointAuth', () => (
            jest.fn().mockReturnValue({
                getAccessToken: jest.fn().mockResolvedValue('AT'),
            })));
        Sharepoint = require('../actions/sharepoint');
    });

    afterAll(() => {
        jest.clearAllMocks();
    });

    // The 'getAuthorizedRequestOption' method returns the authorized request options with the correct headers and access token.
    it('should return authorized request options with correct headers and access token', async () => {
        const sharepoint = new Sharepoint(appConfig);
        const options = await sharepoint.getAuthorizedRequestOption();
        expect(options.headers.get('Authorization')).toContain('Bearer AT');
    });

    // The 'executeGQL' method throws an error if the response is not ok.
    it('should throw an error if the response is not ok', async () => {
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({
            ok: false
        });
        await expect(await sharepoint.executeGQL('url', {}).ok).not.toBeTruthy();
    });

    // The 'getItemId' method throws an error if the item ID is not found.
    it('should get item from path', async () => {
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.executeGQL = jest.fn().mockResolvedValue({
            json: { id: 10 }
        });
        const id = await sharepoint.getItemId(
            `${appConfig.getFgSite()}/driveid:root`,
            '/draft/fg.xlsx'
        );
        expect(id).toEqual(10);
    });

    // The 'getDriveRoot' method logs an error if the response is not ok.
    it('should log an error if the response is not ok', async () => {
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.fetchWithRetry = jest
            .fn()
            .mockResolvedValue({
                ok: false,
                status: 500
            });
        await sharepoint.getDriveRoot('accessToken');
    });

    it('should return an object with fileDownloadUrl and fileSize properties when given a valid file path and isFloodgate boolean', async () => {
        // Mock dependencies
        const sharepoint = new Sharepoint(appConfig);
        const filePath = '/path/to/file.txt';
        const isFloodgate = false;

        // Mock fetchWithRetry function
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({
                '@microsoft.graph.downloadUrl': 'https://example.com/file.txt',
                size: 1024,
            }),
        });

        // Invoke getFileData method
        const fileData = await sharepoint.getFileData(filePath, isFloodgate);

        // Assertions
        expect(fileData).toEqual({
            fileDownloadUrl: 'https://example.com/file.txt',
            fileSize: 1024,
        });
    });

    it('should create a folder in SharePoint when valid folder path is provided', async () => {
        // Mock dependencies
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.getAuthorizedRequestOption = jest.fn().mockResolvedValue({
            method: 'POST',
            headers: new Headers(),
            body: JSON.stringify({}),
        });
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ id: '12345' }),
        });

        // Test the method
        const folder = '/example-folder';
        const isFloodgate = false;
        const response = await sharepoint.createFolder(folder, isFloodgate);

        // Assertions
        expect(response).toEqual({ id: '12345' });
        expect(sharepoint.getAuthorizedRequestOption).toHaveBeenCalledWith({
            method: 'PATCH',
        });
        expect(sharepoint.fetchWithRetry).toHaveBeenCalledWith(
            'https://graph.microsoft.com/v1.0/sites/site.sharepoint.com,d21/drives/123/root:/milo/example-folder',
            expect.any(Object)
        );
    });

    it('should return a buffer object when given a valid download URL and authorized request options', async () => {
        // Mock the necessary dependencies
        const sharepoint = new Sharepoint(appConfig);
        const downloadUrl = '/file/download';

        // Mock the fetchWithRetry method
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({ buffer: () => 'Test' });

        // Invoke the method and assert the result
        const result = await sharepoint.getFileUsingDownloadUrl(downloadUrl);
        expect(result).toBe('Test');
    });

    it('should return the file name when given a valid file path with multiple directory levels', () => {
        const sharepoint = new Sharepoint(appConfig);
        const path = '/folder/subfolder/file.txt';
        const fileName = sharepoint.getFileNameFromPath(path);
        expect(fileName).toBe('file.txt');
    });

    it('should create an upload session with valid inputs', async () => {
        // Mock dependencies
        const spConfig = {
            api: {
                file: {
                    createUploadSession: {
                        payload: {
                            // payload properties
                        },
                        method: 'POST',
                        baseURI: 'https://example.com/api/file',
                        fgBaseURI: 'https://example.com/api/file/fg',
                    },
                },
            },
        };

        const file = {
            size: 1024, // file size in bytes
            // other file properties
        };

        const dest = '/path/to/destination';
        const filename = 'example.txt';
        const isFloodgate = false;

        const sharepoint = new Sharepoint(appConfig);
        sharepoint.getAuthorizedRequestOption = jest.fn().mockResolvedValue({
            method: 'POST',
            headers: new Headers(),
            body: JSON.stringify({}),
        });

        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({
            ok: true,
            json: jest.fn().mockResolvedValue({ id: '12345' }),
        });

        const uploadSession = await sharepoint.createUploadSession(spConfig, file, dest, filename, isFloodgate);

        // Assertions
        expect(uploadSession).toBeDefined();
        // Add more assertions as needed
    });

    it('should upload file successfully when given valid parameters', async () => {
        // Mock dependencies
        const spConfig = {
            api: {
                file: {
                    upload: {
                        method: 'POST'
                    }
                }
            }
        };
        const uploadUrl = 'https://example.com/upload';
        const options = {
            method: spConfig.api.file.upload.method,
            headers: { append: jest.fn() },
            body: {}
        };
        const response = { ok: true, json: jest.fn() };
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.getAuthorizedRequestOption = jest.fn().mockResolvedValue(options);
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue(response);

        // Invoke method
        const result = await sharepoint.uploadFile(spConfig, uploadUrl, {});

        // Assertions
        expect(sharepoint.getAuthorizedRequestOption).toHaveBeenCalledWith({
            json: false,
            method: spConfig.api.file.upload.method
        });
        expect(sharepoint.fetchWithRetry).toHaveBeenCalledWith(uploadUrl, options, { donotRetryLockedFiles: true });
        expect(result).toEqual(response);
    });

    it('should delete file when given valid file path and SharePoint object', async () => {
        fetch.delete('*', 200);
        const sharepoint = new Sharepoint(appConfig);
        const sp = {
            api: {
                file: {
                    delete: {
                        method: 'DELETE'
                    }
                }
            }
        };

        const filePath = 'https://sp.domain/path/to/file.txt';

        await sharepoint.releaseUploadSession(sp, filePath);
        const response = await sharepoint.deleteFile(sp, filePath);

        expect(response.ok).toBe(true);
    });
    it('should rename a file successfully with valid inputs', async () => {
        // Mock the necessary dependencies
        fetch.patch('*', 200);
        const sharepoint = new Sharepoint(appConfig);

        // Define the test inputs
        const spFileUrl = 'https://example.sharepoint.com/sites/testsite/documents/example.docx';
        const filename = 'new_example.docx';

        // Invoke the method and assert the result
        const response = await sharepoint.renameFile(spFileUrl, filename);
        expect(response.status).toBe(200);
    });

    it('should return a string with the original filename, a "-locked-" string, and the current timestamp', () => {
        const sharepoint = new Sharepoint(appConfig);
        const filename = 'example.txt';
        const lockedFileName = sharepoint.getLockedFileNewName(filename);
        const regex = /^example-locked-\d+\.txt$/;
        expect(regex.test(lockedFileName)).toBe(true);
    });

    it('should create an upload session and upload the file successfully', async () => {
        const spConfig = {
            api: {
                file: {
                    createUploadSession: {
                        payload: {
                            description: 'Preview file',
                            fileSize: 1000,
                            name: 'example.txt'
                        },
                        method: 'POST',
                        baseURI: 'https://example.com/api/files/',
                        fgBaseURI: 'https://example.com/api/files/floodgate/'
                    },
                    upload: {
                        method: 'PUT'
                    }
                }
            }
        };

        const dest = 'path/to/destination';
        const filename = 'example.txt';
        const isFloodgate = false;

        const sharepoint = new Sharepoint(appConfig);
        const response = { ok: true, json: jest.fn().mockReturnValue({ uploadUrl: 'url' }) };
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue(response);
        const result = await sharepoint.createSessionAndUploadFile(spConfig, {}, dest, filename, isFloodgate);

        expect(result.success).toBe(true);
        expect(result.uploadedFile).toBeDefined();
    });

    it('should create folders for a list of file paths successfully', async () => {
        // Mock dependencies
        const sharepointAuth = jest.fn();
        const getAccessToken = jest.fn().mockResolvedValue('token');
        const getAuthorizedRequestOption = jest.fn().mockResolvedValue({});
        const executeGQL = jest.fn().mockResolvedValue({ ok: true });
        const createFolder = jest.fn().mockResolvedValue({ ok: true });

        // Initialize Sharepoint class object
        const sharepoint = new Sharepoint(appConfig);
        const response = { ok: true, json: jest.fn().mockReturnValue({ uploadUrl: 'url' }) };
        sharepoint.sharepointAuth = sharepointAuth;
        sharepoint.sharepointAuth.getAccessToken = getAccessToken;
        sharepoint.getAuthorizedRequestOption = getAuthorizedRequestOption;
        sharepoint.executeGQL = executeGQL;
        sharepoint.createFolder = createFolder;
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue(response);

        // Define input
        const srcPathList = [
            [1, { doc: { filePath: '/a/b/one.txt' } }],
            [2, { doc: { filePath: '/a/b/two.txt' } }],
            [3, { doc: { filePath: '/a/c/three.txt' } }],
            [4, { doc: { filePath: '/a/c/d/three.txt' } }]
        ];
        const isFloodgate = false;

        // Invoke method
        const result = await sharepoint.bulkCreateFolders(srcPathList, isFloodgate);

        // Assertions
        expect(result).toEqual([{ ok: true }, { ok: true }]);
        expect(createFolder).toHaveBeenCalledTimes(2);
        expect(createFolder).toHaveBeenCalledWith('/a/b', isFloodgate);
        expect(createFolder).toHaveBeenCalledWith('/a/c/d', isFloodgate);
    });

    it('should copy a file from source path to destination folder', async () => {
        const sharepoint = new Sharepoint(appConfig);
        sharepoint.fetchWithRetry = jest.fn().mockResolvedValue({ ok: true, json: () => ({ status: 'completed' }), headers: { get: jest.fn().mockReturnValue({ Location: 'https://sp/file' }) } });

        // Test input
        const srcPath = '/path/to/source/file.txt';
        const destinationFolder = '/path/to/destination/folder';
        const newName = null;
        const isFloodgate = false;
        const isFloodgateLockedFile = false;

        // Invoke method
        const copyStatus = await sharepoint.copyFile(srcPath, destinationFolder, newName, isFloodgate, isFloodgateLockedFile);

        // Assertions
        expect(copyStatus.success).toBe(true);
    });

    it('should save', async () => {
        // Mock dependencies
        const sharepoint = new Sharepoint(appConfig);
        const folder = '/Documents';
        const filename = 'example.txt';
        const isFloodgate = false;
        sharepoint.getAuthorizedRequestOption = jest.fn().mockResolvedValue({
            method: 'POST',
            headers: new Headers(),
            body: JSON.stringify({}),
        });
        jest.spyOn(sharepoint, 'createFolder').mockResolvedValueOnce({});
        jest.spyOn(sharepoint, 'createSessionAndUploadFile').mockResolvedValueOnce({ locked: true }).mockResolvedValueOnce({ success: true, uploadedFile: {} });
        jest.spyOn(sharepoint, 'releaseUploadSession').mockResolvedValueOnce({});
        jest.spyOn(sharepoint, 'getLockedFileNewName').mockResolvedValueOnce(filename);
        jest.spyOn(sharepoint, 'renameFile').mockResolvedValueOnce(filename);
        jest.spyOn(sharepoint, 'copyFile').mockResolvedValueOnce({success: true});
        jest.spyOn(sharepoint, 'deleteFile').mockResolvedValueOnce({});

        // Invoke the method
        const resp = await sharepoint.saveFile({}, `${folder}/${filename}`, isFloodgate);

        // Verify the behavior
        expect(resp.success).toBe(true);
    });

    it('should return a list of rows when tableJson value is truthy', async () => {
        const sharepoint = new Sharepoint(appConfig);
        jest.spyOn(sharepoint, 'getItemId').mockResolvedValueOnce('itemId');
        jest.spyOn(sharepoint, 'executeGQL').mockResolvedValueOnce({ json: { value: [{ values: [['data']] }] }});

        const excelPath = '/path/to/excel/file.xlsx';
        const tableName = 'Table1';

        const result = await sharepoint.getExcelTable(excelPath, tableName);

        expect(result).toEqual([[['data']]]);
    });

    it('should delete the specified folder', async () => {
        const sharepoint = new Sharepoint({ ...appConfig, fgDirPattern: 'test' });
        jest.spyOn(sharepoint, 'deleteFile').mockResolvedValueOnce({});
        const deleteSuccess = await sharepoint.deleteFloodgateDir();

        expect(deleteSuccess).toBe(true);
    });

    it('should update the table when the Excel file and table exist', async () => {
        const sharepoint = new Sharepoint(appConfig);
        jest.spyOn(sharepoint, 'getItemId').mockResolvedValueOnce('itemId');
        jest.spyOn(sharepoint, 'executeGQL').mockResolvedValueOnce({});

        // Test code
        const excelPath = 'path/to/excel/file.xlsx';
        const tableName = 'Sheet1';
        const values = [
            ['A1', 'B1', 'C1'],
            ['A2', 'B2', 'C2'],
            ['A3', 'B3', 'C3'],
        ];

        const response = await sharepoint.updateExcelTable(excelPath, tableName, values);

        expect(sharepoint.getItemId).toHaveBeenCalledWith(baseURI, excelPath);
        expect(sharepoint.executeGQL).toHaveBeenCalledWith('https://gql/base/itemId/workbook/tables/Sheet1/rows', {
            body: JSON.stringify({ values }),
            method: 'POST',
        });
        expect(response).toEqual({});
    });

    it('should handle headers with duplicate names by overwriting the previous value with the new one', () => {
        const response = {
            headers: new Map([
                ['Content-Type', 'application/json'],
                ['Authorization', 'Bearer token123'],
                ['User-Agent', 'MyApp'],
                ['Content-Type', 'text/plain'],
            ]),
            status: 200,
        };

        const sharepoint = new Sharepoint(appConfig);
        const headersStr = sharepoint.getHeadersStr(response);

        expect(headersStr).toBe('{"Content-Type":"text/plain","Authorization":"Bearer token123","User-Agent":"MyApp"}');
    });

    it('should log response status and headers when getLogRespHeader is true', () => {
        const response = {
            status: 200,
            headers: new Headers({
                'Content-Type': 'application/json',
                'RateLimit-Reset': '3600',
                'Retry-After': '120',
            }),
        };

        const sharepoint = new Sharepoint(appConfig);
        jest.spyOn(sharepoint, 'getLogRespHeader').mockResolvedValueOnce(true);
        jest.spyOn(sharepoint, 'getHeadersStr').mockResolvedValueOnce('Content-Type: application/json');

        expect(() => sharepoint.logHeaders(response)).not.toThrow();
    });

    // Handles rate limit headers and 429 errors by retrying the request after the specified time
    it('should handle rate limit headers and 429 errors by retrying the request after the specified time', async () => {
        // Mock the fetch function to return a response with rate limit headers or status code 429
        const mockResponse = {
            status: 429,
            headers: {
                'ratelimit-reset': '2',
                'retry-after': '3',
                'test-retry-status': '429'
            }
        };
        const mockResponse2 = {
            status: 200,
            body: {}
        };
        let fetchMockCalled = 0;
        fetch.route('*', () => {
            fetchMockCalled += 1;
            return fetchMockCalled > 1 ? mockResponse2 : mockResponse;
        });
        const apiUrl = 'https://api.example.com/data';
        const options = {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                Authorization: 'Bearer token123',
                'test-retry-status': 'true'
            }
        };

        const sharepoint = new Sharepoint(appConfig);
        const response = await sharepoint.fetchWithRetry(apiUrl, options);

        expect(response).toBeDefined();
        expect(response.status).toBe(200);
        const data = await response.json();
        expect(data).toEqual({});
    });

    it('uploads a file and returns update status', async () => {
        const sharepoint = new Sharepoint(appConfig);
        jest.spyOn(sharepoint, 'executeGQL').mockResolvedValueOnce({ 'id': 'SP10' });
        const options = {
            content: Buffer.from('Testing'),
            mime: 'text/plain',
        }
        const response = await sharepoint.uploadFileByPath(appConfig.getSpConfig(), '/drafts/file.txt', options);
        expect(response.id).toEqual('SP10');
    });
});

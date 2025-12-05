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

describe('fgUser', () => {
    let FgUser;
    let fgUser;
    let appConfigMock;

    beforeAll(() => {
        jest.mock('../actions/utils', () => ({
            getAioLogger: () => ({
                info: jest.fn(),
                debug: jest.fn(),
                error: jest.fn(),
            }),
        }));

        jest.mock('../actions/sharepoint', () => (jest.fn().mockReturnValue({
            getSharepointAuth: jest.fn().mockReturnValue({
                getUserDetails: jest.fn().mockReturnValue({
                    oid: 'oid1'
                }),
                getAccessToken: jest.fn().mockReturnValue('at')
            }),
            getDriveRoot: jest.fn().mockReturnValue('at')
        })));

        appConfigMock = {
            getConfig: jest.fn().mockReturnValue({
                fgAdminGroups: ['a'],
                fgUserGroups: ['b'],
            }),
            getUserToken: jest.fn().mockReturnValue('test')
        };

        FgUser = require('../actions/fgUser');
        fgUser = new FgUser({ at: 'at', appConfig: appConfigMock });
    });

    afterAll(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        fetch.reset();
    });

    it('is an admin', async () => {
        fetch.get('*', () => ({
            value: ['a']
        }));
        const found = await fgUser.isAdmin();
        expect(found).toBe(true);
    });

    it('admin group is not defined', async () => {
        appConfigMock.getConfig.mockReturnValueOnce({ fgAdminGroups: [] });
        const found = await fgUser.isAdmin();
        expect(found).toBe(false);
    });

    it('is an fg user', async () => {
        fetch.get('*', () => ({
            value: ['b']
        }));
        const found = await fgUser.isUser();
        expect(found).toBe(true);
    });

    it('fg user group is not defined', async () => {
        appConfigMock.getConfig.mockReturnValueOnce({ fgUserGroups: [] });
        const found = await fgUser.isUser();
        expect(found).toBe(false);
    });
});

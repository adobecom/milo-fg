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
const UrlInfo = require('../actions/urlInfo');

describe('UrlInfo', () => {
    // Constructing a UrlInfo object with a valid adminPageUri sets the urlInfoMap with the correct values.
    it('should set urlInfoMap with correct values when adminPageUri is valid', () => {
        const adminPageUri = 'https://main--main--adobecom.hlx.page/admin?project=projectName&referrer=referrerName&owner=ownerName&repo=repoName&ref=branchName';
        const urlInfo = new UrlInfo(adminPageUri);

        expect(urlInfo.getUrlInfo()).toEqual({
            sp: 'referrerName',
            owner: 'ownerName',
            repo: 'repoName',
            branch: 'branchName',
            origin: 'https://branchName--repoName--ownerName.hlx.page'
        });
    });

    it('should set urlInfoMap with correct values when adminPageUri is valid with aem.page', () => {
        const adminPageUri = 'https://main--main--adobecom.aem.page/admin?project=projectName&referrer=referrerName&owner=ownerName&repo=repoName&ref=branchName';
        const urlInfo = new UrlInfo(adminPageUri);

        expect(urlInfo.getUrlInfo()).toEqual({
            sp: 'referrerName',
            owner: 'ownerName',
            repo: 'repoName',
            branch: 'branchName',
            origin: 'https://branchName--repoName--ownerName.aem.page'
        });
    });


    // Constructing a UrlInfo object with an invalid adminPageUri sets the urlInfoMap with undefined values.
    it('should set urlInfoMap with values', () => {
        const adminPageUri = 'https://example.com/admin?project=p&referrer=https://sp/&owner=o&repo=rp&ref=main';
        const urlInfo = new UrlInfo(adminPageUri);

        expect(urlInfo.getUrlInfo()).toEqual({
            sp: 'https://sp/',
            owner: 'o',
            repo: 'rp',
            branch: 'main',
            origin: 'https://main--rp--o.hlx.page'
        });

        expect(urlInfo.getOrigin()).toEqual('https://main--rp--o.hlx.page');
        expect(urlInfo.getBranch()).toEqual('main');
        expect(urlInfo.getOwner()).toEqual('o');
        expect(urlInfo.getRepo()).toEqual('rp');
    });
});

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

class UrlInfo {
    urlInfoMap = {};

    constructor(adminPageUri) {
        const location = new URL(adminPageUri);
        function getParam(name) {
            return location.searchParams.get(name);
        }
        const projectName = getParam('project');
        const sub = projectName ? projectName.split('--') : [];

        const referrer = getParam('referrer');
        const owner = getParam('owner') || sub[1];
        const repo = getParam('repo') || sub[0];
        const branch = getParam('ref') || 'main';

        this.urlInfoMap.sp = referrer;
        this.urlInfoMap.owner = owner;
        this.urlInfoMap.repo = repo;
        this.urlInfoMap.branch = branch;
        this.urlInfoMap.origin = `https://${branch}--${repo}--${owner}.hlx.page`;
    }

    isValid() {
        const {
            sp, owner, repo, branch
        } = this.urlInfoMap;
        return sp && owner && repo && branch;
    }

    getUrlInfo() {
        return this.urlInfoMap;
    }

    getOrigin() {
        return this.urlInfoMap.origin;
    }

    getRepo() {
        return this.urlInfoMap.repo;
    }

    getOwner() {
        return this.urlInfoMap.owner;
    }

    getBranch() {
        return this.urlInfoMap.branch;
    }

    getMiloConfigUrl() {
        return `${this.urlInfoMap.origin}/.milo/config.json`;
    }
}

module.exports = UrlInfo;

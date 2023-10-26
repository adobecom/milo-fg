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

const fetch = require('node-fetch');
const { getAioLogger } = require('./utils');
const appConfig = require('./appConfig');
const sharepoint = require('./sharepoint');
const sharepointAuth = require('./sharepointAuth');

const logger = getAioLogger();
class FgUser {
    userGroupIds = [];

    constructor({ at }) {
        this.at = at;
        this.userDetails = sharepointAuth.getUserDetails(at);
        this.userOid = this.userDetails?.oid;
    }

    getUserDetails() {
        return this.userDetails;
    }

    async isInGroups(grpIds) {
        if (!grpIds?.length) return false;
        const appAt = await sharepointAuth.getAccessToken();
        // eslint-disable-next-line max-len
        const numGrps = grpIds.length;
        let url = appConfig.getConfig().groupCheckUrl || '';
        url += `&$filter=id eq '${this.userOid}'`;
        let found = false;
        for (let c = 0; c < numGrps; c += 1) {
            const grpUrl = url.replace('{groupOid}', grpIds[c]);
            logger.debug(`isInGroups-URL- ${grpUrl}`);
            // eslint-disable-next-line no-await-in-loop
            found = await fetch(grpUrl, {
                headers: {
                    Authorization: `Bearer ${appAt}`
                }
            }).then((d) => d.json()).then((d1) => {
                if (d1.error) {
                    // When user dooes not have access to group an error is also returned
                    logger.debug(`Error while getting member info ${JSON.stringify(d1)}`);
                }
                return d1?.value?.length && true;
            }).catch((err) => {
                logger.warn(err);
                return false;
            });
            if (found) break;
        }
        return found === true;
    }

    async isInAdminGroup() {
        const grpIds = appConfig.getConfig().fgAdminGroups;
        return !grpIds?.length ? false : this.isInGroups(grpIds);
    }

    async isInUserGroup() {
        const grpIds = appConfig.getConfig().fgUserGroups;
        return !grpIds?.length ? true : this.isInGroups(grpIds);
    }

    async isUser() {
        const dr = await sharepoint.getDriveRoot(this.at);
        return dr ? this.isInUserGroup() : false;
    }

    async isAdmin() {
        const dr = await sharepoint.getDriveRoot(this.at);
        return dr ? this.isInAdminGroup() : false;
    }
}

module.exports = FgUser;

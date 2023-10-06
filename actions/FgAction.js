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
const openwhisk = require('openwhisk');
const { getAioLogger, actInProgress } = require('./utils');
const appConfig = require('./appConfig');
const FgUser = require('./fgUser');
const FgStatus = require('./fgStatus');

const FG_PROOCESS_ACTION = 'fgProcessAction';
const logger = getAioLogger();
const BAD_REQUEST_SC = 400;
const AUTH_FAILED_SC = 401;
const GEN_ERROR_SC = 500;
const ALL_OK_SC = 200;

/**
 * The common parameter validation, user check,
 */
class FgAction {
    constructor(action, params) {
        this.action = action || FG_PROOCESS_ACTION;
        appConfig.setAppConfig(params);
        this.spToken = params.spToken;
        // Defaults
        this.fgUser = null;
    }

    init({ fgStatusParams, skipUserDetails = false, ow }) {
        const statsParams = { action: this.action, ...fgStatusParams };
        if (!skipUserDetails) {
            this.fgUser = new FgUser({ at: this.spToken });
            statsParams.userDetails = this.fgUser.getUserDetails();
        }
        this.fgStatus = new FgStatus(statsParams);
        this.ow = ow || openwhisk();
    }

    getActionParams() {
        return {
            action: this.action,
            appConfig,
            fgStatus: this.fgStatus,
            fgUser: this.fgUser
        };
    }

    /**
     * Validates parameters for storing statues
     * @param {*}   statParams - These are parameters those are must for action to start tracking.
     * @returns Response validation status like { ok: <status as true/false>, details: <status message> }
     */
    async validateStatusParams(statParams = []) {
        const resp = { ok: false, message: 'Status Params Validation' };
        logger.debug(resp.message);
        const conf = appConfig.getPayload();
        const valFailed = statParams.find((p) => !conf[p]) !== undefined;
        if (valFailed) {
            resp.message = 'Could not determine the project path. Try reloading the page and trigger the action again.';
            return resp;
        }
        resp.ok = true;
        return resp;
    }

    /**
     * Parameter validators for action
     * @param {*} Options with
     *  reqParams - These are parameter which are required for the action to function.
     * @returns Response validation status like { ok: <status as true/false>, details: <status message> }
     */
    async validateParams(reqParams = []) {
        const resp = { ok: false, message: 'Params Validation.' };
        logger.debug(resp.message);
        let stepMsg;
        const conf = appConfig.getPayload();
        const valFailed = reqParams.find((p) => !conf[p]) !== undefined;
        if (valFailed) {
            stepMsg = `Required data is not available to proceed with FG ${this.action}.`;
            resp.message = stepMsg;
            await this.fgStatus?.updateStatusToStateLib({
                status: FgStatus.PROJECT_STATUS.FAILED,
                statusMessage: stepMsg
            });
            return resp;
        }
        resp.ok = true;
        return resp;
    }

    /**
     * User validations for action
     */
    async validateUser() {
        const resp = { ok: false, message: 'User Validation' };
        logger.debug(resp.message);
        let stepMsg;
        const storeValue = await this.fgStatus.getStatusFromStateLib();
        if (this.fgUser && !await this.fgUser.isUser()) {
            stepMsg = 'Unauthorized Access! Please contact Floodgate Administrators.';
            storeValue.action.status = FgStatus.PROJECT_STATUS.FAILED;
            storeValue.action.message = stepMsg;
            resp.details = storeValue;
            return resp;
        }
        resp.ok = true;
        return resp;
    }

    /**
     * Check if the action is in progress.
     * @param {*} options with checkActivation flag if the flag is set then activation
     *  is check is skipped
     * @returns object with ok true
     */
    async actionInProgressCheck({ checkActivation = false }) {
        const resp = { ok: false, message: 'Action In Progress' };
        logger.debug(resp.message);
        let stepMsg;
        const storeValue = await this.fgStatus.getStatusFromStateLib();
        const svStatus = storeValue?.action?.status;
        const actId = storeValue?.action?.activationId;
        const fgInProg = FgStatus.isInProgress(svStatus);

        if (!appConfig.getSkipInProgressCheck() && fgInProg) {
            if (!checkActivation || await actInProgress(this.ow, actId, FgStatus.isInProgress(svStatus))) {
                stepMsg = `A ${this.action} project with activationid: ${storeValue?.action?.activationId} is already in progress. 
                Not triggering this action. And the previous action can be retrieved by refreshing the console page`;
                storeValue.action.status = FgStatus.PROJECT_STATUS.FAILED;
                storeValue.action.message = stepMsg;
                resp.message = stepMsg;
                resp.details = storeValue;
                return resp;
            }
        }
        resp.ok = true;
        return resp;
    }

    /**
     * Validation for action for params/user/action
     * @param {*} opts options for validation
     * Returns null if no error else the payload is returned
     */
    async validateAction({
        statParams,
        actParams,
        checkUser = false,
        checkStatus = false,
        checkActivation = false
    }) {
        const OKVAL = { ok: true };
        let vStat = statParams ? await this.validateStatusParams(statParams) : OKVAL;
        if (!vStat.ok) {
            return {
                code: BAD_REQUEST_SC,
                payload: vStat.message,
            };
        }

        vStat = actParams ? await this.validateParams(actParams) : OKVAL;
        if (!vStat.ok) {
            return {
                code: BAD_REQUEST_SC,
                payload: vStat.message,
            };
        }

        vStat = checkUser ? await this.validateUser() : OKVAL;
        if (!vStat.ok) {
            return {
                code: AUTH_FAILED_SC,
                payload: vStat.details,
            };
        }

        vStat = checkStatus ? await this.actionInProgressCheck({ checkActivation }) : OKVAL;
        if (!vStat.ok) {
            return {
                code: GEN_ERROR_SC,
                payload: vStat.details,
            };
        }

        return { code: ALL_OK_SC };
    }

    logStart() {
        logger.info(`${this.action} action for ${this.fgStatus?.getStoreKey()} triggered by ${JSON.stringify(this.fgUser?.getUserDetails() || 'FG')}`);
    }
}

module.exports = FgAction;

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

const stateLib = require('@adobe/aio-lib-state');
const crypto = require('crypto');
const { getAioLogger } = require('./utils');

const FG_KEY = 'FLOODGATE';

/**
 * This is helper to track status of the Floodgate process.
 * The project status is stored data in to libstate and can be retrieved.
 */
class FgStatus {
    /**
     * Status constants
     */
    static PROJECT_STATUS = {
        STARTED: 'STARTED',
        NOT_STARTED: 'NOT STARTED',
        COMPLETED: 'COMPLETED',
        COMPLETED_WITH_ERROR: 'COMPLETED WITH ERROR',
        IN_PROGRESS: 'IN PROGRESS',
        FAILED: 'FAILED'
    };

    /**
     * Template that will be populated and stored in state
     */
    storeStatus = {
        action: {
            type: '',
            status: '',
            message: '',
            activationId: '',
            startTime: '',
            endTime: ''
        }
    };

    /**
     * Constructor with initial setup
     * @param {*} options statusKey is the key to be used to store
     * and action is the type of FG Action like copy or promote
     */
    constructor({ statusKey, action }) {
        this.storeStatus.action.type = action || '';
        this.storeKey = statusKey || FG_KEY;
        this.logger = getAioLogger();
    }

    /**
     * Checks if the given status is to be treated as InProgress
     * @param {*} status Status to be checked
     * @returns true, if the FG Status InProgress or Started
     */
    static isInProgress(status) {
        return [FgStatus.PROJECT_STATUS.IN_PROGRESS,
            FgStatus.PROJECT_STATUS.STARTED].includes(status);
    }

    /**
     * Checks if the given status is to be treated as completed
     * @param {*} status Status to be checked
     * @returns true, if the FG Status Completed (or with Error) or Failed
     */
    static isFinished(status) {
        return [FgStatus.PROJECT_STATUS.COMPLETED, FgStatus.PROJECT_STATUS.COMPLETED_WITH_ERROR,
            FgStatus.PROJECT_STATUS.FAILED].includes(status);
    }

    /**
     * Updates the status in storeStatus and stores to libstate
     * @param {*} optinos, status, message are required to be passed in most cases other optional
     * fields are activationId, startTime, endTime, action
     * @returns progress object which is stored in the store
     */
    async updateStatusToStateLib({
        status, statusMessage, activationId, action, startTime, endTime
    }) {
        try {
            await this.getStatusFromStateLib().then((result) => {
                if (result?.action) {
                    this.storeStatus = result;
                    if (status) {
                        this.storeStatus.action.status = status;
                    }
                    if (statusMessage) {
                        this.storeStatus.action.message = statusMessage;
                    }
                    if (activationId) {
                        this.storeStatus.action.activationId = activationId;
                    }
                    if (startTime) {
                        this.storeStatus.action.startTime = startTime;
                    }
                    if (endTime) {
                        this.storeStatus.action.endTime = endTime;
                    }
                } else {
                    this.storeStatus.action.type = action;
                    this.storeStatus.action.status = status;
                    this.storeStatus.action.message = statusMessage;
                    this.storeStatus.action.activationId = activationId;
                    this.storeStatus.action.startTime = startTime || this.storeStatus.action.startTime;
                    this.storeStatus.action.endTime = startTime || this.storeStatus.action.endTime;
                }
                // Set start and end based on status
                if (status && FgStatus.PROJECT_STATUS.STARTED === status) {
                    this.storeStatus.action.startTime = new Date();
                }
                if (FgStatus.isFinished(this.storeStatus.action.status)) {
                    this.storeStatus.action.endTime = new Date();
                    if (!this.storeStatus.action.startTime) {
                        this.storeStatus.action.startTime = this.storeStatus.action.endTime;
                    }
                }
                this.updateStateStatus();
            });
        } catch (err) {
            this.logger.error(`Error creating state store ${err}`);
        }
        return this.storeStatus;
    }

    /**
     * Get the status object from libstate
     * @returns Status object
     */
    async getStatusFromStateLib() {
        let status;
        try {
            // md5 hash of the config file
            const hash = crypto.createHash('md5').update(this.storeKey).digest('hex');
            this.logger.info(`Project excel path and hash value -- ${this.storeKey} and ${hash}`);
            // init when running in an Adobe I/O Runtime action (OpenWhisk) (uses env vars __OW_API_KEY and __OW_NAMESPACE automatically)
            const state = await stateLib.init();
            // getting activation id data from io state
            const res = await state.get(hash); // res = { value, expiration }
            if (res) {
                status = res.value;
                this.logger.info(`Status from the store ${JSON.stringify(status)}`);
            }
        } catch (err) {
            this.logger.error(`Error getting data from state store ${err}`);
        }
        return status;
    }

    /**
     * Save the store status object into libstate
     */
    async updateStateStatus() {
        const hash = crypto.createHash('md5').update(this.storeKey).digest('hex');
        this.logger.info(`Adding status to aio state lib with hash -- ${hash} - ${JSON.stringify(this.storeStatus)}`);
        // get the hash value if its available
        try {
            const state = await stateLib.init();
            // save it
            await state.put(hash, this.storeStatus, {
                // 30day expiration...
                ttl: 2592000
            });
        } catch (err) {
            this.logger.error(`Error creating state store ${err}`);
        }
    }
}

module.exports = FgStatus;

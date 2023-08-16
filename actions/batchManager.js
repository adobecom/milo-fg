/* eslint-disable no-await-in-loop */
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
const filesLib = require('@adobe/aio-lib-files');
const Batch = require('./batch');
const appConfig = require('./appConfig');
const { getAioLogger } = require('./utils');

const logger = getAioLogger();

/**
 * The BatchManager class helps manage a collection of batches for a single process. Its functions include:
 * 1. Create batches based on the number of batch files configuration.
 * 2. Maintain a manifest file for the collection of batches,
 *    which includes details such as the last batch and associated activation IDs.
 * 3. Track the current batch in the manager and provide helper methods for management.
 * 4. Offer cleanup functions for managing any necessary cleanup tasks.
 * Some near term tasks to be done
 * 1. Clean of processed files needs to be handled instead of full cleanup
 * 2. Stop and resume needs to be implemented.
 * 3. Retry of failed files needs to be implemented which might need rebatching
 * 4. The execution/triggering of action is out of this (i.e. promoteBatch).
 *   There needs to be enhacement to handle this within this e.g. Batch execution stargergy should be implemented.
 */
class BatchManager {
    filesSdk = null;

    instanceData = { lastBatch: '', dtls: { batchesInfo: [] } };

    /**
     * Initializes the batch manager based on the action and sets up manifest files.
     * Default files in batch is 1000 and filePath is generate based on configuration and action
     * @param {*} params { key: <Key to be used for the batchManager e.g. promoteAction>,
     * instance: <insance name e.g. _milo_pink>}
     */
    constructor(params) {
        this.params = params || {};
        this.batches = [];
        this.batchFilesPath = appConfig.getBatchConfig()?.batchFilesPath;
        this.key = params.key;
        this.bmPath = `${this.batchFilesPath}/${this.key}`;
        this.bmTracker = `${this.bmPath}/tracker.json`;
        this.initInstance(params);
    }

    /**
     * Setup instance key e.g. Promote File is action and the fgRootPath (e.g. _milo_pink is key)
     * @param {*} params {instance: <insance name e.g. _milo_pink> }
     * @returns this
     */
    initInstance(params) {
        this.instanceKey = (params.instanceKey || 'default').replaceAll('/', '_');
        this.instancePath = `${this.batchFilesPath}/${this.key}/instance${this.instanceKey}`;
        this.instanceFile = `${this.instancePath}/instance_info.json`;
        return this;
    }

    /**
     * Initialize Batch Optionally
     * @param {*} params {batchNumber: batchNumber }
     * @returns this
     */
    initBatch(params) {
        if (params?.batchNumber) {
            this.currentBatchNumber = params.batchNumber;
            this.currentBatch = new Batch({
                ...this.params,
                filesSdk: this.filesSdk,
                instancePath: this.instancePath,
                batchNumber: this.currentBatchNumber
            });
            this.batches.push(this.currentBatch);
        }
        return this;
    }

    async init(params) {
        if (!this.filesSdk) this.filesSdk = await filesLib.init();
        this.initBatch(params);
        return this;
    }

    /**
     * **********************************************************
     * ************* TRACKER RELATED FUNCTIONS ******************
     * **********************************************************
     */

    /**
     * Read promoteAction/tracker.json
     * Structure
     * {
     *   instanceKeys: [_milo_pink],
     *   '_milo_pink': {done: <true>, proceed: <true>}
     * }
     */
    async readBmTracker() {
        try {
            const buffer = await this.filesSdk.read(this.bmTracker);
            return JSON.parse(buffer.toString());
        } catch (err) {
            logger.debug(`Error while reading bmTracker file ${err.message}`);
        }
        return {};
    }

    /**
     * Write to promoteAction/tracker.json
     */
    async writeToBmTracker(data) {
        const content = await this.readBmTracker();
        content.instanceKeys = content.instanceKeys || [];
        if (content.instanceKeys) {
            const filteredArray = content.instanceKeys.filter((e) => e !== null);
            content.instanceKeys = filteredArray;
            if (this.instanceKey && !content.instanceKeys.includes(this.instanceKey)) {
                content.instanceKeys.push(this.instanceKey);
            }
        }
        await this.filesSdk.write(this.bmTracker, JSON.stringify({ ...content, ...data }));
    }

    /**
     * **********************************************************
     * ************* INSTANCE RELATED FUNCTIONS ******************
     * **********************************************************
     */

    /**
     * Overwrite details in the instance file
     * @param {*} data {lastBatch: <final batch>, dtls:[{batchNunber: <batch number>,
     * activationId: <AIO action activation id>}]}
     */
    async writeToInstanceFile(data) {
        await this.filesSdk.write(this.instanceFile, JSON.stringify(data));
    }

    /**
     * Append to manifest file. The addToInstanceFile and this can be merged. Can be looked later.
     * @param {*} params data similar to that of writeToManifest
     */
    async addToInstanceFile(params) {
        const ifc = await this.getInstanceFileContent();
        ifc.dtls = { ...ifc.dtls, ...params };
        await this.writeToInstanceFile(ifc);
    }

    /**
     * Read instance_info.json under promoteAction/instance_<key>/instance_info.json
     * @returns Read the file contents of instance_info.json
     */
    async getInstanceFileContent() {
        const buffer = await this.filesSdk.read(this.instanceFile);
        const data = buffer.toString();
        return JSON.parse(data);
    }

    /**
     * **********************************************************
     * ************** FLOW RELATED FUNCTIONS ********************
     * **********************************************************
     */

    /**
     * Reads tracker.json to get the instance key and then reads instance_info.json
     */
    async getInstanceData() {
        let instanceData = null;
        const bmData = await this.readBmTracker();
        const instanceKey = bmData.instanceKeys?.find((e) => !bmData[e].done && bmData[e].proceed);
        if (bmData[instanceKey]) {
            this.initInstance({ instanceKey });
            instanceData = await this.getInstanceFileContent();
        }
        return instanceData;
    }

    async finalizeInstance(addlParams) {
        // Save any pending files in the batch
        await this.currentBatch?.savePendingFiles();

        // If there are any additional parameters then add to the instance file.
        if (addlParams) {
            const ifc = await this.getInstanceFileContent();
            ifc.dtls = { ...ifc.dtls, ...addlParams };
            await this.writeToInstanceFile(ifc);
        }

        // Update promoteAction/tracker.json to start the batch processing
        const params = {};
        params[`${this.instanceKey}`] = {
            done: false,
            proceed: true,
        };
        await this.writeToBmTracker(params);
    }

    async markComplete() {
        const params = {};
        params[`${this.instanceKey}`] = {
            done: true,
            proceed: false,
        };
        await this.writeToBmTracker(params);
    }

    /** Cleanup files for the current action */
    async cleanupFiles() {
        await this.filesSdk.delete(`${this.instancePath}/`);
    }

    /**
     * Returns the current running batch interface
     * @returns Batch which has details like batch number and batchPath
     */
    async getCurrentBatch() {
        if (!this.currentBatch) {
            this.currentBatch = this.createBatch();
        }
        return this.currentBatch;
    }

    /**
     * **********************************************************
     * ************** BATCH RELATED FUNCTIONS ********************
     * **********************************************************
     */

    /**
     * This method is used when a batch overflows and a new batch needs to be created.
     * This batch is also linked with BatchManager
     */
    async createBatch() {
        this.currentBatchNumber = this.getNewBatchNumber();
        this.currentBatch = new Batch({
            filesSdk: this.filesSdk,
            instancePath: this.instancePath,
            batchNumber: this.currentBatchNumber
        });
        this.batches.push(this.currentBatch);
        this.instanceData.lastBatch = this.currentBatchNumber;
        this.instanceData.dtls.batchesInfo = this.getBatchesInfo();
        this.writeToInstanceFile(this.instanceData);
        return this.currentBatch;
    }

    /**
     * Current batch number else 0
     * @returns current batch number else 0
     */
    getNewBatchNumber() {
        return (this.currentBatch?.getBatchNumber() || 0) + 1;
    }

    getBatchesInfo() {
        return this.batches.map((b) => ({ batchNumber: b.getBatchNumber() }));
    }

    /**
     * This adds the files metadata to Batch and create a new if it overflows
     * @param {*} file  File path
     * @param {*} retryCount after an overflow a new batch is created and this is called again.
     */
    async addFile(file, retryCount) {
        if (this.filesSdk && this.instancePath) {
            if (this.currentBatch && this.currentBatch.canAddFile()) {
                await this.currentBatch.addFile(file);
            } else if (!retryCount) {
                await this.currentBatch?.savePendingFiles();
                await this.createBatch();
                await this.addFile(file, 1);
            }
        }
    }

    /**
     * @returns Return batches linked to BatchManager
     */
    getBatches() {
        return this.batches;
    }
}

module.exports = BatchManager;

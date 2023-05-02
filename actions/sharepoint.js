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

const { Headers } = require('node-fetch');
const fetch = require('node-fetch');
const { getConfig } = require('./config');

const BATCH_REQUEST_LIMIT = 20;
const BATCH_DELAY_TIME = 200;

// eslint-disable-next-line default-param-last
function getAuthorizedRequestOption(spToken, { body = null, json = true, method = 'GET' } = {}) {
    const bearer = `Bearer ${spToken}`;
    const headers = new Headers();
    headers.append('Authorization', bearer);
    if (json) {
        headers.append('Accept', 'application/json');
        headers.append('Content-Type', 'application/json');
    }

    const options = {
        method,
        headers,
    };

    if (body) {
        options.body = typeof body === 'string' ? body : JSON.stringify(body);
    }

    return options;
}

async function getFileData(spToken, adminPageUri, filePath, isFloodgate) {
    const { sp } = await getConfig(adminPageUri);
    const options = getAuthorizedRequestOption(spToken);
    const baseURI = isFloodgate ? sp.api.directory.create.fgBaseURI : sp.api.directory.create.baseURI;
    const resp = await fetch(`${baseURI}${filePath}`, options);
    const json = await resp.json();
    return json;
}

async function getFilesData(spToken, adminPageUri, filePaths, isFloodgate) {
    const batchArray = [];
    for (let i = 0; i < filePaths.length; i += BATCH_REQUEST_LIMIT) {
        const arrayChunk = filePaths.slice(i, i + BATCH_REQUEST_LIMIT);
        batchArray.push(arrayChunk);
    }
    // process data in batches
    const fileJsonResp = [];
    for (let i = 0; i < batchArray.length; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        fileJsonResp.push(...await Promise.all(
            batchArray[i].map((file) => getFileData(spToken, adminPageUri, file, isFloodgate)),
        ));
        // eslint-disable-next-line no-await-in-loop, no-promise-executor-return
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_TIME));
    }
    return fileJsonResp;
}

async function getFile(doc) {
    if (doc && doc.sp && doc.sp.status === 200) {
        const response = await fetch(doc.sp['@microsoft.graph.downloadUrl']);
        return response.blob();
    }
    return undefined;
}

async function createFolder(spToken, adminPageUri, folder, isFloodgate) {
    const { sp } = await getConfig(adminPageUri);

    const options = getAuthorizedRequestOption(spToken, { method: sp.api.directory.create.method });
    options.body = JSON.stringify(sp.api.directory.create.payload);

    const baseURI = isFloodgate ? sp.api.directory.create.fgBaseURI : sp.api.directory.create.baseURI;

    const res = await fetch(`${baseURI}${folder}`, options);
    if (res.ok) {
        return res.json();
    }
    throw new Error(`Could not create folder: ${folder}`);
}

function getFolderFromPath(path) {
    if (path.includes('.')) {
        return path.substring(0, path.lastIndexOf('/'));
    }
    return path;
}

function getFileNameFromPath(path) {
    return path.split('/').pop().split('/').pop();
}

async function createUploadSession(spToken, sp, file, dest, filename, isFloodgate) {
    const payload = {
        ...sp.api.file.createUploadSession.payload,
        description: 'Preview file',
        fileSize: file.size,
        name: filename,
    };
    const options = getAuthorizedRequestOption(spToken, { method: sp.api.file.createUploadSession.method });
    options.body = JSON.stringify(payload);

    const baseURI = isFloodgate ? sp.api.file.createUploadSession.fgBaseURI : sp.api.file.createUploadSession.baseURI;

    const createdUploadSession = await fetch(`${baseURI}${dest}:/createUploadSession`, options);
    return createdUploadSession.ok ? createdUploadSession.json() : undefined;
}

async function uploadFile(spToken, sp, uploadUrl, file) {
    const options = getAuthorizedRequestOption(spToken, {
        json: false,
        method: sp.api.file.upload.method,
    });
    // TODO API is limited to 60Mb, for more, we need to batch the upload.
    options.headers.append('Content-Length', file.size);
    options.headers.append('Content-Range', `bytes 0-${file.size - 1}/${file.size}`);
    options.headers.append('Prefer', 'bypass-shared-lock');
    options.body = file;
    return fetch(`${uploadUrl}`, options);
}

async function deleteFile(spToken, sp, filePath) {
    const options = getAuthorizedRequestOption(spToken, {
        json: false,
        method: sp.api.file.delete.method,
    });
    options.headers.append('Prefer', 'bypass-shared-lock');
    return fetch(filePath, options);
}

async function renameFile(spToken, spFileUrl, filename) {
    const options = getAuthorizedRequestOption(spToken, { method: 'PATCH', body: JSON.stringify({ name: filename }) });
    options.headers.append('Prefer', 'bypass-shared-lock');
    return fetch(spFileUrl, options);
}

async function releaseUploadSession(spToken, sp, uploadUrl) {
    await deleteFile(spToken, sp, uploadUrl);
}

function getLockedFileNewName(filename) {
    const extIndex = filename.indexOf('.');
    const fileNameWithoutExtn = filename.substring(0, extIndex);
    const fileExtn = filename.substring(extIndex);
    return `${fileNameWithoutExtn}-locked-${Date.now()}${fileExtn}`;
}

async function createSessionAndUploadFile(spToken, sp, file, dest, filename, isFloodgate) {
    const createdUploadSession = await createUploadSession(spToken, sp, file, dest, filename, isFloodgate);
    const status = {};
    if (createdUploadSession) {
        const uploadSessionUrl = createdUploadSession.uploadUrl;
        if (!uploadSessionUrl) {
            return status;
        }
        status.sessionUrl = uploadSessionUrl;
        const uploadedFile = await uploadFile(spToken, sp, uploadSessionUrl, file);
        if (!uploadedFile) {
            return status;
        }
        if (uploadedFile.ok) {
            status.uploadedFile = await uploadedFile.json();
            status.success = true;
        } else if (uploadedFile.status === 423) {
            status.locked = true;
        }
    }
    return status;
}

async function copyFile(spToken, adminPageUri, srcPath, destinationFolder, newName, isFloodgate, isFloodgateLockedFile) {
    await createFolder(spToken, adminPageUri, destinationFolder, isFloodgate);
    const { sp } = await getConfig(adminPageUri);
    const { baseURI } = sp.api.file.copy;
    const { fgBaseURI } = sp.api.file.copy;
    const rootFolder = isFloodgate ? fgBaseURI.split('/').pop() : baseURI.split('/').pop();

    const payload = { ...sp.api.file.copy.payload, parentReference: { path: `${rootFolder}${destinationFolder}` } };
    if (newName) {
        payload.name = newName;
    }
    const options = getAuthorizedRequestOption(spToken, {
        method: sp.api.file.copy.method,
        body: JSON.stringify(payload),
    });
    // In case of FG copy action triggered via saveFile(), locked file copy happens in the floodgate content location
    // So baseURI is updated to reflect the destination accordingly
    const contentURI = isFloodgate && isFloodgateLockedFile ? fgBaseURI : baseURI;
    const copyStatusInfo = await fetch(`${contentURI}${srcPath}:/copy`, options);
    const statusUrl = copyStatusInfo.headers.get('Location');
    let copySuccess = false;
    let copyStatusJson = {};
    while (statusUrl && !copySuccess && copyStatusJson.status !== 'failed') {
        // eslint-disable-next-line no-await-in-loop
        const status = await fetch(statusUrl);
        if (status.ok) {
            // eslint-disable-next-line no-await-in-loop
            copyStatusJson = await status.json();
            copySuccess = copyStatusJson.status === 'completed';
        }
    }
    return copySuccess;
}

async function saveFile(spToken, adminPageUri, file, dest, isFloodgate) {
    try {
        const folder = getFolderFromPath(dest);
        const filename = getFileNameFromPath(dest);
        await createFolder(spToken, adminPageUri, folder, isFloodgate);
        const { sp } = await getConfig(adminPageUri);
        let uploadFileStatus = await createSessionAndUploadFile(spToken, sp, file, dest, filename, isFloodgate);
        if (uploadFileStatus.locked) {
            await releaseUploadSession(spToken, sp, uploadFileStatus.sessionUrl);
            const lockedFileNewName = getLockedFileNewName(filename);
            const baseURI = isFloodgate ? sp.api.file.get.fgBaseURI : sp.api.file.get.baseURI;
            const spFileUrl = `${baseURI}${dest}`;
            await renameFile(spToken, spFileUrl, lockedFileNewName);
            const newLockedFilePath = `${folder}/${lockedFileNewName}`;
            const copyFileStatus = await copyFile(spToken, adminPageUri, newLockedFilePath, folder, filename, isFloodgate, true);
            if (copyFileStatus) {
                uploadFileStatus = await createSessionAndUploadFile(spToken, sp, file, dest, filename, isFloodgate);
                if (uploadFileStatus.success) {
                    await deleteFile(spToken, sp, `${baseURI}${newLockedFilePath}`);
                }
            }
        }
        const uploadedFileJson = uploadFileStatus.uploadedFile;
        if (uploadedFileJson) {
            return { success: true, uploadedFileJson, path: dest };
        }
    } catch (error) {
        return { success: false, path: dest, errorMsg: error.message };
    }
    return { success: false, path: dest };
}

async function updateExcelTable(spToken, adminPageUri, excelPath, tableName, values) {
    const { sp } = await getConfig(adminPageUri);

    const options = getAuthorizedRequestOption(spToken, {
        body: JSON.stringify({ values }),
        method: sp.api.excel.update.method,
    });

    const res = await fetch(
        `${sp.api.excel.update.baseURI}${excelPath}:/workbook/tables/${tableName}/rows/add`,
        options,
    );
    if (res.ok) {
        return res.json();
    }
    throw new Error(`Failed to update excel sheet ${excelPath} table ${tableName}.`);
}

module.exports = {
    getAuthorizedRequestOption,
    getFilesData,
    getFile,
    copyFile,
    saveFile,
    createFolder,
    updateExcelTable,
};

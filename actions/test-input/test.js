const { getAioLogger } = require('../utils');

// This returns the activation ID of the action that it called
function main(params) {
    const logger = getAioLogger();
    const {
        fgSite,
        fgClientId,
        fgAuthority,
    } = params;

    const payload = {
        fgSite,
        fgClientId,
        fgAuthority,
    }

    return {
        body: payload,
    };
}

exports.main = main;

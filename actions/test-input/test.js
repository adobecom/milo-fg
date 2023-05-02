const { getAioLogger } = require('../utils');

// This returns the activation ID of the action that it called
function main(params) {
    const logger = getAioLogger('main', params.LOG_LEVEL || 'info');
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

    logger.debug(`fg params: ${JSON.parse(payload)}`);

    return {
        body: payload,
    };
}

exports.main = main;

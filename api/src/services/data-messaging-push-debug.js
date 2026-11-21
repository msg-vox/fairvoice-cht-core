const logger = require('@medic/logger');

module.exports = (format, ...args) => {
  if (process.env.DATA_MESSAGE_PUSH_DEBUG === 'true') {
    logger.info('[Fairvoice push] ' + format, ...args);
  }
};

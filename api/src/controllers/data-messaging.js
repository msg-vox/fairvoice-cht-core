const { PREFIXES } = require('@medic/constants');
const serverUtils = require('../server-utils');
const dataMessaging = require('../services/data-messaging');

module.exports = {
  send: serverUtils.doOrError(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const accountId = PREFIXES.COUCH_USER + req.userCtx.name;
    const created = await dataMessaging.send(accountId, req.body);
    return res.status(created ? 201 : 200).json({ id: req.body._id });
  }),

  sync: serverUtils.doOrError(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { since = '0' } = req.query;
    if (typeof since !== 'string' || since.length > 4096 || !/^\d+(?:-[\w=-]+)?$/.test(since)) {
      return serverUtils.error({ code: 400, message: 'Invalid messaging sync cursor' }, req, res);
    }

    const accountId = PREFIXES.COUCH_USER + req.userCtx.name;
    const page = await dataMessaging.getSyncPage(accountId, since);
    return res.json(page);
  }),
};

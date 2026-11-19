const { PREFIXES } = require('@medic/constants');
const serverUtils = require('../server-utils');
const dataMessaging = require('../services/data-messaging');
const pushRegistrations = require('../services/data-messaging-push-registrations');

const getAccountId = req => PREFIXES.COUCH_USER + req.userCtx.name;

module.exports = {
  send: serverUtils.doOrError(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const accountId = getAccountId(req);
    const created = await dataMessaging.send(accountId, req.body);
    return res.status(created ? 201 : 200).json({ id: req.body._id });
  }),

  sync: serverUtils.doOrError(async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { since = '0' } = req.query;
    if (typeof since !== 'string' || since.length > 4096 || !/^\d+(?:-[\w=-]+)?$/.test(since)) {
      return serverUtils.error({ code: 400, message: 'Invalid messaging sync cursor' }, req, res);
    }

    const accountId = getAccountId(req);
    const page = await dataMessaging.getSyncPage(accountId, since);
    return res.json(page);
  }),

  registerPush: serverUtils.doOrError(async (req, res) => {
    res.json(await pushRegistrations.register(getAccountId(req), req.body));
  }),

  refreshPush: serverUtils.doOrError(async (req, res) => {
    res.json(await pushRegistrations.refresh(getAccountId(req), req.body));
  }),

  unregisterPush: serverUtils.doOrError(async (req, res) => {
    await pushRegistrations.unregister(getAccountId(req), req.body);
    res.status(204).end();
  }),
};

const assert = require('node:assert/strict');
const sinon = require('sinon');
const { PREFIXES, USER_ROLES } = require('@medic/constants');
const defaultSettings = require('../../../../config/default/app_settings.json');
const auth = require('../../../src/auth');
const config = require('../../../src/config');
const dataMessaging = require('../../../src/services/data-messaging');
const users = require('@medic/user-management/src/users');

describe('Data messaging contract', () => {
  afterEach(() => sinon.restore());

  describe('configuration', () => {
    it('is off for both existing deployments and the default app settings', () => {
      const get = sinon.stub(config, 'get');
      assert.equal(dataMessaging.getConfig().enabled, false);

      get.withArgs('data_messaging').returns(defaultSettings.data_messaging);
      assert.equal(dataMessaging.getConfig().enabled, false);
    });

    it('requires explicit enablement and a configured pilot', () => {
      const get = sinon.stub(config, 'get').withArgs('data_messaging');
      const pilot = { role_ids: { cr: ['researcher'], supervisor: ['manager'] }, pilot_root_place_ids: ['pilot'] };
      get.returns({ ...pilot, enabled: 'true' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ ...pilot, enabled: true, pilot_root_place_ids: 'pilot' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ ...pilot, enabled: true });
      const settings = dataMessaging.getConfig();
      assert.deepEqual(settings, {
        enabled: true,
        roleIds: { cr: ['researcher'], supervisor: ['manager'], officer: [] },
        pilotRootPlaceIds: ['pilot'],
      });
      assert.equal(dataMessaging.isPilotPlace(settings, ['pilot']), true);
      assert.equal(dataMessaging.isPilotPlace(settings, ['child', 'pilot', 'parent']), true);
      assert.equal(dataMessaging.isPilotPlace(settings, ['sibling', 'parent']), false);
      assert.equal(dataMessaging.isPilotPlace({ ...settings, enabled: false }, ['pilot']), false);
    });
  });

  describe('session account', () => {
    it('uses the authenticated name for either an online or offline account', async () => {
      const req = { body: { sender_id: 'supplied-id' }, userCtx: { name: 'supplied-name' } };
      const getUserCtx = sinon.stub(auth, 'getUserCtx');
      const getMessagingAccount = sinon.stub(users, 'getMessagingAccount');
      const account = { id: PREFIXES.COUCH_USER + 'authenticated', facilityIds: ['place-a', 'place-b'] };
      getMessagingAccount.withArgs('authenticated').resolves(account);
      for (const roles of [[USER_ROLES.ONLINE], ['cr']]) {
        getUserCtx.withArgs(req).resolves({ name: 'authenticated', roles });
        assert.deepEqual(await dataMessaging.getAccount(req), account);
      }
      assert.deepEqual(getUserCtx.args, [[req], [req]]);
      assert.deepEqual(getMessagingAccount.args, [['authenticated'], ['authenticated']]);
    });

    it('rejects an unauthenticated request before looking up the account', async () => {
      sinon.stub(auth, 'getUserCtx').rejects({ code: 401 });
      const getMessagingAccount = sinon.stub(users, 'getMessagingAccount');
      await assert.rejects(dataMessaging.getAccount({}), { code: 401 });
      assert.equal(getMessagingAccount.callCount, 0);
    });
  });
});

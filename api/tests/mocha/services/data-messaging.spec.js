const assert = require('node:assert/strict');
const sinon = require('sinon');
const { PREFIXES, USER_ROLES } = require('@medic/constants');
const defaultSettings = require('../../../../config/default/app_settings.json');
const auth = require('../../../src/auth');
const config = require('../../../src/config');
const db = require('../../../src/db');
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
      const pilot = { pilot_root_place_ids: ['pilot'] };
      get.returns({ ...pilot, enabled: 'true' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ enabled: true, pilot_root_place_ids: 'pilot' });
      assert.equal(dataMessaging.getConfig().enabled, false);
      get.returns({ ...pilot, enabled: true });
      const settings = dataMessaging.getConfig();
      assert.deepEqual(settings, {
        enabled: true,
        pilotRootPlaceIds: ['pilot'],
      });
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

  describe('recipient eligibility', () => {
    const accountId = name => PREFIXES.COUCH_USER + name;
    const canMessage = (first, second) => dataMessaging.canMessage(accountId(first), accountId(second));
    const place = (_id, contact_type, parent) => ({ _id, _rev: '1-test', type: 'contact', contact_type, parent });
    let getAccount;
    let readPlace;
    let getSettings;

    beforeEach(() => {
      getSettings = sinon.stub(config, 'get').withArgs('data_messaging');
      getSettings.returns({ enabled: true, pilot_root_place_ids: ['pilot'] });
      sinon.stub(config, 'getAll').returns({ contact_types: [
        { id: 'country' },
        { id: 'region', parents: ['country'] },
        { id: 'zone', parents: ['region', 'zone'] },
        { id: 'hub', parents: ['zone'] },
        { id: 'site', parents: ['hub'] },
        { id: 'person', person: true },
      ] });
      readPlace = sinon.stub(db.medic, 'get').rejects({ status: 404 });
      [
        place('country', 'country'),
        place('pilot', 'region', { _id: 'country' }),
        place('elsewhere', 'region', { _id: 'country' }),
        place('zone', 'zone', { _id: 'pilot' }),
        place('other-zone', 'zone', { _id: 'pilot' }),
        place('outside-zone', 'zone', { _id: 'elsewhere' }),
        place('hub', 'hub', { _id: 'zone' }),
        place('site', 'site', { _id: 'hub', parent: { _id: 'zone', parent: { _id: 'pilot' } } }),
        place('person', 'person', { _id: 'hub' }),
      ].forEach(doc => readPlace.withArgs(doc._id).resolves(doc));
      getAccount = sinon.stub(users, 'getMessagingAccount').resolves();
      const assignments = {
        site: ['site'],
        peer: ['site'],
        hub: ['hub'],
        zone: ['zone'],
        pilot: ['pilot'],
        country: ['country'],
        unrelated: ['other-zone'],
        multiple: ['other-zone', 'hub'],
        unassigned: [],
        missingPlace: ['missing'],
        person: ['person'],
      };
      Object.entries(assignments).forEach(([name, facilityIds]) => {
        getAccount.withArgs(name).resolves({ id: accountId(name), facilityIds, roles: ['custom'] });
      });
    });

    [
      ['site', 'pilot', true],
      ['site', 'zone', true],
      ['site', 'hub', true],
      ['hub', 'pilot', true],
      ['site', 'multiple', true],
      ['site', 'peer', false],
      ['zone', 'unrelated', false],
      ['site', 'unrelated', false],
      ['site', 'country', false],
      ['site', 'unassigned', false],
      ['site', 'inactive', false],
      ['site', 'missingPlace', false],
      ['hub', 'person', false],
      ['site', 'site', false],
    ].forEach(([first, second, allowed]) => {
      it(`${allowed ? 'allows' : 'denies'} ${first} and ${second} in both directions`, async () => {
        assert.equal(await canMessage(first, second), allowed);
        assert.equal(await canMessage(second, first), allowed);
      });
    });

    it('filters and deduplicates directory candidates using the send policy', async () => {
      const sender = accountId('site');
      const candidates = ['hub', 'peer', 'pilot', 'hub', 'inactive', 'site'].map(accountId);
      assert.deepEqual(await dataMessaging.getEligibleRecipientIds(sender, candidates), [
        accountId('hub'),
        accountId('pilot'),
      ]);
      assert.equal(getAccount.withArgs('site').callCount, 1);
      assert.equal(getAccount.withArgs('hub').callCount, 1);

      getAccount.withArgs('site').resolves({ id: sender, facilityIds: ['other-zone'] });
      assert.equal(await canMessage('site', 'hub'), false);
      assert.deepEqual(await dataMessaging.getEligibleRecipientIds(sender, candidates), [accountId('pilot')]);
    });

    it('honors an outer pilot root when another pilot root is nested below it', async () => {
      getSettings.returns({ enabled: true, pilot_root_place_ids: ['hub', 'pilot'] });
      assert.equal(await canMessage('site', 'pilot'), true);
    });

    it('uses current place parents and account assignments on every check', async () => {
      assert.equal(await canMessage('site', 'pilot'), true);
      readPlace.withArgs('hub').resolves(place('hub', 'hub', { _id: 'outside-zone' }));
      assert.equal(await canMessage('site', 'pilot'), false);
      getAccount.withArgs('site').resolves({ id: accountId('site'), facilityIds: ['zone'] });
      assert.equal(await canMessage('site', 'pilot'), true);
    });

    it('rejects a disallowed parent type or cyclic chain', async () => {
      readPlace.withArgs('site').resolves(place('site', 'site', { _id: 'zone' }));
      assert.equal(await canMessage('site', 'pilot'), false);
      readPlace.withArgs('zone').resolves(place('zone', 'zone', { _id: 'zone' }));
      assert.equal(await canMessage('zone', 'pilot'), false);
    });

    it('rejects malformed IDs and disabled messaging before loading accounts', async () => {
      assert.equal(await dataMessaging.canMessage(null, accountId('pilot')), false);
      getSettings.returns({ enabled: false, pilot_root_place_ids: ['pilot'] });
      assert.equal(await canMessage('site', 'pilot'), false);
      assert.equal(getAccount.callCount, 0);
    });
  });
});

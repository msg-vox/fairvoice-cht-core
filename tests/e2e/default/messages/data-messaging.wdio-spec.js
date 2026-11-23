const { v7: uuid } = require('uuid');
const { Key } = require('webdriverio');
const { CONTACT_TYPES, PREFIXES } = require('@medic/constants');
const { DB_NAME } = require('@constants');
const utils = require('@utils');
const commonPage = require('@page-objects/default/common/common.wdio.page');
const loginPage = require('@page-objects/default/login/login.wdio.page');
const messagesPage = require('@page-objects/default/sms/messages.wdio.page');
const placeFactory = require('@factories/cht/contacts/place');
const userFactory = require('@factories/cht/users/users');

describe('Private data messaging', () => {
  const places = placeFactory.generateHierarchy();
  const root = places.get(CONTACT_TYPES.DISTRICT_HOSPITAL);
  const site = places.get(CONTACT_TYPES.HEALTH_CENTER);
  const outside = placeFactory.place().build({ type: CONTACT_TYPES.DISTRICT_HOSPITAL });
  const suffix = uuid().slice(-8);
  const makeUser = (name, place, roles) => userFactory.build({
    username: `data-${name}-${suffix}`,
    place: place._id,
    roles,
    contact: { name },
  });
  const worker = makeUser('worker', site, ['chw']);
  const dashboard = makeUser('dashboard', root, ['program_officer']);
  const unrelated = makeUser('unrelated', outside, ['program_officer']);
  const accounts = [worker, dashboard, unrelated];
  const accountId = user => PREFIXES.COUCH_USER + user.username;
  const threadId = user => 'data:' + accountId(user);
  const scopedHistory = user => utils.request({ path: '/api/v1/data-messaging/sync', auth: user });
  const setPilot = data_messaging => utils.request({
    path: '/api/v1/settings?replace=1', method: 'PUT', body: { data_messaging },
  });
  const messageRows = () => $$('#message-content li[data-id]');
  const sendModal = '#send-message';
  const replyComposer = '.data-message-reply mm-data-message-composer';
  let originalPilot;

  const enterMessages = async user => {
    await loginPage.login(user);
    await commonPage.goToMessages();
    await commonPage.waitForPageLoaded();
  };

  const submit = async (composer, text) => {
    await $(composer).$('textarea').setValue(text);
    await $(composer).$('button[type="submit"]').click();
  };

  const goOffline = async () => {
    await browser.throttleNetwork('offline');
    await browser.waitUntil(() => browser.execute(() => !navigator.onLine), {
      timeoutMsg: 'The browser did not go offline',
    });
  };

  const waitForDelivery = async (index, status) => {
    await browser.waitUntil(async () => {
      const row = (await messageRows())[index];
      return row && (await row.$('.task-state').getText()) === status;
    }, { timeout: 30000, timeoutMsg: `Message ${index + 1} did not reach "${status}"` });
  };

  const expectCopiedText = async (row, text) => {
    const copy = row.$('button=Copy message text');
    await copy.click();
    await browser.execute(() => {
      const target = document.createElement('textarea');
      target.id = 'clipboard-test-target';
      document.body.append(target);
      target.focus();
    });
    await browser.keys([Key.Ctrl, 'v']);
    expect(await $('#clipboard-test-target').getValue()).to.equal(text);
  };

  const expectBubbleSides = async expected => {
    const sides = await browser.execute(() => {
      const root = document.querySelector('.app-root');
      const originalDirection = root.dir;
      const wasRtl = root.classList.contains('rtl');
      try {
        return ['ltr', 'rtl'].map(direction => {
          root.dir = direction;
          root.classList.toggle('rtl', direction === 'rtl');
          return Array.from(document.querySelectorAll('#message-content .data-message-text'), bubble => {
            const { left, right } = bubble.getBoundingClientRect();
            const body = bubble.closest('.data').getBoundingClientRect();
            return left - body.left < body.right - right ? 'left' : 'right';
          });
        });
      } finally {
        root.dir = originalDirection;
        root.classList.toggle('rtl', wasRtl);
      }
    });
    expect(sides).to.deep.equal([expected, expected]);
  };

  before(async () => {
    const settings = await utils.request('/api/v1/settings');
    originalPilot = settings.data_messaging ?? null;
    await utils.saveDocs([...places.values(), outside]);
    await utils.createUsers(accounts);
    await setPilot({ enabled: true, pilot_root_place_ids: [root._id] });
    await browser.waitUntil(async () => (await scopedHistory(worker)).directory?.length === 1);
  });

  after(async () => {
    const path = `/${DB_NAME}-data-messaging`;
    try {
      const history = await scopedHistory(worker);
      const keys = history.messages.map(message => message._id);
      const { rows } = await utils.request({ path: path + '/_all_docs', method: 'POST', body: { keys } });
      const docs = rows.map(row => ({ _id: row.id, _rev: row.value.rev, _deleted: true }));
      await utils.request({ path: path + '/_bulk_docs', method: 'POST', body: { docs } });
    } finally {
      await setPilot(originalPilot);
    }
  });

  afterEach(async () => {
    await browser.throttleNetwork('online');
  });

  it('exchanges a queued message and a dashboard reply and rejects a pending send after disablement', async () => {
    const first = 'Offline worker message <b>shown as text</b>';
    const reply = 'Dashboard reply';
    const pending = 'Queued before the pilot was disabled';

    await enterMessages(worker);
    await commonPage.clickFastActionFlat({ waitForList: false });
    const picker = $(`${sendModal} #send-message-account + .select2`);
    const search = picker.$('input.select2-search__field');
    await search.waitForDisplayed();
    expect(await $('#send-message-channel').isExisting()).to.equal(false);
    expect(await $('#send-message-phone').isDisplayed()).to.equal(false);
    await search.click();
    const results = $(`${sendModal} .select2-results__options[aria-multiselectable="true"]`);
    const options = () => results.$$('.select2-results__option[aria-selected]');
    await browser.waitUntil(async () => (await options()).length === 1);
    const [recipient] = await options();
    expect(await recipient.getText()).to.include(dashboard.contact.name);
    await recipient.click();
    expect(await picker.$('.select2-selection__choice').getText()).to.include(dashboard.contact.name);

    await browser.waitUntil(() => browser.execute(() => !!navigator.serviceWorker.controller));
    await goOffline();
    await submit(`${sendModal} form.data-message-composer`, first);
    await waitForDelivery(0, 'Waiting to sync');
    const queuedId = await (await messageRows())[0].getAttribute('data-id');

    await commonPage.refresh();
    await waitForDelivery(0, 'Waiting to sync');
    expect(await (await messageRows())[0].getAttribute('data-id')).to.equal(queuedId);
    expect((await scopedHistory(dashboard)).messages).to.deep.equal([]);

    await browser.throttleNetwork('online');
    await waitForDelivery(0, 'Sent to server');
    expect((await scopedHistory(dashboard)).messages.map(message => message._id)).to.deep.equal([queuedId]);
    await commonPage.logout();
    await enterMessages(dashboard);
    await messagesPage.openMessage(threadId(worker));
    const received = await messageRows();
    expect(received).to.have.lengthOf(1);
    const [incoming] = received;
    expect(await incoming.$('.data-message-text').getText()).to.equal(first);
    expect(await incoming.$('.data-message-text b').isExisting()).to.equal(false);
    await submit(replyComposer, reply);
    await waitForDelivery(1, 'Sent to server');
    await expectBubbleSides(['left', 'right']);

    const outsiderView = await scopedHistory(unrelated);
    expect(outsiderView.messages).to.deep.equal([]);
    expect(outsiderView.directory).to.deep.equal([]);

    await commonPage.logout();
    await enterMessages(worker);
    await messagesPage.openMessage(threadId(dashboard));
    await browser.waitUntil(async () => (await messageRows()).length === 2);
    await expectBubbleSides(['right', 'left']);
    await goOffline();
    await submit(replyComposer, pending);
    await waitForDelivery(2, 'Waiting to sync');

    await setPilot({ enabled: false, pilot_root_place_ids: [root._id] });
    await browser.waitUntil(async () => (await scopedHistory(worker)).directory?.length === 0);
    await browser.throttleNetwork('online');
    await waitForDelivery(2, 'This recipient can no longer receive your data message.');
    const rows = await messageRows();
    const texts = await Promise.all(Array.from(rows, row => row.$('.data-message-text').getText()));
    expect(texts).to.deep.equal([first, reply, pending]);
    await expectCopiedText(rows[2], pending);
    for (const participant of [worker, dashboard]) {
      expect((await scopedHistory(participant)).messages.map(message => message.text)).to.have.members([first, reply]);
    }
  });
});

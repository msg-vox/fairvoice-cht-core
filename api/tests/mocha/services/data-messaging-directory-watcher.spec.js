const assert = require('node:assert/strict');
const sinon = require('sinon');
const logger = require('@medic/logger');
const dbWatcher = require('../../../src/services/db-watcher');
const configWatcher = require('../../../src/services/config-watcher');
const dataMessaging = require('../../../src/services/data-messaging');
const watcher = require('../../../src/services/data-messaging-directory-watcher');

describe('Data messaging directory watcher', () => {
  let clock;
  let rebuild;
  let config;
  let medicChange;
  let userChange;
  let settingsChange;
  let translationsChange;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    sinon.stub(dbWatcher, 'medic').callsFake(callback => medicChange = callback);
    sinon.stub(dbWatcher, 'users').callsFake(callback => userChange = callback);
    sinon.stub(configWatcher, 'watch').callsFake(callback => settingsChange = callback);
    sinon.stub(configWatcher, 'watchTranslations').callsFake(callback => translationsChange = callback);
    rebuild = sinon.stub(dataMessaging, 'rebuildDirectories').callsFake(watch => {
      watch('place');
      return Promise.resolve();
    });
    config = sinon.stub(dataMessaging, 'getConfig').returns({ enabled: true });
    watcher.start();
  });

  afterEach(() => sinon.restore());

  it('builds initially and coalesces changes to accounts, tracked places and settings', async () => {
    await clock.tickAsync(0);
    assert.equal(rebuild.callCount, 1);
    medicChange({ id: 'unrelated-report' });
    await clock.tickAsync(250);
    assert.equal(rebuild.callCount, 1);

    userChange({ id: 'org.couchdb.user:sender' });
    medicChange({ id: 'org.couchdb.user:recipient' });
    medicChange({ id: 'place', deleted: true });
    translationsChange();
    await clock.tickAsync(250);
    assert.equal(rebuild.callCount, 2);

    config.returns({ enabled: false });
    settingsChange();
    await clock.tickAsync(250);
    assert.equal(rebuild.callCount, 3);
    userChange({ id: 'org.couchdb.user:sender' });
    translationsChange();
    await clock.tickAsync(250);
    assert.equal(rebuild.callCount, 3);
  });

  it('reruns after a dependency changes during a build and retries failures', async () => {
    sinon.stub(logger, 'error');
    rebuild.onFirstCall().callsFake(watch => {
      watch('place');
      medicChange({ id: 'place' });
      return Promise.resolve();
    });
    rebuild.onSecondCall().rejects(new Error('storage failure'));
    await clock.tickAsync(0);
    assert.equal(rebuild.callCount, 1);
    await clock.tickAsync(250);
    assert.equal(rebuild.callCount, 2);
    await clock.tickAsync(5000);
    assert.equal(rebuild.callCount, 3);
  });
});

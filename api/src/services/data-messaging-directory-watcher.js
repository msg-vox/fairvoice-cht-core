const logger = require('@medic/logger');
const { PREFIXES } = require('@medic/constants');
const configWatcher = require('./config-watcher');
const dbWatcher = require('./db-watcher');
const dataMessaging = require('./data-messaging');

const REBUILD_DELAY = 250;
const RETRY_DELAY = 5000;

const start = () => {
  let watchedPlaces = new Set();
  let timer;
  let running = false;
  let dirty = false;

  const schedule = (delay = REBUILD_DELAY) => {
    dirty = true;
    if (!running && !timer) {
      timer = setTimeout(rebuild, delay);
    }
  };

  const rebuild = async () => {
    timer = undefined;
    running = true;
    dirty = false;
    const places = new Set();
    let delay = REBUILD_DELAY;
    try {
      await dataMessaging.rebuildDirectories(id => {
        // Track each dependency before reading it so changes during a build trigger another pass.
        watchedPlaces.add(id);
        places.add(id);
      });
      watchedPlaces = places;
    } catch (err) {
      logger.error('Failed to rebuild data messaging directories: %o', err);
      dirty = true;
      delay = RETRY_DELAY;
    } finally {
      running = false;
      if (dirty) {
        schedule(delay);
      }
    }
  };

  const onAccountChange = ({ id }) => {
    if (id.startsWith(PREFIXES.COUCH_USER) && dataMessaging.getConfig().enabled) {
      schedule();
    }
  };
  dbWatcher.users(onAccountChange);
  dbWatcher.medic(change => {
    if (watchedPlaces.has(change.id)) {
      schedule();
    } else {
      onAccountChange(change);
    }
  });
  configWatcher.watch(() => schedule());
  configWatcher.watchTranslations(() => {
    if (dataMessaging.getConfig().enabled) {
      schedule();
    }
  });
  schedule(0);
};

module.exports = { start };

const auth = require('../auth');
const config = require('../config');
const db = require('../db');
const dataContext = require('./data-context');
const { users } = require('@medic/user-management')(config, db, dataContext);

const getIds = ids => {
  if (!Array.isArray(ids) || !ids.every(id => typeof id === 'string' && id.trim())) {
    return [];
  }
  return [...new Set(ids)];
};

module.exports = {
  getConfig: () => {
    const settings = config.get('data_messaging');
    const roleIds = {
      cr: getIds(settings?.role_ids?.cr),
      supervisor: getIds(settings?.role_ids?.supervisor),
      officer: getIds(settings?.role_ids?.officer),
    };
    const pilotRootPlaceIds = getIds(settings?.pilot_root_place_ids);
    return {
      enabled: settings?.enabled === true &&
        roleIds.cr.length > 0 &&
        (roleIds.supervisor.length > 0 || roleIds.officer.length > 0) &&
        pilotRootPlaceIds.length > 0,
      roleIds,
      pilotRootPlaceIds,
    };
  },

  // The lineage must come from the current server hierarchy, in order from
  // the assigned place itself through its ancestors.
  isPilotPlace: (settings, lineageIds) => settings.enabled &&
    lineageIds.some(id => settings.pilotRootPlaceIds.includes(id)),

  getAccount: async req => {
    const { name } = await auth.getUserCtx(req);
    return users.getMessagingAccount(name);
  },
};

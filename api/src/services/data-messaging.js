const auth = require('../auth');
const config = require('../config');
const db = require('../db');
const dataContext = require('./data-context');
const { Place, Qualifier } = require('@medic/cht-datasource');
const { PREFIXES } = require('@medic/constants');
const { getContactType, isParentOf } = require('@medic/contact-types-utils');
const { users } = require('@medic/user-management')(config, db, dataContext);

const getConfig = () => {
  const settings = config.get('data_messaging');
  const roots = settings?.pilot_root_place_ids;
  const pilotRootPlaceIds = Array.isArray(roots) && roots.every(id => typeof id === 'string' && id.trim())
    ? [...new Set(roots)] : [];
  return {
    enabled: settings?.enabled === true && pilotRootPlaceIds.length > 0,
    pilotRootPlaceIds,
  };
};

const getUsername = id => {
  if (typeof id === 'string' && id.startsWith(PREFIXES.COUCH_USER)) {
    return id.slice(PREFIXES.COUCH_USER.length);
  }
};

const getPilotLineage = async (placeId, pilotRoots, getPlace, settings) => {
  const visited = new Set();
  let pilotEnd = 0;
  let childType;
  while (typeof placeId === 'string' && placeId && !visited.has(placeId)) {
    const place = await getPlace(placeId);
    const type = getContactType(settings, place);
    if (!type || (childType && !isParentOf(type, childType))) {
      return [];
    }
    visited.add(placeId);
    if (pilotRoots.has(placeId)) {
      pilotEnd = visited.size;
    }
    if (!place.parent) {
      return [...visited].slice(0, pilotEnd);
    }
    childType = type;
    // Follow each current parent document. Embedded ancestry can be stale.
    placeId = place.parent._id;
  }
  return [];
};

const hasAssignedAncestor = async (descendant, ancestor, getLineage) => {
  const assignments = new Set(ancestor.facilityIds);
  for (const placeId of new Set(descendant.facilityIds)) {
    const [, ...ancestorIds] = await getLineage(placeId);
    if (ancestorIds.some(id => assignments.has(id))) {
      return true;
    }
  }
  return false;
};

const createRecipientPolicy = () => {
  const { enabled, pilotRootPlaceIds } = getConfig();
  const pilotRoots = new Set(pilotRootPlaceIds);
  const settings = config.getAll();
  const readPlace = dataContext.bind(Place.v1.get);
  const places = new Map();
  const accounts = new Map();

  const getPlace = id => {
    if (!places.has(id)) {
      places.set(id, readPlace(Qualifier.byUuid(id)));
    }
    return places.get(id);
  };

  const getAccount = name => {
    if (!accounts.has(name)) {
      accounts.set(name, users.getMessagingAccount(name));
    }
    return accounts.get(name);
  };

  const getLineage = id => getPilotLineage(id, pilotRoots, getPlace, settings);

  return async (senderId, recipientId) => {
    const senderName = getUsername(senderId);
    const recipientName = getUsername(recipientId);
    if (!enabled || !senderName || !recipientName || senderId === recipientId) {
      return false;
    }

    const [sender, recipient] = await Promise.all([
      getAccount(senderName),
      getAccount(recipientName),
    ]);
    if (!sender?.facilityIds.length || !recipient?.facilityIds.length) {
      return false;
    }

    return await hasAssignedAncestor(sender, recipient, getLineage) ||
      hasAssignedAncestor(recipient, sender, getLineage);
  };
};

module.exports = {
  getConfig,

  getAccount: async req => {
    const { name } = await auth.getUserCtx(req);
    return users.getMessagingAccount(name);
  },

  canMessage: (senderId, recipientId) => createRecipientPolicy()(senderId, recipientId),

  getEligibleRecipientIds: async (senderId, candidateIds) => {
    const canMessage = createRecipientPolicy();
    const recipients = [];
    for (const candidateId of new Set(candidateIds)) {
      if (await canMessage(senderId, candidateId)) {
        recipients.push(candidateId);
      }
    }
    return recipients;
  },
};

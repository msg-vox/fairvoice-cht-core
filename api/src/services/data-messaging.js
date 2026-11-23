const { isDeepStrictEqual } = require('node:util');
const auth = require('../auth');
const config = require('../config');
const db = require('../db');
const { BadRequestError, ConflictError, PermissionError } = require('../errors');
const dataContext = require('./data-context');
const { Place, Qualifier } = require('@medic/cht-datasource');
const { DATA_MESSAGE_RECIPIENT_INELIGIBLE, DATA_MESSAGE_TEXT_LIMIT, DOC_TYPES, PREFIXES } = require('@medic/constants');
const { getContactType, isParentOf } = require('@medic/contact-types-utils');
const { validate: isUuid } = require('uuid');
const { users } = require('@medic/user-management')(config, db, dataContext);

const DIRECTORY_TYPE = 'data_message_directory';
const DIRECTORY_PREFIX = 'data-message-directory:';
const SYNC_PAGE_SIZE = 100;
const MESSAGE_FIELDS = ['_id', 'type', 'sender_id', 'recipient_id', 'text', 'created_at'];

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

const getStrictAncestors = async (id, getLineage) => (await getLineage(id)).slice(1);

const hasAssignedAncestor = async (descendant, ancestor, getLineage) => {
  const assignments = new Set(ancestor.facilityIds);
  for (const placeId of new Set(descendant.facilityIds)) {
    const ancestorIds = await getStrictAncestors(placeId, getLineage);
    if (ancestorIds.some(id => assignments.has(id))) {
      return true;
    }
  }
  return false;
};

const createPilotPlaces = (pilotRootPlaceIds, settings, watchPlace = () => {}) => {
  const pilotRoots = new Set(pilotRootPlaceIds);
  const readPlace = dataContext.bind(Place.v1.get);
  const places = new Map();
  const lineages = new Map();

  const getPlace = id => {
    if (!places.has(id)) {
      watchPlace(id);
      places.set(id, readPlace(Qualifier.byUuid(id)));
    }
    return places.get(id);
  };

  const getLineage = id => {
    if (!lineages.has(id)) {
      lineages.set(id, getPilotLineage(id, pilotRoots, getPlace, settings));
    }
    return lineages.get(id);
  };
  return { getPlace, getLineage };
};

const createRecipientPolicy = () => {
  const { enabled, pilotRootPlaceIds } = getConfig();
  const { getLineage } = createPilotPlaces(pilotRootPlaceIds, config.getAll());
  const accounts = new Map();
  const getAccount = name => {
    if (!accounts.has(name)) {
      accounts.set(name, users.getMessagingAccount(name));
    }
    return accounts.get(name);
  };

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

const getDirectoryEntries = async (pilotRoots, settings, watchPlace) => {
  const configuredTypes = settings.data_messaging?.directory_parent_place_types;
  const parentPlaceTypes = new Set(Array.isArray(configuredTypes) ? configuredTypes : []);
  const accounts = await users.listMessagingAccounts();
  const { getPlace, getLineage } = createPilotPlaces(pilotRoots, settings, watchPlace);
  const entries = new Map();
  const recipients = new Map();
  const accountsByPlace = new Map();
  for (const account of accounts) {
    const placeLabels = new Set();
    for (const id of new Set(account.facilityIds)) {
      const lineage = await getLineage(id);
      if (!lineage.length) {
        continue;
      }
      if (!accountsByPlace.has(id)) {
        accountsByPlace.set(id, []);
      }
      accountsByPlace.get(id).push(account.id);
      const place = await getPlace(id);
      const useParent = parentPlaceTypes.has(getContactType(settings, place).id);
      const displayPlace = useParent ? (lineage[1] && await getPlace(lineage[1])) : place;
      const name = displayPlace?.name;
      if (typeof name === 'string' && name) {
        placeLabels.add(name);
      }
    }
    const roleLabels = account.roles
      .map(role => settings.roles?.[role]?.name)
      .filter(Boolean)
      .map(key => ({ key, fallback: config.translate(key, settings.locale || 'en') }));
    const names = [...placeLabels];
    if (parentPlaceTypes.size) {
      names.sort((a, b) => a.localeCompare(b));
    }
    const placeLabel = names.join(', ');
    entries.set(account.id, {
      account_id: account.id,
      display_name: account.displayName,
      role_label: [...new Set(roleLabels.map(({ fallback }) => fallback))].join(', '),
      role_labels: roleLabels,
      place_label: placeLabel,
      ...(parentPlaceTypes.size && placeLabel && { place_group: placeLabel }),
    });
    recipients.set(account.id, new Set());
  }

  // Join each assigned place with the accounts assigned to its strict pilot ancestors.
  for (const [placeId, descendants] of accountsByPlace) {
    for (const ancestor of await getStrictAncestors(placeId, getLineage)) {
      for (const parentId of accountsByPlace.get(ancestor) || []) {
        for (const childId of descendants) {
          if (parentId !== childId) {
            recipients.get(parentId).add(childId);
            recipients.get(childId).add(parentId);
          }
        }
      }
    }
  }

  return new Map([...recipients].map(([id, ids]) => [
    id, [...ids].sort().map(id => entries.get(id)),
  ]));
};

const rebuildDirectories = async watchPlace => {
  const { rows } = await db.dataMessaging.allDocs({
    include_docs: true,
    startkey: DIRECTORY_PREFIX,
    endkey: DIRECTORY_PREFIX + '\ufff0',
  });
  const existing = new Map(rows.map(({ id, doc }) => [id.slice(DIRECTORY_PREFIX.length), doc]));
  const { enabled, pilotRootPlaceIds } = getConfig();
  const directories = enabled
    ? await getDirectoryEntries(pilotRootPlaceIds, config.getAll(), watchPlace)
    : new Map();

  for (const accountId of existing.keys()) {
    if (!directories.has(accountId)) {
      directories.set(accountId, []);
    }
  }
  for (const [owner_id, entries] of directories) {
    const previous = existing.get(owner_id);
    if (previous?.type === DIRECTORY_TYPE && previous.owner_id === owner_id &&
        isDeepStrictEqual(previous.entries, entries)) {
      continue;
    }
    await db.dataMessaging.put({
      _id: DIRECTORY_PREFIX + owner_id,
      ...(previous && { _rev: previous._rev }),
      type: DIRECTORY_TYPE,
      owner_id,
      entries,
    });
  }
};

const validateMessage = message => {
  const id = message?._id;
  if (!message || Object.keys(message).length !== MESSAGE_FIELDS.length ||
      !MESSAGE_FIELDS.every(field => Object.hasOwn(message, field)) ||
      typeof id !== 'string' || !id.startsWith(PREFIXES.DATA_MESSAGE) ||
      id !== id.toLowerCase() || !isUuid(id.slice(PREFIXES.DATA_MESSAGE.length)) ||
      message.type !== DOC_TYPES.DATA_MESSAGE ||
      !getUsername(message.sender_id)?.trim() || !getUsername(message.recipient_id)?.trim() ||
      !Number.isFinite(message.created_at) ||
      typeof message.text !== 'string' || message.text.length > DATA_MESSAGE_TEXT_LIMIT * 2 || !message.text.trim() ||
      Array.from(message.text).length > DATA_MESSAGE_TEXT_LIMIT) {
    throw new BadRequestError('Invalid data message');
  }
};

const getMessagingDoc = async id => {
  try {
    return await db.dataMessaging.get(id);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
};

const acknowledgeRetry = (stored, message) => {
  if (!stored || !MESSAGE_FIELDS.every(field => stored[field] === message[field])) {
    throw new ConflictError('Data message ID already in use');
  }
  return false;
};

const canMessage = (senderId, recipientId) => createRecipientPolicy()(senderId, recipientId);

const send = async (accountId, message) => {
  validateMessage(message);
  if (message.sender_id !== accountId) {
    throw new PermissionError('Data message sender must match the authenticated account');
  }

  const stored = await getMessagingDoc(message._id);
  if (stored) {
    return acknowledgeRetry(stored, message);
  }
  if (!await canMessage(accountId, message.recipient_id)) {
    throw Object.assign(new PermissionError('Data message recipient is not currently eligible'), {
      details: DATA_MESSAGE_RECIPIENT_INELIGIBLE,
    });
  }

  try {
    await db.dataMessaging.put(message);
    return true;
  } catch (err) {
    if (err.status !== 409) {
      throw err;
    }
    return acknowledgeRetry(await getMessagingDoc(message._id), message);
  }
};

const getDirectory = async accountId => {
  const id = DIRECTORY_PREFIX + accountId;
  const doc = await getMessagingDoc(id);
  if (doc?.type !== DIRECTORY_TYPE || doc.owner_id !== accountId || !Array.isArray(doc.entries)) {
    return null;
  }
  return doc.entries.map(({ account_id, display_name, role_label, role_labels, place_label, place_group }) => ({
    account_id, display_name, role_label, place_label,
    ...(Array.isArray(role_labels) && { role_labels }),
    ...(typeof place_group === 'string' && { place_group }),
  }));
};

const getSyncPage = async (accountId, since) => {
  const selector = {
    type: DOC_TYPES.DATA_MESSAGE,
    $or: [{ sender_id: accountId }, { recipient_id: accountId }],
  };
  const [changes, directory] = await Promise.all([
    db.dataMessaging.changes({
      since,
      limit: SYNC_PAGE_SIZE,
      include_docs: true,
      selector,
    }),
    getDirectory(accountId),
  ]);
  const messages = changes.results
    .map(change => change.doc)
    .filter(doc => doc?.type === DOC_TYPES.DATA_MESSAGE && !doc._deleted && doc._id.startsWith(PREFIXES.DATA_MESSAGE) &&
      (doc.sender_id === accountId || doc.recipient_id === accountId))
    .map(({ _id, sender_id, recipient_id, text, created_at }) => ({
      _id, sender_id, recipient_id, text, created_at,
    }));

  return {
    account_id: accountId,
    messages,
    directory,
    next_since: String(changes.last_seq),
    has_more: changes.results.length === SYNC_PAGE_SIZE,
  };
};

module.exports = {
  getConfig,
  getSenderDisplayName: accountId => users.getMessagingDisplayName(getUsername(accountId)),
  getSyncPage,
  rebuildDirectories,
  send,

  getAccount: async req => {
    const { name } = await auth.getUserCtx(req);
    return users.getMessagingAccount(name);
  },

  canMessage,

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

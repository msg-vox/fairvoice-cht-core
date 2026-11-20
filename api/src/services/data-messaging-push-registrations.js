const { createHash, randomBytes } = require('node:crypto');
const db = require('../db');
const queryView = require('./data-messaging-push-view');
const { BadRequestError, ConflictError, PermissionError } = require('../errors');

const REGISTRATION_TYPE = 'data_message_push_registration';
const REGISTRATION_PREFIX = 'data-message-push-registration:';
const MAX_WRITE_ATTEMPTS = 5;

const isInstallationKey = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const isToken = value => typeof value === 'string' && /^[!-~]{1,4096}$/.test(value);
const isBinding = value => typeof value === 'string' && /^[!-~]{1,128}$/.test(value);
const isPositiveInteger = value => Number.isSafeInteger(value) && value > 0;

const validate = (body, fields) => {
  if (!body || Object.keys(body).length !== Object.keys(fields).length ||
      !Object.entries(fields).every(([key, valid]) => Object.hasOwn(body, key) && valid(body[key]))) {
    throw new BadRequestError('Invalid push registration request');
  }
};

const getRegistration = async id => {
  try {
    return await db.vault.get(id);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }
};

const updateRegistration = async (installationKey, update) => {
  const id = REGISTRATION_PREFIX + createHash('sha256').update(installationKey).digest('hex');
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const previous = await getRegistration(id);
    const next = update(previous);
    if (next === previous) {
      return previous;
    }

    try {
      await db.vault.put({ ...next, _id: id, ...(previous && { _rev: previous._rev }), type: REGISTRATION_TYPE });
      return next;
    } catch (err) {
      if (err.status !== 409) {
        throw err;
      }
    }
  }
  throw new ConflictError('Push registration changed concurrently');
};

const requireBinding = (registration, accountId, binding) => {
  if (!registration || registration.account_id !== accountId || registration.recipient_binding !== binding) {
    throw new PermissionError('Push registration does not match this account and installation');
  }
};

const register = async (accountId, body) => {
  validate(body, { installation_key: isInstallationKey, generation: isPositiveInteger, fcm_token: isToken });
  const { installation_key, generation, fcm_token } = body;
  const registration = await updateRegistration(installation_key, previous => {
    if (previous && generation <= previous.generation) {
      if (generation === previous.generation && previous.account_id === accountId && previous.fcm_token) {
        return previous;
      }
      throw new ConflictError('Push registration generation is no longer current');
    }

    return {
      account_id: accountId,
      generation,
      fcm_token,
      recipient_binding: randomBytes(32).toString('hex'),
    };
  });
  return { recipient_binding: registration.recipient_binding };
};

const refresh = async (accountId, body) => {
  validate(body, {
    installation_key: isInstallationKey,
    recipient_binding: isBinding,
    previous_fcm_token: isToken,
    fcm_token: isToken,
  });
  const { installation_key, recipient_binding, previous_fcm_token, fcm_token } = body;
  const registration = await updateRegistration(installation_key, previous => {
    requireBinding(previous, accountId, recipient_binding);
    if (!previous.fcm_token) {
      throw new PermissionError('Push registration has been revoked');
    }
    if (previous.fcm_token === fcm_token) {
      return previous;
    }
    if (previous.fcm_token !== previous_fcm_token) {
      throw new ConflictError('Previous push registration token is no longer current');
    }
    return { ...previous, fcm_token };
  });
  return { recipient_binding: registration.recipient_binding };
};

const unregister = async (accountId, body) => {
  validate(body, { installation_key: isInstallationKey, recipient_binding: isBinding });
  const { installation_key, recipient_binding } = body;
  await updateRegistration(installation_key, previous => {
    requireBinding(previous, accountId, recipient_binding);
    return previous.fcm_token ? { ...previous, fcm_token: null } : previous;
  });
};

const activeRegistrationsMap = `function (doc) {
  if (doc.type === "${REGISTRATION_TYPE}" && doc.fcm_token) {
    emit(doc.account_id, doc.recipient_binding);
  }
}`;

const listActiveForAccount = async accountId => {
  const { rows } = await queryView('data-message-push-registrations-v1', activeRegistrationsMap, { key: accountId });
  return rows.map(({ id, value }) => ({ _id: id, recipient_binding: value }));
};

const getCurrent = async job => {
  const registration = await getRegistration(job.installation_id);
  if (registration?.type === REGISTRATION_TYPE && registration.account_id === job.recipient_account_id &&
      registration.recipient_binding === job.recipient_binding && registration.fcm_token) {
    return registration;
  }
};

const retireToken = async registration => {
  // The revision check protects refreshes and account switches while FCM is responding.
  await db.vault.put({ ...registration, fcm_token: null });
};

module.exports = { register, refresh, unregister, listActiveForAccount, getCurrent, retireToken };

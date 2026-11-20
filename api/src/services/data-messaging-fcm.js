const { GoogleAuth } = require('google-auth-library');

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const FCM_ERROR_TYPE = 'type.googleapis.com/google.firebase.fcm.v1.FcmError';
const BAD_REQUEST_TYPE = 'type.googleapis.com/google.rpc.BadRequest';
const REQUEST_TIMEOUT = 10000;

const retryAfterMs = value => {
  if (!value) {
    return 0;
  }
  return /^\d+$/.test(value) ? Number(value) * 1000 : Math.max(0, Date.parse(value) - Date.now()) || 0;
};

const getAccessToken = async (auth, signal) => {
  signal.throwIfAborted();
  let abort;
  const deadline = new Promise((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  try {
    return await Promise.race([auth.getAccessToken(), deadline]);
  } finally {
    signal.removeEventListener('abort', abort);
  }
};

const createSender = projectId => {
  const auth = new GoogleAuth({ scopes: [SCOPE] });
  const url = `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/messages:send`;

  return async (prepareMessage, expiresAt, leaseUntil) => {
    const signal = AbortSignal.timeout(REQUEST_TIMEOUT);
    const accessToken = await getAccessToken(auth, signal);
    if (!accessToken) {
      throw new Error('Firebase access token unavailable');
    }
    signal.throwIfAborted();
    const message = await prepareMessage();
    if (!message) {
      return { status: 'discarded' };
    }
    if (Date.now() + REQUEST_TIMEOUT >= leaseUntil) {
      return { status: 'retry' };
    }
    const ttl = Math.floor((expiresAt - Date.now()) / 1000);
    if (ttl < 1) {
      return { status: 'discarded' };
    }
    const response = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({ message: { ...message, android: { priority: 'high', ttl: `${ttl}s` } } }),
      redirect: 'error',
      signal,
    });
    if (response.ok) {
      await response.body?.cancel();
      return { status: 'sent' };
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      return {
        status: 'retry',
        minimumDelay: Math.max(response.status === 429 ? 60000 : 0, retryAfterMs(response.headers.get('retry-after'))),
      };
    }

    const { error } = await response.json().catch(() => ({})) || {};
    const details = Array.isArray(error?.details) ? error.details : [];
    const invalidToken = details.some(detail => {
      if (detail['@type'] === FCM_ERROR_TYPE) {
        return detail.errorCode === 'UNREGISTERED' ||
          (detail.errorCode === 'INVALID_ARGUMENT' && error.message ===
            'The registration token is not a valid FCM registration token');
      }
      return detail['@type'] === BAD_REQUEST_TYPE &&
        detail.fieldViolations?.some(({ field }) => field === 'message.token');
    });
    return { status: invalidToken ? 'invalid_token' : 'failed' };
  };
};

module.exports = { createSender };

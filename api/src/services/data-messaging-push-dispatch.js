const logger = require('@medic/logger');
const db = require('../db');
const messaging = require('./data-messaging');
const registrations = require('./data-messaging-push-registrations');
const fcm = require('./data-messaging-fcm');
const { JOB_TYPE } = require('./data-messaging-push-queue');
const queryView = require('./data-messaging-push-view');
const logPushDebug = require('./data-messaging-push-debug');

const LIFETIME = 5 * 60 * 1000;
const LEASE_TIME = 60000;
const POLL_DELAY = 5000;
const PAGE_SIZE = 100;

const update = async (job, fields) => {
  const next = { ...job, ...fields };
  const { rev } = await db.vault.put(next);
  return { ...next, _rev: rev };
};

const dispatchJob = async (job, send) => {
  const now = Date.now();
  if (job.status || job.next_attempt_at > now) {
    return;
  }
  const expiresAt = job.queued_at + LIFETIME;
  if (!Number.isFinite(expiresAt) || expiresAt <= now) {
    logPushDebug('Dispatch discarded an expired job');
    await update(job, { status: 'discarded' });
    return;
  }

  // A revision-checked lease lets another API instance recover a job after a crash.
  const leaseUntil = now + LEASE_TIME;
  job = await update(job, { next_attempt_at: leaseUntil });
  const eligible = await messaging.canMessage(job.sender_account_id, job.recipient_account_id);
  if (!eligible) {
    logPushDebug('Dispatch discarded a job because the sender is no longer eligible');
    await update(job, { status: 'discarded' });
    return;
  }

  const senderName = await messaging.getSenderDisplayName(job.sender_account_id);
  if (Date.now() >= Math.min(expiresAt, leaseUntil)) {
    logPushDebug('Dispatch stopped after the lease or job lifetime elapsed');
    return;
  }

  let registration;
  const prepareMessage = async () => {
    // Resolve the binding and token after acquiring the OAuth credential.
    registration = await registrations.getCurrent(job);
    if (!registration || !messaging.getConfig().enabled) {
      logPushDebug(registration ?
        'Dispatch discarded a job because messaging is disabled' :
        'Dispatch discarded a job because its registration is unavailable');
      return;
    }
    return {
      token: registration.fcm_token,
      data: {
        version: '1',
        event: 'data_message',
        message_id: job.message_id,
        sender_account_id: job.sender_account_id,
        sender_display_name: senderName,
        recipient_binding: registration.recipient_binding,
      },
    };
  };
  let result;
  try {
    result = await send(prepareMessage, expiresAt, leaseUntil);
  } catch {
    // Transport and credential errors may include the request and its secrets.
    result = { status: 'retry' };
  }
  logPushDebug('Dispatch finished with status %s', result.status);
  if (result.status === 'invalid_token') {
    await registrations.retireToken(registration);
    await update(job, { status: 'discarded' });
    return;
  }
  if (result.status === 'retry') {
    const attempts = (job.attempts || 0) + 1;
    const backoff = Math.min(60000, 5000 * 2 ** (attempts - 1));
    const delay = Math.max(result.minimumDelay || 0, backoff + Math.floor(Math.random() * backoff / 4));
    logPushDebug('Dispatch scheduling retry attempt %s (delay %s ms before lifetime limit)', attempts, delay);
    await update(job, { attempts, next_attempt_at: Math.min(expiresAt, Date.now() + delay) });
    return;
  }
  if (result.status === 'failed') {
    logger.warn('Firebase rejected a data message push');
  }
  await update(job, { status: result.status });
};

const pendingJobsMap = `function (doc) {
  if (doc.type === "${JOB_TYPE}" && !doc.status) {
    emit([doc.next_attempt_at || 0, doc._id], null);
  }
}`;

const processPage = async (send, startkey) => {
  if (!messaging.getConfig().enabled) {
    return;
  }
  const { rows } = await queryView('data-message-push-pending-v1', pendingJobsMap, {
    startkey,
    endkey: [Date.now(), {}],
    include_docs: true,
    limit: PAGE_SIZE + 1,
  });
  for (const { doc } of rows.slice(0, PAGE_SIZE)) {
    if (doc?.type !== JOB_TYPE) {
      continue;
    }
    try {
      await dispatchJob(doc, send);
    } catch (err) {
      if (err.status !== 409) {
        logger.error('Data message push dispatch failed (status: %s)', err.status || 'unknown');
      }
    }
  }
  return rows[PAGE_SIZE]?.key;
};

const start = () => {
  if (process.env.DATA_MESSAGE_PUSH_SEND_ENABLED !== 'true') {
    logPushDebug('Dispatch inactive because sending is disabled');
    return;
  }
  const projectId = process.env.DATA_MESSAGE_PUSH_FIREBASE_PROJECT_ID?.trim();
  if (!projectId) {
    logger.error('Data message push dispatch requires a Firebase project ID');
    return;
  }

  logPushDebug('Dispatch active');
  if (process.env.DATA_MESSAGE_PUSH_DEBUG === 'true') {
    logPushDebug('Data messaging enabled at worker startup: %s', messaging.getConfig().enabled);
  }
  const send = fcm.createSender(projectId);
  const poll = async startkey => {
    let next;
    try {
      next = await processPage(send, startkey);
    } catch (err) {
      logger.error('Data message push scan failed (status: %s)', err.status || 'unknown');
    }
    setTimeout(poll, next ? 0 : POLL_DELAY, next);
  };
  void poll();
};

module.exports = { start, processPage };

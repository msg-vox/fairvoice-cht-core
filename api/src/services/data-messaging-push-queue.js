const logger = require('@medic/logger');
const { DOC_TYPES, PREFIXES } = require('@medic/constants');
const { validate: isUuid } = require('uuid');
const db = require('../db');
const registrations = require('./data-messaging-push-registrations');

const CHECKPOINT_ID = 'data-message-push-checkpoint';
const JOB_TYPE = 'data_message_push_job';
const JOB_PREFIX = 'data-message-push-job:';
const PAGE_SIZE = 100;
const POLL_DELAY = 5000;

const getCheckpoint = async activationSequence => {
  try {
    return await db.vault.get(CHECKPOINT_ID);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  const checkpoint = { _id: CHECKPOINT_ID, since: activationSequence };
  const { rev } = await db.vault.put(checkpoint);
  return { ...checkpoint, _rev: rev };
};

const enqueue = async (message, installation) => {
  try {
    await db.vault.put({
      _id: `${JOB_PREFIX}${message._id}:${installation._id}`,
      type: JOB_TYPE,
      queued_at: Date.now(),
      message_id: message._id,
      sender_account_id: message.sender_id,
      recipient_account_id: message.recipient_id,
      installation_id: installation._id,
      recipient_binding: installation.recipient_binding,
    });
  } catch (err) {
    // A replay or another API instance already queued this message for the installation.
    if (err.status !== 409) {
      throw err;
    }
  }
};

const isMessageCreate = doc => doc?.type === DOC_TYPES.DATA_MESSAGE &&
  !doc._deleted && doc._rev.startsWith('1-') && doc._id.startsWith(PREFIXES.DATA_MESSAGE) &&
  doc._id === doc._id.toLowerCase() && isUuid(doc._id.slice(PREFIXES.DATA_MESSAGE.length));

const processPage = async activationSequence => {
  const checkpoint = await getCheckpoint(activationSequence);
  const { results, last_seq } = await db.dataMessaging.changes({
    since: checkpoint.since,
    limit: PAGE_SIZE,
    include_docs: true,
    selector: { type: DOC_TYPES.DATA_MESSAGE },
  });
  for (const { doc } of results) {
    if (isMessageCreate(doc)) {
      const installations = await registrations.listActiveForAccount(doc.recipient_id);
      for (const installation of installations) {
        await enqueue(doc, installation);
      }
    }
  }
  if (last_seq !== checkpoint.since) {
    await db.vault.put({ ...checkpoint, since: last_seq });
  }
  return results.length === PAGE_SIZE;
};

const start = () => {
  const activationSequence = process.env.DATA_MESSAGE_PUSH_ACTIVATION_SEQUENCE?.trim();
  if (!activationSequence) {
    return;
  }
  if (activationSequence === 'now') {
    logger.error('Data message push queue requires a fixed activation sequence');
    return;
  }

  const poll = async () => {
    let delay = POLL_DELAY;
    try {
      if (await processPage(activationSequence)) {
        delay = 0;
      }
    } catch (err) {
      // Database errors can carry request details. Log only the status.
      if (err.status !== 409) {
        logger.error('Data message push queue failed (status: %s)', err.status || 'unknown');
      }
    }
    setTimeout(poll, delay);
  };
  void poll();
};

module.exports = { start, processPage, JOB_PREFIX, JOB_TYPE };

const { randomUUID } = require('node:crypto');

const USER_PREFIX = 'org.couchdb.user:';
const MESSAGE_TEXT_LIMIT = 4000;

const parseServer = (address) => {
  try {
    const url = new URL(address);
    if (['http:', 'https:'].includes(url.protocol) && url.pathname === '/' &&
        !url.username && !url.password && !url.search && !url.hash) {
      return url.origin;
    }
  } catch {
    // Report a fixed error without echoing the entered address.
  }
  throw new Error('Enter a CouchDB server origin such as http://localhost:5984 or https://couch.example.org.');
};

const connect = (origin, database, username, password) => {
  const authorization = 'Basic ' + Buffer.from(username + ':' + password).toString('base64');

  const request = async (dbName, path, options = {}) => {
    const response = await fetch(origin + '/' + encodeURIComponent(dbName) + '/' + path, {
      ...options,
      headers: { authorization, ...options.headers },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    }).catch(() => {
      throw new Error('Could not reach CouchDB. Check the server address and connection.');
    });

    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`CouchDB returned HTTP ${response.status} for ${dbName}.`);
    }
    return response.json().catch(() => {
      throw new Error('CouchDB returned an invalid JSON response.');
    });
  };

  const readUserDocs = async (dbName) => {
    const query = new URLSearchParams({
      include_docs: 'true',
      startkey: JSON.stringify(USER_PREFIX),
      endkey: JSON.stringify(USER_PREFIX + '\ufff0'),
    });
    const { rows } = await request(dbName, '_all_docs?' + query);
    if (!Array.isArray(rows)) {
      throw new Error('CouchDB returned an invalid account list.');
    }
    return rows.flatMap(({ doc }) => doc ? [doc] : []);
  };

  return {
    async listParticipants() {
      const [logins, settings] = await Promise.all([readUserDocs('_users'), readUserDocs(database)]);
      const settingsById = new Map(settings.map(doc => [doc._id, doc]));
      return logins.flatMap(login => {
        const user = settingsById.get(login._id);
        if (!user || user.inactive || !login._id.startsWith(USER_PREFIX) || !login.name?.trim()) {
          return [];
        }
        const fullname = typeof user.fullname === 'string' && user.fullname.trim();
        return [{
          id: login._id,
          username: login.name,
          displayName: fullname || login.name,
          roles: Array.isArray(login.roles) ? login.roles : [],
        }];
      }).sort((a, b) => a.displayName.localeCompare(b.displayName) || a.username.localeCompare(b.username));
    },

    async send(sender, recipient, text) {
      if (sender.id === recipient.id) {
        throw new Error('Choose two different participants.');
      }
      if (!text.trim() || Array.from(text).length > MESSAGE_TEXT_LIMIT) {
        throw new Error(`Enter a message between 1 and ${MESSAGE_TEXT_LIMIT} characters.`);
      }
      const message = {
        _id: 'data-message:' + randomUUID(),
        type: 'data_message',
        sender_id: sender.id,
        recipient_id: recipient.id,
        text,
        created_at: Date.now(),
      };
      try {
        const result = await request(database + '-data-messaging', encodeURIComponent(message._id), {
          method: 'PUT',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(message),
        });
        if (!result.ok || result.id !== message._id) {
          throw new Error('CouchDB did not confirm the message write.');
        }
        return message._id;
      } catch (error) {
        throw new Error(`${error.message} Check message ID ${message._id} before sending again.`);
      }
    },
  };
};

module.exports = { connect, MESSAGE_TEXT_LIMIT, parseServer };

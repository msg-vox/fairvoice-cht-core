const request = require('@medic/couch-request');
const environment = require('@medic/environment');
const { DB_ADMIN_ROLES } = require('@medic/constants');

module.exports = {
  name: 'create-data-messaging-db',
  created: new Date('2026-11-18'),
  run: async () => {
    const url = `${environment.couchUrl}-data-messaging`;
    try {
      await request.put({ url });
    } catch (err) {
      if (err.status !== 412) {
        throw err;
      }
    }

    await request.put({
      url: `${url}/_security`,
      body: {
        admins: { names: [], roles: DB_ADMIN_ROLES },
        members: { names: [], roles: DB_ADMIN_ROLES },
      },
    });
  },
};

const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { CONTACT_TYPES, PREFIXES } = require('@medic/constants');
const placeFactory = require('../tests/factories/cht/contacts/place');
const userFactory = require('../tests/factories/cht/users/users');

const couchUrl = new URL(process.env.COUCH_URL || 'http://medic:password@localhost:5984/medic');
const apiUrl = `http://localhost:${process.env.API_PORT || 5988}`;
const admin = {
  username: decodeURIComponent(couchUrl.username),
  password: decodeURIComponent(couchUrl.password),
};
const dbPath = couchUrl.pathname.replace(/\/$/, '');

const request = async (path, { method = 'GET', body, user = admin } = {}) => {
  const credentials = Buffer.from(`${user.username}:${user.password}`).toString('base64');
  const response = await fetch(apiUrl + path, {
    method,
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} failed (${response.status}): ${await response.text()}`);
  }
  return response.json();
};

const seed = async () => {
  const suffix = randomUUID().slice(0, 8);
  const password = `Desktop_${randomUUID()}`;
  const places = placeFactory.generateHierarchy([CONTACT_TYPES.DISTRICT_HOSPITAL, CONTACT_TYPES.HEALTH_CENTER]);
  const root = places.get(CONTACT_TYPES.DISTRICT_HOSPITAL);
  const site = places.get(CONTACT_TYPES.HEALTH_CENTER);
  root.name = `Messaging district ${suffix}`;
  site.name = `Messaging health center ${suffix}`;
  const outside = placeFactory.place().build({
    name: `Outside district ${suffix}`,
    type: CONTACT_TYPES.DISTRICT_HOSPITAL,
  });
  const makeUser = (label, place, role) => userFactory.build({
    username: `data-${label.toLowerCase()}-${suffix}`,
    password,
    place: place._id,
    roles: [role],
    contact: { name: label },
    password_change_required: false,
  });
  const worker = makeUser('Worker', site, 'chw');
  const dashboard = makeUser('Dashboard', root, 'program_officer');
  const unrelated = makeUser('Unrelated', outside, 'program_officer');

  const results = await request(`${dbPath}/_bulk_docs`, {
    method: 'POST', body: { docs: [...places.values(), outside] },
  });
  if (results.some(result => !result.ok)) {
    throw new Error(`Could not create pilot places: ${JSON.stringify(results)}`);
  }
  for (const user of [worker, dashboard, unrelated]) {
    await request('/api/v1/users', { method: 'POST', body: user });
  }
  await request('/api/v1/settings?replace=1', {
    method: 'PUT', body: { data_messaging: { enabled: true, pilot_root_place_ids: [root._id] } },
  });

  console.log(`CHT: ${apiUrl}\nPilot root: ${root._id}\nPassword for all three users: ${password}`);
  console.table({ Worker: worker.username, Dashboard: dashboard.username, Unrelated: unrelated.username });

  const deadline = Date.now() + 30000;
  const accountId = user => PREFIXES.COUCH_USER + user.username;
  while (Date.now() < deadline) {
    const [workerView, dashboardView, unrelatedView] = await Promise.all(
      [worker, dashboard, unrelated].map(user => request('/api/v1/data-messaging/sync', { user }))
    );
    if (workerView.directory?.length === 1 && workerView.directory[0].account_id === accountId(dashboard) &&
        dashboardView.directory?.length === 1 && dashboardView.directory[0].account_id === accountId(worker) &&
        unrelatedView.directory?.length === 0) {
      console.log('Recipient directories are ready.');
      return;
    }
    await delay(500);
  }
  throw new Error('Timed out waiting for the pilot recipient directories. Check the API logs.');
};

seed().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

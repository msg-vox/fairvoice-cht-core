const db = require('../db');

module.exports = async (name, map, options) => {
  const view = `${name}/${name}`;
  try {
    return await db.vault.query(view, options);
  } catch (err) {
    if (err.status !== 404) {
      throw err;
    }
  }

  try {
    await db.vault.put({ _id: `_design/${name}`, views: { [name]: { map } } });
  } catch (err) {
    // Another API instance may have installed the view.
    if (err.status !== 409) {
      throw err;
    }
  }
  return db.vault.query(view, options);
};

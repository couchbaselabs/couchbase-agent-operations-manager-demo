/**
 * In-memory stand-in for the Couchbase client, selected via
 * COUCHBASE_DRIVER=memory. Not used by `docker compose up` (which always
 * talks to the real Couchbase container) — this exists so the API can be
 * run and exercised with a plain `node src/server.js` / `npm start`
 * during development, without Docker at all, using the exact same
 * get/upsert/remove/selectByType interface `src/services/*` relies on.
 */

const store = new Map();

async function initCluster() {
  // no-op: nothing to bootstrap
}

async function upsert(key, doc) {
  store.set(key, JSON.parse(JSON.stringify(doc)));
}

async function upsertMany(entries) {
  for (const { key, doc } of entries) store.set(key, JSON.parse(JSON.stringify(doc)));
}

async function get(key) {
  const value = store.get(key);
  return value === undefined ? null : { value };
}

async function remove(key) {
  store.delete(key);
}

async function selectByType(type) {
  return [...store.values()].filter((v) => v.type === type);
}

async function query() {
  throw new Error("Raw N1QL query() is not available in memory-driver mode.");
}

module.exports = {
  BUCKET: process.env.COUCHBASE_BUCKET || "procurement",
  initCluster,
  upsert,
  upsertMany,
  get,
  remove,
  query,
  selectByType,
};

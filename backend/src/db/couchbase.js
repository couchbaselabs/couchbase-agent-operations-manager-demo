/**
 * Minimal Couchbase client built on the built-in `fetch` and the cluster's
 * public REST + N1QL HTTP interfaces. We deliberately avoid the official
 * Couchbase Node SDK (it ships native bindings that are painful to build
 * reliably in a small Alpine image) — everything this app needs (bucket
 * bootstrap, key/value upserts, N1QL queries) is reachable over plain HTTP.
 *
 * This module also doubles as the "context cache" described in the project
 * README: agent results and copilot context are stored as documents in the
 * `procurement` bucket so repeat lookups are served from Couchbase instead
 * of being recomputed against the (simulated) source ERPs / Snowflake.
 */

const MGMT_URL = process.env.COUCHBASE_MGMT_URL || "http://couchbase:8091";
const QUERY_URL = process.env.COUCHBASE_QUERY_URL || "http://couchbase:8093";
const USERNAME = process.env.COUCHBASE_USERNAME || "Administrator";
const PASSWORD = process.env.COUCHBASE_PASSWORD || "password123";
const BUCKET = process.env.COUCHBASE_BUCKET || "procurement";

function authHeader() {
  const token = Buffer.from(`${USERNAME}:${PASSWORD}`).toString("base64");
  return `Basic ${token}`;
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(fn, { attempts = 60, delayMs = 2000, label = "condition" } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const ok = await fn();
      if (ok) return true;
    } catch (err) {
      lastErr = err;
    }
    await sleep(delayMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastErr ? `: ${lastErr.message}` : ""}`);
}

async function mgmtRequest(path, { method, body, auth = true, form = true } = {}) {
  // Default to POST whenever a body is supplied and GET otherwise -- Node's
  // built-in fetch (undici) throws "Request with GET/HEAD method cannot
  // have body" if a body is sent with the default GET, which silently
  // broke every POST call here that forgot to pass `method: "POST"`
  // explicitly (this bit us for real: both /clusterInit and the bucket-
  // creation call below had exactly this bug until it was caught by
  // testing against a fake Couchbase server, since the in-memory driver
  // used for local dev never exercises this file at all).
  const resolvedMethod = method || (body ? "POST" : "GET");
  const headers = {};
  if (auth) headers["Authorization"] = authHeader();
  let payload = body;
  if (body && form) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    payload = new URLSearchParams(body).toString();
  }
  const res = await fetch(`${MGMT_URL}${path}`, { method: resolvedMethod, headers, body: payload });
  return res;
}

async function query(statement, params = {}) {
  const res = await fetch(`${QUERY_URL}/query/service`, {
    method: "POST",
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ statement, ...params }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status === "fatal" || json.status === "errors") {
    const msg = json.errors ? JSON.stringify(json.errors) : `HTTP ${res.status}`;
    throw new Error(`N1QL query failed: ${msg} :: ${statement.slice(0, 200)}`);
  }
  return json.results || [];
}

function encodeKey(key) {
  return encodeURIComponent(key);
}

/**
 * Upsert a single JSON document by key using N1QL (works without the SDK).
 *
 * These statements use *named* parameters ($key, $doc, $type below) rather
 * than positional ones ($1, $2, ...). Couchbase's Query REST API treats
 * those as two entirely different wire formats: positional values go in an
 * "args" array, but named values must be sent as top-level request fields
 * literally named "$key", "$doc", etc. — see
 * https://docs.couchbase.com/server/current/n1ql/n1ql-rest-api/index.html#query-parameters.
 * This file used to send `{ args: [key, doc] }` for a statement written
 * with $key/$doc, which is the *positional* wire format for a statement
 * that only declares named parameters -- so the query service could never
 * find a value for $key and failed every single upsert with "No value for
 * named parameter $key", surfaced for real for the first time once this
 * app was seeded against an actual Couchbase container (in-memory-driver
 * testing never touches this file). Fixed by sending the correctly
 * `$`-prefixed named parameters instead of an "args" array.
 */
async function upsert(key, doc) {
  await query(`UPSERT INTO \`${BUCKET}\` (KEY, VALUE) VALUES ($key, $doc)`, {
    $key: key,
    $doc: doc,
  });
}

async function upsertMany(entries) {
  for (const { key, doc } of entries) {
    // eslint-disable-next-line no-await-in-loop
    await upsert(key, doc);
  }
}

/** Returns { value: <document> } to match the in-memory driver's shape, or null if absent. */
async function get(key) {
  const rows = await query(`SELECT RAW \`${BUCKET}\` FROM \`${BUCKET}\` USE KEYS $key`, {
    $key: key,
  });
  return rows[0] !== undefined ? { value: rows[0] } : null;
}

async function remove(key) {
  await query(`DELETE FROM \`${BUCKET}\` USE KEYS $key`, { $key: key });
}

async function selectByType(type) {
  return query(`SELECT RAW t FROM \`${BUCKET}\` t WHERE t.type = $type`, { $type: type });
}

async function clusterIsInitialized() {
  const res = await mgmtRequest("/pools/default");
  if (res.status === 401) return true; // initialized but our creds not accepted yet
  if (res.status !== 200) return false;
  const json = await res.json();
  return Array.isArray(json.nodes) && json.nodes.length > 0;
}

async function bucketExists() {
  const res = await mgmtRequest(`/pools/default/buckets/${BUCKET}`);
  return res.status === 200;
}

async function initCluster() {
  console.log("[couchbase] waiting for node to accept connections...");
  await waitFor(
    async () => {
      const res = await fetch(`${MGMT_URL}/pools`).catch(() => null);
      return !!res && res.status < 500;
    },
    { label: "couchbase node" }
  );

  const already = await clusterIsInitialized().catch(() => false);
  if (!already) {
    console.log("[couchbase] performing first-time cluster setup via POST /clusterInit...");
    // /clusterInit is Couchbase's single-call cluster bootstrap endpoint: it
    // "combines all of the others" (assigning services, setting memory
    // quotas and indexer storage mode, naming the node, and establishing
    // admin credentials) into one atomic, unauthenticated call against a
    // freshly booted node — see
    // https://docs.couchbase.com/server/current/rest-api/rest-initialize-cluster.html.
    // This used to be four separate calls (setupServices, pools/default,
    // settings/indexes, settings/web) whose responses were never checked,
    // so a failure partway through silently left the node stuck on the
    // "Setup New Cluster" wizard with nothing in the logs to explain why.
    // The single documented endpoint, with its response actually checked
    // below, avoids that whole failure mode.
    const res = await mgmtRequest("/clusterInit", {
      auth: false,
      body: {
        hostname: "127.0.0.1",
        services: "kv,n1ql,index",
        memoryQuota: "512",
        indexMemoryQuota: "256",
        indexerStorageMode: "plasma",
        clusterName: "couchbase-procurement-command-center",
        sendStats: "false",
        username: USERNAME,
        password: PASSWORD,
        port: "SAME",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`POST /clusterInit failed: HTTP ${res.status} ${text}`);
    }
    console.log("[couchbase] /clusterInit succeeded.");
    await sleep(3000);
  }

  await waitFor(() => clusterIsInitialized(), { label: "cluster init" });

  const hasBucket = await bucketExists().catch(() => false);
  if (!hasBucket) {
    console.log(`[couchbase] creating bucket "${BUCKET}"...`);
    const res = await mgmtRequest("/pools/default/buckets", {
      body: {
        name: BUCKET,
        bucketType: "couchbase",
        ramQuotaMB: "256",
        flushEnabled: "1",
      },
    });
    if (!res.ok && res.status !== 202) {
      const text = await res.text();
      throw new Error(`Failed to create bucket: ${res.status} ${text}`);
    }
  }

  await waitFor(() => bucketExists(), { label: "bucket ready" });
  // Give the query service a moment to pick up the new bucket/keyspace.
  await sleep(4000);

  console.log("[couchbase] ensuring primary index exists...");
  await waitFor(
    async () => {
      try {
        await query(`CREATE PRIMARY INDEX IF NOT EXISTS ON \`${BUCKET}\``);
        return true;
      } catch (err) {
        console.log(`[couchbase] index not ready yet (${err.message}), retrying...`);
        return false;
      }
    },
    { label: "primary index", attempts: 30, delayMs: 3000 }
  );

  console.log("[couchbase] cluster ready.");
}

const restClient = {
  BUCKET,
  initCluster,
  upsert,
  upsertMany,
  get,
  remove,
  query,
  selectByType,
};

// COUCHBASE_DRIVER=memory swaps in an in-process store for Docker-free local
// development (see memoryStore.js). Default / production path always talks
// to the real Couchbase container over REST + N1QL, as documented above.
module.exports = process.env.COUCHBASE_DRIVER === "memory" ? require("./memoryStore") : restClient;

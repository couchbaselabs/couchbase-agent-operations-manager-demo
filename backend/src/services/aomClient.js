/**
 * Node client for the Couchbase Agent Operations Manager (AOM).
 *
 * AOM ships an official SDK (`operations-manager/sdk/aom_sdk`), but it's
 * Python-only, and this backend is Node — so this module is a hand-rolled
 * equivalent rather than an import of that package. It deliberately
 * mirrors the Python `AOMClient`'s method names and request/response
 * shapes 1:1 (`discover`, `invoke`, `discoverAndInvoke`, `complete`) so
 * anyone who has read that SDK's README recognizes this immediately, and
 * so a future move to a real shared client (e.g. a Python sidecar, or an
 * official Node SDK if AOM ever ships one) is a drop-in swap rather than a
 * rewrite.
 *
 * Every call this app makes to AOM goes through here now, not just LLM
 * completions: `copilot.js` also uses `discoverAndInvoke()` to run real,
 * RBAC-checked lookups against AOM's bundled Snowflake sample server
 * (see the "Compare suppliers" and "PO readiness" quick actions) — so this
 * app's traffic shows up as both an agent -> LLM provider edge *and* an
 * agent -> MCP server edge on AOM's own Dashboard "Live topology" diagram,
 * not just the former.
 *
 * Per-role identity: this app has its own RBAC (PCC roles `admin` / `buyer`
 * / `viewer` — see backend/src/middleware/auth.js) which is DIFFERENT from
 * AOM's RBAC (`admin` / `finance_analyst` / `support_agent`). Every call
 * into this module takes the *caller's PCC role* as an option and maps it
 * onto the matching AOM identity/API key below, rather than this app
 * holding one single AOM key for all its traffic regardless of who's
 * actually asking — that used to mean every buyer, viewer, and admin
 * request was indistinguishable to AOM's own audit log and RBAC checks.
 * `admin` maps straight across; `buyer` (the day-to-day role that runs
 * Compare Suppliers / PO Readiness against the data warehouse) maps to
 * AOM's `finance_analyst`, the least-privilege seeded role that can still
 * call the Snowflake tools those actions need; `viewer` (read-only) maps
 * to AOM's more limited `support_agent`. See PCC_ROLE_TO_AOM_ROLE below.
 *
 * Resilience posture unchanged from the LLM-only version this replaces:
 * if AOM isn't configured or isn't reachable, callers are expected to
 * catch and fall back to their own deterministic text/behavior — this app
 * must keep working with no AOM running at all (e.g. under
 * `COUCHBASE_DRIVER=memory` local dev).
 *
 * TLS note: AOM's `operations-manager` service serves HTTPS by default (a
 * self-signed cert it bakes into its own image on first boot — see the AOM
 * project's docker-compose.yml). Since AOM is always a locally-run
 * dev/demo appliance (there is no CA-signed-cert deployment documented for
 * it), this module trusts that self-signed cert specifically for this one
 * client via a scoped `https.Agent({ rejectUnauthorized: false })` — it
 * does NOT touch Node's global TLS validation (no
 * NODE_TLS_REJECT_UNAUTHORIZED), so every other outbound HTTPS call this
 * app makes stays fully validated.
 *
 * This deliberately uses Node's built-in `http`/`https` modules rather
 * than `fetch` + a custom dispatcher — see this module's git history
 * (formerly `llmGateway.js`) for why: an external `undici` Agent passed as
 * `fetch`'s dispatcher is a hard version-skew incompatibility with Node
 * 20's internal copy of undici. Plain `https.request()` with a real
 * `https.Agent` sidesteps the problem entirely.
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");

const AOM_URL = (process.env.COUCHBASE_AOM_URL || "https://host.docker.internal:8090").replace(/\/+$/, "");
const AOM_PROVIDER = process.env.COUCHBASE_AOM_PROVIDER || "google";
const AOM_MODEL = process.env.COUCHBASE_AOM_MODEL || "gemini-2.5-flash";
const AOM_TIMEOUT_MS = Number(process.env.COUCHBASE_AOM_TIMEOUT_MS || 8000);
const AOM_ALLOW_INSECURE_TLS = process.env.COUCHBASE_AOM_ALLOW_INSECURE_TLS !== "false";

// One AOM API key per AOM RBAC role, each defaulting to that role's seeded
// demo key (see the AOM project's config.py / .env.example) so this works
// out of the box against a freshly-started AOM appliance with no extra
// setup, same as the single-key default this replaces.
const AOM_API_KEYS = {
  admin: process.env.COUCHBASE_AOM_API_KEY_ADMIN || "demo-admin-4c56",
  finance_analyst: process.env.COUCHBASE_AOM_API_KEY_FINANCE_ANALYST || "demo-finance-analyst-7e83",
  support_agent: process.env.COUCHBASE_AOM_API_KEY_SUPPORT_AGENT || "demo-support-agent-9f21",
};

// PCC's own RBAC role (backend/src/middleware/auth.js: admin/buyer/viewer)
// -> the AOM identity that role's traffic authenticates as. `buyer` maps to
// `finance_analyst` (least-privilege role that can still call the
// Snowflake tools Compare Suppliers / PO Readiness use); `viewer` maps to
// the more limited `support_agent`. See the module docstring above.
const PCC_ROLE_TO_AOM_ROLE = {
  admin: "admin",
  buyer: "finance_analyst",
  viewer: "support_agent",
};

const DEFAULT_PCC_ROLE = "buyer";

let warnedUnknownRole = false;

/**
 * Resolve a PCC role (`req.user.role`, or a fixed role for background
 * traffic like the demo generator) to the AOM role whose API key that
 * call should authenticate with. An unrecognized or missing role falls
 * back to `viewer`'s mapping (`support_agent`, AOM's most limited seeded
 * role) rather than silently defaulting to admin.
 */
function resolveAomRole(pccRole) {
  if (pccRole && PCC_ROLE_TO_AOM_ROLE[pccRole]) return PCC_ROLE_TO_AOM_ROLE[pccRole];
  if (!warnedUnknownRole) {
    warnedUnknownRole = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[aomClient] Unrecognized or missing PCC role "${pccRole}" for an AOM call — falling back to the ` +
        `support_agent (viewer) identity rather than assuming a more privileged one.`
    );
  }
  return "support_agent";
}

let warnedInsecureTls = false;
let insecureAgent = null;

// Only relevant for https:// URLs; a plain http:// AOM_URL (e.g. someone
// running AOM with DISABLE_TLS=true) needs no special agent at all.
function getHttpsAgent() {
  if (!AOM_ALLOW_INSECURE_TLS) return undefined;
  if (!warnedInsecureTls) {
    warnedInsecureTls = true;
    // eslint-disable-next-line no-console
    console.warn(
      "[aomClient] Trusting the Couchbase Agent Operations Manager's self-signed HTTPS certificate " +
        `(${AOM_URL}) -- this is scoped to AOM calls only, not a global TLS setting. Set ` +
        "COUCHBASE_AOM_ALLOW_INSECURE_TLS=false if AOM is ever deployed behind a CA-signed cert."
    );
  }
  if (!insecureAgent) {
    insecureAgent = new https.Agent({ rejectUnauthorized: false });
  }
  return insecureAgent;
}

/**
 * Minimal promise-based JSON POST over plain `http`/`https` (no fetch, no
 * undici) — see the module docstring for why. Resolves with
 * `{ status, text }` for any response that actually completes; throws on
 * a transport-level error (DNS, connection refused, TLS rejection, or the
 * abort signal firing).
 */
function postJson(urlStr, { headers = {}, body, signal } = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(urlStr);
    } catch (err) {
      reject(err);
      return;
    }
    const isHttps = parsed.protocol === "https:";
    const lib = isHttps ? https : http;
    const payload = Buffer.from(body, "utf8");

    const req = lib.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (isHttps ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method: "POST",
        headers: { ...headers, "Content-Length": payload.length },
        agent: isHttps ? getHttpsAgent() : undefined,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString("utf8") }));
        res.on("error", reject);
      }
    );

    req.on("error", reject);

    if (signal) {
      if (signal.aborted) {
        req.destroy();
        return;
      }
      signal.addEventListener("abort", () => req.destroy(), { once: true });
    }

    req.write(payload);
    req.end();
  });
}

/**
 * @param {string} [pccRole] - PCC role (admin/buyer/viewer). Omit to check
 *   whether AOM is configured for *any* role at all (used only for a
 *   generic "is this feature available" status flag, e.g. the Demo page —
 *   see services/demo.js). Every call that's actually about to hit AOM
 *   should pass the specific role it will authenticate as instead.
 */
function isConfigured(pccRole) {
  if (pccRole !== undefined) return !!AOM_API_KEYS[resolveAomRole(pccRole)];
  return Object.values(AOM_API_KEYS).some(Boolean);
}

/**
 * POST an authenticated request to AOM and return its parsed JSON body.
 * Throws on any failure (not configured, network error, timeout, or a
 * non-2xx response) — this never silently returns fabricated data, same
 * posture as the rest of this module. `pccRole` selects which AOM
 * identity/API key the request authenticates as (see resolveAomRole).
 */
async function callAom(path, body, { timeoutMs = AOM_TIMEOUT_MS, role: pccRole } = {}) {
  const aomRole = resolveAomRole(pccRole);
  const apiKey = AOM_API_KEYS[aomRole];
  if (!apiKey) {
    throw new Error(
      `No AOM API key configured for the ${aomRole} role — cannot call the Couchbase Agent Operations Manager`
    );
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await postJson(`${AOM_URL}${path}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`AOM POST ${path} failed: HTTP ${res.status} ${res.text.slice(0, 300)}`);
    }
    return JSON.parse(res.text);
  } catch (err) {
    if (controller.signal.aborted) {
      throw new Error(`AOM POST ${path} timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask AOM's caching gateway to complete `prompt`.
 *
 * @param {string} prompt
 * @param {{ namespace?: string, bypassCache?: boolean, timeoutMs?: number, role?: string }} [opts]
 *   `namespace` is AOM's soft cache-partitioning lever — see the AOM
 *   README's "Cache invalidation" table. This app uses a distinct
 *   namespace per call site (decision narration vs. copilot chat) so the
 *   two kinds of prompts never collide in the shared cache and can be
 *   invalidated independently. `role` is the caller's PCC role
 *   (admin/buyer/viewer); it's mapped to the matching AOM identity/API key
 *   — see resolveAomRole. Defaults to DEFAULT_PCC_ROLE ("buyer") if
 *   omitted, matching this app's previous single-key behavior.
 */
async function complete(prompt, { namespace, bypassCache = false, timeoutMs, role = DEFAULT_PCC_ROLE } = {}) {
  const json = await callAom(
    "/v1/llm/complete",
    { prompt, provider: AOM_PROVIDER, model: AOM_MODEL, namespace, bypass_cache: bypassCache },
    { timeoutMs, role }
  );
  return {
    text: (json.response || "").trim(),
    provider: json.provider,
    model: json.model,
    cacheStatus: json.cache && json.cache.status,
    stub: !!json.stub,
  };
}

/**
 * POST /v1/tools/discover — RBAC + vector-search pre-filtered tool search
 * for the calling role's AOM identity. Mirrors the Python SDK's
 * `AOMClient.discover()`. Never returns a tool that identity can't also
 * invoke. `role` is the caller's PCC role — see resolveAomRole.
 */
async function discover(query, { topK = 5, timeoutMs, role = DEFAULT_PCC_ROLE } = {}) {
  return callAom("/v1/tools/discover", { query, top_k: topK }, { timeoutMs, role });
}

/**
 * POST /v1/tools/invoke — re-checks authorization independently of
 * discover, then proxies to the tool's real MCP server. Mirrors the
 * Python SDK's `AOMClient.invoke()`. The response includes
 * `hijack_warning` (non-null when the live payload was flagged by AOM's
 * MCP Tool Hijacking detector) — this app doesn't currently act on it,
 * but a caller that matters more than a demo cross-check should check it
 * rather than trusting `result` blindly. `role` is the caller's PCC role
 * — see resolveAomRole.
 */
async function invoke(toolId, args = {}, { timeoutMs, role = DEFAULT_PCC_ROLE } = {}) {
  return callAom("/v1/tools/invoke", { tool_id: toolId, arguments: args }, { timeoutMs, role });
}

/**
 * Convenience wrapper matching the Python SDK's
 * `AOMClient.discover_and_invoke()`: find the single best-matching tool
 * for `query` and invoke it immediately. Returns `null` (rather than
 * throwing) when nothing matched — every caller in this app treats a tool
 * lookup as an optional enrichment, never the only path to an answer.
 * `role` is the caller's PCC role — see resolveAomRole.
 */
async function discoverAndInvoke(query, args = {}, { timeoutMs, role = DEFAULT_PCC_ROLE } = {}) {
  const discovered = await discover(query, { topK: 1, timeoutMs, role });
  const tools = discovered.tools || [];
  if (!tools.length) return null;
  return invoke(tools[0].tool_id, args, { timeoutMs, role });
}

module.exports = {
  complete,
  discover,
  invoke,
  discoverAndInvoke,
  isConfigured,
  resolveAomRole,
  AOM_URL,
  AOM_PROVIDER,
  AOM_MODEL,
};

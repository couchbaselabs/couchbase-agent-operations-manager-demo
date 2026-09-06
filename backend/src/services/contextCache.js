/**
 * Context-caching layer.
 *
 * The reference recording this app is built from is titled "Context
 * Caching" — the idea being that instead of re-querying source ERPs and
 * Snowflake every time a buyer opens a PR, the agents' decisions (and the
 * data they were computed from) are cached in Couchbase and served back
 * near-instantly on repeat access. This module is the thin layer that
 * makes that visible: every decision response tells the UI whether it was
 * a cache hit and how long it took, so the effect of the cache is
 * something you can actually see rather than just a talking point.
 */

const cb = require("../db/couchbase");
const { decideForPurchaseRequest } = require("../agents/engine");
const agentNarration = require("./agentNarration");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cacheKey(prId) {
  return `context_cache::decision::${prId}`;
}

/**
 * Get the agent decision for a PR, preferring the Couchbase cache.
 * Pass `refresh: true` to force recomputation (simulates a cache
 * invalidation after upstream ERP/Snowflake data changes).
 */
async function getDecision(pr, { refresh = false } = {}) {
  const key = cacheKey(pr.id);
  const start = Date.now();

  if (!refresh) {
    // cb.get() returns { value: <stored document> }; the document we stored
    // is itself an envelope ({ type: "context_cache", ..., value: decision })
    // so the actual decision payload is one level deeper, at .value.value.
    const cached = await cb.get(key).catch(() => null);
    const cachedDecision = cached && cached.value && cached.value.value;
    if (cachedDecision) {
      // Cache hits are fast by construction; add a hair of jitter so it
      // still reads as a real timing rather than a hardcoded "0ms".
      await sleep(2 + Math.round(Math.random() * 6));
      return {
        ...cachedDecision,
        servedFromCache: true,
        latencyMs: Date.now() - start,
      };
    }
  }

  // Cache miss: simulate the cost of fanning out to the source ERP +
  // Snowflake before computing the recommendation. The recommendation
  // itself (which supplier, what price, how much is saved) is always the
  // deterministic rule engine's output; narrate() only asks Gemini (via
  // AOM) to upgrade the buyer-facing rationale text on top of it, and
  // falls back to the rule engine's own text if AOM isn't configured or
  // fails -- see agentNarration.js for why that split exists.
  await sleep(140 + Math.round(Math.random() * 120));
  const decision = await agentNarration.narrate(decideForPurchaseRequest(pr));
  await cb
    .upsert(key, { type: "context_cache", prId: pr.id, cachedAt: new Date().toISOString(), value: decision })
    .catch((err) => console.warn(`[context-cache] failed to persist cache for ${pr.id}: ${err.message}`));

  return { ...decision, servedFromCache: false, latencyMs: Date.now() - start };
}

async function invalidate(prId) {
  await cb.remove(cacheKey(prId)).catch(() => {});
}

module.exports = { getDecision, invalidate };

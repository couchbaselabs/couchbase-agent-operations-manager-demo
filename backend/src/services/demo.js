/**
 * "Demo" mode — Settings → Demo's Start/Stop button.
 *
 * Purpose: make the Couchbase Agent Operations Manager's (AOM) LLM
 * caching visibly earn its keep, the same way Follow-up 9 in this
 * project's build notes did by hand (asking the copilot the same
 * question twice and watching AOM's dashboard show an EXACT HIT). This
 * module automates that at volume: it simulates a population of
 * `VIRTUAL_USERS` buyers who each keep asking one of a fixed, small pool
 * of common questions (the same "My priority / Compare suppliers /
 * Explain oversupply / PO readiness" quick actions real buyers use,
 * across this app's 18 seeded PRs) — exactly the shape of traffic a large
 * user base produces in practice: lots of different people asking the
 * same small set of things about the same handful of high-priority PRs.
 *
 * It does this by calling `services/copilot.js`'s real `chat()` function
 * directly (no HTTP hop, no synthetic prompt-building of its own) — every
 * demo request is byte-for-byte the same code path a real buyer's click
 * would take, including the real call to AOM's `/v1/llm/complete` via
 * `aomClient.js`. That's deliberate: this is meant to *demonstrate* the
 * real integration under load, not simulate a fake one.
 *
 * Why the hit rate doesn't just climb to ~100%: a pool of finite,
 * repeated questions (see `POOL` below) will asymptotically approach a
 * hit rate near 100% the longer it runs, since almost every request ends
 * up a repeat. That's mechanically correct but doesn't read as a
 * realistic live system to someone watching a demo — a hit rate pinned
 * at 99.9% looks staged. So this module deliberately keeps the picture
 * moving: on top of the natural repeat traffic, it manufactures a
 * controlled number of guaranteed-fresh requests each tick (by varying
 * the question text slightly, which changes AOM's exact-match cache key)
 * to hold the **trailing-60-second hit rate** oscillating in a target
 * band — see `currentTargetPct()` and `ROLLING_WINDOW_MS` below, tuned to
 * roughly 82%-96%, drifting on a multi-minute cycle. This is a real,
 * closed-loop controller against AOM's own reported cache verdicts (not
 * a display trick): it compares the actual trailing hit rate to the
 * moving target every tick and adjusts how many fresh vs. repeat
 * questions to send next, so the number stays honest to what AOM is
 * actually doing while still looking like a live population of users
 * rather than a monotonically-improving counter.
 *
 * Writes nothing new to Couchbase beyond what real copilot usage already
 * would (the existing per-PR decision cache in `contextCache.js`) — no
 * synthetic purchase requests, purchase orders, or buyer-action records
 * are created, so there is nothing to clean up when the demo is stopped
 * and no risk of polluting the real dataset or the dashboard's own KPIs.
 */

const copilot = require("./copilot");
const store = require("./store");
const aom = require("./aomClient");

const PR_SCOPED_ACTIONS = ["compare_suppliers", "explain_oversupply", "po_readiness"];
const VIRTUAL_USERS = 100;
const TICK_MS = 500;
const REQUESTS_PER_TICK = 8; // ~16 req/s

// The trailing-hit-rate controller: a rolling window (for the "per
// minute average" the demo panel shows) tracked against a slowly-moving
// target band.
const ROLLING_WINDOW_MS = 60000; // 1 minute, matching "per-minute average"
const OSC_PERIOD_MS = 150000; // ~2.5 min per full swing low -> high -> low
const OSC_MIDPOINT_PCT = 89; // (LOW + HIGH) / 2
const OSC_AMPLITUDE_PCT = 7; // -> oscillates between 82% and 96%
const CONTROLLER_GAIN = 0.6; // proportional correction toward the target
const MIN_MISS_PROBABILITY = 0.02;
const MAX_MISS_PROBABILITY = 0.6;

let pool = null; // built lazily against real seeded PR ids, once
let userFavorite = null; // virtual user index -> pool index, fixed for the run
let missCounter = 0; // monotonic counter baked into forced-miss question text for uniqueness

let timer = null;
let runState = null;

async function buildPool() {
  const prs = await store.getPurchaseRequests();
  const entries = [{ quickAction: "my_priority", prId: null, question: "What's my top priority right now?" }];
  const questionText = {
    compare_suppliers: "Compare suppliers for this PR.",
    explain_oversupply: "Explain the oversupply signal on this PR.",
    po_readiness: "Is this PR PO-ready?",
  };
  for (const pr of prs) {
    for (const quickAction of PR_SCOPED_ACTIONS) {
      entries.push({ quickAction, prId: pr.id, question: questionText[quickAction] });
    }
  }
  return entries;
}

function classify(result) {
  // result.cacheStatus is AOM's own verdict straight from
  // /v1/llm/complete's response envelope (e.g. "miss", "exact_hit",
  // "semantic_hit") -- null means this call never reached AOM at all
  // (not configured, or the call failed and copilot fell back to its
  // rule-based text).
  if (!result.narrated) return "no_aom";
  if (!result.cacheStatus) return "unknown";
  return /miss/i.test(result.cacheStatus) ? "miss" : "hit";
}

/** Where the trailing hit rate should be right now: a smooth sine wave so
 * it drifts gradually rather than jumping, matching "per-minute average
 * changes from about 82% to 96%" when left running for a few minutes. */
function currentTargetPct(elapsedMs) {
  return OSC_MIDPOINT_PCT + OSC_AMPLITUDE_PCT * Math.sin((elapsedMs / OSC_PERIOD_MS) * 2 * Math.PI);
}

function rollingHitRatePct(now) {
  const cutoff = now - ROLLING_WINDOW_MS;
  while (runState.history.length && runState.history[0].ts < cutoff) {
    runState.history.shift();
  }
  let hits = 0;
  let total = 0;
  for (const entry of runState.history) {
    if (entry.verdict === "hit") {
      hits += 1;
      total += 1;
    } else if (entry.verdict === "miss") {
      total += 1;
    }
  }
  return total > 0 ? Math.round((hits / total) * 1000) / 10 : null;
}

async function runOne(poolIndex, forceMiss) {
  const entry = pool[poolIndex];
  const seenBefore = runState.seen.has(poolIndex);
  runState.seen.add(poolIndex);
  // Forcing a miss means asking the *same* underlying question but with
  // slightly different wording each time -- AOM caches on the exact
  // request (prompt text included), so varying the wording is enough to
  // guarantee a fresh call without changing what's actually being asked
  // or the facts it's grounded in.
  const message = forceMiss ? `${entry.question} (ref #${(missCounter += 1)})` : undefined;
  try {
    const result = await copilot.chat({ prId: entry.prId, quickAction: entry.quickAction, message });
    const verdict = classify(result);
    const now = Date.now();
    runState.totalRequests += 1;
    if (verdict === "hit") runState.aomHits += 1;
    else if (verdict === "miss") runState.aomMisses += 1;
    else if (verdict === "no_aom") runState.noAomCalls += 1;
    else runState.unknownVerdicts += 1;
    if (verdict === "hit" || verdict === "miss") {
      runState.history.push({ ts: now, verdict });
    }
    // Our own prediction, independent of what AOM reported -- lets the
    // status endpoint show "expected" alongside "actual" so a mismatch
    // (e.g. AOM's cache TTL expiring mid-run) is visible rather than
    // silently averaged away.
    if (forceMiss || !seenBefore) runState.expectedMisses += 1;
    else runState.expectedHits += 1;
  } catch (err) {
    runState.totalRequests += 1;
    runState.errors += 1;
    runState.lastError = err.message || String(err);
  }
}

function tick() {
  if (!runState || !runState.running) return;
  const now = Date.now();
  const elapsedMs = now - new Date(runState.startedAt).getTime();
  const target = currentTargetPct(elapsedMs);
  const rolling = rollingHitRatePct(now);

  // Open-loop baseline (send roughly the fraction of fresh questions the
  // target band implies) plus a proportional nudge toward whatever the
  // rolling window is actually reporting, so real-world cache behavior
  // (AOM TTL expiry, semantic hits, etc.) gets corrected for rather than
  // just assumed away.
  let missProbability = 1 - target / 100;
  if (rolling !== null) {
    const errorFraction = (rolling - target) / 100; // positive => too many hits lately => raise miss odds
    missProbability += errorFraction * CONTROLLER_GAIN;
  }
  missProbability = Math.min(MAX_MISS_PROBABILITY, Math.max(MIN_MISS_PROBABILITY, missProbability));

  runState.lastTargetPct = Math.round(target * 10) / 10;
  runState.lastMissProbability = Math.round(missProbability * 1000) / 1000;

  const jobs = [];
  for (let i = 0; i < REQUESTS_PER_TICK; i++) {
    const userId = Math.floor(Math.random() * VIRTUAL_USERS);
    const poolIndex = userFavorite[userId];
    const forceMiss = Math.random() < missProbability;
    jobs.push(runOne(poolIndex, forceMiss));
  }
  Promise.all(jobs).catch(() => {});
}

async function start() {
  if (runState && runState.running) return status();
  if (!pool) pool = await buildPool();
  userFavorite = Array.from({ length: VIRTUAL_USERS }, (_, i) => i % pool.length);
  runState = {
    running: true,
    startedAt: new Date().toISOString(),
    stoppedAt: null,
    totalRequests: 0,
    aomHits: 0,
    aomMisses: 0,
    noAomCalls: 0,
    unknownVerdicts: 0,
    expectedHits: 0,
    expectedMisses: 0,
    errors: 0,
    lastError: null,
    seen: new Set(),
    history: [], // { ts, verdict } within the trailing ROLLING_WINDOW_MS
    lastTargetPct: OSC_MIDPOINT_PCT,
    lastMissProbability: null,
  };
  timer = setInterval(tick, TICK_MS);
  return status();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (runState) {
    runState.running = false;
    runState.stoppedAt = new Date().toISOString();
  }
  return status();
}

function status() {
  if (!runState) {
    return {
      running: false,
      virtualUsers: VIRTUAL_USERS,
      oscLowPct: OSC_MIDPOINT_PCT - OSC_AMPLITUDE_PCT,
      oscHighPct: OSC_MIDPOINT_PCT + OSC_AMPLITUDE_PCT,
      aomConfigured: aom.isConfigured(),
      poolSize: pool ? pool.length : null,
    };
  }
  const measuredTotal = runState.aomHits + runState.aomMisses; // excludes no_aom / unknown -- only calls AOM actually gave a verdict for
  const hitRatePct = measuredTotal > 0 ? Math.round((runState.aomHits / measuredTotal) * 1000) / 10 : 0;
  const expectedTotal = runState.expectedHits + runState.expectedMisses;
  const expectedHitRatePct = expectedTotal > 0 ? Math.round((runState.expectedHits / expectedTotal) * 1000) / 10 : 0;
  const now = Date.now();
  const windowHitRatePct = rollingHitRatePct(now);
  const elapsedMs = new Date((runState.stoppedAt || new Date().toISOString())).getTime() - new Date(runState.startedAt).getTime();
  return {
    running: runState.running,
    startedAt: runState.startedAt,
    stoppedAt: runState.stoppedAt,
    elapsedMs,
    virtualUsers: VIRTUAL_USERS,
    poolSize: pool.length,
    warmedCount: runState.seen.size,
    warmupComplete: runState.seen.size >= pool.length,
    oscLowPct: OSC_MIDPOINT_PCT - OSC_AMPLITUDE_PCT,
    oscHighPct: OSC_MIDPOINT_PCT + OSC_AMPLITUDE_PCT,
    targetPct: runState.lastTargetPct,
    aomConfigured: aom.isConfigured(),
    totalRequests: runState.totalRequests,
    aomHits: runState.aomHits,
    aomMisses: runState.aomMisses,
    hitRatePct, // all-time cumulative
    windowHitRatePct, // trailing ~60s -- this is the number that should oscillate 82%-96%
    expectedHitRatePct,
    noAomCalls: runState.noAomCalls,
    unknownVerdicts: runState.unknownVerdicts,
    errors: runState.errors,
    lastError: runState.lastError,
  };
}

module.exports = { start, stop, status };

/**
 * Settings → Agent Simulation: a small, always-on-while-started traffic
 * generator that role-plays two distinct AOM identities against this
 * app's own real data and real MCP tools, so Couchbase Agent Operations
 * Manager's Live Topology, Roles & RBAC, and Threat Detection pages have
 * something to show without a person clicking through this app by hand.
 *
 * Every 60 seconds (TICK_MS) this fires:
 *
 *   - A support_agent "customer support call": picks a random purchase
 *     request and asks the copilot one of its two support-shaped quick
 *     actions — "Explain oversupply" or "PO readiness" — authenticating
 *     to AOM as PCC's `viewer` role, which `aomClient.js` maps to AOM's
 *     `support_agent` identity. This is the exact same `copilot.chat()`
 *     path a real buyer's browser calls (see routes/copilot.js); the only
 *     difference is the AOM identity it authenticates as. It also looks
 *     up existing support tickets for the purchase request via AOM's
 *     Zendesk MCP server (`zendesk::search_tickets`, one of the tools
 *     support_agent is actually RBAC-allowed to call) -- without this,
 *     the whole turn would only ever produce an agent -> LLM provider
 *     edge on AOM's Live Topology, never an agent -> MCP server edge,
 *     since `copilot.chat()`'s own Snowflake cross-check (PO readiness)
 *     is finance_analyst/admin-only and support_agent's discover() call
 *     for it legitimately finds nothing.
 *
 *   - Occasionally — every ADMIN_EVERY_N_TICKS'th tick, a few minutes
 *     apart rather than every call — an "admin agent" turn authenticating
 *     as AOM's `admin` identity: it discovers-and-invokes AOM's bundled
 *     web-search tool, discovers-and-invokes its internal docs-search
 *     tool, and creates a Jira issue via `jira::create_issue`.
 *
 *     All three hit AOM's own bundled *sample* MCP servers (see the AOM
 *     project's `sample-mcp-servers/app/main.py`) — fixture servers that
 *     return fully mocked, hardcoded data and make no real network call
 *     or write of their own, precisely so a demo can call them freely.
 *     Two of the three are also AOM's own MCP-hijacking fixtures:
 *     docs-search's one tool is quarantined at ingest time (its
 *     *description* carries a defanged metadata-poisoning payload), so
 *     `discover()` legitimately finds nothing for it on every single
 *     call — that is the correct, intended outcome, not a bug in this
 *     module. web-search's tool ingests and invokes normally, but its
 *     mocked *response* carries a payload that AOM's response-payload
 *     scan flags on invoke — so running this admin turn is what puts a
 *     live finding on AOM's Threat Detection page and Agent Tool Audit,
 *     the same way a person manually invoking it from the AOM UI would.
 *
 * Like services/demo.js, this writes nothing new to this app's own
 * Couchbase data — no purchase requests, POs, or buyer-action records —
 * it only calls the same real copilot/AOM paths a person would, so
 * stopping it leaves nothing to clean up. Unlike demo.js it isn't trying
 * to steer toward a target cache-hit rate; it's a realistic
 * multi-identity activity generator, not a cache metric demo.
 */

const copilot = require("./copilot");
const store = require("./store");
const aom = require("./aomClient");

const TICK_MS = 60_000;
const ADMIN_EVERY_N_TICKS = 4; // an admin turn roughly every 4 minutes, not every tick
const SUPPORT_ACTIONS = ["explain_oversupply", "po_readiness"];
const SUPPORT_QUESTION_TEXT = {
  explain_oversupply: "Is there an oversupply alert on this one?",
  po_readiness: "Has a PO been created for this yet?",
};

let timer = null;
let tickCount = 0;
let runState = null;

function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function freshRunState() {
  return {
    running: true,
    startedAt: Date.now(),
    ticks: 0,
    supportAgentCalls: 0,
    adminAgentCalls: 0,
    lastSupportAgent: null,
    lastAdminAgent: null,
    errors: 0,
  };
}

/**
 * The support_agent "customer support call" — always fires, once a tick.
 * Never throws: a failure here (AOM down, no purchase requests seeded
 * yet) is recorded on runState and the loop keeps going, same posture as
 * copilot.chat()'s own AOM fallback.
 */
async function supportAgentTurn() {
  let prs;
  try {
    prs = await store.getPurchaseRequests();
  } catch (err) {
    runState.errors += 1;
    // eslint-disable-next-line no-console
    console.warn(`[agentSimulation] support_agent turn failed to load purchase requests: ${err.message}`);
    return;
  }
  if (!prs.length) return;
  const pr = pick(prs);
  const quickAction = pick(SUPPORT_ACTIONS);
  const message = SUPPORT_QUESTION_TEXT[quickAction];
  try {
    const result = await copilot.chat({ prId: pr.id, quickAction, message, role: "viewer" });

    // A real, RBAC-checked support_agent MCP call -- checks for existing
    // support tickets tied to this PR via AOM's Zendesk sample server.
    // zendesk::search_tickets is one of the tools support_agent is
    // actually allowed to invoke (see AOM's rbac_policy.py), so this is
    // what puts an agent -> MCP server edge on the Live Topology for
    // support_agent, not just an agent -> LLM provider edge.
    let ticketCheck;
    try {
      const ticketResult = await aom.invoke("zendesk::search_tickets", { query: pr.id, status: "open" }, { role: "viewer" });
      ticketCheck = { ok: true, hijackWarning: (ticketResult && ticketResult.hijack_warning) || null };
    } catch (err) {
      ticketCheck = { ok: false, reason: err.message };
    }

    runState.supportAgentCalls += 1;
    runState.lastSupportAgent = {
      at: Date.now(),
      prId: pr.id,
      item: pr.item,
      quickAction,
      reply: result.reply,
      narrated: result.narrated,
      cacheStatus: result.cacheStatus,
      ticketCheck,
    };
  } catch (err) {
    runState.errors += 1;
    // eslint-disable-next-line no-console
    console.warn(`[agentSimulation] support_agent turn failed: ${err.message}`);
  }
}

/**
 * The occasional admin turn: web search, internal docs search, Jira
 * ticket creation, in that order, each independently caught so one
 * failing (docs-search is *expected* to come back empty — see the module
 * docstring) never stops the others from running.
 */
async function adminAgentTurn() {
  const outcome = { at: Date.now(), webSearch: null, docsSearch: null, jira: null };

  try {
    const webResult = await aom.discoverAndInvoke(
      "fetch a public web page and summarize its content",
      { url: "https://example.com/supplier-market-update" },
      { role: "admin" }
    );
    outcome.webSearch = webResult
      ? { ok: true, hijackWarning: webResult.hijack_warning || null }
      : { ok: false, reason: "no matching tool discovered" };
  } catch (err) {
    outcome.webSearch = { ok: false, reason: err.message };
  }

  try {
    const docsResult = await aom.discoverAndInvoke(
      "search internal documentation and runbooks",
      { query: "procurement escalation runbook" },
      { role: "admin" }
    );
    // AOM quarantines this tool at ingest time (see module docstring) --
    // finding nothing is the correct, expected outcome here, not a
    // failure of this call.
    outcome.docsSearch = docsResult ? { ok: true } : { ok: false, reason: "quarantined by AOM (expected)" };
  } catch (err) {
    outcome.docsSearch = { ok: false, reason: err.message };
  }

  try {
    const prs = await store.getPurchaseRequests();
    const pr = prs.length ? pick(prs) : null;
    const summary = pr
      ? `Follow up on ${pr.id} (${pr.item}) raised by the procurement copilot`
      : "Procurement copilot admin follow-up";
    const jiraResult = await aom.invoke(
      "jira::create_issue",
      { project: "PROC", summary, issue_type: "Task", priority: "Medium" },
      { role: "admin" }
    );
    outcome.jira = { ok: true, key: jiraResult && jiraResult.result && jiraResult.result.key, hijackWarning: (jiraResult && jiraResult.hijack_warning) || null };
  } catch (err) {
    outcome.jira = { ok: false, reason: err.message };
  }

  runState.adminAgentCalls += 1;
  runState.lastAdminAgent = outcome;
}

async function tick() {
  if (!runState || !runState.running) return;
  tickCount += 1;
  runState.ticks = tickCount;
  await supportAgentTurn();
  if (tickCount % ADMIN_EVERY_N_TICKS === 0) {
    await adminAgentTurn();
  }
}

async function start() {
  if (runState && runState.running) return status();
  tickCount = 0;
  runState = freshRunState();
  timer = setInterval(() => {
    tick().catch((err) => {
      runState.errors += 1;
      // eslint-disable-next-line no-console
      console.warn(`[agentSimulation] tick failed: ${err.message}`);
    });
  }, TICK_MS);
  // Fire the first turn immediately rather than making Start look like a
  // no-op for a full minute.
  await tick();
  return status();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  if (runState) runState.running = false;
  return status();
}

function status() {
  if (!runState) {
    return { running: false, aomConfigured: aom.isConfigured("admin"), tickIntervalMs: TICK_MS, adminEveryNTicks: ADMIN_EVERY_N_TICKS };
  }
  return {
    ...runState,
    elapsedMs: Date.now() - runState.startedAt,
    aomConfigured: aom.isConfigured("admin"),
    tickIntervalMs: TICK_MS,
    adminEveryNTicks: ADMIN_EVERY_N_TICKS,
  };
}

module.exports = { start, stop, status };

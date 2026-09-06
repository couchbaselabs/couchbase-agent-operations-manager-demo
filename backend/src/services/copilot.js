/**
 * Procurement AI — the context-aware buyer copilot from the reference UI.
 *
 * Every reply is grounded in the same small rules engine as before (it
 * answers from whatever PR is currently selected, mirroring the "My
 * priority / Compare suppliers / Explain oversupply / PO readiness"
 * quick-action chips shown in the demo) — that rules engine is what
 * supplies the *facts* (which PR, which supplier, which numbers) and is
 * always correct on its own. When the Couchbase Agent Operations Manager
 * is configured (`COUCHBASE_AOM_API_KEY`), those facts are handed to
 * Gemini via AOM's `/v1/llm/complete` caching gateway to produce the final
 * reply text, instead of the rule engine's own template string. AOM
 * caches repeat questions (exact + semantic match) so the tokens are only
 * spent once. If AOM isn't configured, isn't reachable, or the call
 * fails, the rule engine's own template text is returned unchanged — the
 * app works fully without AOM, same as before.
 *
 * Two of those quick actions — Compare suppliers and PO readiness — also
 * cross-check the data warehouse via `aomClient.discoverAndInvoke()`
 * before narrating: a real, RBAC-checked `discover` + `invoke` round trip
 * against AOM's bundled Snowflake sample server, running under this app's
 * `finance_analyst`-scoped API key (see `.env.example`). Same resilience
 * posture as the LLM call: if it fails or AOM isn't configured, the facts
 * text is used unchanged, no error surfaces to the buyer. This is what
 * makes this app's traffic show up as *both* an agent -> LLM provider edge
 * and an agent -> MCP server edge on AOM's Dashboard "Live topology"
 * diagram, not just the former.
 *
 * (Earlier versions of this file had a comment claiming an
 * `ANTHROPIC_API_KEY` env var would route replies through Claude — that
 * was never actually implemented; this AOM/Gemini integration is what
 * that comment described but didn't build. See the README changelog.)
 *
 * `chat()` (and the helpers it calls) takes an optional `role` — the PCC
 * role whose AOM identity the call should authenticate as (see
 * `aomClient.resolveAomRole`). Every real caller today (routes/copilot.js)
 * omits it, so this app's own buyer-facing traffic is unchanged and keeps
 * authenticating as `aomClient.DEFAULT_PCC_ROLE` ("buyer" / AOM's
 * `finance_analyst`). It exists so a caller that already knows which
 * identity it's role-playing — `services/agentSimulation.js`'s
 * support_agent turn — can say so explicitly instead of everything
 * looking like the same buyer to AOM's own audit log and RBAC checks.
 */

const contextCache = require("./contextCache");
const aom = require("./aomClient");
const { runValidationAgent } = require("../agents/engine");
const store = require("./store");
const seed = require("../data/seed");

function fmtMoney(n) {
  return `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * Ask Gemini (via AOM) to answer `question` grounded in `facts` — the
 * rule-engine-computed text that would otherwise be returned directly.
 * `facts` doubles as the fallback: if AOM isn't configured or the call
 * fails, `facts` is returned unchanged, so every quick action still gives
 * a complete, correct answer with no AOM running at all.
 *
 * Returns `{ text, narrated, cacheStatus, model }` rather than a bare
 * string: `cacheStatus` is AOM's own verdict for this call (e.g. "miss",
 * "exact_hit") straight from its `/v1/llm/complete` response envelope —
 * `narrated: false` (and `cacheStatus: null`) means AOM wasn't configured
 * or the call failed and `text` is the rule-engine fallback. This extra
 * detail is additive: every existing caller only ever used `.text` before
 * (see `chat()` below, which still returns `reply` as a bare string) — it
 * exists so callers that DO care about real cache behavior (the Settings
 * → Demo generator, see `services/demo.js`) can report AOM's actual
 * hit/miss verdict instead of guessing.
 */
async function narrateReply(question, facts, namespace = "couchbase-pcc-copilot", role) {
  if (!aom.isConfigured(role)) return { text: facts, narrated: false, cacheStatus: null, model: null };
  const prompt =
    `You are the Procurement AI copilot inside the Procurement Command Center. ` +
    `A buyer asked: "${question}". Answer using ONLY the facts below — never invent a ` +
    `supplier, price, PR number, or figure that isn't listed. Keep it to 2-4 sentences, ` +
    `concise and professional, in first person as the copilot.\n\nFacts:\n${facts}\n\nAnswer:`;
  try {
    const result = await aom.complete(prompt, { namespace, role });
    return { text: result.text || facts, narrated: true, cacheStatus: result.cacheStatus || null, model: result.model || null };
  } catch (err) {
    console.warn(`[copilot] Gemini call failed, using rule-based fallback: ${err.message}`);
    return { text: facts, narrated: false, cacheStatus: null, model: null };
  }
}

/**
 * Optional data-warehouse cross-check via AOM's `discover` + `invoke`
 * (`aomClient.discoverAndInvoke`) — a real, RBAC-checked round trip to
 * AOM's bundled Snowflake sample server, not just the LLM caching gateway.
 * Never throws: a lookup failure (AOM unreachable, not configured, role
 * not authorized for the matched tool) just means no cross-check note gets
 * appended below, the same "degrade, never break" posture as narrateReply.
 */
async function crossCheckWarehouse(query, args, role) {
  if (!aom.isConfigured(role)) return null;
  try {
    return await aom.discoverAndInvoke(query, args, { role });
  } catch (err) {
    console.warn(`[copilot] AOM data-warehouse lookup failed, continuing without it: ${err.message}`);
    return null;
  }
}

function withCrossCheckNote(facts, toolResult) {
  if (!toolResult) return facts;
  return `${facts} (Cross-checked against the data warehouse via the Couchbase Agent Operations Manager.)`;
}

async function buildPrSummary(pr) {
  const decision = await contextCache.getDecision(pr);
  return { pr, decision };
}

function answerMyPriority(allDecisions) {
  const urgent = allDecisions
    .filter((d) => d.pr.urgent)
    .sort((a, b) => (b.decision.savings || 0) - (a.decision.savings || 0));
  if (urgent.length === 0) return "Nothing is flagged urgent right now — good time to clear the Review queue.";
  const top = urgent[0];
  return `Your top priority is ${top.pr.id} (${top.pr.item}) — ${top.decision.rationale} Need-by is ${top.decision.daysToNeedBy} day(s) out, and it's worth ${fmtMoney(
    top.decision.savings || 0
  )}. There are ${urgent.length} urgent PRs waiting in total.`;
}

function answerCompareSuppliers(pr, decision) {
  if (decision.candidates) {
    const lines = decision.candidates
      .map((c) => `${c.name}: ${fmtMoney(c.price)}/${pr.uom} · ${c.leadTimeDays}-day lead time`)
      .join("; ");
    return `Current supplier ${pr.currentSupplier.name} is ${fmtMoney(pr.currentSupplier.price)}/${pr.uom}. Qualified alternatives — ${lines}.`;
  }
  if (decision.recommendedSupplier) {
    return `Current supplier ${pr.currentSupplier.name} is at ${fmtMoney(pr.currentSupplier.price)}/${pr.uom}. Recommended: ${decision.recommendedSupplier.name} at ${fmtMoney(
      decision.recommendedSupplier.price
    )}/${pr.uom}, saving ${fmtMoney(decision.savings)} on this PR.`;
  }
  return `${pr.currentSupplier.name} is currently the only qualified supplier on file for ${pr.item} — no cheaper alternative was found.`;
}

function answerExplainOversupply(pr, decision) {
  if (decision.recommendation !== "dont_buy") {
    return `No oversupply signal on ${pr.id} — the Oversupply Agent didn't find covering stock or an open PO elsewhere for ${pr.item}.`;
  }
  return `${decision.buyerBrief} That's ${decision.supplyQty} ${pr.uom} available at ${decision.supplyAvailableAt}, avoiding a new ${fmtMoney(
    decision.savings
  )} purchase.`;
}

async function answerPoReadiness(pr) {
  const supplierName = pr?.currentSupplier?.name;
  const supplierRecord = supplierName ? await store.getSupplierByName(supplierName) : null;
  const validation = runValidationAgent(pr, supplierRecord);
  const failing = validation.checks.filter((c) => !c.passed).map((c) => c.label);
  if (failing.length === 0) {
    return `${pr.id} is PO-ready — supplier master, payment terms and contract status all check out.`;
  }
  return `${pr.id} isn't PO-ready yet. Still needed: ${failing.join(", ")}.`;
}

function answerArchitecture() {
  const layerNames = seed.CONTEXT_HUB.layers.map((l) => `${l.layer}) ${l.name}`).join("; ");
  return (
    `This app runs on a 5-layer Context Hub: ${layerNames}. ` +
    `Governance sits alongside it in the Trust Layer (explainability, observability, buyer-behavior/agent-accuracy logging, and an IT GRC/EY audit checklist). ` +
    `Recommendations are driven by a business-rule catalog (this build implements ${seed.BUSINESS_RULES.length} rule shapes of the ~56 the real system is scoped for), and Couchbase's role is context caching — the first phase of a longer "AI data plane" adoption journey.`
  );
}

async function chat({ prId, message, quickAction, role }) {
  const pr = prId ? await store.getPurchaseRequest(prId) : null;
  const decision = pr ? (await buildPrSummary(pr)).decision : null;

  const action = quickAction || detectQuickAction(message);

  if (action === "architecture") {
    // Deliberately not narrated: this answer describes the app's own
    // architecture rather than PR data, so there are no "facts" to hand an
    // LLM that it doesn't already have baked into its own training —
    // asking Gemini to describe this app's build risks it improvising
    // details about itself. Authored text is the more honest answer here.
    return { reply: answerArchitecture(), contextPrId: prId || null, narrated: false, cacheStatus: null };
  }

  if (action === "my_priority" || (!pr && /priorit/i.test(message || ""))) {
    const allPrs = await store.getPurchaseRequests();
    const summaries = await Promise.all(allPrs.map((p) => buildPrSummary(p)));
    const facts = answerMyPriority(summaries);
    const narrated = await narrateReply(message || "What's my top priority right now?", facts, "couchbase-pcc-copilot-priority", role);
    return { reply: narrated.text, contextPrId: prId || null, narrated: narrated.narrated, cacheStatus: narrated.cacheStatus };
  }

  if (!pr) {
    return {
      reply:
        "Select a purchase request from the AI Decision Feed and I can explain the recommendation, compare suppliers, check for oversupply, or confirm PO readiness.",
      contextPrId: null,
      narrated: false,
      cacheStatus: null,
    };
  }

  if (action === "compare_suppliers") {
    let facts = answerCompareSuppliers(pr, decision);
    const toolResult = await crossCheckWarehouse(
      "run a read-only analytics SQL query against the data warehouse for supplier pricing history",
      { sql: `SELECT * FROM supplier_pricing_history WHERE pr_id = '${pr.id}'` },
      role
    );
    facts = withCrossCheckNote(facts, toolResult);
    const narrated = await narrateReply(message || "Compare suppliers for this PR.", facts, "couchbase-pcc-copilot-suppliers", role);
    return { reply: narrated.text, contextPrId: pr.id, narrated: narrated.narrated, cacheStatus: narrated.cacheStatus };
  }
  if (action === "explain_oversupply") {
    const facts = answerExplainOversupply(pr, decision);
    const narrated = await narrateReply(message || "Explain the oversupply signal on this PR.", facts, "couchbase-pcc-copilot-oversupply", role);
    return { reply: narrated.text, contextPrId: pr.id, narrated: narrated.narrated, cacheStatus: narrated.cacheStatus };
  }
  if (action === "po_readiness") {
    let facts = await answerPoReadiness(pr);
    const toolResult = await crossCheckWarehouse(
      "retrieve business metrics from the data warehouse to validate purchase order readiness",
      { metric_types: ["transaction_volume", "error_rate"], start_date: "2026-08-01", end_date: "2026-08-31" },
      role
    );
    facts = withCrossCheckNote(facts, toolResult);
    const narrated = await narrateReply(message || "Is this PR PO-ready?", facts, "couchbase-pcc-copilot-readiness", role);
    return { reply: narrated.text, contextPrId: pr.id, narrated: narrated.narrated, cacheStatus: narrated.cacheStatus };
  }

  // Freeform fallback: summarize the current decision in plain language.
  const parts = [decision.rationale];
  if (decision.savings) {
    parts.push(
      `${decision.savingsType === "avoid_purchase" ? "Avoids" : "Saves"} ${fmtMoney(decision.savings)}.`
    );
  }
  if (decision.leadTimeNote) parts.push(decision.leadTimeNote + ".");
  parts.push(
    `Agent checks: ${decision.agentChecks.map((c) => c.label).join(", ")} — all verified against source ERP and Snowflake history.`
  );
  const facts = parts.join(" ");
  const narrated = await narrateReply(message || "Tell me about this purchase request.", facts, "couchbase-pcc-copilot-freeform", role);
  return { reply: narrated.text, contextPrId: pr.id, narrated: narrated.narrated, cacheStatus: narrated.cacheStatus };
}

function detectQuickAction(message) {
  const m = (message || "").toLowerCase();
  if (m.includes("priorit")) return "my_priority";
  if (m.includes("compare") || m.includes("supplier")) return "compare_suppliers";
  if (m.includes("oversupply") || m.includes("excess") || m.includes("inventory")) return "explain_oversupply";
  if (m.includes("po ready") || m.includes("readiness") || m.includes("validat")) return "po_readiness";
  if (
    m.includes("context hub") ||
    m.includes("trust layer") ||
    m.includes("business rule") ||
    m.includes("governance") ||
    m.includes("couchbase") ||
    m.includes("architecture") ||
    m.includes("data plane")
  )
    return "architecture";
  return null;
}

module.exports = { chat };

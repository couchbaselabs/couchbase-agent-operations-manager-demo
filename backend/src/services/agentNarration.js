/**
 * Gemini-narrated upgrade for an agent decision's buyer-facing text, layered
 * on top of the deterministic decision `engine.js` already computed.
 *
 * Design choice, worth being explicit about: the *numbers* in a decision
 * (which supplier, what price, how much is saved, whether stock exists
 * elsewhere) always come from `engine.js`'s deterministic rules against
 * the same mock ERP/Snowflake-sourced data as before — this module only
 * asks Gemini (via the Couchbase Agent Operations Manager) to phrase the
 * explanation of those already-computed facts, never to recompute or
 * invent them. That split matters because these decisions drive real
 * actions (PO creation): an LLM call is a fine way to write a better
 * sentence, a bad way to decide how much money to commit. The prompt
 * below is explicit about that boundary too ("using ONLY the facts
 * given").
 *
 * If AOM isn't configured or the call fails for any reason, the decision
 * is returned unchanged — `engine.js`'s own rule-based rationale/
 * buyerBrief/leadTimeNote text is a complete, correct answer on its own,
 * so narration failing is a downgrade in prose quality, never a broken
 * decision.
 */

const aom = require("./aomClient");

function factsFor(decision) {
  const lines = [`Agent: ${decision.agent} (rule ${decision.ruleId || "n/a"})`, `Recommendation: ${decision.recommendation}`];
  if (decision.currentSupplier) {
    lines.push(`Current supplier: ${decision.currentSupplier.name} at $${decision.currentSupplier.price}/unit`);
  }
  if (decision.recommendedSupplier) {
    lines.push(`Recommended supplier: ${decision.recommendedSupplier.name} at $${decision.recommendedSupplier.price}/unit`);
  }
  if (decision.candidates) {
    lines.push(
      `Candidate suppliers: ${decision.candidates
        .map((c) => `${c.name} ($${c.price}/unit, ${c.leadTimeDays}-day lead time)`)
        .join("; ")}`
    );
  }
  if (decision.savings) {
    lines.push(`${decision.savingsType === "avoid_purchase" ? "Purchase avoided, worth" : "Savings"}: $${decision.savings}`);
  }
  if (decision.supplyAvailableAt) {
    lines.push(`Existing supply available at: ${decision.supplyAvailableAt} (qty ${decision.supplyQty})`);
  }
  if (decision.leadTimeNote) lines.push(`Lead time: ${decision.leadTimeNote}`);
  if (decision.daysToNeedBy != null) lines.push(`Days to need-by: ${decision.daysToNeedBy}`);
  if (decision.automationEligibility) lines.push(`Automation eligibility: ${decision.automationEligibility}`);
  return lines.join("\n");
}

function buildPrompt(decision) {
  return (
    `You are a procurement buyer's assistant. A rules engine already computed the facts below for one ` +
    `purchase-request recommendation. Write a 1-2 sentence buyer-facing rationale explaining this ` +
    `recommendation, using ONLY the facts given — never invent a supplier, price, or number that isn't ` +
    `listed. Match a concise, professional tone suitable for a procurement dashboard.\n\nFacts:\n${factsFor(
      decision
    )}\n\nRationale:`
  );
}

/**
 * Returns `decision` with `rationale` replaced by Gemini's phrasing when
 * AOM is configured and reachable; otherwise returns `decision` unchanged.
 */
async function narrate(decision) {
  if (!aom.isConfigured()) return decision;
  try {
    const result = await aom.complete(buildPrompt(decision), { namespace: "couchbase-pcc-decision" });
    if (!result.text) return decision;
    return {
      ...decision,
      rationale: result.text,
      narratedBy: { provider: result.provider, model: result.model, cacheStatus: result.cacheStatus },
    };
  } catch (err) {
    console.warn(`[agent-narration] Gemini narration failed for ${decision.prId || decision.agent}, keeping rule-based text: ${err.message}`);
    return decision;
  }
}

module.exports = { narrate, factsFor, buildPrompt };

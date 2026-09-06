/**
 * Agent decision engine.
 *
 * Four narrow, explainable "agents" mirror the ones shown in the reference
 * demo: Best Price, Oversupply, Sourcing and Validation. Each is a small
 * pure function over a purchase request — there's no external model call,
 * just the same kind of deterministic rule + data checks a real buyer
 * workbench would run against ERP, inventory and Snowflake pricing data.
 *
 * The demo's "today" is pinned so the lead-time math matches the reference
 * screenshots exactly (PR-100239 needed by Jul 26 reads as "3 days to
 * need-by" against a 12-day lead time, etc).
 */

const DEMO_TODAY = new Date("2026-07-23T00:00:00Z");

function daysBetween(dateStr) {
  const target = new Date(`${dateStr}T00:00:00Z`);
  return Math.round((target - DEMO_TODAY) / (1000 * 60 * 60 * 24));
}

function money(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Business rule catalog shapes implemented by the functions below. The
 * underlying catalog is described as roughly 56 total rules, consistent
 * across scenarios but varying in applicability — this app implements the
 * 10 rule shapes directly evidenced in the reference app (see seed.js
 * BUSINESS_RULES for the full catalog with descriptions); each decision
 * below is tagged with the ruleId that fired so it's traceable, not a
 * black box.
 */
function agentChecksFor(pr) {
  return [
    { label: "PR normalized from source ERP", source: pr.sourceErp, passed: true },
    { label: "Historical price checked in Snowflake", passed: true },
    { label: "Inventory and open POs checked", passed: true },
    { label: "Destination ERP identified", source: pr.sourceErp, passed: true },
  ];
}

/** Oversupply Agent: can this PR be avoided using stock/PO elsewhere? */
function runOversupplyAgent(pr) {
  if (pr.inventoryElsewhere) {
    const avoidSave = money(pr.qty * pr.currentSupplier.price);
    return {
      agent: "Oversupply Agent",
      ruleId: "RULE-OS-01",
      recommendation: "dont_buy",
      confidence: "high",
      rationale: `Oversupply Agent found stock in another organization that can cover the requirement.`,
      buyerBrief: `Using existing supply instead of creating a new PO for ${pr.buyingOrg}.`,
      supplyAvailableAt: pr.inventoryElsewhere.org,
      supplyQty: pr.inventoryElsewhere.qty,
      savings: avoidSave,
      savingsType: "avoid_purchase",
      leadTimeNote: "Not applicable — use existing supply",
      automationEligibility: "Buyer decision required",
    };
  }
  if (pr.openPoElsewhere) {
    const avoidSave = money(pr.qty * pr.currentSupplier.price);
    return {
      agent: "Oversupply Agent",
      ruleId: "RULE-OS-02",
      recommendation: "dont_buy",
      confidence: "high",
      rationale: `Oversupply Agent found an open PO at the same destination organization that fully covers the requirement.`,
      buyerBrief: `Open PO ${pr.openPoElsewhere.poNumber} at ${pr.openPoElsewhere.org} already covers this requirement.`,
      supplyAvailableAt: pr.openPoElsewhere.org,
      supplyQty: pr.openPoElsewhere.qty,
      savings: avoidSave,
      savingsType: "avoid_purchase",
      leadTimeNote: "Not applicable — use existing supply",
      automationEligibility: "Buyer decision required",
    };
  }
  return null;
}

/** Best Price Agent + Sourcing Agent: is there a cheaper / tradeoff supplier? */
function runPricingAgents(pr) {
  const candidates = pr.candidateSuppliers || [];
  if (candidates.length === 0) return null;

  const cheapest = [...candidates].sort((a, b) => a.price - b.price)[0];
  const fastest = [...candidates].sort(
    (a, b) => (a.leadTimeDays ?? 999) - (b.leadTimeDays ?? 999)
  )[0];

  const isTradeoff =
    candidates.length > 1 &&
    cheapest.name !== fastest.name &&
    cheapest.leadTimeDays != null &&
    pr.leadTimeDays != null &&
    cheapest.leadTimeDays > pr.leadTimeDays;

  if (isTradeoff) {
    return {
      agent: "Sourcing Agent",
      ruleId: "RULE-SA-01",
      recommendation: "source",
      confidence: "medium",
      rationale: "Best Price Agent found two qualified suppliers with different lead times.",
      candidates: candidates.map((c) => ({
        ...c,
        totalPrice: money(c.price * pr.qty),
      })),
      leadTimeNote: `${daysBetween(pr.needBy)} days to need-by vs ${cheapest.leadTimeDays}-day lead time`,
      automationEligibility: "Buyer decision required",
    };
  }

  if (cheapest.price < pr.currentSupplier.price) {
    const savings = money((pr.currentSupplier.price - cheapest.price) * pr.qty);
    const daysToNeed = daysBetween(pr.needBy);
    const expediteDays = cheapest.leadTimeDays != null ? cheapest.leadTimeDays - daysToNeed : 0;
    // Automation eligibility tracks whether this PO can go out without a
    // human in the loop (an approved supplier on a standing contract) — a
    // tight lead time is a separate, informational expedite note, not a
    // reason to require manual approval.
    const straightThrough = !!pr.contract;
    return {
      agent: "Best Price Agent",
      ruleId: straightThrough ? "RULE-BP-01" : "RULE-BP-02",
      recommendation: "buy_now",
      confidence: "high",
      rationale: `Best Price Agent found a better landed price with ${cheapest.name}.`,
      currentSupplier: pr.currentSupplier,
      recommendedSupplier: cheapest,
      savings,
      savingsType: "buy_savings",
      leadTimeNote:
        cheapest.leadTimeDays != null
          ? `${daysToNeed} days to need-by vs ${cheapest.leadTimeDays}-day lead time${
              expediteDays > 0 ? ` · ${expediteDays}-day expedite required` : ""
            }`
          : null,
      automationEligibility: straightThrough ? "Straight-through eligible" : "Buyer decision required",
    };
  }

  return null;
}

/** Validation Agent: run on demand before a PO is allowed to go out. */
function runValidationAgent(pr, supplierRecord) {
  const checks = [
    {
      label: "Supplier master, ASL & remit-to",
      ruleId: "RULE-VA-01",
      passed: !!(supplierRecord && supplierRecord.asl && supplierRecord.remitTo),
    },
    {
      label: "Payment terms on file",
      ruleId: "RULE-VA-02",
      passed: !!(supplierRecord && supplierRecord.paymentTerms),
    },
    {
      label: "Contract active (if applicable)",
      ruleId: "RULE-VA-03",
      passed: pr.contract ? new Date(pr.contract.expires) > DEMO_TODAY : true,
    },
    {
      label: "Buying org / GL coding present",
      ruleId: "RULE-VA-04",
      passed: !!pr.buyingOrg,
    },
  ];
  return {
    agent: "Validation Agent",
    passed: checks.every((c) => c.passed),
    checks,
  };
}

/**
 * Compute the full decision for a PR. Returns the shape the UI renders,
 * including the generic agent checks list shown in the "Agent Activity"
 * panel of the reference app.
 *
 * `invocationPoint` models the microservice-style agent reuse pattern:
 * the same agent/logic can be invoked at three different points in a
 * business process — "planning" (by a planner), "requisition" (plant
 * request), or "buying" (this app's PR/PO screens). The decision logic
 * itself doesn't change by invocation point in this demo (no separate
 * planning- or requisition-stage data model exists yet), but the field is
 * threaded through end-to-end so a real planning/requisition caller could
 * invoke `decideForPurchaseRequest` identically, since it's the same
 * agent, same logic, same things, just invoked at three different times.
 */
function decideForPurchaseRequest(pr, invocationPoint = "buying") {
  const oversupply = runOversupplyAgent(pr);
  const pricing = oversupply ? null : runPricingAgents(pr);
  const decision = oversupply || pricing || {
    agent: "Sourcing Agent",
    ruleId: "RULE-DEFAULT",
    recommendation: "review",
    confidence: "low",
    rationale: "No qualified alternative supplier or excess inventory was found — needs manual review.",
    automationEligibility: "Buyer decision required",
  };

  const daysToNeed = daysBetween(pr.needBy);
  return {
    prId: pr.id,
    computedAt: new Date().toISOString(),
    invocationPoint,
    daysToNeedBy: daysToNeed,
    agentChecks: agentChecksFor(pr),
    ...decision,
  };
}

module.exports = {
  DEMO_TODAY,
  daysBetween,
  decideForPurchaseRequest,
  runValidationAgent,
};

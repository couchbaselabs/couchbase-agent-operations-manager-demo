const express = require("express");
const store = require("../services/store");
const contextCache = require("../services/contextCache");
const { runValidationAgent } = require("../agents/engine");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const { filter } = req.query;
    const prs = await store.getPurchaseRequests();
    const withDecisions = await Promise.all(
      prs.map(async (pr) => ({ pr, decision: await contextCache.getDecision(pr) }))
    );

    let rows = withDecisions;
    if (filter === "urgent") rows = rows.filter((r) => r.pr.urgent);
    else if (filter && filter !== "all") rows = rows.filter((r) => r.decision.recommendation === filter);

    res.json(
      rows.map(({ pr, decision }) => ({
        id: pr.id,
        item: pr.item,
        qty: pr.qty,
        uom: pr.uom,
        sourceErp: pr.sourceErp,
        location: pr.location,
        businessUnit: pr.businessUnit || null,
        needBy: pr.needBy,
        urgent: pr.urgent,
        status: pr.status,
        recommendation: decision.recommendation,
        confidence: decision.confidence,
        agent: decision.agent,
        rationale: decision.rationale,
        leadTimeNote: decision.leadTimeNote || null,
        savings: decision.savings || 0,
        savingsType: decision.savingsType || null,
        servedFromCache: decision.servedFromCache,
        latencyMs: decision.latencyMs,
      }))
    );
  } catch (err) {
    next(err);
  }
});

router.get("/:id", async (req, res, next) => {
  try {
    const pr = await store.getPurchaseRequest(req.params.id);
    if (!pr) return res.status(404).json({ error: "Purchase request not found" });
    const decision = await contextCache.getDecision(pr, { refresh: req.query.refresh === "true" });
    res.json({ pr, decision });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/review-later", async (req, res, next) => {
  try {
    const updated = await store.setPurchaseRequestStatus(req.params.id, "review_later");
    if (!updated) return res.status(404).json({ error: "Purchase request not found" });
    res.json({ pr: updated });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/accept", async (req, res, next) => {
  try {
    const pr = await store.getPurchaseRequest(req.params.id);
    if (!pr) return res.status(404).json({ error: "Purchase request not found" });
    const decision = await contextCache.getDecision(pr);
    const updated = await store.setPurchaseRequestStatus(pr.id, "accepted");
    await store.logBuyerAction({ pr, decision, action: "accepted" });
    if (decision.savings) {
      await store.addVerifiedSavings(
        decision.savings,
        `${pr.id} added ${`$${Math.round(decision.savings).toLocaleString()}`} of verified savings. Strong buyer decision.`
      );
    }
    res.json({ pr: updated, decision });
  } catch (err) {
    next(err);
  }
});

// Buyer rejects the agent's recommendation. Agent accuracy runs both
// ways — a reject is just as important to log as an accept, so the Trust
// Layer's buyer-behavior tracking (see store.getAgentAccuracy) has both
// sides of the ledger, not only accepted savings.
router.post("/:id/reject", async (req, res, next) => {
  try {
    const pr = await store.getPurchaseRequest(req.params.id);
    if (!pr) return res.status(404).json({ error: "Purchase request not found" });
    const decision = await contextCache.getDecision(pr);
    const updated = await store.setPurchaseRequestStatus(pr.id, "rejected");
    await store.logBuyerAction({ pr, decision, action: "rejected", reason: req.body?.reason });
    res.json({ pr: updated, decision });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/validate", async (req, res, next) => {
  try {
    const pr = await store.getPurchaseRequest(req.params.id);
    if (!pr) return res.status(404).json({ error: "Purchase request not found" });
    const supplier = await store.getSupplierByName(pr.currentSupplier.name);
    const validation = runValidationAgent(pr, supplier);
    res.json({ validation });
  } catch (err) {
    next(err);
  }
});

router.post("/:id/create-po", async (req, res, next) => {
  try {
    const pr = await store.getPurchaseRequest(req.params.id);
    if (!pr) return res.status(404).json({ error: "Purchase request not found" });

    const decision = await contextCache.getDecision(pr);
    const supplierName = decision.recommendedSupplier?.name || pr.currentSupplier.name;
    const supplier = await store.getSupplierByName(supplierName);
    const validation = runValidationAgent(pr, supplier);
    if (!validation.passed) {
      return res.status(409).json({ error: "Validation Agent has not cleared this PR yet", validation });
    }

    const unitPrice = decision.recommendedSupplier?.price ?? pr.currentSupplier.price;
    const po = await store.createPurchaseOrder({ pr, decision, supplierName, unitPrice });

    if (decision.savings) {
      await store.addVerifiedSavings(
        decision.savings,
        `${pr.id} added $${Math.round(decision.savings).toLocaleString()} of verified savings. Strong buyer decision.`
      );
    }

    res.status(201).json({ po, validation });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

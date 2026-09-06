const express = require("express");
const store = require("../services/store");
const contextCache = require("../services/contextCache");

const router = express.Router();

router.get("/summary", async (req, res, next) => {
  try {
    const prs = await store.getPurchaseRequests();
    const open = prs.filter((p) => p.status === "open");
    const decisions = await Promise.all(open.map((p) => contextCache.getDecision(p)));

    const savingsIdentified = decisions.reduce((sum, d) => sum + (d.savings || 0), 0);
    const oversupplyAlerts = decisions.filter((d) => d.recommendation === "dont_buy").length;
    const highPriority = open.filter((p) => p.urgent).length;
    const pos = await store.getPurchaseOrders();

    res.json({
      prWaiting: open.length,
      highPriorityCount: highPriority,
      savingsIdentified: Math.round(savingsIdentified),
      oversupplyAlerts,
      posCreatedThisMonth: pos.length,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

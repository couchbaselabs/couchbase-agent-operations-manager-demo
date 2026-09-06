const express = require("express");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const suppliers = await store.getSuppliers();
    const prs = await store.getPurchaseRequests();
    const enriched = suppliers.map((s) => ({
      ...s,
      openPrs: prs.filter((p) => p.currentSupplier?.name === s.name && p.status === "open").length,
    }));
    res.json(enriched);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

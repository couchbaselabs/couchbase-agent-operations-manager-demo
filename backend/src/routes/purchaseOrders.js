const express = require("express");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const pos = await store.getPurchaseOrders();
    res.json(pos);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

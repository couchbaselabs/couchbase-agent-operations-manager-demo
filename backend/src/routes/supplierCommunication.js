const express = require("express");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const comms = await store.getSupplierCommunications();
    res.json(comms);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

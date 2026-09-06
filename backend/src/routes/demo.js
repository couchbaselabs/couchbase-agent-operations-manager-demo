/**
 * Admin-only Settings → Demo controls. See services/demo.js for what
 * "the demo" actually does and why its cache-hit rate is expected to
 * cross 90%. Mounted behind requireAuth + requireAdmin in server.js, same
 * as the rest of Settings.
 */

const express = require("express");
const demo = require("../services/demo");

const router = express.Router();

router.get("/status", (req, res) => {
  res.json(demo.status());
});

router.post("/start", async (req, res, next) => {
  try {
    res.json(await demo.start());
  } catch (err) {
    next(err);
  }
});

router.post("/stop", (req, res) => {
  res.json(demo.stop());
});

module.exports = router;

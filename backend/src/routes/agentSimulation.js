/**
 * Admin-only Settings → Agent Simulation controls. See
 * services/agentSimulation.js for what this actually does. Mounted
 * behind requireAuth + requireAdmin in server.js, same as the rest of
 * Settings (including the existing cache-hit-rate Demo it sits next to).
 */

const express = require("express");
const agentSimulation = require("../services/agentSimulation");

const router = express.Router();

router.get("/status", (req, res) => {
  res.json(agentSimulation.status());
});

router.post("/start", async (req, res, next) => {
  try {
    res.json(await agentSimulation.start());
  } catch (err) {
    next(err);
  }
});

router.post("/stop", (req, res) => {
  res.json(agentSimulation.stop());
});

module.exports = router;

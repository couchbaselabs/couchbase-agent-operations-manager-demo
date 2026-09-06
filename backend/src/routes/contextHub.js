/**
 * AI Architecture / Context Hub route.
 *
 * Surfaces the architecture modeled behind this app — the 5-layer Context
 * Hub, the Trust Layer, the business-rule catalog, the AI Data Plane
 * phased journey, the business-unit / LMN process mapping, and the agent
 * build-out roadmap — so it's visible in the app itself, not only in the
 * README. See backend/src/data/seed.js for the source data.
 */
const express = require("express");
const seed = require("../data/seed");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const agents = await store.getAiAgents();
    res.json({
      contextHub: seed.CONTEXT_HUB,
      trustLayer: seed.TRUST_LAYER,
      businessRules: seed.BUSINESS_RULES,
      aiDataPlaneJourney: seed.AI_DATA_PLANE_JOURNEY,
      businessUnits: seed.BUSINESS_UNITS,
      lmnProcesses: seed.LMN_PROCESSES,
      procurementCommandCenterProcess: seed.PROCUREMENT_COMMAND_CENTER_PROCESS,
      agentRoadmap: seed.AGENT_ROADMAP,
      agents,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

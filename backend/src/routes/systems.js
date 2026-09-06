const express = require("express");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const [systems, agents] = await Promise.all([store.getConnectedSystems(), store.getAiAgents()]);
    res.json({ systems, agents });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

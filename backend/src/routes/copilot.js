const express = require("express");
const copilot = require("../services/copilot");

const router = express.Router();

router.post("/chat", async (req, res, next) => {
  try {
    const { prId, message, quickAction } = req.body || {};
    const result = await copilot.chat({ prId, message, quickAction });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

module.exports = router;

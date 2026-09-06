const express = require("express");
const store = require("../services/store");

const router = express.Router();

router.get("/", async (req, res, next) => {
  try {
    const state = await store.getGamificationState();
    const buyer = await store.getBuyer();
    const verified = state.verifiedSavingsThisWeek || 0;
    const agentAccuracy = await store.getAgentAccuracy();
    const hungerGames = await store.getHungerGamesLeaderboard();
    res.json({
      verifiedThisWeek: verified,
      weeklyQuestGoal: state.weeklyQuestGoal,
      weeklyQuestPct: Math.min(100, Math.round((verified / state.weeklyQuestGoal) * 100)),
      status: verified >= state.weeklyQuestGoal ? "Savings Leader" : "In progress",
      streakDays: 4,
      team: state.team,
      teamMonthlyGoal: state.teamMonthlyGoal,
      teamProgress: Math.min(100, Math.round((170000 / state.teamMonthlyGoal) * 100)),
      teamRaised: 170000,
      yourContribution: 26500,
      buyer,
      recognitionFeed: state.recognitionFeed || [],
      // Agent accuracy: "the accuracy of agent, it goes both ways" (Vivek K)
      // — computed from real accept/reject events logged this session.
      agentAccuracy,
      // "Hunger Games" — Bhavik Shah: "Vivek is planning to schedule Hunger
      // Games with it. Basically competitions ... within the business
      // units, how much they're using." Verified savings by business unit,
      // from the same buyer-action log.
      hungerGames,
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

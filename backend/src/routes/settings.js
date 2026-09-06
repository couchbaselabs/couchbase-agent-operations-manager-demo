/**
 * Admin-only settings: local account and role management. Everything
 * here is mounted behind requireAuth + requireAdmin in server.js.
 */

const express = require("express");
const store = require("../services/store");

const router = express.Router();

const VALID_ROLES = ["admin", "buyer", "viewer"];

/* ---------------- Users & roles ---------------- */

router.get("/users", async (req, res, next) => {
  try {
    res.json(await store.listUsers());
  } catch (err) {
    next(err);
  }
});

router.post("/users", async (req, res, next) => {
  try {
    const { username, role, password } = req.body || {};
    if (!username || !VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `username and a role in [${VALID_ROLES.join(", ")}] are required` });
    }
    if (password && String(password).length < 8) {
      return res.status(400).json({ error: "password must be at least 8 characters (or omit it to require the user to set one at first login)" });
    }
    const user = await store.createUser({ username, role, password });
    res.status(201).json(user);
  } catch (err) {
    if (/already exists/.test(err.message)) return res.status(409).json({ error: err.message });
    next(err);
  }
});

router.put("/users/:username/role", async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of [${VALID_ROLES.join(", ")}]` });
    }
    res.json(await store.updateUserRole(req.params.username, role));
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.post("/users/:username/reset-password", async (req, res, next) => {
  try {
    const { newPassword } = req.body || {};
    if (!newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: "newPassword must be at least 8 characters" });
    }
    res.json(await store.setUserPassword(req.params.username, newPassword));
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: err.message });
    next(err);
  }
});

router.delete("/users/:username", async (req, res, next) => {
  try {
    if (req.params.username === req.user.username) {
      return res.status(400).json({ error: "You cannot delete your own account while signed in as it." });
    }
    await store.deleteUser(req.params.username);
    res.json({ ok: true });
  } catch (err) {
    if (/not found/.test(err.message)) return res.status(404).json({ error: err.message });
    if (/last remaining admin/.test(err.message)) return res.status(400).json({ error: err.message });
    next(err);
  }
});

module.exports = router;

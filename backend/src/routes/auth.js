const express = require("express");
const store = require("../services/store");
const auth = require("../services/auth");
const { COOKIE_NAME, requireAuth } = require("../middleware/auth");

const router = express.Router();

function setSessionCookie(res, sessionDoc) {
  res.cookie(COOKIE_NAME, sessionDoc.id, {
    httpOnly: true,
    sameSite: "lax",
    // Set COOKIE_SECURE=1 once this is served over TLS (e.g. behind a
    // reverse proxy terminating HTTPS) -- left off by default so local
    // http://localhost:8080 dev/demo access keeps working.
    secure: process.env.COOKIE_SECURE === "1",
    maxAge: auth.SESSION_TTL_MS,
  });
}

/**
 * POST /api/auth/login { username, password }
 *
 * Local accounts only: the username must resolve to a local_user record
 * with source "local", and the password is verified against that
 * record's stored hash. An account that has never set a password gets
 * the mustSetPassword handshake instead (see POST /set-password).
 */
router.post("/login", async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || typeof username !== "string") {
      return res.status(400).json({ error: "username is required" });
    }

    const localUser = await store.getUserByUsername(username);
    if (!localUser || localUser.source !== "local") {
      return res.status(401).json({ error: "Invalid username or password" });
    }
    if (localUser.mustSetPassword || !localUser.passwordEncrypted) {
      return res.json({ mustSetPassword: true, username: localUser.username });
    }
    if (!password || !auth.verifyPassword(password, localUser.passwordEncrypted)) {
      return res.status(401).json({ error: "Invalid username or password" });
    }

    const { doc } = auth.newSession(localUser);
    await store.createSession(doc);
    setSessionCookie(res, doc);
    res.json({ user: { username: localUser.username, role: localUser.role, source: localUser.source } });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/auth/set-password { username, newPassword }
 *
 * Only succeeds for an account currently in the "must set password on
 * first login" state (the seeded default admin, or any local account an
 * admin created without an initial password) -- once a password has been
 * set this always 400s, so it can't be replayed to reset an existing
 * account's password. Logs the user in immediately on success.
 */
router.post("/set-password", async (req, res, next) => {
  try {
    const { username, newPassword } = req.body || {};
    if (!username || !newPassword || String(newPassword).length < 8) {
      return res.status(400).json({ error: "username and a newPassword of at least 8 characters are required" });
    }
    const user = await store.getUserByUsername(username);
    if (!user || user.source !== "local" || !user.mustSetPassword) {
      return res.status(400).json({ error: "This account is not awaiting an initial password." });
    }
    const updated = await store.setUserPassword(username, newPassword);
    const { doc } = auth.newSession(updated);
    await store.createSession(doc);
    setSessionCookie(res, doc);
    res.json({ user: { username: updated.username, role: updated.role, source: updated.source } });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await store.deleteSession(req.sessionId);
    res.clearCookie(COOKIE_NAME);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", async (req, res, next) => {
  try {
    const sid = req.cookies && req.cookies[COOKIE_NAME];
    if (!sid) return res.json({ authenticated: false });
    const session = await store.getSession(sid);
    if (!session || auth.isSessionExpired(session)) {
      return res.json({ authenticated: false });
    }
    res.json({ authenticated: true, user: { username: session.username, role: session.role } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

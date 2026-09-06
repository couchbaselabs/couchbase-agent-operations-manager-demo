/**
 * Session-cookie auth gate. A session is an opaque random token (see
 * services/auth.js) stored server-side as a `session::<id>` document --
 * requireAuth looks it up on every request, checks expiry, and attaches
 * the resolved { id, username, role } as req.user.
 */

const store = require("../services/store");
const { isSessionExpired } = require("../services/auth");

const COOKIE_NAME = "couchbase_pcc_session";

async function requireAuth(req, res, next) {
  try {
    const sid = req.cookies && req.cookies[COOKIE_NAME];
    if (!sid) return res.status(401).json({ error: "Not authenticated" });

    const session = await store.getSession(sid);
    if (!session || isSessionExpired(session)) {
      if (session) await store.deleteSession(sid).catch(() => {});
      res.clearCookie(COOKIE_NAME);
      return res.status(401).json({ error: "Session expired" });
    }

    req.user = { id: session.userId, username: session.username, role: session.role };
    req.sessionId = sid;
    next();
  } catch (err) {
    next(err);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Not authenticated" });
  if (req.user.role !== "admin") return res.status(403).json({ error: "Admin role required" });
  next();
}

module.exports = { requireAuth, requireAdmin, COOKIE_NAME };

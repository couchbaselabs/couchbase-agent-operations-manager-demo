/**
 * Password hashing + session token helpers for local login.
 *
 * Hashing uses Node's built-in scrypt (no bcrypt/argon2 dependency needed
 * -- keeps this in line with the rest of the backend's "avoid native
 * bindings in a small Alpine image" stance, see db/couchbase.js). The
 * resulting salt:hash string is then AES-256-GCM encrypted (services/
 * crypto.js) before it's ever written to Couchbase, satisfying
 * "encrypted at rest" on top of the hashing itself.
 *
 * Sessions are opaque random tokens stored server-side as `session::<id>`
 * documents (see store.js) -- not signed JWTs -- so a session can be
 * revoked immediately (logout, password reset) just by deleting its
 * document, and no secret ever needs to be shipped to the browser beyond
 * the random token itself.
 */

const crypto = require("crypto");
const cryptoUtil = require("./crypto");

const SCRYPT_KEYLEN = 64;
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  const combined = `${salt.toString("hex")}:${hash.toString("hex")}`;
  return cryptoUtil.encrypt(combined);
}

function verifyPassword(password, encryptedBlob) {
  if (!encryptedBlob) return false;
  let combined;
  try {
    combined = cryptoUtil.decrypt(encryptedBlob);
  } catch (err) {
    return false;
  }
  const [saltHex, hashHex] = combined.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN);
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function newSessionId() {
  return crypto.randomBytes(32).toString("hex");
}

function newSession(user) {
  const id = newSessionId();
  const now = Date.now();
  return {
    id,
    doc: {
      type: "session",
      id,
      userId: user.id,
      username: user.username,
      role: user.role,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    },
  };
}

function isSessionExpired(sessionDoc) {
  return !sessionDoc || typeof sessionDoc.expiresAt !== "number" || sessionDoc.expiresAt < Date.now();
}

module.exports = {
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  newSession,
  isSessionExpired,
};

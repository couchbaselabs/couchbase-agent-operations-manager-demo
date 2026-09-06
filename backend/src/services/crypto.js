/**
 * AES-256-GCM helpers used to encrypt sensitive fields (local password
 * hashes) before they're written to Couchbase, so
 * a raw look at a document/backup never shows usable secrets -- only a
 * ciphertext blob that's useless without ENCRYPTION_KEY.
 *
 * This is encryption-at-rest for *values inside* documents, layered on top
 * of (not a replacement for) proper password hashing -- see auth.js, which
 * scrypt-hashes the password first and then encrypts that hash with this
 * module, so a leaked ENCRYPTION_KEY alone still doesn't hand over
 * plaintext passwords, and a leaked database dump alone (without the key)
 * reveals nothing at all.
 */

const crypto = require("crypto");

const ALGO = "aes-256-gcm";
const IV_LEN = 12; // recommended nonce size for GCM
const KEY_ENV = "ENCRYPTION_KEY";

// Dev-only fallback so `docker compose up` keeps working with zero config,
// exactly like COUCHBASE_PASSWORD's "password123" default elsewhere in
// this app. Anything beyond local dev/demo MUST set ENCRYPTION_KEY (64 hex
// chars = 32 bytes) in the environment -- see .env.example.
const INSECURE_DEV_DEFAULT_KEY =
  "0000000000000000000000000000000000000000000000000000000000aa";

let warned = false;

function getKey() {
  const raw = process.env[KEY_ENV] || INSECURE_DEV_DEFAULT_KEY;
  if (raw === INSECURE_DEV_DEFAULT_KEY && !warned) {
    warned = true;
    // eslint-disable-next-line no-console
    console.warn(
      `[crypto] ${KEY_ENV} is not set -- using an INSECURE built-in dev key to encrypt ` +
        `local password hashes at rest. Set ${KEY_ENV} to a random 32-byte hex string ` +
        "(e.g. `openssl rand -hex 32`) for anything beyond local dev/demo."
    );
  }
  const key = Buffer.from(raw, "hex");
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must be 32 bytes of hex (64 hex characters); got ${key.length} bytes.`);
  }
  return key;
}

/** Encrypt a UTF-8 string, returning a single base64 blob (iv || authTag || ciphertext). */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

/** Reverse of encrypt(). Throws if the blob is malformed or the key doesn't match. */
function decrypt(blob) {
  const key = getKey();
  const buf = Buffer.from(blob, "base64");
  const iv = buf.subarray(0, IV_LEN);
  const authTag = buf.subarray(IV_LEN, IV_LEN + 16);
  const ciphertext = buf.subarray(IV_LEN + 16);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };

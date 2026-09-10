// Application-level encryption for sensitive-at-rest fields (AES-256-GCM).
// First such utility in this codebase - added for the Vendor KYC feature
// (Ryan, Sept 2026) since national ID/business registration numbers were
// previously stored as plain text on vendors.national_id_number/
// registration_number. Not used for passwords (bcrypt stays as is, it's
// one-way by design) - this is for data the app needs to read back.
//
// Requires KYC_ENCRYPTION_KEY in the environment: a 64-character hex
// string (32 raw bytes) - generate one with `openssl rand -hex 32` and
// set it on Render (Environment tab), never commit it or paste it into
// chat/logs. The same key must decrypt what it encrypted, so losing it
// means every encrypted KYC value becomes permanently unreadable - keep
// a backup of it somewhere safe outside the repo.
//
// A second, distinct key is derived from it (SHA-256 of the encryption
// key plus a fixed label) for the deterministic "blind index" hash used
// to look up/dedupe encrypted values without decrypting them - see
// hashForLookup() below and migrations/079_vendor_kyc.sql's comment on
// why a hash column sits alongside each encrypted one.

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // recommended IV length for GCM

function getEncryptionKey() {
    const hex = process.env.KYC_ENCRYPTION_KEY;
    if (!hex) {
        throw new Error("KYC_ENCRYPTION_KEY is not set - required to encrypt/decrypt vendor KYC data.");
    }
    const key = Buffer.from(hex, "hex");
    if (key.length !== 32) {
        throw new Error("KYC_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). Generate one with `openssl rand -hex 32`.");
    }
    return key;
}

function getHashKey() {
    // Derived, not a second env var to manage/rotate separately - a plain
    // SHA-256 of the encryption key plus a fixed label is one-way, so
    // knowing the hash key alone doesn't help recover the encryption key.
    return crypto.createHash("sha256").update(getEncryptionKey().toString("hex") + ":kyc-lookup-hash").digest();
}

// Encrypts a plaintext string, returning one self-contained string
// carrying the IV and auth tag alongside the ciphertext
// (iv:tag:ciphertext, each base64) - decrypt() needs nothing but this
// string and the env key.
function encryptField(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === "") return null;
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${authTag.toString("base64")}:${ciphertext.toString("base64")}`;
}

function decryptField(stored) {
    if (!stored) return null;
    const key = getEncryptionKey();
    const [ivB64, tagB64, ciphertextB64] = stored.split(":");
    if (!ivB64 || !tagB64 || !ciphertextB64) {
        throw new Error("Malformed encrypted value - expected iv:tag:ciphertext.");
    }
    const iv = Buffer.from(ivB64, "base64");
    const authTag = Buffer.from(tagB64, "base64");
    const ciphertext = Buffer.from(ciphertextB64, "base64");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
}

// Deterministic, one-way "blind index" for equality lookups (dedup
// checks) on an encrypted field without ever decrypting anything for
// that purpose. Normalizes the same way the old plaintext dedup did
// (migration 054: LOWER(TRIM(...))) so behaviour doesn't silently change.
function hashForLookup(plaintext) {
    if (plaintext === null || plaintext === undefined || plaintext === "") return null;
    const normalized = String(plaintext).trim().toLowerCase();
    if (!normalized) return null;
    return crypto.createHmac("sha256", getHashKey()).update(normalized).digest("hex");
}

module.exports = { encryptField, decryptField, hashForLookup };

const test = require("node:test");
const assert = require("node:assert/strict");

// A fixed, deterministic 32-byte key for the test run only - never a
// real secret. encryption.js reads this at call time (not at require
// time), so setting it before each test is enough.
process.env.KYC_ENCRYPTION_KEY = "0".repeat(64);

const { encryptField, decryptField, hashForLookup } = require("../server/utils/encryption.js");

test("encryptField/decryptField: round-trips a plaintext value", () => {
    const encrypted = encryptField("CM12345678AB");
    assert.notEqual(encrypted, "CM12345678AB");
    assert.equal(decryptField(encrypted), "CM12345678AB");
});

test("encryptField: null/undefined/empty string all encrypt to null", () => {
    assert.equal(encryptField(null), null);
    assert.equal(encryptField(undefined), null);
    assert.equal(encryptField(""), null);
});

test("decryptField: null/undefined/empty string all decrypt to null", () => {
    assert.equal(decryptField(null), null);
    assert.equal(decryptField(undefined), null);
    assert.equal(decryptField(""), null);
});

test("encryptField: the same plaintext encrypts differently each time (random IV)", () => {
    const a = encryptField("CM12345678AB");
    const b = encryptField("CM12345678AB");
    assert.notEqual(a, b);
    assert.equal(decryptField(a), "CM12345678AB");
    assert.equal(decryptField(b), "CM12345678AB");
});

test("decryptField: throws on a malformed stored value", () => {
    assert.throws(() => decryptField("not-a-valid-format"));
});

test("decryptField: throws (auth tag check fails) on tampered ciphertext", () => {
    const encrypted = encryptField("CM12345678AB");
    const [iv, tag, ciphertext] = encrypted.split(":");
    const tampered = `${iv}:${tag}:${Buffer.from("tampered").toString("base64")}`;
    assert.throws(() => decryptField(tampered));
});

test("hashForLookup: null/undefined/empty/whitespace-only all hash to null", () => {
    assert.equal(hashForLookup(null), null);
    assert.equal(hashForLookup(undefined), null);
    assert.equal(hashForLookup(""), null);
    assert.equal(hashForLookup("   "), null);
});

test("hashForLookup: same value always hashes the same (deterministic, unlike encryptField)", () => {
    const a = hashForLookup("CM12345678AB");
    const b = hashForLookup("CM12345678AB");
    assert.equal(a, b);
});

test("hashForLookup: case and surrounding whitespace don't change the hash (matches old LOWER(TRIM()) dedup behaviour)", () => {
    assert.equal(hashForLookup("CM12345678AB"), hashForLookup("cm12345678ab"));
    assert.equal(hashForLookup("CM12345678AB"), hashForLookup("  CM12345678AB  "));
});

test("hashForLookup: different values hash differently", () => {
    assert.notEqual(hashForLookup("CM12345678AB"), hashForLookup("CM99999999XY"));
});

test("getEncryptionKey: throws a clear error when KYC_ENCRYPTION_KEY is unset", () => {
    const saved = process.env.KYC_ENCRYPTION_KEY;
    delete process.env.KYC_ENCRYPTION_KEY;
    try {
        assert.throws(() => encryptField("anything"), /KYC_ENCRYPTION_KEY is not set/);
    } finally {
        process.env.KYC_ENCRYPTION_KEY = saved;
    }
});

test("getEncryptionKey: throws a clear error when KYC_ENCRYPTION_KEY is the wrong length", () => {
    const saved = process.env.KYC_ENCRYPTION_KEY;
    process.env.KYC_ENCRYPTION_KEY = "abcd";
    try {
        assert.throws(() => encryptField("anything"), /64-character hex string/);
    } finally {
        process.env.KYC_ENCRYPTION_KEY = saved;
    }
});

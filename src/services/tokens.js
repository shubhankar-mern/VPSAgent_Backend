const crypto = require("crypto");

function createAgentToken() {
  // 32 cryptographically-random bytes, URL-safe encoding.
  return crypto.randomBytes(32).toString("base64url");
}

function hashAgentToken(token) {
  return crypto.createHash("sha256").update(token, "utf8").digest("hex");
}

module.exports = { createAgentToken, hashAgentToken };

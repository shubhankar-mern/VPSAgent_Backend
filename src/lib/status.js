const OFFLINE_AFTER_MS = Number(process.env.AGENT_OFFLINE_AFTER_SECONDS || 45) * 1000;

// The agent posts every 15s; three missed intervals means the box is gone.
function deriveStatus(record, now = Date.now()) {
  if (!record) return "unknown";
  if (record.status === "revoked") return "revoked";
  if (!record.lastSeen) return "pending";
  return now - Number(record.lastSeen) <= OFFLINE_AFTER_MS ? "online" : "offline";
}

module.exports = { deriveStatus, OFFLINE_AFTER_MS };
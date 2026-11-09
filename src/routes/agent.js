const express = require("express");
const { z } = require("zod");
const { db } = require("../services/firebase");
const { findServerForToken } = require("../services/agentAuth");

const router = express.Router();

const metricsSchema = z.object({
  agentVersion: z.string().max(40).optional(),
  serverName: z.string().max(120).optional(),
  collectedAt: z.string().datetime().optional(),
  host: z.record(z.any()).optional(),
  cpu: z.record(z.any()).optional(),
  memory: z.record(z.any()).optional(),
  swap: z.record(z.any()).optional(),
  load: z.record(z.any()).optional(),
  disks: z.array(z.record(z.any())).max(100).optional(),
  diskIO: z.array(z.record(z.any())).max(100).optional(),
  networks: z.array(z.record(z.any())).max(100).optional(),
  processes: z.array(z.record(z.any())).max(200).optional(),
  collectionErrors: z.record(z.string()).optional(),
}).passthrough();

router.post("/metrics", async (req, res, next) => {
  try {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) return res.status(401).json({ error: "Missing agent bearer token." });

    const identity = await findServerForToken(match[1]);
    if (!identity) return res.status(401).json({ error: "Invalid or revoked agent token." });

    const parsed = metricsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid metrics payload.",
        details: parsed.error.issues.slice(0, 10).map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const { uid, serverId } = identity;
    const receivedAt = Date.now();
    const metrics = {
      ...parsed.data,
      receivedAt,
      collectedAt: parsed.data.collectedAt || new Date(receivedAt).toISOString(),
    };

    const updates = {};
    updates[`users/${uid}/liveMetrics/${serverId}`] = metrics;
    updates[`users/${uid}/servers/${serverId}/lastSeen`] = receivedAt;
    updates[`users/${uid}/servers/${serverId}/status`] = "online";
    if (parsed.data.agentVersion) {
      updates[`users/${uid}/servers/${serverId}/agentVersion`] = parsed.data.agentVersion;
    }
    if (parsed.data.host?.hostname) {
      updates[`users/${uid}/servers/${serverId}/reportedHostname`] = parsed.data.host.hostname;
    }

    await db().ref().update(updates);
    res.status(202).json({ accepted: true, serverId, receivedAt });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

const express = require("express");
const { z } = require("zod");
const { db } = require("../services/firebase");
const { requireFirebaseUser } = require("../middleware/requireFirebaseUser");
const { createAgentToken, hashAgentToken } = require("../services/tokens");
const { deriveStatus, OFFLINE_AFTER_MS } = require("../lib/status");
 const { serverLimitFor, countActiveServers } = require("../services/billing");
const router = express.Router();

const registerSchema = z.object({
  name: z.string().trim().min(1).max(80),
  hostname: z.string().trim().max(255).optional().default(""),
  os: z.string().trim().max(120).optional().default(""),
  architecture: z.string().trim().max(40).optional().default(""),
}).strict();

function buildAgentConfig(serverName, token) {
  return {
    apiUrl: process.env.PUBLIC_API_URL || `http://localhost:${process.env.PORT || 5000}`,
    metricsPath: "/api/agent/metrics",
    agentToken: token,
    serverName,
    intervalSeconds: 15,
    timeoutSeconds: 10,
    maxProcesses: 10,
  };
}

function present(id, record) {
  return { id, ...record, status: deriveStatus(record) };
}

router.use(requireFirebaseUser);

router.get("/", async (req, res, next) => {
  try {
    const snapshot = await db().ref(`users/${req.user.uid}/servers`).once("value");
    const servers = snapshot.exists()
      ? Object.entries(snapshot.val())
          .map(([id, server]) => present(id, server))
          .filter((server) => server.status !== "revoked")
      : [];
    servers.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    res.json({ servers, meta: { offlineAfterMs: OFFLINE_AFTER_MS, serverTime: Date.now() } });
  } catch (error) {
    next(error);
  }
});

router.get("/:serverId", async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const snapshot = await db().ref(`users/${req.user.uid}/servers/${serverId}`).once("value");
    if (!snapshot.exists()) return res.status(404).json({ error: "Server not found." });
    res.json({ server: present(serverId, snapshot.val()) });
  } catch (error) {
    next(error);
  }
});

router.post("/", async (req, res, next) => {
  try {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Invalid server details.",
        details: parsed.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

       const uid = req.user.uid;

    const [billingSnapshot, serversSnapshot] = await Promise.all([
      db().ref(`users/${uid}/billing`).once("value"),
      db().ref(`users/${uid}/servers`).once("value"),
    ]);
    const billing = billingSnapshot.val() || null;
    const serverLimit = serverLimitFor(billing);
    const usedServers = countActiveServers(serversSnapshot.val());

    if (usedServers >= serverLimit) {
      return res.status(402).json({
        error:
          serverLimit === 0
            ? "An active subscription is required to register a server."
            : `Your ${billing?.planName || "current"} plan covers ${serverLimit} server${
                serverLimit === 1 ? "" : "s"
              }. Upgrade to add more.`,
        code: "PLAN_LIMIT_REACHED",
        planId: billing?.planId || null,
        serverLimit,
        usedServers,
      });
    }

    
   // const uid = req.user.uid;
    const serverRef = db().ref(`users/${uid}/servers`).push();
    const serverId = serverRef.key;
    const token = createAgentToken();
    const now = Date.now();

    const serverRecord = {
      name: parsed.data.name,
      hostname: parsed.data.hostname || null,
      os: parsed.data.os || null,
      architecture: parsed.data.architecture || null,
      status: "pending",
      createdAt: now,
      lastSeen: null,
      agentVersion: null,
    };

    // The raw token is returned only in this response. Only its SHA-256 hash
    // is persisted under the serverAuth path, which client rules deny.
    const updates = {};
    updates[`users/${uid}/servers/${serverId}`] = serverRecord;
    updates[`serverAuth/${serverId}`] = {
      uid,
      tokenHash: hashAgentToken(token),
      createdAt: now,
      revoked: false,
    };

    await db().ref().update(updates);

    return res.status(201).json({
      server: { id: serverId, ...serverRecord },
      agentToken: token,
      tokenNotice: "Copy this token now. It will not be returned by the API again.",
      agentConfig: buildAgentConfig(parsed.data.name, token),
    });
  } catch (error) {
    next(error);
  }
});

router.post("/:serverId/rotate-token", async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const serverSnapshot = await db().ref(`users/${req.user.uid}/servers/${serverId}`).once("value");
    if (!serverSnapshot.exists()) return res.status(404).json({ error: "Server not found." });

    const server = serverSnapshot.val();
    if (server.status === "revoked") {
      return res.status(409).json({ error: "This server has been revoked. Register a new one." });
    }

    const token = createAgentToken();
    const now = Date.now();
    const updates = {};
    updates[`serverAuth/${serverId}`] = {
      uid: req.user.uid,
      tokenHash: hashAgentToken(token),
      createdAt: now,
      rotatedAt: now,
      revoked: false,
    };
    updates[`users/${req.user.uid}/servers/${serverId}/status`] = "pending";
    updates[`users/${req.user.uid}/servers/${serverId}/lastSeen`] = null;
    await db().ref().update(updates);

    res.json({
      serverId,
      agentToken: token,
      tokenNotice: "The previous token is now invalid. Update the agent config and restart the agent.",
      agentConfig: buildAgentConfig(server.name, token),
    });
  } catch (error) {
    next(error);
  }
});

router.delete("/:serverId", async (req, res, next) => {
  try {
    const { serverId } = req.params;
    const serverRef = db().ref(`users/${req.user.uid}/servers/${serverId}`);
    const snapshot = await serverRef.once("value");
    if (!snapshot.exists()) return res.status(404).json({ error: "Server not found." });

    const updates = {};
    updates[`serverAuth/${serverId}`] = null;
    updates[`users/${req.user.uid}/liveMetrics/${serverId}`] = null;
    updates[`users/${req.user.uid}/servers/${serverId}/status`] = "revoked";
    updates[`users/${req.user.uid}/servers/${serverId}/revokedAt`] = Date.now();
    await db().ref().update(updates);
    res.json({ success: true, serverId, status: "revoked" });
  } catch (error) {
    next(error);
  }
});

module.exports = router;
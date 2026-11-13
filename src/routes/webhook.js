const express = require("express");
const crypto = require("node:crypto");
const { db } = require("../services/firebase");
const { getAdmin } = require("../services/firebase");
const { applySubscriptionEvent } = require("../services/billing");
const { isOwnerUid } = require("../config/owner");
const router = express.Router();
const TOLERANCE_SECONDS = 5 * 60;

function verifySignature(rawBody, headers) {
  const secret = process.env.DODO_WEBHOOK_KEY;
  if (!secret) return false;

  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!id || !timestamp || !signatureHeader) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto
    .createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  return String(signatureHeader).split(" ").some((part) => {
    const [version, signature] = part.split(",");
    if (version !== "v1" || !signature) return false;
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  });
}

async function resolveUid(subscription) {
  const subscriptionId = subscription?.subscription_id;
  if (subscriptionId) {
    const snap = await db().ref(`billingIndex/subscription/${subscriptionId}`).once("value");
    if (snap.exists()) return snap.val();
  }
  if (subscription?.metadata?.uid) return subscription.metadata.uid;

  const customerId = subscription?.customer?.customer_id;
  if (customerId) {
    const snap = await db().ref(`billingIndex/customer/${customerId}`).once("value");
    if (snap.exists()) return snap.val();
  }

  const email = subscription?.customer?.email;
  if (email) {
    try { return (await getAdmin().auth().getUserByEmail(email)).uid; } catch { /* unknown user */ }
  }
  return null;
}

router.post("/dodo", express.raw({ type: "*/*" }), async (req, res, next) => {
  try {
    const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";
    if (!rawBody || !verifySignature(rawBody, req.headers)) {
      return res.status(401).json({ error: "Invalid webhook signature." });
    }

    let event;
    try { event = JSON.parse(rawBody); } catch { return res.status(400).json({ error: "Invalid JSON." }); }

    const webhookId = req.headers["webhook-id"];
    const seen = await db().ref(`billingWebhooks/${webhookId}`).once("value");
    if (seen.exists()) return res.json({ received: true, duplicate: true });

    const type = event.type || "";
    if (!type.startsWith("subscription.")) {
      await db().ref(`billingWebhooks/${webhookId}`).set(Date.now());
      return res.json({ received: true, ignored: true });
    }

    const subscription = event.data || {};
    const uid = await resolveUid(subscription);
    if (!uid) {
      await db().ref(`billingOrphans/${subscription.subscription_id || webhookId}`).set({
        type, receivedAt: Date.now(), subscription,
      });
      console.error(`Billing webhook ${webhookId} could not be attributed to a user.`);
      return res.json({ received: true, orphaned: true });
    }
        if (isOwnerUid(uid)) {
      await db().ref(`billingWebhooks/${webhookId}`).set(Date.now());
      return res.json({ received: true, ignored: true, reason: "owner-account" });
    }
    const eventTimestamp = Date.parse(event.timestamp) || Date.now();
    await applySubscriptionEvent({ uid, type, eventTimestamp, subscription });
    await db().ref(`billingWebhooks/${webhookId}`).set(eventTimestamp);

    res.json({ received: true });
  } catch (error) { next(error); }
});

module.exports = router;
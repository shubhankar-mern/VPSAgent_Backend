const express = require("express");
const { db } = require("../services/firebase");
const { requireFirebaseUser } = require("../middleware/requireFirebaseUser");
const { listPlans, getPlanById } = require("../config/plans");
const { isEntitled, countActiveServers, resolveEntitlement } = require("../services/billing");
const { isOwnerUid } = require("../config/owner");
const { createCheckoutSession, createPortalLink } = require("../services/dodo");

const router = express.Router();
const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/+$/, "");

router.get("/plans", (_req, res) => {
  res.set("Cache-Control", "public, max-age=300");
  res.json({ plans: listPlans(), currency: "USD", interval: "month" });
});

router.use(requireFirebaseUser);

router.get("/status", async (req, res, next) => {
  try {
    const [billingSnap, serversSnap] = await Promise.all([
      db().ref(`users/${req.user.uid}/billing`).once("value"),
      db().ref(`users/${req.user.uid}/servers`).once("value"),
    ]);
        const billing = billingSnap.val() || null;
    const usedServers = countActiveServers(serversSnap.val());
    const entitlement = resolveEntitlement(req.user.uid, billing);
    res.json({
      billing: entitlement.billing,
      entitlement: {
        active: entitlement.active,
        serverLimit: entitlement.serverLimit,
        usedServers,
        canAddServer: usedServers < entitlement.serverLimit,
        isOwner: entitlement.isOwner,
      },
    });
  } catch (error) { next(error); }
});

router.post("/checkout", async (req, res, next) => {
  try {
        if (isOwnerUid(req.user.uid)) {
      return res.status(409).json({
        error: "Owner accounts already have full access. No subscription is required.",
        code: "OWNER_ACCOUNT",
      });
    }
    const plan = getPlanById(req.body?.planId);
    if (!plan) return res.status(400).json({ error: "Unknown plan." });
    if (!plan.productId) return res.status(503).json({ error: "Billing is not configured for this plan." });
    if (!req.user.email) return res.status(400).json({ error: "Add an email address to your account first." });

    const billing = (await db().ref(`users/${req.user.uid}/billing`).once("value")).val();
    if (isEntitled(billing)) {
      return res.status(409).json({
        error: "You already have an active subscription. Manage it from Billing.",
        code: "SUBSCRIPTION_ACTIVE",
        planId: billing?.planId || null,
      });
    }

    const { checkoutUrl } = await createCheckoutSession({
      uid: req.user.uid, email: req.user.email, name: req.user.name,
      plan, frontendUrl: FRONTEND_URL,
    });
    if (!checkoutUrl) return res.status(502).json({ error: "Dodo did not return a checkout URL." });
    res.json({ checkoutUrl, planId: plan.id });
  } catch (error) { next(error); }
});

router.post("/portal", async (req, res, next) => {
  try {
    const billing = (await db().ref(`users/${req.user.uid}/billing`).once("value")).val();
    if (!billing?.customerId) {
    //       if (isOwnerUid(req.user.uid)) {
    //   return res.status(409).json({ error: "Owner accounts are not billed.", code: "OWNER_ACCOUNT" });
    // }
      return res.status(404).json({ error: "No billing profile yet. Subscribe to a plan first." });
    }
    const url = await createPortalLink({ customerId: billing.customerId, frontendUrl: FRONTEND_URL });
    if (!url) return res.status(502).json({ error: "Could not open the billing portal." });
    res.json({ url });
  } catch (error) { next(error); }
});

module.exports = router;
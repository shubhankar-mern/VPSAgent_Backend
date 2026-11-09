const express = require("express");
const { z } = require("zod");
const { db } = require("../services/firebase");
const { requireFirebaseUser } = require("../middleware/requireFirebaseUser");

const router = express.Router();

router.post("/sync", requireFirebaseUser, async (req, res, next) => {
  try {
    const profile = {
      uid: req.user.uid,
      email: req.user.email,
      displayName: req.user.name,
      photoURL: req.user.picture,
      updatedAt: Date.now(),
    };

    await db().ref(`users/${req.user.uid}/profile`).update(profile);
    return res.json({ user: profile });
  } catch (error) {
    next(error);
  }
});

router.post("/delete-account", requireFirebaseUser, async (req, res, next) => {
  const uid = req.user.uid;
  try {
    const [billingSnap, serversSnap] = await Promise.all([
      db().ref(`users/${uid}/billing`).once("value"),
      db().ref(`users/${uid}/servers`).once("value"),
    ]);
    const billing = billingSnap.val() || {};
    const servers = serversSnap.val() || {};

    // Cancel first: never delete data while a subscription can still bill.
    if (billing.subscriptionId && !["cancelled", "expired", "failed"].includes(billing.status)) {
      await cancelSubscription(billing.subscriptionId);
    }

    // Kill agent credentials, billing lookups and the user subtree atomically.
    const updates = {};
    for (const serverId of Object.keys(servers)) updates[`serverAuth/${serverId}`] = null;
    if (billing.customerId) updates[`billingIndex/customer/${billing.customerId}`] = null;
    if (billing.subscriptionId) updates[`billingIndex/subscription/${billing.subscriptionId}`] = null;
    updates[`users/${uid}`] = null;
    updates[`accountDeletions/${uid}`] = Date.now();   // tombstone / audit, no PII
    await db().ref().update(updates);

    // Auth record last so a failed run can be retried with the same uid.
    await getAdmin().auth().deleteUser(uid);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

module.exports = router;

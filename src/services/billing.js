const { db } = require("./firebase");
const { getPlanByProductId } = require("../config/plans");
const { OWNER_PLAN, isOwnerUid } = require("../config/owner");

const ENTITLED_STATUSES = new Set(["active", "past_due"]);
const ACTIVATING = new Set([
  "subscription.active",
  "subscription.renewed",
  "subscription.unpaused",
  "subscription.plan_changed",
]);
const DEACTIVATING = {
  "subscription.expired": "expired",
  "subscription.failed": "failed",
  "subscription.on_hold": "on_hold",
  "subscription.paused": "paused",
};

function isEntitled(billing, now = Date.now()) {
  if (!billing) return false;
  if (ENTITLED_STATUSES.has(billing.status)) return true;
  // Cancelled but already paid through the end of the period.
  if (billing.status === "cancelled" && billing.cancelAtNextBillingDate) {
    const end = billing.nextBillingDate ? Date.parse(billing.nextBillingDate) : NaN;
    return Number.isFinite(end) && end > now;
  }
  return false;
}

function serverLimitFor(billing, now = Date.now()) {
  return isEntitled(billing, now) ? Number(billing.serverLimit) || 0 : 0;
}

function countActiveServers(servers) {
  if (!servers) return 0;
  return Object.values(servers).filter((s) => s && s.status !== "revoked").length;
}

function ownerPlanView(billing) {
  return {
    ...(billing || {}),
    status: "active",
    planId: OWNER_PLAN.id,
    planName: OWNER_PLAN.name,
    serverLimit: OWNER_PLAN.serverLimit,
  };
}

function resolveEntitlement(uid, billing, now = Date.now()) {
  if (isOwnerUid(uid)) {
    return {
      active: true,
      serverLimit: OWNER_PLAN.serverLimit,
      planId: OWNER_PLAN.id,
      planName: OWNER_PLAN.name,
      isOwner: true,
      billing: ownerPlanView(billing),
    };
  }
  return {
    active: isEntitled(billing, now),
    serverLimit: serverLimitFor(billing, now),
    planId: billing?.planId ?? null,
    planName: billing?.planName ?? null,
    isOwner: false,
    billing,
  };
}

function normalizeStatus(type, subscription) {
  if (DEACTIVATING[type]) return DEACTIVATING[type];
  if (ACTIVATING.has(type)) return "active";
  if (type === "subscription.past_due") return "past_due";
  if (type === "subscription.cancelled") {
    const scheduled = Boolean(subscription.cancel_at_next_billing_date);
    const end = Date.parse(subscription.next_billing_date || "") || 0;
    return scheduled && end > Date.now() ? "active" : "cancelled";
  }
  return String(subscription.status || "unknown").toLowerCase();
}

async function applySubscriptionEvent({ uid, type, eventTimestamp, subscription }) {
  const snapshot = await db().ref(`users/${uid}/billing`).once("value");
  const current = snapshot.val() || {};
  if (current.lastEventAt && eventTimestamp < current.lastEventAt) {
    return { applied: false, reason: "out-of-order" };
  }

  const plan = getPlanByProductId(subscription.product_id);
  const customerId = subscription.customer?.customer_id || current.customerId || null;
  const subscriptionId = subscription.subscription_id || current.subscriptionId || null;

  if (!plan && subscription.product_id) {
    console.warn(`Dodo product ${subscription.product_id} is not mapped to a plan; keeping previous limits.`);
  }

  const record = {
    status: normalizeStatus(type, subscription),
    planId: plan?.id ?? current.planId ?? null,
    planName: plan?.name ?? current.planName ?? null,
    serverLimit: plan?.serverLimit ?? current.serverLimit ?? 0,
    productId: subscription.product_id || current.productId || null,
    subscriptionId,
    customerId,
    currency: subscription.currency || current.currency || null,
    recurringPreTaxAmount:
      subscription.recurring_pre_tax_amount ?? current.recurringPreTaxAmount ?? null,
    previousBillingDate: subscription.previous_billing_date || current.previousBillingDate || null,
    nextBillingDate: subscription.next_billing_date || current.nextBillingDate || null,
    cancelAtNextBillingDate: Boolean(subscription.cancel_at_next_billing_date),
    expiresAt: subscription.expires_at || null,
    lastEventType: type,
    lastEventAt: eventTimestamp,
    updatedAt: Date.now(),
  };

  const updates = {};
  for (const [key, value] of Object.entries(record)) {
    updates[`users/${uid}/billing/${key}`] = value;
  }
  if (customerId) updates[`billingIndex/customer/${customerId}`] = uid;
  if (subscriptionId) updates[`billingIndex/subscription/${subscriptionId}`] = uid;

  await db().ref().update(updates);
  return { applied: true, record };
}

module.exports = {
  isEntitled, serverLimitFor, countActiveServers, applySubscriptionEvent, normalizeStatus,resolveEntitlement, ownerPlanView,
};
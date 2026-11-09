const { db } = require("./firebase");

const BASE_URL =
  process.env.DODO_ENVIRONMENT === "live_mode"
    ? "https://live.dodopayments.com"
    : "https://test.dodopayments.com";

async function dodoRequest(path, { method = "GET", body } = {}) {
  const apiKey = process.env.DODO_API_KEY;
  if (!apiKey) throw new Error("DODO_API_KEY is not configured.");

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text }; }
  }

  if (!response.ok) {
    const detail = data?.error?.message || data?.message || "Unknown error";
    const error = new Error(`Dodo Payments: ${detail}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return data;
}

async function ensureCustomer({ uid, email, name }) {
  const stored = await db().ref(`users/${uid}/billing/customerId`).once("value");
  if (stored.exists()) return stored.val();

  const customer = await dodoRequest("/customers", {
    method: "POST",
    body: { email, name: name || undefined, metadata: { uid } },
  });

  const customerId = customer.customer_id;
  await db().ref().update({
    [`users/${uid}/billing/customerId`]: customerId,
    [`billingIndex/customer/${customerId}`]: uid,
  });
  return customerId;
}

async function createCheckoutSession({ uid, email, name, plan, frontendUrl }) {
  const customerId = await ensureCustomer({ uid, email, name });
  const session = await dodoRequest("/checkouts", {
    method: "POST",
    body: {
      product_cart: [{ product_id: plan.productId, quantity: 1 }],
      customer: { customer_id: customerId },
      return_url: `${frontendUrl}/dashboard/billing?checkout=success`,
      cancel_url: `${frontendUrl}/pricing?checkout=cancelled`,
      metadata: { uid, planId: plan.id },
    },
  });
  return { sessionId: session.session_id, checkoutUrl: session.checkout_url || null };
}

async function createPortalLink({ customerId, frontendUrl }) {
  const query = `?return_url=${encodeURIComponent(`${frontendUrl}/dashboard/billing`)}`;
  const session = await dodoRequest(
    `/customers/${encodeURIComponent(customerId)}/customer-portal/session${query}`,
    { method: "POST" },
  );
  return session.link || null;
}

async function cancelSubscription(subscriptionId, comment = "Account deleted") {
  if (!subscriptionId) return null;
  return dodoRequest(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: "PATCH",
    body: { cancel_at_next_billing_date: true, cancellation_comment: comment },
  });
}

module.exports = { dodoRequest, ensureCustomer, createCheckoutSession, createPortalLink, cancelSubscription };
const PLANS = [
  {
    id: "starter",
    name: "Starter",
    priceUsd: 9,
    interval: "month",
    serverLimit: 1,
    productId: process.env.DODO_PRODUCT_STARTER || null,
    features: [
      "1 monitored server",
      "15-second metric updates",
      "CPU, memory, disk, network and load",
      "Revocable per-server agent tokens",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    priceUsd: 25,
    interval: "month",
    serverLimit: 3,
    productId: process.env.DODO_PRODUCT_PRO || null,
    features: [
      "3 monitored servers",
      "Everything in Starter",
      "Disk I/O and process breakdowns",
      "Priority support",
    ],
  },
];

const listPlans = () => PLANS.map(({ productId, ...plan }) => plan);
const getPlanById = (planId) => PLANS.find((plan) => plan.id === planId) || null;
const getPlanByProductId = (productId) =>
  productId ? PLANS.find((plan) => plan.productId === productId) || null : null;

module.exports = { PLANS, listPlans, getPlanById, getPlanByProductId };
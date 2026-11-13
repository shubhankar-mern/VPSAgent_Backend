const OWNER_PLAN = {
  id: "owner",
  name: "Owner",
  serverLimit: 999,
};

const OWNER_UIDS = new Set(
  (process.env.OWNER_UIDS || "")
    .split(",")
    .map((uid) => uid.trim())
    .filter(Boolean),
);

function isOwnerUid(uid) {
  return Boolean(uid) && OWNER_UIDS.has(uid);
}

module.exports = { OWNER_PLAN, OWNER_UIDS, isOwnerUid };
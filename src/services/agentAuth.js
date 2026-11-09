const { db } = require("./firebase");
const { hashAgentToken } = require("./tokens");

async function findServerForToken(token) {
  const tokenHash = hashAgentToken(token);
  const snapshot = await db()
    .ref("serverAuth")
    .orderByChild("tokenHash")
    .equalTo(tokenHash)
    .limitToFirst(1)
    .once("value");

  if (!snapshot.exists()) return null;

  const entries = snapshot.val();
  const [serverId, authRecord] = Object.entries(entries)[0];
  if (!authRecord || authRecord.revoked === true) return null;

  return { serverId, uid: authRecord.uid };
}

module.exports = { findServerForToken };

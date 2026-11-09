const { getAdmin } = require("../services/firebase");

async function requireFirebaseUser(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const match = header.match(/^Bearer\s+(.+)$/i);

    if (!match) {
      return res.status(401).json({ error: "Missing Firebase ID token." });
    }

    const decoded = await getAdmin().auth().verifyIdToken(match[1], true);
    req.user = {
      uid: decoded.uid,
      email: decoded.email || null,
      name: decoded.name || null,
      picture: decoded.picture || null,
    };
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired Firebase ID token." });
  }
}

module.exports = { requireFirebaseUser };

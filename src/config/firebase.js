const admin = require("firebase-admin");

function initializeFirebase() {
  if (admin.apps.length) return admin;

  const projectId = process.env.FIREBASE_PROJECT_ID;
  const databaseURL = process.env.FIREBASE_DATABASE_URL;

  if (!projectId || !databaseURL) {
    throw new Error("FIREBASE_PROJECT_ID and FIREBASE_DATABASE_URL must be configured.");
  }

  // Firebase Admin uses Application Default Credentials when no explicit
  // credential is passed. GOOGLE_APPLICATION_CREDENTIALS can point to a
  // service-account JSON file.
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId,
    databaseURL,
  });

  return admin;
}

module.exports = { initializeFirebase };

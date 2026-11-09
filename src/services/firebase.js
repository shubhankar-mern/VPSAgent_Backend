const { initializeFirebase } = require("../config/firebase");

let adminInstance;

function getAdmin() {
  if (!adminInstance) adminInstance = initializeFirebase();
  return adminInstance;
}

function db() {
  return getAdmin().database();
}

module.exports = { getAdmin, db };

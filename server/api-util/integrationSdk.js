// server/api-util/integrationSdk.js
//
// Lazily instantiated Sharetribe Integration SDK singleton.
// All server-side code that needs admin-level access (closed listings,
// platform-wide reviews, user publicData queries) imports from here.

const sharetribeIntegrationSdk = require('sharetribe-flex-integration-sdk');

const INTEGRATION_CLIENT_ID = process.env.SHARETRIBE_INTEGRATION_CLIENT_ID;
const INTEGRATION_CLIENT_SECRET = process.env.SHARETRIBE_INTEGRATION_CLIENT_SECRET;

let _instance = null;

const getIntegrationSdk = () => {
  if (!_instance) {
    if (!INTEGRATION_CLIENT_ID || !INTEGRATION_CLIENT_SECRET) {
      throw new Error(
        '[integrationSdk] Missing SHARETRIBE_INTEGRATION_CLIENT_ID or ' +
          'SHARETRIBE_INTEGRATION_CLIENT_SECRET environment variables.'
      );
    }
    _instance = sharetribeIntegrationSdk.createInstance({
      clientId: INTEGRATION_CLIENT_ID,
      clientSecret: INTEGRATION_CLIENT_SECRET,
    });
  }
  return _instance;
};

module.exports = { getIntegrationSdk };
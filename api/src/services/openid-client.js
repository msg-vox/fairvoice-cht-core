const {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  allowInsecureRequests,
  randomState,
  randomNonce,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
} = require('openid-client');

/*
 * Wrap the openid-client ESM dependency to enable unit testing.
 */
module.exports = {
  discovery,
  buildAuthorizationUrl,
  authorizationCodeGrant,
  allowInsecureRequests,
  randomState,
  randomNonce,
  randomPKCECodeVerifier,
  calculatePKCECodeChallenge,
};

const crypto = require('node:crypto');
const fs = require('node:fs');
function parseJwt(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || parts.some((p) => !/^[A-Za-z0-9_-]+$/.test(p)))
    throw new Error('Malformed JWT.');
  return {
    header: JSON.parse(Buffer.from(parts[0], 'base64url')),
    payload: JSON.parse(Buffer.from(parts[1], 'base64url')),
    signingInput: parts[0] + '.' + parts[1],
    signature: Buffer.from(parts[2], 'base64url'),
  };
}
function createJwtVerifier({
  publicKey,
  publicKeyFile = process.env.JWT_PUBLIC_KEY_FILE,
  issuer = process.env.JWT_ISSUER || 'umc-care-identity',
  audience = process.env.JWT_AUDIENCE || 'umc-care-services',
  clockSkewSeconds = 5,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  let key = publicKey;
  if (!key && publicKeyFile) {
    try {
      key = fs.readFileSync(publicKeyFile, 'utf8');
    } catch {
      key = null;
    }
  }
  return async (token, options = {}) => {
    if (!key) throw new Error('JWT public key is not configured.');
    const { header, payload: p, signingInput, signature } = parseJwt(token);
    if (header.alg !== 'RS256' || header.typ !== 'JWT')
      throw new Error('Unsupported JWT algorithm.');
    if (p.iss !== issuer || !(Array.isArray(p.aud) ? p.aud.includes(audience) : p.aud === audience))
      throw new Error('JWT issuer or audience is invalid.');
    if (typeof p.sub !== 'string' || !p.sub.trim()) throw new Error('JWT subject is invalid.');
    if (!Number.isInteger(p.tokenVersion) || p.tokenVersion < 1)
      throw new Error('JWT tokenVersion is invalid.');
    if (!crypto.verify('RSA-SHA256', Buffer.from(signingInput), key, signature))
      throw new Error('JWT signature is invalid.');
    const current = now();
    if (!Number.isFinite(p.exp) || p.exp <= current - (options.action ? 0 : clockSkewSeconds))
      throw new Error('JWT is expired.');
    if (p.nbf != null && p.nbf > current + clockSkewSeconds) throw new Error('JWT is not active.');
    if (p.iat != null && p.iat > current + clockSkewSeconds)
      throw new Error('JWT was issued in the future.');
    if (options.action) {
      if (p.action !== options.action) throw new Error('Authorization lease action is invalid.');
      if (!Number.isFinite(p.iat) || p.exp <= p.iat || p.exp - p.iat > 30)
        throw new Error('Authorization lease is too long or missing issued-at.');
      if (
        (options.subject && p.sub !== options.subject) ||
        (options.tokenVersion != null && p.tokenVersion !== options.tokenVersion)
      )
        throw new Error('Authorization lease identity differs.');
    } else {
      if (p.action || !['PATIENT', 'DOCTOR', 'STAFF'].includes(p.actorType))
        throw new Error('JWT actor type is invalid.');
      if (!Array.isArray(p.capabilities) || p.capabilities.some((c) => typeof c !== 'string'))
        throw new Error('JWT capabilities are invalid.');
    }
    return p;
  };
}
module.exports = { createJwtVerifier, parseJwt };

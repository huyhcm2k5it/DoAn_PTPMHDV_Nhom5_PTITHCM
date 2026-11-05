const crypto = require('node:crypto');
const fs = require('node:fs');

function decodeBase64Url(value) {
  const normalized = String(value).replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalized + '='.repeat((4 - (normalized.length % 4)) % 4), 'base64');
}

function createJwtVerifier({
  publicKey,
  publicKeyFile = process.env.JWT_PUBLIC_KEY_FILE,
  issuer = process.env.JWT_ISSUER || 'umc-care-identity',
  audience = process.env.JWT_AUDIENCE || 'umc-care-services',
  clockSkewSeconds = 5,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  let resolvedKey = publicKey;
  if (!resolvedKey && publicKeyFile) {
    try {
      resolvedKey = fs.readFileSync(publicKeyFile, 'utf8');
    } catch {
      resolvedKey = null;
    }
  }
  return async function verifyJwt(token) {
    if (!resolvedKey) throw new Error('JWT public key is not configured.');
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Malformed JWT.');
    const header = JSON.parse(decodeBase64Url(parts[0]).toString('utf8'));
    const payload = JSON.parse(decodeBase64Url(parts[1]).toString('utf8'));
    if (header.alg !== 'RS256' || header.typ !== 'JWT') throw new Error('Unsupported JWT algorithm.');
    if (payload.iss !== issuer || (Array.isArray(payload.aud) ? !payload.aud.includes(audience) : payload.aud !== audience))
      throw new Error('JWT issuer or audience is invalid.');
    if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('JWT subject is invalid.');
    if (!Number.isInteger(payload.tokenVersion) || payload.tokenVersion < 1)
      throw new Error('JWT tokenVersion is invalid.');
    if (!['PATIENT', 'DOCTOR', 'STAFF'].includes(String(payload.actorType || '').toUpperCase()))
      throw new Error('JWT actor type is invalid.');
    if (!Array.isArray(payload.capabilities) || payload.capabilities.some((item) => typeof item !== 'string'))
      throw new Error('JWT capabilities are invalid.');
    const current = now();
    if (!Number.isFinite(payload.exp) || payload.exp <= current - clockSkewSeconds)
      throw new Error('JWT is expired.');
    if (payload.nbf != null && payload.nbf > current + clockSkewSeconds)
      throw new Error('JWT is not active.');
    if (payload.iat != null && payload.iat > current + clockSkewSeconds)
      throw new Error('JWT was issued in the future.');
    if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), resolvedKey, decodeBase64Url(parts[2])))
      throw new Error('JWT signature is invalid.');
    return payload;
  };
}

module.exports = { createJwtVerifier };

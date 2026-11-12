const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const args = process.argv.slice(2);
const verifyIdentity = args[0] === '--verify-identity';
if (verifyIdentity) args.shift();
const input = args[0] || path.resolve(__dirname, '../../infra/certs/jwt_public.pem');
const output = args[1] || path.resolve(__dirname, '../../.runtime/jwks.json');
const publicKey = crypto.createPublicKey(fs.readFileSync(input, 'utf8'));
const jwk = publicKey.export({ format: 'jwk' });
if (jwk.kty !== 'RSA') throw new Error('RS256 public key required.');
if (verifyIdentity) {
  const privatePath = path.resolve(__dirname, '../../services/identity/jwt_private.pem');
  let identityPublic;
  try {
    identityPublic = crypto.createPublicKey(crypto.createPrivateKey(fs.readFileSync(privatePath)));
  } catch {
    throw new Error('Identity signing PEM is missing or unreadable. JWKS was not changed.');
  }
  const publicDER = (key) => key.export({ type: 'spki', format: 'der' });
  if (!publicDER(publicKey).equals(publicDER(identityPublic))) {
    throw new Error('Identity signing PEM does not match the public PEM. JWKS was not changed.');
  }
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify({ keys: [{ ...jwk, use: 'sig', alg: 'RS256' }] }, null, 2) + '\n',
);
console.log('Gateway JWKS prepared from configured public key.');

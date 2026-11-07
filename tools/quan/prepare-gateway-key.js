const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const input = process.argv[2] || path.resolve(__dirname, '../../infra/certs/jwt_public.pem');
const output = process.argv[3] || path.resolve(__dirname, '../../.runtime/jwks.json');
const publicKey = crypto.createPublicKey(fs.readFileSync(input, 'utf8'));
const jwk = publicKey.export({ format: 'jwk' });
if (jwk.kty !== 'RSA') throw new Error('RS256 public key required.');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(
  output,
  JSON.stringify({ keys: [{ ...jwk, use: 'sig', alg: 'RS256' }] }, null, 2) + '\n',
);
console.log('Gateway JWKS prepared from configured public key.');

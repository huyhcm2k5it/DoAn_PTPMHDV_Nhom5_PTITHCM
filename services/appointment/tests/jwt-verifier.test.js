const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJwtVerifier } = require('../src/auth/jwt-verifier.js');

function tokenFor(privateKey, payload, header = { alg: 'RS256', typ: 'JWT' }) {
  const encode = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const input = `${encode(header)}.${encode(payload)}`;
  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(input), privateKey)
    .toString('base64url');
  return `${input}.${signature}`;
}

test('JWT verifier enforces signature, issuer, audience and token version', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const verify = createJwtVerifier({
    publicKey,
    issuer: 'issuer',
    audience: 'audience',
    now: () => 1000,
  });
  const claims = {
    iss: 'issuer',
    aud: 'audience',
    sub: 'user-1',
    actorType: 'STAFF',
    capabilities: ['RECEPTION'],
    tokenVersion: 3,
    iat: 900,
    exp: 1100,
  };
  assert.deepEqual(await verify(tokenFor(privateKey, claims)), claims);
  await assert.rejects(
    () => verify(tokenFor(privateKey, { ...claims, iss: 'other' })),
    /issuer or audience/,
  );
  await assert.rejects(
    () => verify(tokenFor(privateKey, { ...claims, tokenVersion: 0 })),
    /tokenVersion/,
  );
  await assert.rejects(
    () => verify(tokenFor(privateKey, { ...claims, exp: 900 })),
    /expired/,
  );
  await assert.rejects(
    () => verify(tokenFor(privateKey, claims, { alg: 'HS256', typ: 'JWT' })),
    /algorithm/,
  );
});

test('JWT authorization lease is short-lived and action-bound', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const verify = createJwtVerifier({
    publicKey,
    issuer: 'issuer',
    audience: 'audience',
    now: () => 1000,
  });
  const base = {
    iss: 'issuer',
    aud: 'audience',
    sub: 'doctor-1',
    actorType: 'DOCTOR',
    capabilities: [],
    tokenVersion: 1,
    iat: 995,
    exp: 1025,
    action: 'queue.claim',
  };
  await verify(tokenFor(privateKey, base), { action: 'queue.claim' });
  await assert.rejects(
    () =>
      verify(tokenFor(privateKey, { ...base, action: 'queue.call' }), {
        action: 'queue.claim',
      }),
    /action/,
  );
  await assert.rejects(
    () =>
      verify(tokenFor(privateKey, { ...base, exp: 1030 }), {
        action: 'queue.claim',
      }),
    /too long/,
  );
});

test('signed schedule lease aliases remain action, identity and time bound', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const verify = createJwtVerifier({
    publicKey,
    issuer: 'issuer',
    audience: 'audience',
    now: () => 1000,
  });
  const claims = {
    iss: 'issuer',
    aud: 'audience',
    sub: 'admin',
    tokenType: 'LEASE',
    tokenVersion: 1,
    iat: 995,
    exp: 1025,
    action: 'AP-002',
  };
  const options = {
    action: 'AP-005',
    expectedActions: ['AP-005', 'AP-002'],
    subject: 'admin',
    tokenVersion: 1,
  };
  assert.equal(
    (await verify(tokenFor(privateKey, claims), options)).action,
    'AP-002',
  );
  await assert.rejects(
    verify(tokenFor(privateKey, { ...claims, action: 'AP-003' }), options),
    /action/,
  );
  await assert.rejects(
    verify(tokenFor(privateKey, { ...claims, sub: 'other' }), options),
    /identity/,
  );
  await assert.rejects(
    verify(tokenFor(privateKey, { ...claims, exp: 1000 }), options),
    /expired/,
  );
});

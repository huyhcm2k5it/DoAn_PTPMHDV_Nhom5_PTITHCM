const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createJwtVerifier } = require('../src/auth/jwt-verifier');
test('Identity authorization lease binds subject/version and cannot be used as bearer access', async () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
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
    sub: 'staff',
    tokenVersion: 2,
    action: 'PH-008',
    iat: 995,
    exp: 1025,
  };
  const sign = (p) => {
    const data =
      Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString(
        'base64url',
      ) +
      '.' +
      Buffer.from(JSON.stringify(p)).toString('base64url');
    return (
      data +
      '.' +
      crypto
        .sign('RSA-SHA256', Buffer.from(data), privateKey)
        .toString('base64url')
    );
  };
  assert.equal(
    (
      await verify(sign(claims), {
        action: 'PH-008',
        subject: 'staff',
        tokenVersion: 2,
      })
    ).sub,
    'staff',
  );
  await assert.rejects(verify(sign(claims)));
  await assert.rejects(
    verify(sign(claims), {
      action: 'PH-008',
      subject: 'another',
      tokenVersion: 2,
    }),
  );
  await assert.rejects(
    verify(sign(claims), {
      action: 'PH-008',
      subject: 'staff',
      tokenVersion: 1,
    }),
  );
  await assert.rejects(
    verify(sign({ ...claims, iat: undefined }), { action: 'PH-008' }),
  );
});

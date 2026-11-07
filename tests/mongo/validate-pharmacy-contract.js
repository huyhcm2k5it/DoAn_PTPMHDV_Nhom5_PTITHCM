const assert = require('node:assert/strict');
const Ajv = require('ajv/dist/2020');
const formats = require('ajv-formats');
const spec = require('../../contracts/http/pharmacy.openapi.json');
const ajv = new Ajv({ strict: false, allErrors: true });
formats(ajv);
ajv.addSchema(spec, 'urn:umc-care:pharmacy-http');
const cache = new Map();
function validatePharmacyResponse(method, path, status, body) {
  const pathname = '/api/v1/pharmacy' + path.split('?')[0];
  const route = Object.keys(spec.paths).find((route) =>
    new RegExp('^' + route.replace(/\{[^}]+\}/g, '[^/]+') + '$').test(pathname),
  );
  assert.ok(route, 'HTTP route is present in OpenAPI');
  const operation = spec.paths[route][method.toLowerCase()];
  assert.ok(operation, 'HTTP method is present in OpenAPI');
  const schema = operation.responses[status]?.content['application/json'].schema;
  assert.ok(schema, 'HTTP status is declared in OpenAPI');
  const reference = 'urn:umc-care:pharmacy-http' + schema.$ref;
  if (!cache.has(reference)) cache.set(reference, ajv.compile({ $ref: reference }));
  const validate = cache.get(reference);
  assert.ok(validate(body), JSON.stringify(validate.errors));
}
module.exports = { validatePharmacyResponse };

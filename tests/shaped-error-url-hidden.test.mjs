// tests/shaped-error-url-hidden.test.mjs
// A shaped error carries the RAW request in its url field so the shapers' own readers can read it
// back -- the re-price rebuilds the text from it and the omitUrl decision is read from the shaper's
// flag -- but the field was an enumerable own property, so JSON.stringify, Object.keys, a spread or
// any error logger published the request verbatim, query string and credential included. The field
// is a non-enumerable own property now: still readable by name, invisible to a serializer. The
// priced secret set was moved out of the object for the same reason, and this pins the second half.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { repriceShapedError, shapeHttpError, shapeTransportError } from '../scripts/lib/net.mjs';

const SECRET_URL = 'https://feeds.example/rss?token=SECRET42';
const serialised = (err) => JSON.stringify(err);
const spread = (err) => ({ ...err });

test('a shaped HTTP error keeps its url readable and off every serializer', () => {
  const shaped = shapeHttpError(500, Buffer.from('the server broke'), SECRET_URL, 200);
  assert.equal(shaped.url, SECRET_URL, 'the shaper no longer carries the raw request for its readers');
  assert.equal(Object.prototype.propertyIsEnumerable.call(shaped, 'url'), false,
    'the raw request is still an enumerable own property');
  assert.equal(Object.keys(shaped).includes('url'), false,
    'Object.keys still hands the raw request out: ' + Object.keys(shaped).join(','));
  assert.equal(serialised(shaped).includes('SECRET42'), false,
    'a serializer published the request credential: ' + serialised(shaped));
  assert.equal(serialised(spread(shaped)).includes('SECRET42'), false,
    'spreading the error carried the request credential: ' + serialised(spread(shaped)));
  assert.equal(serialised(spread(shaped)).includes('feeds.example'), false,
    'spreading the error carried the raw request at all');
});

test('a shaped transport error keeps its url readable and off every serializer', () => {
  const shaped = shapeTransportError({ status: 7 }, SECRET_URL, 200);
  assert.equal(shaped.url, SECRET_URL, 'the transport shaper no longer carries the raw request');
  assert.equal(Object.prototype.propertyIsEnumerable.call(shaped, 'url'), false,
    'the transport raw request is still enumerable');
  assert.equal(serialised(shaped).includes('SECRET42'), false,
    'a serializer published the transport request credential: ' + serialised(shaped));
  assert.equal(serialised(spread(shaped)).includes('SECRET42'), false,
    'spreading the transport error carried the credential');
});

test('the re-price still reads the url by name and keeps it hidden on its result', () => {
  const shaped = shapeHttpError(500, Buffer.from('the server broke'), SECRET_URL, 200);
  const repriced = repriceShapedError(shaped, [], 200);
  assert.notEqual(repriced, shaped, 'the re-price no longer rebuilds the text');
  assert.equal(repriced.message, 'HTTP 500 for https://feeds.example/rss',
    'the re-price lost the redacted request: ' + JSON.stringify(repriced.message));
  assert.equal(repriced.url, SECRET_URL, 'the repriced error no longer carries the request by name');
  assert.equal(Object.prototype.propertyIsEnumerable.call(repriced, 'url'), false,
    'the repriced error made the raw request enumerable again');
  assert.equal(serialised(repriced).includes('SECRET42'), false,
    'a serializer published the credential from the repriced error');
  // A later re-price reads the request back off its own result; losing it would silently turn a
  // shaped notice into one that names no request at all.
  assert.equal(repriceShapedError(repriced, [], 200).message, repriced.message,
    'a second re-price lost the request the first one carried');
  const transport = repriceShapedError(shapeTransportError({ status: 7 }, SECRET_URL, 200), [], 200);
  assert.equal(transport.message, 'request failed for https://feeds.example/rss: failed to connect (curl exit 7)',
    'the transport re-price changed: ' + JSON.stringify(transport.message));
  assert.equal(serialised(transport).includes('SECRET42'), false,
    'a serializer published the credential from the repriced transport error');
});

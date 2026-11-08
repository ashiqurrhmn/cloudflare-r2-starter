import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler, type Env } from './index';
import { MAX_BYTES } from './files';
import { FakeBucket, PROJECT, goodPayload, jpegBytes, makeKey, pngBytes, signToken, type TestKey } from './testkit';

let key: TestKey;
let other: TestKey;

before(async () => {
  key = await makeKey('test-key-1');
  other = await makeKey('test-key-1');
});

const ORIGIN = 'https://app.example.com';
const getKeys = async () => [key.jwk];
const handler = createHandler(getKeys);

const nowSec = () => Math.floor(Date.now() / 1000);
const tokenFor = (sub = 'user-1') => signToken(key, goodPayload(nowSec(), { sub }));

function makeEnv(bucket = new FakeBucket()): { env: Env; bucket: FakeBucket } {
  return { env: { BUCKET: bucket, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGIN: ORIGIN }, bucket };
}

const call = (env: Env, path: string, init: RequestInit = {}, h = handler) =>
  h(new Request('https://worker.test' + path, init), env);

async function put(env: Env, bytes: Uint8Array, type: string | null, sub = 'user-1', path = '/avatar') {
  const headers: Record<string, string> = { Authorization: `Bearer ${await tokenFor(sub)}` };
  if (type) headers['Content-Type'] = type;
  return call(env, path, { method: 'PUT', headers, body: bytes });
}
const authed = async (sub = 'user-1'): Promise<Record<string, string>> => ({ Authorization: `Bearer ${await tokenFor(sub)}` });

// ------------------------------------------------------------------- /health
test('GET /health is public', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/health');
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('POST /health is not allowed', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/health', { method: 'POST' });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET');
});

// ----------------------------------------------------------- sign-in required
test('PUT /avatar without a token answers 401 and stores nothing', async () => {
  const { env, bucket } = makeEnv();
  const res = await call(env, '/avatar', { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: pngBytes() });
  assert.equal(res.status, 401);
  assert.equal(bucket.store.size, 0);
});

test('PUT /avatar with a forged token answers 401 and stores nothing', async () => {
  const { env, bucket } = makeEnv();
  const forged = await signToken(other, goodPayload(nowSec()));
  const res = await call(env, '/avatar', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${forged}`, 'Content-Type': 'image/png' },
    body: pngBytes(),
  });
  assert.equal(res.status, 401);
  assert.equal(bucket.store.size, 0);
});

test('GET /avatar without a token answers 401', async () => {
  const { env } = makeEnv();
  assert.equal((await call(env, '/avatar')).status, 401);
});

test('DELETE /avatar without a token answers 401', async () => {
  const { env, bucket } = makeEnv();
  bucket.store.set('users/user-1/avatar', { bytes: pngBytes() });
  const res = await call(env, '/avatar', { method: 'DELETE' });
  assert.equal(res.status, 401);
  assert.equal(bucket.store.size, 1);
});

test('when the keys cannot be downloaded the answer is 503', async () => {
  const { env } = makeEnv();
  const broken = createHandler(async () => { throw new Error('jwks-fetch-failed'); });
  const res = await call(env, '/avatar', { headers: await authed() }, broken);
  assert.equal(res.status, 503);
});

// --------------------------------------------------------------------- upload
test('PUT /avatar stores a PNG at the key built from the uid', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(500), 'image/png');
  assert.equal(res.status, 201);
  assert.deepEqual(await res.json(), { key: 'users/user-1/avatar', size: 500, contentType: 'image/png' });
  const stored = bucket.store.get('users/user-1/avatar');
  assert.ok(stored);
  assert.equal(stored.contentType, 'image/png');
  assert.equal(stored.bytes.length, 500);
});

test('PUT /avatar stores a JPEG', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, jpegBytes(200), 'image/jpeg');
  assert.equal(res.status, 201);
  assert.equal(bucket.store.get('users/user-1/avatar')?.contentType, 'image/jpeg');
});

test('PUT /avatar records who uploaded and when', async () => {
  const { env, bucket } = makeEnv();
  await put(env, pngBytes(), 'image/png');
  const custom = bucket.store.get('users/user-1/avatar')?.custom;
  assert.equal(custom?.uploadedBy, 'user-1');
  assert.ok(custom?.uploadedAt && !Number.isNaN(Date.parse(custom.uploadedAt)));
});

test('a second upload replaces the first', async () => {
  const { env, bucket } = makeEnv();
  await put(env, pngBytes(100), 'image/png');
  await put(env, pngBytes(300), 'image/png');
  assert.equal(bucket.store.size, 1);
  assert.equal(bucket.store.get('users/user-1/avatar')?.bytes.length, 300);
});

test('the client cannot choose the key (query string)', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(), 'image/png', 'user-1', '/avatar?key=users/user-2/avatar');
  assert.equal(res.status, 201);
  assert.deepEqual([...bucket.store.keys()], ['users/user-1/avatar']);
});

test('a verified token with an unsafe uid answers 401 and stores nothing', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(), 'image/png', '../other-user');
  assert.equal(res.status, 401);
  assert.equal(bucket.store.size, 0);
});

test('two users keep separate pictures', async () => {
  const { env, bucket } = makeEnv();
  await put(env, pngBytes(111), 'image/png', 'user-1');
  await put(env, jpegBytes(222), 'image/jpeg', 'user-2');
  assert.equal(bucket.store.get('users/user-1/avatar')?.bytes.length, 111);
  assert.equal(bucket.store.get('users/user-2/avatar')?.bytes.length, 222);
});

// ---------------------------------------------------------- upload validation
test('PUT /avatar with a text type answers 415', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(), 'text/plain');
  assert.equal(res.status, 415);
  assert.deepEqual(await res.json(), { error: 'unsupported-media-type' });
  assert.equal(bucket.store.size, 0);
});

test('PUT /avatar with no Content-Type answers 415', async () => {
  const { env } = makeEnv();
  const res = await put(env, pngBytes(), null);
  assert.equal(res.status, 415);
});

test('PUT /avatar with PNG bytes labelled JPEG answers 415', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(), 'image/jpeg');
  assert.equal(res.status, 415);
  assert.equal(bucket.store.size, 0);
});

test('PUT /avatar with HTML labelled as a PNG answers 415', async () => {
  const { env, bucket } = makeEnv();
  const html = new TextEncoder().encode("<html><script>alert('x')</script></html>");
  const res = await put(env, html, 'image/png');
  assert.equal(res.status, 415);
  assert.equal(bucket.store.size, 0);
});

test('PUT /avatar with an empty body answers 400', async () => {
  const { env } = makeEnv();
  const res = await put(env, new Uint8Array(0), 'image/png');
  assert.equal(res.status, 400);
  assert.deepEqual(await res.json(), { error: 'empty-file' });
});

test('PUT /avatar with a file of exactly the maximum size is accepted', async () => {
  const { env } = makeEnv();
  const res = await put(env, pngBytes(MAX_BYTES), 'image/png');
  assert.equal(res.status, 201);
});

test('PUT /avatar with a file one byte too large answers 413', async () => {
  const { env, bucket } = makeEnv();
  const res = await put(env, pngBytes(MAX_BYTES + 1), 'image/png');
  assert.equal(res.status, 413);
  assert.deepEqual(await res.json(), { error: 'payload-too-large' });
  assert.equal(bucket.store.size, 0);
});

test('when the bucket fails the answer is 500 and the reason is not leaked', async () => {
  const bucket = new FakeBucket();
  bucket.failPut = true;
  const { env } = makeEnv(bucket);
  const res = await put(env, pngBytes(), 'image/png');
  assert.equal(res.status, 500);
  const text = await res.text();
  assert.deepEqual(JSON.parse(text), { error: 'storage-error' });
  assert.ok(!text.includes('disk'));
});

// ------------------------------------------------------------------- download
test('GET /avatar returns the stored picture with safe headers', async () => {
  const { env } = makeEnv();
  const original = pngBytes(321);
  await put(env, original, 'image/png');
  const res = await call(env, '/avatar', { headers: await authed() });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'image/png');
  assert.equal(res.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(res.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.deepEqual(new Uint8Array(await res.arrayBuffer()), original);
});

test('GET /avatar answers 404 when there is no picture', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/avatar', { headers: await authed() });
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not-found' });
});

test('a user cannot see another user picture', async () => {
  const { env } = makeEnv();
  await put(env, pngBytes(111), 'image/png', 'user-1');
  const res = await call(env, '/avatar', { headers: await authed('user-2') });
  assert.equal(res.status, 404);
});

test('GET /avatar ignores a key in the query string', async () => {
  const { env } = makeEnv();
  await put(env, pngBytes(111), 'image/png', 'user-1');
  const res = await call(env, '/avatar?key=users/user-1/avatar', { headers: await authed('user-2') });
  assert.equal(res.status, 404);
});

// --------------------------------------------------------------------- delete
test('DELETE /avatar removes the picture and answers 204', async () => {
  const { env, bucket } = makeEnv();
  await put(env, pngBytes(), 'image/png');
  const res = await call(env, '/avatar', { method: 'DELETE', headers: await authed() });
  assert.equal(res.status, 204);
  assert.equal(bucket.store.size, 0);
});

test('DELETE /avatar twice is not an error', async () => {
  const { env } = makeEnv();
  const headers = await authed();
  await call(env, '/avatar', { method: 'DELETE', headers });
  const res = await call(env, '/avatar', { method: 'DELETE', headers });
  assert.equal(res.status, 204);
});

test('DELETE /avatar only removes the callers own picture', async () => {
  const { env, bucket } = makeEnv();
  await put(env, pngBytes(), 'image/png', 'user-1');
  await put(env, pngBytes(), 'image/png', 'user-2');
  await call(env, '/avatar', { method: 'DELETE', headers: await authed('user-1') });
  assert.deepEqual([...bucket.store.keys()], ['users/user-2/avatar']);
});

// ------------------------------------------------------------------ the rest
test('POST /avatar is not allowed', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/avatar', { method: 'POST', headers: await authed() });
  assert.equal(res.status, 405);
  assert.equal(res.headers.get('Allow'), 'GET, PUT, DELETE');
});

test('an unknown path answers 404', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/files/anything');
  assert.equal(res.status, 404);
  assert.deepEqual(await res.json(), { error: 'not-found' });
});

test('OPTIONS answers the preflight with 204 and allows PUT and DELETE', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/avatar', { method: 'OPTIONS' });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /PUT/);
  assert.match(res.headers.get('Access-Control-Allow-Methods') ?? '', /DELETE/);
});

test('error answers carry the CORS header and are JSON', async () => {
  const { env } = makeEnv();
  const res = await call(env, '/avatar');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.match(res.headers.get('Content-Type') ?? '', /application\/json/);
});

test('PUT /avatar rejects SVG bytes labelled PNG', async () => {
  const { env, bucket } = makeEnv();
  const svg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  );

  const res = await put(env, svg, 'image/png');

  assert.equal(res.status, 415);
  assert.equal(bucket.store.size, 0);
});

test('GET /avatar rejects an unsafe verified uid', async () => {
  const { env, bucket } = makeEnv();
  bucket.store.set('users/user-1/avatar', {
    bytes: pngBytes(),
  });

  const res = await call(env, '/avatar', {
    headers: await authed('../user-1'),
  });

  assert.equal(res.status, 401);
  assert.equal(bucket.store.size, 1);
});

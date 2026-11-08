import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_BYTES, avatarKey, detectImageType, validateUpload } from './files';
import { jpegBytes, pngBytes } from './testkit';

const bytesOf = (text: string) => new TextEncoder().encode(text);

// ------------------------------------------------------------- detectImageType
test('detectImageType recognises a PNG', () => assert.equal(detectImageType(pngBytes()), 'image/png'));
test('detectImageType recognises a JPEG', () => assert.equal(detectImageType(jpegBytes()), 'image/jpeg'));
test('detectImageType accepts a PNG that is only the 8 signature bytes', () => {
  assert.equal(detectImageType(pngBytes(8)), 'image/png');
});
test('detectImageType accepts a JPEG that is only the 3 signature bytes', () => {
  assert.equal(detectImageType(jpegBytes(3)), 'image/jpeg');
});
test('detectImageType rejects a GIF', () => assert.equal(detectImageType(bytesOf('GIF89a......')), null));
test('detectImageType rejects HTML', () => assert.equal(detectImageType(bytesOf('<html><body>hi</body></html>')), null));
test('detectImageType rejects an empty file', () => assert.equal(detectImageType(new Uint8Array(0)), null));
test('detectImageType rejects a PNG signature that is cut short', () => {
  assert.equal(detectImageType(pngBytes(7)), null);
});
test('detectImageType rejects a JPEG signature that is cut short', () => {
  assert.equal(detectImageType(jpegBytes(2)), null);
});

// ------------------------------------------------------------------ avatarKey
test('avatarKey builds the key from the uid', () => assert.equal(avatarKey('abc123'), 'users/abc123/avatar'));
test('avatarKey accepts letters, digits, underscore and hyphen', () => {
  assert.equal(avatarKey('Ab_9-z'), 'users/Ab_9-z/avatar');
});
test('avatarKey accepts a uid of 128 characters', () => {
  assert.equal(avatarKey('a'.repeat(128)), `users/${'a'.repeat(128)}/avatar`);
});

for (const [label, uid] of [
  ['an empty uid', ''],
  ['a uid with a slash', 'a/b'],
  ['a uid that tries to go up a folder', '../other'],
  ['a uid with a space', 'a b'],
  ['a uid with a dot', 'a.b'],
  ['a uid longer than 128 characters', 'a'.repeat(129)],
  ['a number', 12345],
  ['undefined', undefined],
] as const) {
  test(`avatarKey rejects ${label}`, () => {
    assert.throws(() => avatarKey(uid), { message: 'invalid-uid' });
  });
}

// -------------------------------------------------------------- validateUpload
test('validateUpload accepts a PNG', () => assert.equal(validateUpload('image/png', pngBytes()), 'image/png'));
test('validateUpload accepts a JPEG', () => assert.equal(validateUpload('image/jpeg', jpegBytes()), 'image/jpeg'));
test('validateUpload ignores letter case and parameters in the header', () => {
  assert.equal(validateUpload('IMAGE/PNG; charset=binary', pngBytes()), 'image/png');
  assert.equal(validateUpload('  image/jpeg ', jpegBytes()), 'image/jpeg');
});
test('validateUpload accepts a file of exactly the maximum size', () => {
  assert.equal(validateUpload('image/png', pngBytes(MAX_BYTES)), 'image/png');
});
test('validateUpload rejects a file one byte over the maximum', () => {
  assert.throws(() => validateUpload('image/png', pngBytes(MAX_BYTES + 1)), { message: 'too-large' });
});
test('validateUpload rejects an empty file', () => {
  assert.throws(() => validateUpload('image/png', new Uint8Array(0)), { message: 'empty-file' });
});
test('validateUpload reports an empty file before a bad type', () => {
  assert.throws(() => validateUpload('text/plain', new Uint8Array(0)), { message: 'empty-file' });
});
test('validateUpload reports a too-large file before a bad type', () => {
  assert.throws(() => validateUpload('text/plain', new Uint8Array(MAX_BYTES + 1)), { message: 'too-large' });
});

for (const [label, header] of [
  ['a GIF header', 'image/gif'],
  ['a text header', 'text/plain'],
  ['an SVG header', 'image/svg+xml'],
  ['a missing header', null],
  ['an empty header', ''],
] as const) {
  test(`validateUpload rejects ${label}`, () => {
    assert.throws(() => validateUpload(header, pngBytes()), { message: 'unsupported-type' });
  });
}

test('validateUpload rejects a PNG header on JPEG bytes', () => {
  assert.throws(() => validateUpload('image/png', jpegBytes()), { message: 'content-mismatch' });
});
test('validateUpload rejects an image header on HTML bytes', () => {
  assert.throws(() => validateUpload('image/png', bytesOf('<html>not an image</html>')), { message: 'content-mismatch' });
});

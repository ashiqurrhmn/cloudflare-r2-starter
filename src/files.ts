// Maximum allowed upload size: 2 MiB.
export const MAX_BYTES = 2 * 1024 * 1024;

export const ALLOWED_TYPES = ['image/png', 'image/jpeg'] as const;
export type ImageType = (typeof ALLOWED_TYPES)[number];

export function detectImageType(bytes: Uint8Array): ImageType | null {
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const jpeg = [0xff, 0xd8, 0xff];

  if (
    bytes.length >= png.length &&
    png.every((value, index) => bytes[index] === value)
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= jpeg.length &&
    jpeg.every((value, index) => bytes[index] === value)
  ) {
    return 'image/jpeg';
  }

  return null;
}

export function avatarKey(uid: unknown): string {
  if (
    typeof uid !== 'string' ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(uid)
  ) {
    throw new Error('invalid-uid');
  }

  return 'users/' + uid + '/avatar';
}

export function validateUpload(
  contentTypeHeader: string | null,
  bytes: Uint8Array,
): ImageType {
  // Keep these checks in the order required by the specification.
  if (bytes.length === 0) {
    throw new Error('empty-file');
  }

  if (bytes.length > MAX_BYTES) {
    throw new Error('too-large');
  }

  const mediaType = contentTypeHeader
    ?.split(';', 1)[0]
    .trim()
    .toLowerCase();

  if (mediaType !== 'image/png' && mediaType !== 'image/jpeg') {
    throw new Error('unsupported-type');
  }

  if (detectImageType(bytes) !== mediaType) {
    throw new Error('content-mismatch');
  }

  return mediaType;
}
// This file is complete (it is the solution of the previous Worker exercise). You do not need to change it.
export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

export type KeyProvider = () => Promise<Jwk[]>;

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signingInput: string;
  signature: Uint8Array;
}

export interface VerifiedToken {
  uid: string;
  payload: Record<string, unknown>;
}

export const AUTH_ERRORS: ReadonlySet<string> = new Set([
  'malformed-token',
  'invalid-algorithm',
  'unknown-key',
  'invalid-signature',
  'invalid-claims',
]);

export function base64UrlDecode(input: string): Uint8Array {
  const standard = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  const binary = atob(padded); // throws when the text is not valid base64
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseJsonObject(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlDecode(part)));
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new Error('malformed-token');
  }
}

export function decodeJwt(token: string): DecodedJwt {
  const parts = token.split('.');
  if (parts.length !== 3 || parts.some((part) => part === '')) {
    throw new Error('malformed-token');
  }
  const header = parseJsonObject(parts[0]);
  const payload = parseJsonObject(parts[1]);
  let signature: Uint8Array;
  try {
    signature = base64UrlDecode(parts[2]);
  } catch {
    throw new Error('malformed-token');
  }
  return { header, payload, signingInput: `${parts[0]}.${parts[1]}`, signature };
}

export function checkClaims(payload: Record<string, unknown>, projectId: string, nowSec: number): void {
  const reject = (): never => {
    throw new Error('invalid-claims');
  };
  if (payload.aud !== projectId) reject();
  if (payload.iss !== `https://securetoken.google.com/${projectId}`) reject();
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) reject();
  if (typeof payload.iat !== 'number' || payload.iat > nowSec) reject();
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 128) reject();
}

export function getBearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  return match ? match[1] : null;
}

export async function verifyFirebaseIdToken(
  token: string,
  projectId: string,
  getKeys: KeyProvider,
  nowSec: number = Math.floor(Date.now() / 1000),
): Promise<VerifiedToken> {
  const { header, payload, signingInput, signature } = decodeJwt(token);

  if (header.alg !== 'RS256') {
    throw new Error('invalid-algorithm');
  }

  const keys = await getKeys();
  const jwk = keys.find((candidate) => candidate.kid === header.kid);
  if (!jwk) {
    throw new Error('unknown-key');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(signingInput),
  );
  if (!valid) {
    throw new Error('invalid-signature');
  }

  checkClaims(payload, projectId, nowSec);
  return { uid: payload.sub as string, payload };
}

// Helpers for the tests. They create a real RSA key pair and sign real tokens,
// so the tests exercise the real signature check. You do not need to change this file.

import type { webcrypto } from 'node:crypto';
import type { Jwk } from './auth';
import type { R2BucketLike, R2ObjectBodyLike } from './index';

type CryptoKey = webcrypto.CryptoKey;
type CryptoKeyPair = webcrypto.CryptoKeyPair;

const enc = new TextEncoder();

export const PROJECT = 'test-project';
export const NOW = 1_800_000_000; // a fixed "current time" in seconds, for the auth tests

export function b64url(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? enc.encode(data) : data;
  return Buffer.from(bytes).toString('base64url');
}

export interface TestKey {
  privateKey: CryptoKey;
  jwk: Jwk;
}

export async function makeKey(kid = 'test-key-1'): Promise<TestKey> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const pub = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return {
    privateKey: pair.privateKey,
    jwk: { kid, kty: pub.kty as string, n: pub.n as string, e: pub.e as string, alg: 'RS256', use: 'sig' },
  };
}

export function goodPayload(nowSec: number, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `https://securetoken.google.com/${PROJECT}`,
    aud: PROJECT,
    sub: 'user-1',
    email: 'alice@example.com',
    iat: nowSec - 60,
    exp: nowSec + 3600,
    auth_time: nowSec - 60,
    ...over,
  };
}

export async function signToken(
  key: TestKey,
  payload: Record<string, unknown>,
  headerOver: Record<string, unknown> = {},
): Promise<string> {
  const header = { alg: 'RS256', typ: 'JWT', kid: key.jwk.kid, ...headerOver };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, enc.encode(input));
  return `${input}.${b64url(new Uint8Array(sig))}`;
}

// An in-memory stand-in for an R2 bucket, so the tests need no Cloudflare at all.
export class FakeBucket implements R2BucketLike {
  store = new Map<string, { bytes: Uint8Array; contentType?: string; custom?: Record<string, string> }>();
  failPut = false;

  async put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<void> {
    if (this.failPut) throw new Error('disk exploded');
    const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
    this.store.set(key, {
      bytes: new Uint8Array(bytes),
      contentType: options?.httpMetadata?.contentType,
      custom: options?.customMetadata,
    });
  }

  async get(key: string): Promise<R2ObjectBodyLike | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      body: new Response(entry.bytes).body as ReadableStream,
      size: entry.bytes.length,
      httpMetadata: { contentType: entry.contentType },
      customMetadata: entry.custom,
    };
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// Bytes that start like a real PNG or JPEG file.
export function pngBytes(length = 100): Uint8Array {
  const out = new Uint8Array(length);
  out.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].slice(0, length)); // a short file gets a cut-short signature
  return out;
}
export function jpegBytes(length = 100): Uint8Array {
  const out = new Uint8Array(length);
  out.set([0xff, 0xd8, 0xff, 0xe0].slice(0, length)); // a short file gets a cut-short signature
  return out;
}

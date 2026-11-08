// Downloads and caches the public keys that Firebase uses to sign ID tokens.
// This file is complete. You do not need to change it.

import type { Jwk } from './auth';

export const GOOGLE_JWKS_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

interface Cache {
  url: string;
  keys: Jwk[];
  expiresAt: number;
}

let cache: Cache | undefined;
const CACHE_MS = 60 * 60 * 1000; // one hour

export function jwksProvider(url: string = GOOGLE_JWKS_URL): () => Promise<Jwk[]> {
  return async () => {
    const now = Date.now();
    if (cache && cache.url === url && cache.expiresAt > now) {
      return cache.keys;
    }
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error('jwks-fetch-failed');
    }
    const body = (await res.json()) as { keys?: Jwk[] };
    if (!body.keys || !Array.isArray(body.keys)) {
      throw new Error('jwks-invalid');
    }
    cache = { url, keys: body.keys, expiresAt: now + CACHE_MS };
    return body.keys;
  };
}

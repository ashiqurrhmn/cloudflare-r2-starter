import { AUTH_ERRORS, getBearerToken, verifyFirebaseIdToken, type KeyProvider } from './auth';
import { MAX_BYTES, avatarKey, validateUpload } from './files';
import { jwksProvider } from './keys';

// The small part of the R2 bucket API that this Worker uses.
export interface R2ObjectBodyLike {
  body: ReadableStream;
  size: number;
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
}

export interface R2BucketLike {
  put(
    key: string,
    value: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string }; customMetadata?: Record<string, string> },
  ): Promise<unknown>;
  get(key: string): Promise<R2ObjectBodyLike | null>;
  delete(key: string): Promise<void>;
}

export interface Env {
  BUCKET: R2BucketLike; // the private R2 bucket, reached through a binding (see wrangler.jsonc)
  FIREBASE_PROJECT_ID: string; // public configuration
  ALLOWED_ORIGIN?: string; // public configuration
  JWKS_URL?: string; // LOCAL DEVELOPMENT ONLY. Never set this in a deployed Worker.
}

const DEFAULT_ORIGIN = 'http://localhost:5173';

// Complete.
export function corsHeaders(env: Env): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || DEFAULT_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    Vary: 'Origin',
  };
}

// Complete. A JSON answer that always carries the CORS headers.
export function json(body: unknown, status: number, env: Env, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env), ...extra },
  });
}

// Complete (it is the sign-in check from the previous exercise).
// Returns the verified user, or a ready-made error answer:
//   no token or a bad token -> 401, keys could not be downloaded -> 503.
async function authenticate(
  request: Request,
  env: Env,
  getKeys: KeyProvider,
): Promise<{ uid: string } | Response> {
  const token = getBearerToken(request.headers.get('Authorization'));
  if (!token) {
    return json({ error: 'unauthorized' }, 401, env);
  }
  try {
    const verified = await verifyFirebaseIdToken(token, env.FIREBASE_PROJECT_ID, getKeys);
    return { uid: verified.uid };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (AUTH_ERRORS.has(message)) {
      return json({ error: 'unauthorized' }, 401, env);
    }
    console.error('auth unavailable:', message);
    return json({ error: 'auth-unavailable' }, 503, env);
  }
}

/**
 * Build the request handler. The key provider is a parameter so that the tests
 * can supply their own keys without any network access.
 *
 * Routes (see docs/SPEC.md for the exact answers):
 *   OPTIONS anything   -> 204, CORS headers, no body
 *   GET /health        -> public
 *   PUT /avatar        -> store the caller's picture in the bucket
 *   GET /avatar        -> return the caller's own picture
 *   DELETE /avatar     -> delete the caller's own picture
 *   anything else      -> 404
 */
export function createHandler(getKeys: KeyProvider) {
  return async function handle(
    request: Request,
    env: Env,
  ): Promise<Response> {
    // CORS preflight is public and has no response body.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    }

    const path = new URL(request.url).pathname;

    if (path === '/health') {
      if (request.method !== 'GET') {
        return json(
          { error: 'method-not-allowed' },
          405,
          env,
          { Allow: 'GET' },
        );
      }

      return json({ ok: true }, 200, env);
    }

    if (path !== '/avatar') {
      return json({ error: 'not-found' }, 404, env);
    }

    if (!['GET', 'PUT', 'DELETE'].includes(request.method)) {
      return json(
        { error: 'method-not-allowed' },
        405,
        env,
        { Allow: 'GET, PUT, DELETE' },
      );
    }

    // Authenticate before reading an upload body.
    const user = await authenticate(request, env, getKeys);
    if (user instanceof Response) {
      return user;
    }

    // Never accept a storage key from the request.
    let key: string;
    try {
      key = avatarKey(user.uid);
    } catch {
      return json({ error: 'unauthorized' }, 401, env);
    }

    if (request.method === 'PUT') {
      // Reject an advertised oversized body before reading it.
      const length = request.headers.get('Content-Length');
      if (length !== null && Number(length) > MAX_BYTES) {
        return json({ error: 'payload-too-large' }, 413, env);
      }

      const bytes = new Uint8Array(await request.arrayBuffer());

      let contentType: 'image/png' | 'image/jpeg';
      try {
        contentType = validateUpload(
          request.headers.get('Content-Type'),
          bytes,
        );
      } catch (error) {
        const reason = error instanceof Error ? error.message : '';

        if (reason === 'empty-file') {
          return json({ error: 'empty-file' }, 400, env);
        }

        if (reason === 'too-large') {
          return json({ error: 'payload-too-large' }, 413, env);
        }

        if (
          reason === 'unsupported-type' ||
          reason === 'content-mismatch'
        ) {
          return json(
            { error: 'unsupported-media-type' },
            415,
            env,
          );
        }

        throw error;
      }

      try {
        await env.BUCKET.put(key, bytes, {
          httpMetadata: { contentType },
          customMetadata: {
            uploadedBy: user.uid,
            uploadedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        console.error('R2 put failed:', error);
        return json({ error: 'storage-error' }, 500, env);
      }

      return json(
        { key, size: bytes.length, contentType },
        201,
        env,
      );
    }

    if (request.method === 'GET') {
      try {
        const object = await env.BUCKET.get(key);

        if (!object) {
          return json({ error: 'not-found' }, 404, env);
        }

        return new Response(object.body, {
          status: 200,
          headers: {
            ...corsHeaders(env),
            'Content-Type':
              object.httpMetadata?.contentType ??
              'application/octet-stream',
            'Cache-Control': 'private, no-store',
            'X-Content-Type-Options': 'nosniff',
          },
        });
      } catch (error) {
        console.error('R2 get failed:', error);
        return json({ error: 'storage-error' }, 500, env);
      }
    }

    // The only remaining allowed method is DELETE.
    try {
      await env.BUCKET.delete(key);

      return new Response(null, {
        status: 204,
        headers: corsHeaders(env),
      });
    } catch (error) {
      console.error('R2 delete failed:', error);
      return json({ error: 'storage-error' }, 500, env);
    }
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return createHandler(jwksProvider(env.JWKS_URL))(request, env);
  },
};

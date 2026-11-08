# Cloudflare R2 Specification

Write the code in `src/files.ts` and `src/index.ts`. The tests in `src/files.test.ts` and `src/handler.test.ts` describe the expected behaviour exactly. `src/auth.ts` (the token check from the previous exercise), `src/keys.ts` and `src/testkit.ts` are complete.

## What the Worker does

A signed-in user can store, read and delete **one picture of their own** (an avatar) in a **private** R2 bucket. The Worker is the only door to the bucket. The bucket has no public address, and the Worker reaches it through a binding, so there are no access keys in the code.

## Routes

| Method and path | Needs a token | Answer |
|---|---|---|
| `OPTIONS` (any path) | No | `204`, CORS headers, empty body |
| `GET /health` | No | `200` `{ "ok": true }` |
| `PUT /avatar` | Yes | `201` `{ "key": "users/<uid>/avatar", "size": <bytes>, "contentType": "image/png" }` |
| `GET /avatar` | Yes | `200` with the picture, or `404` `{ "error": "not-found" }` |
| `DELETE /avatar` | Yes | `204`, also when nothing was stored |
| any other path | No | `404` `{ "error": "not-found" }` |
| wrong method on a known path | | `405` `{ "error": "method-not-allowed" }` with `Allow: GET` for `/health` and `Allow: GET, PUT, DELETE` for `/avatar` |

Sign-in is checked **before** the body is read. No token or a bad token gives `401`; keys that cannot be downloaded give `503` (this is already written in `authenticate`).

## The storage key

The key is always `users/<uid>/avatar`, built by `avatarKey` from the **verified** uid. It is never taken from the URL, the query string, a header or the body. `avatarKey` throws `invalid-uid` unless the uid has 1 to 128 characters and uses only letters, digits, `_` and `-`. If `avatarKey` throws, the Worker answers `401` `{ "error": "unauthorized" }` and stores or reads nothing. Real Firebase uids are always safe, so this is a second line of defence.

## Upload checks

| Check | Result |
|---|---|
| `Content-Length` header larger than 2 MB | `413` at once, without reading the body |
| No bytes | `400` `{ "error": "empty-file" }` |
| More than 2 MB (2 * 1024 * 1024 bytes; exactly 2 MB is allowed) | `413` `{ "error": "payload-too-large" }` |
| Content-Type missing, or not `image/png` or `image/jpeg` | `415` `{ "error": "unsupported-media-type" }` |
| The first bytes are not the declared type (a PNG or JPEG signature) | `415` `{ "error": "unsupported-media-type" }` |
| The bucket fails | `500` `{ "error": "storage-error" }`, the real reason only in the log |

The order inside `validateUpload` matters: empty, too large, unsupported type, content mismatch.

## Stored data and answers

- Store the object with its content type (`httpMetadata`) and `customMetadata` with `uploadedBy` (the uid) and `uploadedAt` (an ISO time).
- A `GET` answer carries `Content-Type` (the stored type), `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`, plus the CORS headers.
- Every answer, including errors, carries the CORS headers. The allowed origin is never `*`.

## Working method

1. Run `npm test` and observe the failing tests.
2. Implement `src/files.ts` until every `files` test passes.
3. Implement `src/index.ts` following the TODO comments until every `handler` test passes.
4. Run the Worker locally (`npm run dev` and `npm run jwks`) and use `curl` with the files in `samples/`.
5. Read your code once more and ask: "Could anyone store a file at a place that is not theirs, store something that is not a picture, or read someone else's picture?"

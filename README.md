# Cloudflare R2 Starter

Week 1 exercise: write a Cloudflare Worker in TypeScript that stores and serves pictures in a **private** R2 bucket, with strict checks on what may be uploaded.

## What you will learn

- What object storage is and how it differs from a database
- Why the bucket stays private and is reached only through a Worker binding
- Validating uploads: size, declared type, and the real type from the first bytes
- Letting the server choose the storage key
- Running a Worker against a simulated R2 bucket on your computer
- (Optional, needs a payment method) Creating a real R2 bucket and deploying

## Prerequisites

- Node.js 20.3 or newer (`node -v`)
- Git
- A Cloudflare account **only** for the optional real-bucket part (Part E)

Parts A to D run on your computer with a simulated bucket. **No card is needed for them.** Part E uses a real R2 bucket, which needs a payment method on your Cloudflare account. Read the instruction document first.

## Setup

```
npm install
npm test
```

On the first run the tests fail. This is expected, because the code is not written yet.

## Parts

- **Part A:** write `src/files.ts` until the `files` tests pass.
- **Part B:** write `src/index.ts` until the `handler` tests pass.
- **Part C:** run locally with `npm run dev` and `npm run jwks`, and upload the files in `samples/` with `curl`.
- **Part D:** add your own tests and the safeguard table.
- **Part E (optional, needs a payment method):** create a real private R2 bucket, deploy, test, and clean up.

Read `docs/SPEC.md` first. The instruction document explains each part in detail.

## Deliverables

- Repository link with your completed `files.ts` and `index.ts` (no `node_modules`, no `.dev.vars`, no tokens)
- Output of `npm test` with all tests passing
- Output of your `curl` calls (hide any token) from Part C
- Your two additional tests
- A table: for each safeguard in your code, which risk it prevents and how you proved it

## Rules of the exercise

- Never commit `.dev.vars`, tokens, keys or any secret.
- A token is a credential. Do not paste a real token into chat, the report or a screenshot.
- Never make a bucket public. Do not enable an r2.dev address or a public custom domain for it.
- Never set `JWKS_URL` in a deployed Worker.
- Never put card or billing details anywhere except the official Cloudflare pages.
- Be ready to explain every line of your code in the review.

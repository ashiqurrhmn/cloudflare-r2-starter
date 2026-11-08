// A local stand-in for Google's public key server, for testing on your own computer.
//
//   npm run jwks
//
// It creates a fresh RSA key pair, serves the PUBLIC key at http://127.0.0.1:8788/jwks,
// and prints two ID tokens signed with the PRIVATE key (one valid, one expired).
// With JWKS_URL pointing here (see .dev.vars.example), your Worker accepts these tokens
// exactly as it would accept a real Firebase token, without any Firebase project.
//
// The keys exist only while this script is running. Stop it with Ctrl+C.
// Nothing here is a real credential.

import crypto from 'node:crypto';
import http from 'node:http';

const PORT = Number(process.env.JWKS_PORT || 8788);
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'demo-intern-r2';
const KID = 'dev-key-1';

const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: KID, alg: 'RS256', use: 'sig' };

const b64url = (value) => Buffer.from(value).toString('base64url');

function makeToken({ expiresInSec }) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT', kid: KID };
  const payload = {
    iss: `https://securetoken.google.com/${PROJECT_ID}`,
    aud: PROJECT_ID,
    sub: 'dev-user-1',
    email: 'dev@example.com',
    iat: now - 5,
    auth_time: now - 5,
    exp: now + expiresInSec,
  };
  const input = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.sign('RSA-SHA256', Buffer.from(input), privateKey);
  return `${input}.${b64url(signature)}`;
}

http
  .createServer((req, res) => {
    if (req.url === '/jwks') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    } else {
      res.writeHead(404);
      res.end();
    }
  })
  .listen(PORT, '127.0.0.1', () => {
    const valid = makeToken({ expiresInSec: 3600 });
    const expired = makeToken({ expiresInSec: -60 });
    console.log(`Local key server running at http://127.0.0.1:${PORT}/jwks  (project ID: ${PROJECT_ID})`);
    console.log('\nVALID token (expires in 1 hour):\n' + valid);
    console.log('\nEXPIRED token (should be rejected):\n' + expired);
    console.log('\nTry it (in another terminal, with `npm run dev` running):');
    console.log('  curl http://127.0.0.1:8787/health');
    console.log(`  curl -H "Authorization: Bearer <VALID token>" http://127.0.0.1:8787/me`);
    console.log('\nPress Ctrl+C to stop.');
  });

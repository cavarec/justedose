// Génère une paire de clés VAPID pour le Web Push.
// Usage : npm run vapid
// Puis : clé publique → worker/wrangler.toml (VAPID_PUBLIC_KEY)
//        clé privée   → `npx wrangler secret put VAPID_PRIVATE_KEY` (dans worker/)
import { webcrypto } from 'node:crypto';

const b64url = (buf) => Buffer.from(buf).toString('base64url');

const { publicKey, privateKey } = await webcrypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify'],
);
const pub = new Uint8Array(await webcrypto.subtle.exportKey('raw', publicKey));
const jwk = await webcrypto.subtle.exportKey('jwk', privateKey);

console.log('VAPID_PUBLIC_KEY=' + b64url(pub));
console.log('VAPID_PRIVATE_KEY=' + jwk.d);

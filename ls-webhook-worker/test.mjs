/* ============================================================================
   Test the Lemon Squeezy webhook verifier Worker.
   ----------------------------------------------------------------------------
   Sends three requests to your deployed Worker:
     1) a VALID, correctly-signed event           -> expect 2xx
     2) the same body but with a TAMPERED payload  -> expect 401
     3) a request with NO signature                -> expect 401

   No dependencies — needs Node 18+ (built-in fetch + crypto).

   Run:
     LS_SIGNING_SECRET=your-signing-secret \
     WORKER_URL=https://qm-ls-webhook.<you>.workers.dev \
     node test.mjs

   NOTE: the valid request will actually reach Apps Script and may upgrade the
   account in custom_data.account_email to Pro. Use a throwaway test email
   (set TEST_EMAIL=...) or point APPS_SCRIPT_URL at a staging deployment.
   ========================================================================== */

import { createHmac } from 'node:crypto';

const SECRET = process.env.LS_SIGNING_SECRET;
const URL = process.env.WORKER_URL;
const EMAIL = process.env.TEST_EMAIL || 'webhook-test@example.com';

if (!SECRET || !URL) {
  console.error('Set LS_SIGNING_SECRET and WORKER_URL env vars. See header.');
  process.exit(1);
}

// A minimal but realistic subscription_created payload.
function samplePayload() {
  return JSON.stringify({
    meta: {
      event_name: 'subscription_created',
      custom_data: { account_email: EMAIL },
    },
    data: {
      type: 'subscriptions',
      id: 'test-' + Date.now(),
      attributes: { status: 'active', user_email: EMAIL },
    },
  });
}

function sign(body) {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

async function send(label, { body, signature }) {
  const headers = { 'Content-Type': 'application/json' };
  if (signature !== undefined) headers['X-Signature'] = signature;
  const res = await fetch(URL, { method: 'POST', headers, body });
  const text = await res.text();
  console.log(`\n[${label}]  HTTP ${res.status}`);
  console.log('  body:', text.slice(0, 200));
  return res.status;
}

function assert(label, actual, expectedOk) {
  const pass = expectedOk ? actual >= 200 && actual < 300 : actual === 401;
  console.log(`  => ${pass ? 'PASS ✅' : 'FAIL ❌'} (expected ${expectedOk ? '2xx' : '401'})`);
  return pass;
}

const valid = samplePayload();
const validSig = sign(valid);

// Tamper: keep the signature for `valid`, but change the body.
const tampered = valid.replace(EMAIL, 'attacker@evil.com');

let allPass = true;
allPass &= assert('valid', await send('valid signed event', { body: valid, signature: validSig }), true);
allPass &= assert('tampered', await send('tampered body, old signature', { body: tampered, signature: validSig }), false);
allPass &= assert('missing', await send('no signature header', { body: valid }), false);

console.log(`\n${allPass ? 'ALL TESTS PASSED ✅' : 'SOME TESTS FAILED ❌'}`);
process.exit(allPass ? 0 : 1);

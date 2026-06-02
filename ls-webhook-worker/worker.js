/* ============================================================================
   Lemon Squeezy webhook verifier — Cloudflare Worker
   ----------------------------------------------------------------------------
   WHY THIS EXISTS
     Google Apps Script can't read HTTP headers, so it can't verify Lemon
     Squeezy's "X-Signature" HMAC. This Worker sits in front: it verifies the
     signature against your webhook signing secret using constant-time
     comparison, and ONLY forwards genuine, untampered webhooks to your Apps
     Script /exec URL (adding the shared ?wh_secret your script already checks).

     Lemon Squeezy webhook  ->  this Worker (verifies HMAC)  ->  Apps Script

   ----------------------------------------------------------------------------
   SECRETS (set with `wrangler secret put <NAME>`, never hard-code them):
     LS_SIGNING_SECRET   The signing secret from the Lemon Squeezy webhook page.
     APPS_SCRIPT_URL     Your full /exec URL, e.g.
                         https://script.google.com/macros/s/XXXX/exec
     WH_SHARED_SECRET    The same value as LS_WEBHOOK_SECRET in your Apps Script.

   ----------------------------------------------------------------------------
   THEN, in Lemon Squeezy → Settings → Webhooks, point the Callback URL at this
   Worker (e.g. https://qm-ls-webhook.<you>.workers.dev) instead of Apps Script.
   ========================================================================== */

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    // Read the RAW body — the signature is computed over these exact bytes.
    const raw = await request.text();

    const signature = request.headers.get('X-Signature') || '';
    const ok = await verify(raw, signature, env.LS_SIGNING_SECRET);
    if (!ok) {
      return new Response('Invalid signature', { status: 401 });
    }

    // Verified. Forward the untouched body to Apps Script, appending the
    // shared secret your script checks (?wh_secret=...).
    const target = new URL(env.APPS_SCRIPT_URL);
    target.searchParams.set('wh_secret', env.WH_SHARED_SECRET);

    const resp = await fetch(target.toString(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });

    // Bubble up Apps Script's response (Lemon Squeezy treats 2xx as delivered).
    const text = await resp.text();
    return new Response(text, {
      status: resp.status,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};

/* HMAC-SHA256 verify with constant-time comparison, using Web Crypto. */
async function verify(payload, signatureHex, secret) {
  if (!secret || !signatureHex) return false;

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  const expectedHex = [...new Uint8Array(macBuf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(expectedHex, signatureHex.trim().toLowerCase());
}

/* Length-independent, constant-time string compare. */
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

# Lemon Squeezy webhook verifier (Cloudflare Worker)

Verifies Lemon Squeezy's `X-Signature` HMAC and forwards genuine webhooks to
the Quote Master Apps Script backend. Use this when you want true signature
verification instead of (or in addition to) the `?wh_secret` shared-secret
check that Apps Script does on its own.

```
Lemon Squeezy  ──►  this Worker (verifies HMAC)  ──►  Apps Script /exec
```

## Deploy

1. Install the CLI and log in:
   ```bash
   npm install -g wrangler
   wrangler login
   ```

2. From this folder, set the three secrets:
   ```bash
   cd ls-webhook-worker
   wrangler secret put LS_SIGNING_SECRET   # signing secret from the LS webhook page
   wrangler secret put APPS_SCRIPT_URL     # https://script.google.com/macros/s/XXXX/exec
   wrangler secret put WH_SHARED_SECRET    # same value as LS_WEBHOOK_SECRET in Apps Script
   ```

3. Deploy:
   ```bash
   wrangler deploy
   ```
   Note the URL it prints, e.g. `https://qm-ls-webhook.<you>.workers.dev`.

4. In **Lemon Squeezy → Settings → Webhooks**, set the **Callback URL** to the
   Worker URL (not the Apps Script URL). Keep the same events:
   `subscription_created`, `subscription_updated`, `subscription_cancelled`,
   `subscription_expired`, `subscription_resumed`, `order_created`.

That's it. The Worker rejects anything whose signature doesn't match, so only
authentic, untampered events ever reach your backend.

## Test

**Quickest:** in the Lemon Squeezy webhook page use **Send test event** — a
valid event returns `200`; a tampered body or wrong secret returns `401`.

**Local script** (`test.mjs`, Node 18+, no dependencies) — sends a valid signed
event, a tampered one, and an unsigned one, and asserts the responses:

```bash
LS_SIGNING_SECRET=your-signing-secret \
WORKER_URL=https://qm-ls-webhook.<you>.workers.dev \
TEST_EMAIL=webhook-test@example.com \
node test.mjs
```

Expected:

```
[valid signed event]          HTTP 200   => PASS ✅
[tampered body, old signature] HTTP 401   => PASS ✅
[no signature header]          HTTP 401   => PASS ✅
ALL TESTS PASSED ✅
```

> The **valid** request really reaches Apps Script and will set the account in
> `account_email` to Pro — use a throwaway `TEST_EMAIL` or a staging deployment.

**One-off curl** — a tampered request (a signature that doesn't match the body)
must be rejected with `401`:

```bash
curl -i -X POST "$WORKER_URL" \
  -H 'Content-Type: application/json' \
  -H 'X-Signature: 0000000000000000000000000000000000000000000000000000000000000000' \
  -d '{"meta":{"event_name":"subscription_created","custom_data":{"account_email":"x@x.com"}},"data":{"attributes":{"status":"active"}}}'
# => HTTP/1.1 401 Invalid signature
```

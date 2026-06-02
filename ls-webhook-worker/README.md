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

In the Lemon Squeezy webhook page use **Send test event**. A valid event
returns `200`; a tampered body or wrong secret returns `401` and never reaches
Apps Script.

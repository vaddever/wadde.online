/* ============================================================================
   Lemon Squeezy webhook handler for QuoteMaster (Google Apps Script backend)
   ----------------------------------------------------------------------------
   PURPOSE
     This is the ONLY thing that should grant Pro. The browser never sets
     plan='pro' by itself — it just sends the user to Lemon Squeezy's hosted
     checkout. After a successful payment Lemon Squeezy POSTs to your /exec
     URL; this code verifies the call and flips the matching account to Pro
     (or back to Free when a subscription ends).

   ----------------------------------------------------------------------------
   HOW TO INSTALL
     1) Open your Apps Script project (the one behind the API_URL in
        QuoteMaster.html) and paste these functions into a new .gs file.

     2) Wire it into your existing doPost(e). At the TOP of doPost, before you
        read the JSON `action`, add:

            function doPost(e){
              // Lemon Squeezy webhooks have no "action"; they carry meta.event_name
              var ls = maybeHandleLemonSqueezy(e);
              if (ls) return ls;                 // it was a webhook — we're done
              ...your existing action routing continues below...
            }

     3) Pick a long random secret and store it:
          Project Settings → Script properties → add
            LS_WEBHOOK_SECRET = <some-long-random-string>
        (Generate one, e.g. a 40-char random string. Keep it private.)

     4) In Lemon Squeezy → Settings → Webhooks → Add webhook:
          Callback URL:  https://script.google.com/macros/s/XXXX/exec?wh_secret=<same-secret>
          Signing secret: (Lemon Squeezy generates one — see note on security below)
          Events: subscription_created, subscription_updated,
                  subscription_cancelled, subscription_expired,
                  subscription_resumed, order_created

     5) Deploy a NEW version of the web app (Deploy → Manage deployments →
        Edit → New version) with access set to "Anyone".

   ----------------------------------------------------------------------------
   SECURITY NOTE (read this)
     Lemon Squeezy signs each webhook with an HMAC in the "X-Signature" HTTP
     header. Apps Script web apps CANNOT read request headers, so we can't do
     the standard HMAC check here. Instead we use a shared secret in the URL
     query string (?wh_secret=...), which Apps Script CAN read via e.parameter.
     Over HTTPS this is a reasonable safeguard for a small app.

     If you want true HMAC verification, put a tiny Cloudflare Worker (or
     Vercel function) in front: it verifies X-Signature against the signing
     secret, then forwards the body to this Apps Script URL. Ask Claude to
     generate that Worker if you'd like to harden it.
   ========================================================================== */

function maybeHandleLemonSqueezy(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) return null;
    var body = JSON.parse(e.postData.contents);

    // Only handle Lemon Squeezy payloads (they have meta.event_name).
    if (!body || !body.meta || !body.meta.event_name) return null;

    // 1) Verify the shared secret from the URL (?wh_secret=...)
    var expected = PropertiesService.getScriptProperties().getProperty('LS_WEBHOOK_SECRET');
    var got = e.parameter && e.parameter.wh_secret;
    if (!expected || got !== expected) {
      return jsonOut({ ok: false, error: 'bad secret' });
    }

    var event = body.meta.event_name;
    var custom = (body.meta.custom_data) || {};
    var attrs  = (body.data && body.data.attributes) || {};

    // 2) Figure out which account this payment belongs to.
    //    We passed account_email as custom data from the checkout button.
    //    Fall back to the billing email Lemon Squeezy collected.
    var email = (custom.account_email || attrs.user_email || attrs.email || '').toString().toLowerCase().trim();
    if (!email) return jsonOut({ ok: false, error: 'no email in webhook' });

    // 3) Decide the resulting plan from the event.
    var goPro = (
      event === 'subscription_created' ||
      event === 'subscription_resumed' ||
      event === 'order_created' ||
      (event === 'subscription_updated' && attrs.status === 'active')
    );
    var goFree = (
      event === 'subscription_cancelled' ||
      event === 'subscription_expired' ||
      (event === 'subscription_updated' &&
        (attrs.status === 'expired' || attrs.status === 'unpaid' || attrs.status === 'cancelled'))
    );

    if (goPro)       setUserPlanByEmail(email, 'pro');
    else if (goFree) setUserPlanByEmail(email, 'free');
    // other events (e.g. subscription_payment_success) can be ignored or logged

    return jsonOut({ ok: true });
  } catch (err) {
    return jsonOut({ ok: false, error: String(err) });
  }
}

/* ----------------------------------------------------------------------------
   ADAPT THIS to however YOUR backend stores users.
   The two operations you must provide:
     - find the user record by (lowercased) email
     - read its `db` JSON, set db.settings.plan, write it back

   The version below assumes a Google Sheet named "Users" with header columns
   that include  "email"  and  "db"  (the db column holds the JSON string that
   loadDb/saveDb read & write). If your schema differs, change the two marked
   lines — the rest can stay.
---------------------------------------------------------------------------- */
function setUserPlanByEmail(email, plan) {
  var sheet = SpreadsheetApp.getActive().getSheetByName('Users');   // <-- your users sheet
  if (!sheet) throw new Error('Users sheet not found');

  var values = sheet.getDataRange().getValues();
  var header = values[0];
  var emailCol = header.indexOf('email');                            // <-- your email column name
  var dbCol    = header.indexOf('db');                               // <-- your db (JSON) column name
  if (emailCol < 0 || dbCol < 0) throw new Error('email/db columns not found');

  for (var r = 1; r < values.length; r++) {
    if (String(values[r][emailCol]).toLowerCase().trim() === email) {
      var db = {};
      try { db = JSON.parse(values[r][dbCol] || '{}'); } catch (e) {}
      if (!db.settings) db.settings = {};
      db.settings.plan = plan;
      sheet.getRange(r + 1, dbCol + 1).setValue(JSON.stringify(db));
      return true;
    }
  }
  // No match: payment came in for an email we don't recognise. Log it so you
  // can reconcile manually (e.g. they paid with a different email).
  console.warn('Lemon Squeezy: no account for ' + email + ' (plan=' + plan + ')');
  return false;
}

/* Small helper — return JSON to the caller. If your project already has one of
   these, delete this and use yours. */
function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

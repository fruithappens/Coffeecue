/**
 * Coffee Cue -> Google Sheet live feed (optional upgrade to the mirror).
 *
 * One-time setup, ~5 minutes, in YOUR Google account (Claude can't do
 * this part - it's your login):
 *   1. Create a new Google Sheet (name it e.g. "CoffeeCue LIVE").
 *   2. Extensions -> Apps Script -> delete the stub, paste this file.
 *   3. Deploy -> New deployment -> type "Web app" ->
 *      execute as Me, access "Anyone with the link" -> Deploy.
 *   4. Copy the web-app URL, then on the laptop:
 *        export SHEET_WEBHOOK_URL="that url"
 *        bash testbench/run_live_mirror.sh
 *   5. Keep the Sheet open in a tab - it rewrites itself every poll
 *      and survives the app AND the laptop dying.
 */
function doPost(e) {
  var body = JSON.parse(e.postData.contents);
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  sh.clearContents();
  sh.appendRow(['Synced', body.synced_at, 'live orders:', body.rows.length]);
  sh.appendRow(['Order', 'Status', 'Station', 'Name', 'Drink', 'Milk', 'Created']);
  body.rows.forEach(function (r) {
    sh.appendRow(['#' + r.order, r.status, r.station, r.name, r.drink, r.milk, r.created]);
  });
  return ContentService.createTextOutput('ok');
}

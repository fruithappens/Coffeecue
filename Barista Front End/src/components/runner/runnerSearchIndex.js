// Search the Runner (and point to the rest of CupQ). Steve: "so many options ... would be great if there
// was a search, ie you're wanting to find all areas that have to do with
// sponsor ... I just struggle to find stuff, looking for the sms off
// switch."
//
// One entry per page (section, or section/tab) and one per named control a
// person goes looking for (the Texts off switch, the event code, the
// sponsor wall). `words` is how people ask for it, not how the code names
// it. A test checks every page in runnerNav has an entry, so a new page
// can't be left out of search.

export const SEARCH_INDEX = [
  // ---------------------------------------------------------------- Set up
  { section: 'quickSetup', title: 'Quick Setup', what: 'Set up a whole event in one go: name, milks, cup sizes, sugar, drinks, teas, prices.',
    words: 'setup start new event template milks sizes cups sweeteners sugar drinks teas chai matcha hot chocolate pricing price surcharge saved events import unlimited stock walk-in' },
  { section: 'quickSetup', title: 'Prices and surcharges', what: 'Per-drink price, alternative milk and size surcharges.', where: 'Quick Setup',
    words: 'price pricing cost charge surcharge pay payment money dollars' },
  { section: 'menu', tab: 'inventory', title: 'Event Inventory', what: "What's on the menu for the event: milks, drinks, sugar, and their stock.",
    words: 'menu inventory items milk drinks sugar sweetener add item categories turn off stock' },
  { section: 'menu', tab: 'stock', title: 'Event Stock', what: 'Count stock, coffee per shot, recipes, cup reconciliation, which station has what.',
    words: 'stock count beans coffee dose grams shot recipe recipes cups reconciliation allocation ingredients run out low' },
  { section: 'menu', tab: 'stationInventory', title: 'Station Inventory', what: 'What each station can make: its milks, drinks and sizes.',
    words: 'station inventory capabilities what each station makes milks sizes copy station' },
  { section: 'menu', tab: 'quickPicks', title: 'Quick picks', what: 'One-tap drinks on the ordering screens.',
    words: 'quick picks one tap favourite button shortcut popular drink' },
  { section: 'stations', title: 'Stations', what: 'Add, rename, open or close coffee stations; their milks and walk-in defaults.',
    words: 'station stations cart add station delete station open close milks walk-in defaults capacity barista' },
  { section: 'branding', tab: 'logo', title: 'Logo & look', what: 'Event name, logo, colours, backgrounds, the board message and the SMS order number.',
    words: 'branding brand logo event name colour color theme background image video header message footer client look sms number order number phone number text number' },
  { section: 'branding', tab: 'sponsors', title: 'Sponsors', what: 'Sponsor logos and tiers, thank-you line, scrolling ticker, sponsor wall, takeover of the board.',
    words: 'sponsor sponsors logos tiers thank you ticker scrolling wall takeover partner' },
  { section: 'branding', tab: 'labels', title: 'Labels', what: 'The logo printed on cup stickers.',
    words: 'label labels sticker stickers cup print logo sponsor' },
  { section: 'branding', tab: 'milk', title: 'Milk colours', what: 'The colour each milk shows in, for baristas and labels.',
    words: 'milk colour color colours legend' },
  { section: 'branding', tab: 'wording', title: 'Phone wording', what: "The words on the customer's phone page.",
    words: 'phone wording words copy text customer page my order screen' },
  { section: 'schedule', title: 'Schedule', what: 'Sessions and breaks, which stations open when, barista rosters, station lock.',
    words: 'schedule timeline sessions breaks open close hours roster baristas assignment lock station control alert' },
  { section: 'users', tab: 'people', title: 'People', what: 'Logins for baristas, organisers and staff; passwords and two-step sign-in.',
    words: 'people users staff barista login logins account password pin add person two-step 2fa' },
  { section: 'users', tab: 'onCall', title: 'On call', what: 'Who gets alerts and calls when something goes wrong.',
    words: 'on call roster alerts phone contact emergency who to call' },
  { section: 'users', tab: 'access', title: 'Roles & access', what: 'What each role can see and do.',
    words: 'roles access permissions who can see' },

  // ----------------------------------------------------------- Run the day
  { section: 'live', tab: 'readiness', title: 'Readiness', what: 'Pre-event checks: send a test text, a test order, admin alerts.',
    words: 'readiness check ready test order test sms test text alerts before event' },
  { section: 'live', tab: 'board', title: 'Live board', what: 'Every station live, quick actions, emergency alert.',
    words: 'live board stations status command centre center emergency alert' },
  { section: 'live', tab: 'metrics', title: 'Metrics', what: "Today's orders, waits, throughput, pause all orders.",
    words: 'metrics dashboard numbers wait times throughput today pause orders stop' },
  { section: 'orders', tab: 'all', title: 'All orders', what: 'Find, change or cancel any order.',
    words: 'orders find order search cancel refund customer number' },
  { section: 'orders', tab: 'groups', title: 'Group orders', what: 'Orders for a group, a team or a meeting room.',
    words: 'group orders team meeting bulk round many coffees' },
  { section: 'messages', tab: 'notice', title: 'Tell everyone', what: 'One message on every board, phone page and (optionally) by text.',
    words: 'tell everyone notice announcement message board screens phones broadcast run out' },
  { section: 'messages', tab: 'broadcast', title: 'Text blast', what: 'Send a text to everyone who ordered.',
    words: 'text blast sms broadcast send message everyone templates' },
  { section: 'messages', tab: 'wording', title: 'Text wording', what: 'The words in every text the bot sends.',
    words: 'text wording sms words bot replies message copy' },
  { section: 'messages', tab: 'test', title: 'Test a text', what: 'Try the text bot without sending real texts.',
    words: 'test text sms simulator try bot' },
  { section: 'messages', tab: 'meter', title: 'Text meter', what: 'How many texts this event has used, the cap, and the Texts off switch.',
    words: 'text meter sms count usage cost bill cap limit' },
  { section: 'messages', tab: 'meter', title: 'Texts off', where: 'Messages > Text meter', what: 'Run the event with no texts: no mobile asked for, no SMS number shown.',
    words: 'texts off sms off no sms no texts turn off texts disable sms stop texts switch digital only phone only' },
  { section: 'messages', tab: 'blocked', title: 'Blocked numbers', what: 'Phone numbers the text bot ignores.',
    words: 'blocked numbers block spam phone ban' },
  { section: 'screens', title: 'Screens', what: 'Every screen CupQ can show: order board, sponsor wall, how-to-order poster, customer page, touch ordering.',
    words: 'screens display board tv monitor tablet kiosk touch poster qr code how to order sponsor wall beacon customer page ops board set up device' },
  { section: 'screens', title: 'Sponsor wall', where: 'Screens', what: 'Your sponsors, full screen, on a loop.',
    words: 'sponsor wall sponsors full screen loop' },
  { section: 'screens', title: 'How to order poster / QR code', where: 'Screens', what: 'The poster with the QR code people scan to order.',
    words: 'qr code poster how to order scan print sign' },
  { section: 'printers', title: 'Printers', what: 'Label printers: pair, check, reprint or cancel jobs.',
    words: 'printers printer label sticker print pair reprint queue jobs' },

  // ----------------------------------------------------- Review & system
  { section: 'report', tab: 'summary', title: 'Event report', what: 'Coffees made, waits, busiest hour, milks, texts, payments, per station.',
    words: 'report summary results numbers coffees waits busiest milk texts payments export pdf after event' },
  { section: 'report', tab: 'ledger', title: 'Ledger', what: 'What to bill the client: add-ons, hardware, travel.',
    words: 'ledger invoice bill client charges hardware travel quote' },
  { section: 'system', tab: 'health', title: 'Health', what: 'Is the server healthy: CPU, memory, database space.',
    words: 'health server cpu memory database space slow' },
  { section: 'system', tab: 'diagnostics', title: 'Diagnostics', what: 'Self-tests and recent errors.',
    words: 'diagnostics errors crashes tests problems' },
  { section: 'system', tab: 'enquiries', title: 'Enquiries', what: 'Sign-ups, demo requests and help requests.',
    words: 'enquiries sign ups signups demo requests help requests leads' },
  { section: 'system', tab: 'fleet', title: 'Fleet', what: 'Every CupQ copy running for clients.',
    words: 'fleet copies instances clients servers' },
  { section: 'eventsair', title: 'EventsAir', what: 'Attendee list, event access code, surveys, embed code for the event app.',
    words: 'eventsair events air attendees badge registration survey webhook embed app access code' },
  { section: 'eventsair', title: 'Event access code', where: 'EventsAir', what: 'The code people need to order on the web.',
    words: 'event code access code ordering code password qr' },
  { section: 'settings', title: 'Settings', what: 'Release freeze, export the event, bring back a past event, wipe for the next client.',
    words: 'settings export backup restore past event wipe reset next client retire freeze release' },
  { section: 'emergency', title: 'Emergency', what: 'Stop or pause everything, fast.',
    words: 'emergency stop pause everything panic outage down' },
  // ------------------------------------------ elsewhere in CupQ (new tab)
  // Not Runner pages: `href` opens that part of the app in a new tab, and
  // the result says so ("Opens Barista"), so nobody hunts the Runner for a
  // thing that lives on the barista's tablet.
  { href: '/barista', app: 'Barista', title: 'Barista queue', where: 'Barista app > Queue', what: 'The live queue a barista works: start, ready, write on the cup.',
    words: 'barista queue orders make start ready cups write tablet ipad phone station' },
  { href: '/barista', app: 'Barista', title: 'Report low stock (barista)', where: 'Barista app > Stock', what: 'Baristas mark a milk or item low or out from the station.',
    words: 'barista stock low out run out 86 milk report' },
  { href: '/barista', app: 'Barista', title: 'Shot timer and dial-in', where: 'Barista app > Tools', what: 'Shot timer, recipes and the shared grinder dial-in.',
    words: 'barista tools shot timer dial in grinder recipes espresso' },
  { href: '/barista', app: 'Barista', title: 'Auto-print labels (this tablet)', where: 'Barista app > header', what: 'Turn sticker printing on or off for one barista tablet.',
    words: 'auto print labels stickers printer barista tablet' },
  { href: '/displays', app: 'Screens', title: 'All screens', where: 'Screens app', what: 'Open the order board, sponsor wall or poster on this device.',
    words: 'screens display board tv sponsor wall poster beacon' },
  { href: '/sponsors', app: 'Screens', title: 'Sponsor wall (open it)', where: 'Screens app > Sponsor wall', what: 'The full-screen sponsor loop, on this device.',
    words: 'sponsor wall sponsors full screen' },
  { href: '/my', app: 'Customer', title: "Customer's ordering page", where: 'Customer page (/my)', what: 'Order as a customer would, on a phone.',
    words: 'customer page order phone my order test ordering qr' },

  { section: 'help', title: 'Help', what: 'How-to pages for every part of CupQ.',
    words: 'help how to guide instructions' },
];

// Ways people say the same thing. A query word also matches its partners.
const SAME = [
  ['sms', 'text', 'texts', 'texting', 'message', 'messages'],
  ['colour', 'color', 'colours', 'colors'],
  ['sticker', 'stickers', 'label', 'labels'],
  ['staff', 'people', 'users', 'user', 'login', 'logins', 'barista', 'baristas'],
  ['screen', 'screens', 'display', 'board', 'tv', 'monitor'],
  ['off', 'disable', 'stop', 'none'],
  ['sponsor', 'sponsors', 'sponsorship', 'partner'],
  ['price', 'prices', 'pricing', 'cost', 'charge'],
  ['qr', 'poster', 'scan'],
];
const PARTNERS = {};
SAME.forEach((group) => group.forEach((w) => { PARTNERS[w] = group; }));

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9& ]+/g, ' ');

// Every query word (or one of its partners) must appear somewhere in the
// entry. Matches in the title rank above matches only in the words.
export function searchRunner(query, index = SEARCH_INDEX) {
  const q = norm(query).split(/\s+/).filter(Boolean);
  if (!q.length) return [];
  const scored = [];
  index.forEach((e, i) => {
    const title = norm(e.title);
    const hay = `${title} ${norm(e.what)} ${norm(e.words)} ${norm(e.where)}`;
    let score = 0;
    for (const w of q) {
      const forms = PARTNERS[w] || [w];
      const hit = (s) => forms.some((f) => s.split(' ').some((t) => t.startsWith(f)));
      if (hit(title)) score += 3;
      else if (hit(hay)) score += 1;
      else return;
    }
    scored.push({ ...e, score, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i);
}

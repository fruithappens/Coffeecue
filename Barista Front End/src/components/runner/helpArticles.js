// helpArticles.js — the Runner's help pages (roadmap U4-2).
//
// One page per Runner section (same ids as runnerNav.SECTIONS, so the Help
// button in the header can open the page for wherever you are), plus a few
// guides that cross sections. Plain English for the organiser, not the
// developer. A unit test fails if a section has no page.
//
// Each page: title, summary (one line), steps (numbered, optional), points
// (bullets, optional), and `open` = the section (and tab) it's about, so the
// page can take you there.

export const GUIDES = [
  {
    id: 'start',
    title: 'Set up an event, start to finish',
    summary: 'The order that works, from an empty copy to the first coffee.',
    steps: [
      'Quick Setup: name the event, pick the drinks, milks and cup sizes, and how many stations. Save it as a saved event so you can load it again next time.',
      'Branding: add the event logo and colour. The phone page, kiosk and board all wear it.',
      'Stations: give each station a name and where it is ("East Wing"). Customers are told where to collect.',
      'People: add a login for each barista, or set a PIN per person (People > Unlock PINs).',
      'Printers: if you use cup labels, plug the printer into the venue network, then switch it on and give it a station here.',
      'Screens: open the board on the TV and the kiosk on the tablet (each has its own link).',
      'Live > Readiness: work down the list until everything is green, then place one test order from your phone.',
    ],
    open: { section: 'quickSetup' },
  },
  {
    id: 'onTheDay',
    title: 'On the day',
    summary: 'What to keep an eye on while coffee is being served.',
    points: [
      'Live > Board shows every station, its queue and how long people are waiting.',
      'cupq.app/status is a one-page "is it working?" for the venue or client. No login, nothing personal on it.',
      'If something stops (a printer, the texts) and admin alerts are set up, you get a text within about two minutes, and another when a printer is back.',
      'Messages > Tell everyone puts one message on the board, the phones and the barista screens at once ("Station 2 is closing at 11").',
      'Baristas can press the ? button on their screen to ask for help. It arrives in System > Enquiries with what they were looking at.',
    ],
    open: { section: 'live' },
  },
  {
    id: 'faq',
    title: 'Questions people ask',
    summary: 'Quick answers.',
    qa: [
      ['Do customers need the app or an account?', 'No. They scan the QR or tap the kiosk, type a first name and order. A phone number is optional and only used to text them when it is ready.'],
      ['What if the venue wifi drops?', 'Barista screens keep working from what they last loaded and catch up when the connection is back. Phones on mobile data are not affected.'],
      ['What if texts stop working?', 'The board and every customer\'s phone page still show their name and status, and the barista screen shows a banner telling staff to call names. You get an alert if admin alerts are set up.'],
      ['Can I run the same event again next year?', 'Yes. Save it in Quick Setup (saved events). Loading it brings back the menu, stations and the whole look.'],
      ['What happens to attendees\' details afterwards?', 'Settings > Retire this event erases names, phone numbers and notes and keeps the order counts for the report. You can also set it to happen automatically a number of days after each order.'],
      ['Someone ordered the wrong thing. Can it be changed?', 'Cancel it (Orders > All Orders, or from the barista screen) and place the right one. Customers can cancel their own order from their phone page while it is still in the queue.'],
      ['How many people can it handle?', 'It has been tested with 1,000 phones following their orders at once, with no orders lost.'],
    ],
  },
];

export const SECTION_HELP = {
  quickSetup: {
    title: 'Quick Setup',
    summary: 'The fastest way to set up an event: menu, stations and look in one place.',
    steps: [
      'Name the event and choose the drinks, milks, cup sizes and sweeteners you are serving.',
      'Choose how many stations, and whether they all make everything.',
      'Save it as a saved event. Next time, load it and everything comes back, including the look.',
    ],
    points: [
      'Loading a saved event replaces the menu and the look. Save the current event first if you want to come back to it.',
      'A saved event can be exported as a file and imported on another copy.',
    ],
    open: { section: 'quickSetup' },
  },
  menu: {
    title: 'Menu',
    summary: 'What can be ordered, and how much of it there is.',
    points: [
      'Event Inventory: every drink, milk, cup and extra. Switch items on or off for this event.',
      'Event Stock: how much of each item you have. Items run out on their own when stock hits zero.',
      'Station Inventory: what each station can make, if they differ (one station without oat milk, say).',
      'Quick picks: up to four one-tap drinks at the top of the ordering screen ("Flat white", "Oat latte").',
    ],
    open: { section: 'menu' },
  },
  stations: {
    title: 'Stations',
    summary: 'Each coffee station: its name, where it is and whether it is open.',
    points: [
      'The location you type ("Main Hall", "East Wing") is what customers are told when their coffee is ready.',
      'Set a station to inactive to stop new orders going to it. Orders already in its queue stay.',
      'Orders are shared between open stations that can make the drink.',
    ],
    open: { section: 'stations' },
  },
  branding: {
    title: 'Branding',
    summary: 'The look customers see: logo, colour, sponsors, labels.',
    points: [
      'Logo & look: the event logo, name and colour for the phone page, kiosk and board.',
      'Sponsors: logos that scroll along the bottom of the board and phone page.',
      'Labels: what is printed on each cup label.',
      'Milk colours: the colour each milk shows on barista screens and labels, so oat never gets mixed up with full cream.',
      'Phone wording: the big line on a customer\'s phone at each stage ("In the queue", "READY — come and get it"). Leave a line empty to keep ours.',
    ],
    open: { section: 'branding' },
  },
  schedule: {
    title: 'Schedule',
    summary: 'When ordering is open, and when each station is staffed.',
    points: [
      'Outside the open times, customers see that ordering is closed instead of placing an order nobody will make.',
    ],
    open: { section: 'schedule' },
  },
  users: {
    title: 'People',
    summary: 'Who can log in, and what they can do.',
    points: [
      'People: add a login for each person and choose their role. Baristas only see the barista screen.',
      'Unlock PINs: give each person their own PIN for unlocking a station screen. The log shows who unlocked it.',
      'Roles & access: what each role can open.',
      'Change your own password here, and never share the admin login.',
    ],
    open: { section: 'users' },
  },
  live: {
    title: 'Live',
    summary: 'Is the event ready, and how is it going right now?',
    points: [
      'Readiness: a checklist before doors open. Each item says what is wrong and has a button to fix it. Aim for all green.',
      'Board: every station\'s queue and wait time, live.',
      'Metrics: orders per hour, average wait and completion times.',
      'Set the admin alert phone and email in Readiness, so you are texted when a printer or the texts stop.',
    ],
    open: { section: 'live' },
  },
  orders: {
    title: 'Orders',
    summary: 'Every order, and group orders for a table or a team.',
    points: [
      'All Orders: find any order by name or number, see where it is, and cancel it if needed.',
      'Group Orders: enter several drinks under one name. They go to one station and come out together.',
    ],
    open: { section: 'orders' },
  },
  messages: {
    title: 'Messages',
    summary: 'Telling people things, and checking the texts work.',
    points: [
      'Tell everyone: one message on the board, the phones and the barista screens at once.',
      'Text blast: a text to everyone who gave a number. Each text costs money, so use it sparingly.',
      'Test a text: try the text-ordering conversation without sending anything.',
      'Text meter: how many texts this event has used against its allowance.',
      'Blocked numbers: numbers that will never be texted. (Someone who replies STOP is stopped by the text provider itself.)',
    ],
    open: { section: 'messages' },
  },
  screens: {
    title: 'Screens',
    summary: 'Every screen CupQ can put up, and the link for each.',
    points: [
      'The board: names being made and ready to collect, for a TV.',
      'The kiosk: a touchscreen people order from, with a QR so they can follow their order on their phone.',
      'Open a screen on the device, make it full screen, and leave it. It keeps itself up to date.',
      'Tap the board once to switch its sound on, so it chimes when a coffee is ready.',
    ],
    open: { section: 'screens' },
  },
  printers: {
    title: 'Printers',
    summary: 'Cup label printers: switching them on and keeping them printing.',
    steps: [
      'Plug the printer into power and the venue network and turn it on. Within a minute it appears here as a new printer.',
      'Switch it on and choose its station.',
      'Print a test label.',
    ],
    points: [
      'A printer that stops checking in during service raises an alert, and the status page shows "Cup labels" amber or red.',
      'If labels stop, check power, paper and the network cable first.',
      'A printer away for the day? Switch it off here so it does not show as down.',
    ],
    open: { section: 'printers' },
  },
  report: {
    title: 'Report',
    summary: 'After the event: how many coffees, when, and how fast.',
    points: [
      'Pick a day or a range. Times are in the event\'s own time zone.',
      'Download it to send to the client.',
    ],
    open: { section: 'report' },
  },
  system: {
    title: 'System',
    summary: 'Behind the scenes: health, problems and requests for help.',
    points: [
      'Health: is the server, database and texting working.',
      'Diagnostics: tablet and server errors, grouped, with how often each happened.',
      'Enquiries: demo requests from the website, and help requests sent with the ? button.',
      'Fleet: every CupQ copy you run, and whether each is up.',
    ],
    open: { section: 'system' },
  },
  eventsair: {
    title: 'EventsAir',
    summary: 'Linking CupQ to an EventsAir event, for attendee lookups.',
    points: [
      'Pick the EventsAir event, and CupQ keeps a copy of its attendee list up to date.',
      'Attendees can then be recognised by their badge or phone number when they order.',
      'Switch sync off after the event.',
    ],
    open: { section: 'eventsair' },
  },
  settings: {
    title: 'Settings',
    summary: 'Saving, bringing back and retiring an event\'s data.',
    points: [
      'Export this event: a file with everything, kept somewhere safe.',
      'Retire this event: erases attendees\' names, phone numbers and notes, keeps the counts for the report. It backs up first.',
      'Automatic erase: set a number of days and attendee details are erased that long after each order.',
      'Plan: which CupQ plan this event is on, and its text allowance.',
    ],
    open: { section: 'settings' },
  },
  emergency: {
    title: 'Emergency',
    summary: 'For when something has gone badly wrong.',
    points: [
      'Back up now before trying anything else.',
      'Restore from a backup if data has been lost or changed by mistake.',
      'Reset the event clears customer data. It cannot be undone, so back up first.',
      'Not sure? Press the ? button, or ring CupQ support before pressing anything here.',
    ],
    open: { section: 'emergency' },
  },
  help: {
    title: 'Help',
    summary: 'These pages. Press Help at the top of any Runner page to land on the page about it.',
    open: { section: 'help' },
  },
};

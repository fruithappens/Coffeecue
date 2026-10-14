# CupQ data map (for the lawyer)

**Draft, 15 Oct 2026. Not legal advice.** Roadmap L6-1. This is what the
software actually stores, written from the code, so the privacy policy and
terms can be checked against reality. Blanks in [square brackets] are for
Steve to fill.

## Who's who

| Role | Who |
|---|---|
| Runs the service | [CupQ trading name, ABN, address], hello@cupq.com.au |
| Client | The event organiser or venue that books CupQ (e.g. a conference) |
| Attendee / customer | The person who orders a coffee |
| Staff | The client's or CupQ's baristas and organisers who log in |

Each client gets their own copy of CupQ (its own server and database), so
one client's attendees never share a database with another's.

## What is stored about attendees

| Data | Where it comes from | Why | Kept until |
|---|---|---|---|
| First name (or name typed) | Typed when ordering, or the client's attendee list | Called out / shown on the board when the coffee is ready | Erased when the event is retired, or automatically N days after the order if the client sets it |
| Mobile number (optional) | Typed when ordering, texting an order, or the attendee list | Text when the coffee is ready; let them find their order | As above |
| The order (drink, milk, size, notes, time, station) | The order itself | Making it; the event report | The order stays for the report; name, phone and notes are removed from it on erase |
| Saved usual drink, preferences, allergy notes if typed | The attendee's own choices | Faster re-ordering | Erased with the event |
| Text conversations | Texts the attendee sends to the event number | Ordering by text | Erased with the event |
| Texts sent (number, wording) | The system | Delivery checks and cost | Number and wording erased with the event; counts kept |
| Attendee list (name, email, mobile, badge number, registration category) | The client's EventsAir event, if linked | Recognising attendees when they order | Erased with the event; sync switched off by the client |
| A reminder of their own order on their phone | Stored in the phone's browser (localStorage), not on the server | Coming back to their order | Cleared when the order is finished, or by the browser |

Not stored: payment card details (if an event charges, Square handles the
card), passwords for attendees (they have no account), location.

## What is stored about staff

Username, name, email, role, a hashed password, a hashed PIN, an optional
authenticator secret, login times and failed-login counts, who unlocked a
station screen and when. Kept while they have an account.

## What is stored about the client and enquiries

Website "book a demo" form: name, organisation, email, phone, event date,
message, IP address. Help requests from staff screens: who sent it, what they
typed, which screen. Kept until deleted by CupQ (no automatic deletion yet).

## Technical records

- **Server access log:** every request's address, time, IP address and
  browser. Phone numbers in addresses are masked to the last 3 digits (since
  Oct 2026). Held by the hosting provider's log service (Railway) for its
  standard retention.
- **Error reports** from tablets and the server: error text, page address,
  browser.
- **Usage events** from screens (which buttons were used), with no personal
  details.

## Where it lives (subprocessors)

| Who | What for | Where |
|---|---|---|
| Railway (Railway Corp., USA) | Servers and databases | cupq.app in US West (Oregon); demo.cupq.app in Singapore |
| Cloudflare (USA) | Web address, security, caching | Global |
| Twilio (USA) | Sending and receiving texts | USA |
| GitHub (Microsoft, USA) | Source code, automated checks. No attendee data | USA |
| EventsAir (Lightbox, Australia) | Only if the client links their event | Per the client's EventsAir account |
| Square (USA/Australia) | Only if the event charges for coffee | Square |
| Microsoft 365 | CupQ's email (hello@cupq.com.au) | Microsoft |

**Overseas disclosure:** attendee data is stored and processed outside
Australia (USA, Singapore). An Australian region is on the roadmap
(C3-13) for clients who need it.

## Backups

A nightly copy of the cupq.app database is kept on CupQ's own computer
(14 days, encrypted disk [confirm FileVault is on]). The hosting provider's
own backups are [on/off: Railway Pro needed]. Erasing an event does not
reach into backups taken before the erase; they age out after 14 days.

## Security in place

Logins with hashed passwords; optional two-step login for admins; login
attempt limits; each copy has its own secrets; HTTPS everywhere; public
pages show first names and masked numbers only; staff-only data needs a
login (probed address by address, Oct 2026). Details in
docs/PUBLIC_ENDPOINTS.md.

## Questions for the lawyer

1. Does CupQ fall under the Privacy Act (APPs) as a small business, or only
   through clients' contracts? Either way, should it follow the APPs?
2. Who is the controller of attendee data: the client or CupQ? (Drafts
   assume the client decides, CupQ processes on their behalf.)
3. Overseas disclosure wording (APP 8) for USA and Singapore.
4. Texts: the ready-text is transactional. Is any consent wording needed
   under the Spam Act, and is "reply STOP" required on it?
5. Liability cap and what happens if a text doesn't arrive or an order is
   wrong.
6. Allergy notes: should CupQ discourage or disclaim them?

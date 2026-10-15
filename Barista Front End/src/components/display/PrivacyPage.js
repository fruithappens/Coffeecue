// PrivacyPage.js — cupq.app/privacy (roadmap L6-7).
//
// An interim, plain-English privacy notice, written from what CupQ actually
// does (docs/legal/DATA_MAP.md). It stands until the lawyer-reviewed policy
// (docs/legal/PRIVACY_POLICY_DRAFT.md, roadmap L6-1) replaces it. Linked from
// every ordering page (PoweredBy), the sign-up page and the cupq.com.au forms.
import React, { useEffect } from 'react';

const UPDATED = '16 October 2026';

const Section = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="text-lg font-extrabold text-cq-roast">{title}</h2>
    <div className="space-y-2 text-cq-ink-2 leading-relaxed">{children}</div>
  </section>
);

const PrivacyPage = () => {
  useEffect(() => { document.title = 'Privacy | CupQ'; }, []);
  return (
    <div className="cq min-h-screen bg-cq-cream px-4 py-10">
      <article className="max-w-2xl mx-auto bg-cq-milk rounded-cq-xl shadow-cq-card p-6 md:p-8 space-y-6">
        <header className="space-y-1">
          <div className="text-sm font-bold text-cq-caramel-deep tracking-wide">CupQ</div>
          <h1 className="text-3xl font-extrabold text-cq-roast">Privacy</h1>
          <p className="text-sm text-cq-ink-3">Last updated {UPDATED}</p>
        </header>

        <p className="text-cq-ink-2 leading-relaxed">
          CupQ is a coffee ordering service for events, run by Steve Routley in South Australia (ABN 67 990 631 179).
          This page says what we collect, why, and what happens to it. Questions:{' '}
          <span className="font-semibold text-cq-roast select-all">hello@cupq.com.au</span>
        </p>

        <Section title="When you order a coffee">
          <ul className="list-disc pl-5 space-y-1">
            <li><b>Your first name</b>, so the barista can call it and the screen can show it when your coffee is ready.</li>
            <li><b>Your mobile number, if you give it.</b> It's optional. We use it to text you when your coffee is ready. If you order by text, we have the number you texted from.</li>
            <li><b>Your order:</b> the drink, milk, size, any note, the time and the coffee station.</li>
            <li><b>If the event uses EventsAir</b>, the organiser may link their attendee list (name, email, mobile, badge number) so you're recognised when you order.</li>
          </ul>
          <p>
            Notes reach the barista, but CupQ is not an allergy service: please tell the barista about allergies in person.
            We don't collect card details; if an event charges for coffee, Square handles the payment.
          </p>
        </Section>

        <Section title="When you contact us or sign up">
          <p>
            The forms on cupq.com.au and cupq.app/start ask for your name, organisation, email, phone and event details.
            We use them to reply, quote and set up your event, and we keep them as a record of the enquiry.
          </p>
        </Section>

        <Section title="How we use it">
          <p>
            Only to make and hand over your coffee (or to answer your enquiry). The organiser gets a report of how many
            coffees were made, with counts and times, not names. We don't sell your details, use them for advertising,
            or send you marketing. The text saying your coffee is ready is part of the order you placed.
          </p>
        </Section>

        <Section title="Who else handles it">
          <p>To run the service we use Railway (servers and databases), Cloudflare (web security) and Twilio (text messages), and only if the event uses them, EventsAir and Square.</p>
          <p><b>This means your details are stored and processed outside Australia</b>, mainly in the USA and Singapore.</p>
          <p>The event's organiser and baristas can see the names and orders for their event while it runs.</p>
        </Section>

        <Section title="How long we keep it">
          <p>
            When an event is over, its organiser retires it. That erases names, mobile numbers, notes, text conversations
            and any attendee list, and keeps only anonymous counts for the report. Organisers can also have details erased
            automatically a set number of days after each order. Backups are kept for about two weeks, then deleted.
          </p>
        </Section>

        <Section title="Keeping it safe">
          <p>
            Pages anyone can open show a first name and part of a phone number at most. Everything else needs a staff login.
            Connections are encrypted.
          </p>
        </Section>

        <Section title="Your choices">
          <ul className="list-disc pl-5 space-y-1">
            <li>You can order without giving a mobile number.</li>
            <li>You can ask what we hold about you, or ask us to correct or delete it, at hello@cupq.com.au. During an event the organiser can do it straight away.</li>
            <li>If you're unhappy with how we've handled your details, tell us first. If we don't sort it out, you can contact the Office of the Australian Information Commissioner (oaic.gov.au).</li>
          </ul>
        </Section>

        <p className="text-sm text-cq-ink-3">We'll update this page if what we collect or how we use it changes.</p>
      </article>
    </div>
  );
};

export default PrivacyPage;

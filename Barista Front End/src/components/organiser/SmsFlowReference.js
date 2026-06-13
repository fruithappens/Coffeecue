import React from 'react';

/**
 * SmsFlowReference
 *
 * A read-only reference for organisers explaining how the SMS ordering
 * bot processes each incoming text: the conversation flow, what data
 * comes from THIS event's setup vs. what is built-in, and what the bot
 * remembers between messages.
 *
 * The diagram is a static SVG (self-contained, no external deps) so it
 * renders identically everywhere. The menu shown to customers is always
 * driven by the event's own catalog — this is purely an explainer.
 */

const FLOW_SVG = `
<svg viewBox="0 0 680 600" xmlns="http://www.w3.org/2000/svg" width="100%" height="auto" font-family="system-ui, -apple-system, sans-serif" role="img" aria-label="How the SMS bot processes each text">
<defs>
<marker id="smsflow-ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
<path d="M0 0 L10 5 L0 10 z" fill="#9ca3af"/>
</marker>
</defs>

<g font-size="12.5">
<rect x="24" y="20" width="300" height="40" rx="8" fill="#ffffff" stroke="#d1d5db"/>
<text x="38" y="44" fill="#1f2937" font-weight="600">Text arrives from customer</text>

<line x1="174" y1="60" x2="174" y2="74" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="24" y="74" width="300" height="46" rx="8" fill="#ffffff" stroke="#d1d5db"/>
<text x="38" y="94" fill="#1f2937" font-weight="600">Load memory for this number</text>
<text x="38" y="111" fill="#6b7280" font-size="11.5">where are we in the order?</text>

<line x1="174" y1="120" x2="174" y2="134" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="24" y="134" width="300" height="46" rx="8" fill="#ffffff" stroke="#d97706" stroke-width="1.5"/>
<text x="38" y="154" fill="#1f2937" font-weight="600">Greeting or HELP?</text>
<text x="38" y="171" fill="#6b7280" font-size="11.5">&#8594; sends the Welcome message</text>

<line x1="174" y1="180" x2="174" y2="194" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="24" y="194" width="300" height="46" rx="8" fill="#ffffff" stroke="#d97706" stroke-width="1.5"/>
<text x="38" y="214" fill="#1f2937" font-weight="600">A command?</text>
<text x="38" y="231" fill="#6b7280" font-size="11.5">STATUS &#183; CANCEL &#183; MENU &#183; BARISTA</text>

<line x1="174" y1="240" x2="174" y2="254" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="24" y="254" width="300" height="296" rx="8" fill="none" stroke="#e5e7eb" stroke-dasharray="4 3"/>
<text x="38" y="274" fill="#2563eb" font-weight="700" font-size="12">Otherwise: walk through the order</text>

<rect x="40" y="284" width="268" height="38" rx="7" fill="#ffffff" stroke="#d1d5db"/>
<text x="52" y="307" fill="#1f2937">1 &#183; Name &#160;<tspan fill="#6b7280" font-size="11.5">(or "usual" &#8594; saved order)</tspan></text>
<line x1="174" y1="322" x2="174" y2="330" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="40" y="330" width="268" height="34" rx="7" fill="#ffffff" stroke="#d1d5db"/>
<text x="52" y="351" fill="#1f2937">2 &#183; Coffee type</text>
<line x1="174" y1="364" x2="174" y2="372" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="40" y="372" width="268" height="34" rx="7" fill="#ffffff" stroke="#d1d5db"/>
<text x="52" y="393" fill="#1f2937">3 &#183; Milk</text>
<line x1="174" y1="406" x2="174" y2="414" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="40" y="414" width="268" height="34" rx="7" fill="#ffffff" stroke="#d1d5db"/>
<text x="52" y="435" fill="#1f2937">4 &#183; Size</text>
<line x1="174" y1="448" x2="174" y2="456" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="40" y="456" width="268" height="34" rx="7" fill="#ffffff" stroke="#d1d5db"/>
<text x="52" y="477" fill="#1f2937">5 &#183; Sugar</text>
<line x1="174" y1="490" x2="174" y2="498" stroke="#9ca3af" marker-end="url(#smsflow-ar)"/>
<rect x="40" y="498" width="268" height="40" rx="7" fill="#ffffff" stroke="#2563eb" stroke-width="1.5"/>
<text x="52" y="522" fill="#1f2937" font-weight="600">Confirm &#8594; order to barista screen</text>
</g>

<line x1="348" y1="264" x2="364" y2="264" stroke="#d1d5db"/>

<g font-size="12">
<text x="356" y="28" font-size="13" font-weight="700" fill="#1f2937">Where each part comes from</text>

<rect x="356" y="40" width="6" height="44" rx="2" fill="#2563eb"/>
<text x="372" y="58" fill="#1f2937" font-weight="600">Menu: drinks, milk, sizes, prices</text>
<text x="372" y="76" fill="#6b7280" font-size="11.5">your event setup (database) &#8212; per event</text>

<rect x="356" y="92" width="6" height="44" rx="2" fill="#d97706"/>
<text x="372" y="110" fill="#1f2937" font-weight="600">Word matching: "capp" &#8594; cappuccino</text>
<text x="372" y="128" fill="#6b7280" font-size="11.5">built-in dictionary (generic)</text>

<rect x="356" y="144" width="6" height="44" rx="2" fill="#d97706"/>
<text x="372" y="162" fill="#1f2937" font-weight="600">Reply wording / questions</text>
<text x="372" y="180" fill="#6b7280" font-size="11.5">built-in templates (generic)</text>

<rect x="356" y="196" width="6" height="44" rx="2" fill="#2563eb"/>
<text x="372" y="214" fill="#1f2937" font-weight="600">Event name &amp; welcome message</text>
<text x="372" y="232" fill="#6b7280" font-size="11.5">your branding settings</text>

<line x1="356" y1="256" x2="656" y2="256" stroke="#e5e7eb"/>
<text x="356" y="278" font-size="13" font-weight="700" fill="#1f2937">What it remembers</text>

<rect x="356" y="290" width="300" height="56" rx="8" fill="#ffffff" stroke="#d1d5db"/>
<text x="370" y="310" fill="#1f2937" font-weight="600" font-size="12">Short-term &#160;<tspan fill="#6b7280" font-weight="400" font-size="11.5">mid-order</tspan></text>
<text x="370" y="332" fill="#6b7280" font-size="11.5">progress in the order; clears when idle</text>

<rect x="356" y="354" width="300" height="56" rx="8" fill="#ffffff" stroke="#d1d5db"/>
<text x="370" y="374" fill="#1f2937" font-weight="600" font-size="12">Long-term &#160;<tspan fill="#6b7280" font-weight="400" font-size="11.5">the "usual"</tspan></text>
<text x="370" y="396" fill="#6b7280" font-size="11.5">name + saved drink, milk, size, sugar</text>

<rect x="356" y="420" width="300" height="130" rx="8" fill="#f9fafb" stroke="#e5e7eb"/>
<text x="370" y="440" fill="#2563eb" font-weight="700" font-size="12">The takeaway</text>
<text x="370" y="461" fill="#6b7280" font-size="11.5">The MENU is never hardcoded &#8212; it's your</text>
<text x="370" y="478" fill="#6b7280" font-size="11.5">event setup. Only the language</text>
<text x="370" y="495" fill="#6b7280" font-size="11.5">understanding and reply wording are</text>
<text x="370" y="512" fill="#6b7280" font-size="11.5">built-in (generic, safe for any event).</text>
<text x="370" y="533" fill="#6b7280" font-size="11.5">Edit the first message under Settings.</text>
</g>
</svg>`;

const SmsFlowReference = () => (
  <div className="max-w-5xl">
    <div className="bg-white rounded-lg shadow p-6">
      <p className="text-gray-700 mb-1">
        This is how the SMS ordering bot handles every incoming text. Use it as a
        reference when setting up an event or explaining the system to your team.
      </p>
      <p className="text-gray-500 text-sm mb-4">
        The menu customers can order (drinks, milk, sizes, prices) always comes from
        <span className="font-medium text-gray-700"> your event setup</span> — only the bot's
        wording is built in. Customers can text <span className="font-mono">STATUS</span>,{' '}
        <span className="font-mono">CANCEL</span>, <span className="font-mono">MENU</span>, or{' '}
        <span className="font-mono">BARISTA</span> at any point.
      </p>
      <div className="overflow-x-auto" dangerouslySetInnerHTML={{ __html: FLOW_SVG }} />
    </div>

    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4">
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-1">Want to change the menu?</h3>
        <p className="text-sm text-gray-500">
          Use Quick Setup or Inventory — the bot only sells what you've stocked for this event.
        </p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-1">Want to change the welcome text?</h3>
        <p className="text-sm text-gray-500">
          The first message (and the event name in it) is set under Settings — everything else
          is built-in wording.
        </p>
      </div>
      <div className="bg-white rounded-lg shadow p-4">
        <h3 className="font-semibold text-gray-800 mb-1">Want to see real texts?</h3>
        <p className="text-sm text-gray-500">
          Support → Comms Hub shows the live log of messages in and out.
        </p>
      </div>
    </div>
  </div>
);

export default SmsFlowReference;

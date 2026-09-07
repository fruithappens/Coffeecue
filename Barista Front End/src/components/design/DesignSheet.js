// The component sheet: every piece of the design system, with real content,
// on one page -- the thing Steve approves before any of it touches a live
// screen (roadmap phase 3 checkpoint). Route: /design.
import React, { useState } from 'react';
import { Check, Coffee, Package, Wrench, Settings, Monitor, Play, ArrowRightLeft, Printer, MessageSquare, Users, Calendar, Sliders, Image, BarChart3, Radio, LifeBuoy } from 'lucide-react';
import { AreaMark, AREAS, Button, Pill, StatusPill, StationChip, OrderCard, BigNumber, TabBar, SidebarNav, PinPanel } from '../../design';

const SWATCHES = [
  ['Roast', '--cq-roast', 'headers, the dark ground, big type'],
  ['Caramel', '--cq-caramel', 'the one action colour'],
  ['Caramel wash', '--cq-caramel-wash', 'selected, active'],
  ['Tan', '--cq-tan', 'board banners'],
  ['Cream', '--cq-cream', 'the page'],
  ['Milk', '--cq-milk', 'cards'],
  ['Ink', '--cq-ink', 'text'],
  ['Ink 2', '--cq-ink-2', 'secondary text'],
  ['Ink 3', '--cq-ink-3', 'muted labels'],
  ['Line', '--cq-line', 'hairlines'],
  ['Wash', '--cq-wash', 'wells, inputs'],
  ['Ready', '--cq-ready', 'ready · good · done'],
  ['Alert', '--cq-alert', 'needs a person now'],
];

const Section = ({ n, title, why, children }) => (
  <section className="mt-12 first:mt-0">
    <div className="flex items-baseline gap-3 border-b border-cq-line pb-2 mb-5">
      <span className="text-sm font-extrabold text-cq-ink-3 tabular-nums">{String(n).padStart(2, '0')}</span>
      <h2 className="text-2xl font-extrabold text-cq-roast">{title}</h2>
    </div>
    {why ? <p className="text-base text-cq-ink-2 max-w-[65ch] mb-5">{why}</p> : null}
    {children}
  </section>
);

export default function DesignSheet() {
  const [tab, setTab] = useState('orders');
  const [nav, setNav] = useState('stations');
  const [chip, setChip] = useState(1);
  const [pinErr, setPinErr] = useState(false);
  const tabs = [
    { id: 'orders', label: 'Orders', Icon: Coffee, count: 4 },
    { id: 'stock', label: 'Stock', Icon: Package },
    { id: 'station', label: 'Station', Icon: Settings },
    { id: 'tools', label: 'Tools', Icon: Wrench },
  ];
  const groups = [
    { heading: 'Set up', items: [
      { id: 'quick', label: 'Quick Setup', Icon: Sliders }, { id: 'menu', label: 'Menu', Icon: Coffee },
      { id: 'stations', label: 'Stations', Icon: Radio }, { id: 'branding', label: 'Branding', Icon: Image },
      { id: 'schedule', label: 'Schedule', Icon: Calendar }, { id: 'users', label: 'Users', Icon: Users } ] },
    { heading: 'Run the day', items: [
      { id: 'live', label: 'Live', Icon: Monitor }, { id: 'orders', label: 'Orders', Icon: Package, badge: 2 },
      { id: 'messages', label: 'Messages', Icon: MessageSquare }, { id: 'printers', label: 'Printers', Icon: Printer } ] },
    { heading: 'Review', items: [ { id: 'report', label: 'Report', Icon: BarChart3 }, { id: 'help', label: 'Help', Icon: LifeBuoy } ] },
  ];

  return (
    <div className="cq min-h-screen">
      <header className="bg-cq-roast text-cq-cream">
        <div className="max-w-6xl mx-auto px-6 py-8">
          <div className="text-xs font-extrabold uppercase tracking-[0.18em] text-cq-tan">CupQ design system · component sheet · 7 Sep 2026</div>
          <h1 className="mt-2 text-4xl sm:text-5xl font-extrabold leading-tight tracking-tight">One family, one action colour, <span className="text-cq-tan">numbers you can read from the door.</span></h1>
          <p className="mt-3 max-w-[65ch] text-lg text-cq-cream/85">Caramel is the brand and the only colour that means “do this”. Green and red appear only when something needs a person. Areas are told apart by an icon and a name, never by a colour of their own. The type is Manrope, with tabular numerals everywhere.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {Object.keys(AREAS).map((k) => <AreaMark key={k} area={k} inverse />)}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-10">
        <Section n={1} title="Colour" why="Thirteen values, no blue, no grey. The whole app is built from the first eleven; the last two are the only colours allowed to shout.">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {SWATCHES.map(([name, v, use]) => (
              <div key={v} className="rounded-cq-md overflow-hidden border border-cq-line bg-cq-milk">
                <div className="h-16" style={{ background: `var(${v})` }} />
                <div className="p-2.5">
                  <div className="font-bold text-cq-roast">{name}</div>
                  <div className="text-xs text-cq-ink-3">{use}</div>
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={2} title="Type" why="Manrope, variable weight, served from CupQ itself (no internet needed at a venue). Eight sizes on a tablet; the board number is the ninth and scales with the screen.">
          <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-6 space-y-4">
            <div className="font-extrabold leading-none tracking-tighter text-cq-roast" style={{ fontSize: 'var(--cq-text-board)' }}>#1785</div>
            <div className="text-5xl font-extrabold text-cq-roast">Concourse Cart</div>
            <div className="text-2xl font-bold text-cq-ink">Medium long black · extra shot</div>
            <div className="text-base text-cq-ink-2 max-w-[65ch]">Body text at 16 with a 65-character measure. A barista reads a note like “make it decaf, no lid” once, at arm’s length, on a tablet propped by the grinder.</div>
            <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-cq-ink-3">Label · 12 · tracked</div>
            <div className="text-4xl font-extrabold text-cq-roast tabular-nums">10:47 · 12 in queue · 4 min</div>
          </div>
        </Section>

        <Section n={3} title="Area marks" why="Four areas, four icons, one colour. The mark sits in every header and on the sign-in landing.">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Object.entries(AREAS).map(([k, a]) => (
              <div key={k} className="bg-cq-milk rounded-cq-lg shadow-cq-card p-4">
                <AreaMark area={k} size="lg" />
                <div className="mt-2 text-sm text-cq-ink-3">{a.hint}</div>
              </div>
            ))}
          </div>
        </Section>

        <Section n={4} title="Buttons" why="Primary is caramel. Secondary is an outline. Red is for the thing you must think about; green for “it’s ready”. 48 px tall at the default size.">
          <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5 flex flex-wrap items-center gap-3">
            <Button Icon={Play}>Start making</Button>
            <Button variant="ready" Icon={Check}>Mark ready</Button>
            <Button variant="secondary" Icon={ArrowRightLeft}>Move station</Button>
            <Button variant="ghost">Edit</Button>
            <Button variant="dark" Icon={Printer}>Print label</Button>
            <Button variant="danger">Cancel order</Button>
            <Button size="sm" variant="secondary">Small</Button>
            <Button size="lg" Icon={Check}>Large</Button>
            <Button disabled>Disabled</Button>
          </div>
        </Section>

        <Section n={5} title="Status pills" why="The words come from the one status file the beacon, the board and the texts share. A pill can never say something the customer’s phone doesn’t.">
          <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5 flex flex-wrap items-center gap-3">
            <StatusPill status="pending" /><StatusPill status="in-progress" /><StatusPill status="completed" /><StatusPill status="picked_up" /><StatusPill status="cancelled" />
            <Pill tone="roast">Priority</Pill><Pill tone="outline">Walk-up</Pill><Pill tone="neutral" dot>Group of 4</Pill><Pill tone="alert" dot>Out of oat</Pill>
          </div>
        </Section>

        <Section n={6} title="Station chips" why="Your station in roast; the ones you chose to watch beside it, each with its queue. A cap and a picker replace the one-chip-per-cart header.">
          <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5 flex flex-wrap items-center gap-2">
            <StationChip name="Concourse" queue={3} selected={chip === 1} onClick={() => setChip(1)} />
            <StationChip name="Ferguson Room" queue={1} selected={chip === 2} onClick={() => setChip(2)} />
            <StationChip name="Level 3 Foyer" queue={0} status="maintenance" />
            <StationChip name="Express Bar" queue={7} compact />
          </div>
        </Section>

        <Section n={7} title="The order card" why="The number is what you call out; the drink is what you make; the state is on the left edge. Three states, one shape.">
          <div className="grid gap-4 lg:grid-cols-3">
            <OrderCard state="queued" order={{ number: 1786, name: 'Priya', drink: 'Medium flat white', milk: 'Oat', sugar: 'No sugar', since: 'Ordered 2 min ago · phone' }}
              badges={<Pill tone="outline" size="sm">Phone</Pill>} actions={<><Button Icon={Play} block>Start</Button></>} />
            <OrderCard state="making" order={{ number: 1785, name: 'Test', drink: 'Medium long black', sugar: 'Add your own sugar', notes: 'Strong', since: 'Started 1 min ago · Concourse' }}
              badges={<Pill tone="roast" size="sm">Priority</Pill>} actions={<><Button variant="ready" Icon={Check} className="flex-1">Ready</Button><Button variant="secondary" Icon={ArrowRightLeft}>Move</Button></>} />
            <OrderCard state="ready" order={{ number: 1782, name: 'Marcus', drink: 'Large cappuccino', milk: 'Full cream', sugar: '1 sugar', message: 'Waiting 6 min — remind?', since: 'Ready 6 min ago' }}
              actions={<><Button variant="dark" className="flex-1">Collected</Button><Button variant="ghost">Remind</Button></>} />
          </div>
          <div className="mt-4 max-w-sm"><OrderCard compact state="making" order={{ number: 1787, name: 'Ana', drink: 'Small latte', milk: 'Skim' }} /></div>
        </Section>

        <Section n={8} title="The board number" why="Ninety-six to 150 pt depending on the screen. Caramel ring while brewing, green ring and a breath when ready; the fresh one says so.">
          <div className="grid gap-5 lg:grid-cols-2">
            <BigNumber number={1785} name="Test" details="Medium long black" state="making" />
            <BigNumber number={1782} name="Marcus" details="Large cappuccino · full cream" state="ready" isNew />
          </div>
          <div className="mt-5 bg-cq-roast rounded-cq-xl p-6"><BigNumber number={1779} name="Chen" details="Oat flat white" state="ready" dark /></div>
        </Section>

        <Section n={9} title="Tab bar" why="Inside a section: icon and word, the active one in caramel, two-up on a phone. Organiser, runner and barista share it.">
          <TabBar tabs={tabs} active={tab} onChange={setTab} />
        </Section>

        <Section n={10} title="Sidebar" why="The runner’s left rail: three groups, an icon and a word each, the active one in the caramel wash. Collapses to icons on a tablet.">
          <div className="bg-cq-cream rounded-cq-lg border border-cq-line overflow-hidden flex" style={{ height: 420 }}>
            <SidebarNav groups={groups} active={nav} onChange={setNav} />
            <SidebarNav groups={groups} active={nav} onChange={setNav} collapsed />
            <div className="flex-1 p-6">
              <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-cq-ink-3">Set up</div>
              <div className="mt-1 text-3xl font-extrabold text-cq-roast">{groups.flatMap(g => g.items).find(i => i.id === nav)?.label}</div>
              <p className="mt-2 text-cq-ink-2 max-w-[50ch]">Expanded and collapsed, side by side. The page title repeats the item so the rail can collapse without losing the place.</p>
            </div>
          </div>
        </Section>

        <Section n={11} title="PIN panel" why="A barista opens the station’s settings with four taps, one hand, no keyboard. Try 1234; anything else shakes red.">
          <div className="flex flex-wrap gap-6 items-start">
            <PinPanel error={pinErr} onSubmit={(p) => setPinErr(p !== '1234')} />
            <div className="text-cq-ink-2 max-w-[40ch]">
              <p>Replaces the settings tab a customer could reach on an unattended tablet. The PIN lives on the event, set by the organiser.</p>
              <p className="mt-2 text-sm text-cq-ink-3">{pinErr ? 'Wrong PIN shown.' : 'Ready.'}</p>
            </div>
          </div>
        </Section>

        <Section n={12} title="Space and shape" why="A 4-point scale, four radii, two shadows. Cards are 14 px round; chips and pills are full round; the board card is 20.">
          <div className="bg-cq-milk rounded-cq-lg shadow-cq-card p-5 flex flex-wrap items-end gap-3">
            {[4, 8, 12, 16, 20, 24, 32, 40, 48].map((s) => (
              <div key={s} className="flex flex-col items-center gap-1">
                <div className="bg-cq-caramel rounded-cq-sm" style={{ width: s, height: s }} />
                <div className="text-xs text-cq-ink-3 tabular-nums">{s}</div>
              </div>
            ))}
            <div className="ml-6 flex gap-3">
              {[['sm', 6], ['md', 10], ['lg', 14], ['xl', 20]].map(([n, r]) => (
                <div key={n} className="flex flex-col items-center gap-1">
                  <div className="w-14 h-14 bg-cq-wash border-2 border-cq-caramel" style={{ borderRadius: r }} />
                  <div className="text-xs text-cq-ink-3">{n} · {r}</div>
                </div>
              ))}
            </div>
          </div>
        </Section>

        <div className="mt-14 rounded-cq-xl bg-cq-caramel-wash border border-cq-line p-6">
          <div className="text-xs font-extrabold uppercase tracking-[0.14em] text-cq-ink-3">Checkpoint · phase 3</div>
          <p className="mt-1 text-lg text-cq-roast max-w-[65ch]">Nothing on this page is live yet. Say <b>keep going</b> to put it on the barista Orders screen first (phase 4), or name what to change: a colour, the typeface, a shape, a word.</p>
        </div>
      </main>
    </div>
  );
}

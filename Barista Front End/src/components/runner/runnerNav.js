// The runner's map. ONE app for the person on the floor: what used to be
// the Organiser and the Support interface, which overlapped on Operations,
// Users and Messages and made you guess which door to use.
//
// Three groups, in the order a day happens: set it up, run it, look back.
import {
  Zap, Package, Coffee, Palette, Calendar, Users, Activity, Clock, Radio,
  Printer, BarChart3, Heart, CalendarClock, Settings, AlertTriangle, HelpCircle,
  ListChecks, Boxes, Image as ImageIcon, Tag, Droplet, FileText, CheckCircle,
  Terminal, MessageSquare, Phone, Ban, UserCog, Monitor, Megaphone,
} from 'lucide-react';

export const NAV = [
  { heading: 'Set up', items: [
    { id: 'quickSetup', label: 'Quick Setup', Icon: Zap },
    { id: 'menu',       label: 'Menu',        Icon: Package },
    { id: 'stations',   label: 'Stations',    Icon: Coffee },
    { id: 'branding',   label: 'Branding',    Icon: Palette },
    { id: 'schedule',   label: 'Schedule',    Icon: Calendar },
    { id: 'users',      label: 'People',      Icon: Users },
  ] },
  { heading: 'Run the day', items: [
    { id: 'live',     label: 'Live',     Icon: Activity },
    { id: 'orders',   label: 'Orders',   Icon: Clock },
    { id: 'messages', label: 'Messages', Icon: Radio },
    { id: 'screens',  label: 'Screens',  Icon: Monitor },
    { id: 'printers', label: 'Printers', Icon: Printer },
  ] },
  { heading: 'Review & system', items: [
    { id: 'report',    label: 'Report',    Icon: BarChart3 },
    { id: 'system',    label: 'System',    Icon: Heart },
    { id: 'eventsair', label: 'EventsAir', Icon: CalendarClock },
    { id: 'settings',  label: 'Settings',  Icon: Settings },
    { id: 'emergency', label: 'Emergency', Icon: AlertTriangle },
    { id: 'help',      label: 'Help',      Icon: HelpCircle },
  ] },
];

export const TABS = {
  menu: [
    { id: 'inventory',        label: 'Event Inventory',   Icon: ListChecks },
    { id: 'stock',            label: 'Event Stock',       Icon: Boxes },
    { id: 'stationInventory', label: 'Station Inventory', Icon: Coffee },
  ],
  branding: [
    { id: 'logo',     label: 'Logo & look',  Icon: Palette },
    { id: 'sponsors', label: 'Sponsors',     Icon: ImageIcon },
    { id: 'labels',   label: 'Labels',       Icon: Tag },
    { id: 'milk',     label: 'Milk colours', Icon: Droplet },
  ],
  users: [
    { id: 'people', label: 'People',       Icon: Users },
    { id: 'access', label: 'Roles & access', Icon: UserCog },
  ],
  live: [
    { id: 'readiness', label: 'Readiness', Icon: CheckCircle },
    { id: 'board',     label: 'Board',     Icon: Activity },
    { id: 'metrics',   label: 'Metrics',   Icon: BarChart3 },
  ],
  orders: [
    { id: 'all',    label: 'All Orders',   Icon: Clock },
    { id: 'groups', label: 'Group Orders', Icon: FileText },
  ],
  messages: [
    // First, because it is the one you reach for mid-service: the thing you
    // need everyone to know, on every surface at once. Broadcast below it is
    // still the SMS-only path.
    { id: 'notice',    label: 'Tell everyone', Icon: Megaphone },
    { id: 'broadcast', label: 'Text blast', Icon: MessageSquare },
    { id: 'test',      label: 'Test a text', Icon: Phone },
    { id: 'blocked',   label: 'Blocked numbers', Icon: Ban },
  ],
  system: [
    { id: 'health',      label: 'Health',      Icon: Heart },
    { id: 'diagnostics', label: 'Diagnostics', Icon: Terminal },
  ],
};

export const DEFAULT_TAB = Object.fromEntries(
  Object.entries(TABS).map(([section, tabs]) => [section, tabs[0].id]));

export const TITLES = {
  quickSetup: 'Quick Setup',
  menu: 'Menu',
  stations: 'Stations',
  branding: 'Branding',
  schedule: 'Schedule',
  users: 'People',
  live: 'Live',
  orders: 'Orders',
  messages: 'Messages',
  screens: 'Screens',
  printers: 'Printers',
  report: 'Report',
  system: 'System',
  eventsair: 'EventsAir',
  settings: 'Settings',
  emergency: 'Emergency',
  help: 'Help',
};

export const SECTIONS = NAV.flatMap((g) => g.items.map((i) => i.id));

// Where the old two-app links land now. Deep links people already have
// (and anything the app itself still points at) must not break.
export const ALIASES = {
  operations: 'live',           // organiser
  dashboard: 'live',            // support
  communications: 'messages',   // support
  'sms-test': 'messages',
  'sms-blocklist': 'messages',
  integrations: 'eventsair',
  messaging: 'messages',
};

export function readHash() {
  const raw = (window.location.hash || '').replace(/^#/, '');
  if (!raw) return null;
  const [rawSection, rawTab] = raw.split('/');
  const section = ALIASES[rawSection] || rawSection;
  if (!SECTIONS.includes(section)) return null;
  const tabs = TABS[section];
  const tab = tabs && rawTab && tabs.some((t) => t.id === rawTab) ? rawTab : undefined;
  return { section, tab };
}

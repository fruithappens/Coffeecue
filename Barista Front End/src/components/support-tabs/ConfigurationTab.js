import React from 'react';
import { Settings, Palette, Coffee, Globe, MessageSquare, ExternalLink } from 'lucide-react';

// Support → Config used to be a 556-line clone of the Organiser's
// configuration screens (branding, message templates, its own coffee-type /
// milk-option lists, system + SMS settings). None of it persisted anywhere —
// "Save" went to a SettingsService method with no backend, and the menu
// section edited a private copy that the rest of the app never read. It was
// untouched since the initial commit while the real screens evolved.
//
// Rather than maintain a second (broken) editing surface, this tab is now an
// honest signpost: configuration has ONE home (the Organiser interface), and
// this page tells support staff exactly where each thing lives.

const DESTINATIONS = [
  {
    icon: <Palette className="w-6 h-6 text-purple-600" />,
    title: 'Branding & event identity',
    where: 'Organiser → Settings → Event Settings',
    detail:
      'Event name, organisation, colours, logo / display graphic, sponsor ' +
      'message, SMS sender identity. Persists to the backend ' +
      '(/api/settings/branding) — survives reloads and shows on the ' +
      'customer display.',
  },
  {
    icon: <Coffee className="w-6 h-6 text-amber-700" />,
    title: 'Menu & inventory',
    where: 'Organiser → Inventory',
    detail:
      'Milk types, coffee drinks, cups/sizes, syrups, sweeteners, extras — ' +
      'plus which of those each station carries (Station Inventory). This ' +
      'is the catalogue the SMS bot and walk-in dialog sell from.',
  },
  {
    icon: <Globe className="w-6 h-6 text-blue-600" />,
    title: 'Stations',
    where: 'Organiser → Stations',
    detail:
      'Add/rename stations, set capabilities, active/inactive/maintenance ' +
      'mode, per-station menu assignment.',
  },
  {
    icon: <MessageSquare className="w-6 h-6 text-green-600" />,
    title: 'SMS & integrations',
    where: 'Railway → web service → Variables',
    detail:
      'Twilio credentials, TESTING_MODE, backup SMS providers (ClickSend / ' +
      'Cellcast), admin alerts, EventsAir. These are environment variables ' +
      'on the deploy host — not editable from the app by design.',
  },
];

const ConfigurationTab = () => (
  <div className="p-6 max-w-4xl">
    <div className="flex items-center justify-between mb-2">
      <h2 className="text-2xl font-bold flex items-center">
        <Settings className="w-6 h-6 mr-2" />
        Configuration
      </h2>
      <button
        onClick={() => { window.location.href = '/organiser'; }}
        className="flex items-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
      >
        Open Organiser
        <ExternalLink className="w-4 h-4 ml-2" />
      </button>
    </div>
    <p className="text-gray-600 mb-6">
      System configuration has one source of truth — the <strong>Organiser
      interface</strong>. This page used to duplicate those screens without
      saving anywhere, so it now just points you to the right place.
    </p>

    <div className="space-y-4">
      {DESTINATIONS.map((d) => (
        <div key={d.title} className="bg-white rounded-lg shadow-sm p-5 flex items-start space-x-4">
          <div className="mt-1">{d.icon}</div>
          <div>
            <h3 className="font-semibold">{d.title}</h3>
            <div className="text-sm font-medium text-blue-700 mb-1">{d.where}</div>
            <p className="text-sm text-gray-600">{d.detail}</p>
          </div>
        </div>
      ))}
    </div>
  </div>
);

export default ConfigurationTab;

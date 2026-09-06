import React, { useState } from 'react';
import { Settings, Palette } from 'lucide-react';
import BrandingSettings from './BrandingSettings';
import MilkColorSettings from './MilkColorSettings';

/**
 * Event Settings — tabbed interface for event configuration.
 *
 * Previously had three tabs: Branding, Visual Identifiers, and an
 * empty 'Advanced Settings' tab whose only content was the literal
 * text "Additional configuration options will be available here."
 * Plus a Coffee Type Colors panel rendered with opacity-50 + "Coming
 * soon" copy. Both removed in batch G of the system audit — empty
 * tabs / stub panels mislead operators into looking for features
 * that don't exist. Re-introduce when the features are real.
 */
const EventSettings = () => {
  const [activeTab, setActiveTab] = useState('branding');

  return (
    <div>
      {/* Tab Navigation */}
      <div className="mb-6 bg-white p-2 rounded-lg shadow flex gap-2">
        <button
          className={`flex-1 py-2 px-4 rounded-md transition-colors ${
            activeTab === 'branding'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => setActiveTab('branding')}
        >
          <Settings size={16} className="inline-block mr-2" />
          Branding & Display
        </button>

        <button
          className={`flex-1 py-2 px-4 rounded-md transition-colors ${
            activeTab === 'colors'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => setActiveTab('colors')}
        >
          <Palette size={16} className="inline-block mr-2" />
          Visual Identifiers
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'branding' && (
          <BrandingSettings />
        )}

        {activeTab === 'colors' && (
          <MilkColorSettings />
        )}
      </div>
    </div>
  );
};

export default EventSettings;
import React, { useState } from 'react';
import { Settings, Palette, Coffee, Package } from 'lucide-react';
import BrandingSettings from './BrandingSettings';
import MilkColorSettings from './MilkColorSettings';

/**
 * Event Settings Component
 * Provides tabbed interface for various event configuration options
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
              ? 'bg-blue-500 text-white' 
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
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => setActiveTab('colors')}
        >
          <Palette size={16} className="inline-block mr-2" />
          Visual Identifiers
        </button>
        
        <button
          className={`flex-1 py-2 px-4 rounded-md transition-colors ${
            activeTab === 'advanced' 
              ? 'bg-blue-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
          onClick={() => setActiveTab('advanced')}
        >
          <Coffee size={16} className="inline-block mr-2" />
          Advanced Settings
        </button>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === 'branding' && (
          <BrandingSettings />
        )}
        
        {activeTab === 'colors' && (
          <div className="space-y-6">
            <MilkColorSettings />
            
            {/* Future: Coffee type colors */}
            <div className="bg-white shadow-md rounded-lg p-6 opacity-50">
              <h2 className="text-xl font-bold mb-4">Coffee Type Colors</h2>
              <p className="text-gray-600">
                Coming soon: Assign visual colors to different coffee types (Espresso, Cappuccino, Latte, etc.)
              </p>
            </div>
          </div>
        )}
        
        {activeTab === 'advanced' && (
          <div className="bg-white shadow-md rounded-lg p-6">
            <h2 className="text-xl font-bold mb-4">Advanced Settings</h2>
            <p className="text-gray-600">
              Additional configuration options will be available here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EventSettings;
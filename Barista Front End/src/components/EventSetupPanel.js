import React, { useState, useEffect } from 'react';
import { 
  Calendar, Clock, Users, Coffee, Package, Settings,
  Save, Copy, Download, Upload, AlertCircle, CheckCircle,
  Plus, Trash2, Edit, ChevronRight
} from 'lucide-react';

/**
 * Event Setup Panel with Template-Based Configuration
 * Smart defaults with real-time adaptation
 */
const EventSetupPanel = () => {
  // Event templates
  const eventTemplates = {
    'corporate_conference': {
      name: 'Corporate Conference',
      description: 'Standard business conference (100-500 attendees)',
      icon: '🏢',
      items: {
        milks: [
          { type: 'full_cream', name: 'Full Cream', size: '3L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'skim', name: 'Skim Milk', size: '2L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'oat', name: 'Oat Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'almond', name: 'Almond Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } }
        ],
        coffees: [
          { type: 'long_black', name: 'Long Black', milk_required: false, complexity: 'simple', prep_time: 2 },
          { type: 'cappuccino', name: 'Cappuccino', milk_ratio: 0.8, complexity: 'medium', requires_foam: true, prep_time: 4 },
          { type: 'flat_white', name: 'Flat White', milk_ratio: 0.75, complexity: 'medium', requires_microfoam: true, prep_time: 4 },
          { type: 'latte', name: 'Latte', milk_ratio: 0.85, complexity: 'medium', requires_foam: true, prep_time: 3 }
        ],
        schedule_profile: 'standard_business_hours'
      },
      dynamicIntelligence: {
        timeBasedAvailability: {
          '07:00-10:00': { drinks: ['long_black', 'cappuccino'], note: 'Morning rush - speed focus' },
          '10:00-15:00': { drinks: 'all', note: 'Full menu availability' },
          '15:00-17:00': { drinks: ['cappuccino', 'latte', 'flat_white'], note: 'Afternoon preference' },
          '17:00+': { drinks: ['long_black', 'cappuccino'], note: 'End of event simplification' }
        },
        demandPrediction: {
          peakTimes: ['09:00-09:30', '10:30-11:00', '14:00-14:30'],
          expectedOrders: 250,
          staffRequired: { min: 3, recommended: 5, peak: 8 }
        }
      }
    },
    'large_conference': {
      name: 'Large Conference',
      description: 'Major event (500+ attendees)',
      icon: '🏟️',
      items: {
        milks: [
          { type: 'full_cream', name: 'Full Cream', size: '5L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'skim', name: 'Skim Milk', size: '3L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'oat', name: 'Oat Milk', size: '2L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'soy', name: 'Soy Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'almond', name: 'Almond Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } }
        ],
        coffees: [
          { type: 'long_black', name: 'Long Black', milk_required: false, complexity: 'simple', prep_time: 2 },
          { type: 'cappuccino', name: 'Cappuccino', milk_ratio: 0.8, complexity: 'medium', requires_foam: true, prep_time: 4 },
          { type: 'latte', name: 'Latte', milk_ratio: 0.85, complexity: 'medium', requires_foam: true, prep_time: 3 }
        ],
        schedule_profile: 'high_volume_simplified'
      }
    },
    'small_meeting': {
      name: 'Small Meeting',
      description: 'Board meeting or workshop (<50 attendees)',
      icon: '👥',
      items: {
        milks: [
          { type: 'full_cream', name: 'Full Cream', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'skim', name: 'Skim Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } },
          { type: 'oat', name: 'Oat Milk', size: '1L', consumption_per_cup: { small: 120, medium: 150, large: 200 } }
        ],
        coffees: [
          { type: 'long_black', name: 'Long Black', milk_required: false, complexity: 'simple', prep_time: 2 },
          { type: 'cappuccino', name: 'Cappuccino', milk_ratio: 0.8, complexity: 'medium', requires_foam: true, prep_time: 4 },
          { type: 'flat_white', name: 'Flat White', milk_ratio: 0.75, complexity: 'medium', requires_microfoam: true, prep_time: 4 },
          { type: 'latte', name: 'Latte', milk_ratio: 0.85, complexity: 'medium', requires_foam: true, prep_time: 3 },
          { type: 'piccolo', name: 'Piccolo', milk_ratio: 0.5, complexity: 'complex', requires_microfoam: true, prep_time: 5 }
        ],
        schedule_profile: 'premium_service'
      }
    }
  };
  
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [eventConfig, setEventConfig] = useState({
    name: '',
    date: '',
    startTime: '',
    endTime: '',
    expectedAttendees: '',
    venue: '',
    notes: ''
  });
  const [menuItems, setMenuItems] = useState({ milks: [], coffees: [] });
  const [schedule, setSchedule] = useState([]);
  const [saving, setSaving] = useState(false);
  
  // Load template
  const loadTemplate = (templateId) => {
    const template = eventTemplates[templateId];
    if (template) {
      setSelectedTemplate(templateId);
      setMenuItems(template.items);
      
      // Generate schedule based on template
      if (template.dynamicIntelligence?.timeBasedAvailability) {
        const scheduleItems = Object.entries(template.dynamicIntelligence.timeBasedAvailability).map(([time, config]) => ({
          time,
          drinks: config.drinks,
          note: config.note
        }));
        setSchedule(scheduleItems);
      }
    }
  };
  
  // Save event configuration
  const saveEventConfig = async () => {
    setSaving(true);
    try {
      // TODO: Implement API call to save configuration
      console.log('Saving event config:', { eventConfig, menuItems, schedule });
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Show success message
      alert('Event configuration saved successfully!');
    } catch (error) {
      console.error('Error saving configuration:', error);
      alert('Failed to save configuration');
    } finally {
      setSaving(false);
    }
  };
  
  return (
    <div className="space-y-6">
      {/* Template Selection */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Quick Start Templates</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Object.entries(eventTemplates).map(([id, template]) => (
            <button
              key={id}
              onClick={() => loadTemplate(id)}
              className={`p-4 rounded-lg border-2 text-left transition-all ${
                selectedTemplate === id 
                  ? 'border-blue-500 bg-blue-50' 
                  : 'border-gray-200 hover:border-gray-300'
              }`}
            >
              <div className="text-3xl mb-2">{template.icon}</div>
              <h3 className="font-semibold">{template.name}</h3>
              <p className="text-sm text-gray-600 mt-1">{template.description}</p>
            </button>
          ))}
        </div>
      </div>
      
      {/* Event Details */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Event Details</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Event Name
            </label>
            <input
              type="text"
              value={eventConfig.name}
              onChange={(e) => setEventConfig({ ...eventConfig, name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Annual Tech Conference 2024"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Expected Attendees
            </label>
            <input
              type="number"
              value={eventConfig.expectedAttendees}
              onChange={(e) => setEventConfig({ ...eventConfig, expectedAttendees: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="250"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Event Date
            </label>
            <input
              type="date"
              value={eventConfig.date}
              onChange={(e) => setEventConfig({ ...eventConfig, date: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Venue
            </label>
            <input
              type="text"
              value={eventConfig.venue}
              onChange={(e) => setEventConfig({ ...eventConfig, venue: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Convention Center Hall A"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Start Time
            </label>
            <input
              type="time"
              value={eventConfig.startTime}
              onChange={(e) => setEventConfig({ ...eventConfig, startTime: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              End Time
            </label>
            <input
              type="time"
              value={eventConfig.endTime}
              onChange={(e) => setEventConfig({ ...eventConfig, endTime: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>
      </div>
      
      {/* Menu Configuration */}
      {selectedTemplate && (
        <>
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4">Menu Configuration</h2>
            
            {/* Coffee Types */}
            <div className="mb-6">
              <h3 className="font-medium mb-3 flex items-center">
                <Coffee className="w-5 h-5 mr-2" />
                Coffee Types
              </h3>
              <div className="space-y-2">
                {menuItems.coffees.map((coffee, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <span className="font-medium">{coffee.name}</span>
                      <span className="text-sm text-gray-500">
                        {coffee.complexity} · {coffee.prep_time}min
                      </span>
                      {coffee.milk_required !== false && (
                        <span className="text-xs bg-blue-100 text-blue-700 px-2 py-1 rounded">
                          Milk: {Math.round(coffee.milk_ratio * 100)}%
                        </span>
                      )}
                    </div>
                    <button className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            
            {/* Milk Options */}
            <div>
              <h3 className="font-medium mb-3 flex items-center">
                <Package className="w-5 h-5 mr-2" />
                Milk Options
              </h3>
              <div className="space-y-2">
                {menuItems.milks.map((milk, index) => (
                  <div key={index} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center space-x-3">
                      <span className="font-medium">{milk.name}</span>
                      <span className="text-sm text-gray-500">
                        {milk.size} containers
                      </span>
                    </div>
                    <button className="text-gray-400 hover:text-red-500">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          
          {/* Dynamic Schedule */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="text-xl font-semibold mb-4">Dynamic Menu Schedule</h2>
            
            <div className="space-y-3">
              {schedule.map((slot, index) => (
                <div key={index} className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
                  <div className="flex items-center space-x-4">
                    <Clock className="w-5 h-5 text-gray-400" />
                    <div>
                      <p className="font-medium">{slot.time}</p>
                      <p className="text-sm text-gray-600">{slot.note}</p>
                    </div>
                  </div>
                  <ChevronRight className="w-5 h-5 text-gray-400" />
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      
      {/* Action Buttons */}
      <div className="flex justify-end space-x-3">
        <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center space-x-2">
          <Download className="w-4 h-4" />
          <span>Export Config</span>
        </button>
        <button className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 flex items-center space-x-2">
          <Copy className="w-4 h-4" />
          <span>Duplicate</span>
        </button>
        <button 
          onClick={saveEventConfig}
          disabled={saving}
          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center space-x-2"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save Configuration</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default EventSetupPanel;
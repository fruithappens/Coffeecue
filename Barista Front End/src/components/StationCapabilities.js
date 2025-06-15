import React, { useState, useEffect } from 'react';

const StationCapabilities = ({ station, onUpdateCapabilities }) => {
  const [capabilities, setCapabilities] = useState({
    alt_milk_available: true,
    high_volume: false,
    vip_service: false
  });
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Update capabilities from station props when they change
  useEffect(() => {
    if (station && station.capabilities) {
      setCapabilities({
        alt_milk_available: station.capabilities.alt_milk_available !== false,
        high_volume: !!station.capabilities.high_volume,
        vip_service: !!station.capabilities.vip_service
      });
    }
  }, [station]);
  
  const handleSubmit = async () => {
    if (!station) return;
    
    setIsSubmitting(true);
    try {
      // Update station capabilities
      await onUpdateCapabilities(station.id, capabilities);
    } catch (error) {
      console.error('Failed to update capabilities:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  const handleToggleCapability = (capabilityName) => {
    setCapabilities(prev => ({
      ...prev,
      [capabilityName]: !prev[capabilityName]
    }));
  };
  
  if (!station) return null;
  
  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-4">
      <h2 className="text-xl font-bold mb-3">Station Capabilities</h2>
      
      <div className="space-y-4 mb-5">
        <div className="flex items-center">
          <div className="flex-1">
            <label className="font-medium text-gray-700 cursor-pointer flex items-center">
              <input
                type="checkbox"
                className="mr-2 h-4 w-4"
                checked={capabilities.alt_milk_available}
                onChange={() => handleToggleCapability('alt_milk_available')}
              />
              Alternative Milk Available
            </label>
            <p className="text-sm text-gray-500 ml-6">
              This station can handle orders with soy, almond, oat, etc.
            </p>
          </div>
        </div>
        
        <div className="flex items-center">
          <div className="flex-1">
            <label className="font-medium text-gray-700 cursor-pointer flex items-center">
              <input
                type="checkbox"
                className="mr-2 h-4 w-4"
                checked={capabilities.high_volume}
                onChange={() => handleToggleCapability('high_volume')}
              />
              High Volume Station
            </label>
            <p className="text-sm text-gray-500 ml-6">
              This station has additional capacity for handling more orders.
            </p>
          </div>
        </div>
        
        <div className="flex items-center">
          <div className="flex-1">
            <label className="font-medium text-gray-700 cursor-pointer flex items-center">
              <input
                type="checkbox"
                className="mr-2 h-4 w-4"
                checked={capabilities.vip_service}
                onChange={() => handleToggleCapability('vip_service')}
              />
              VIP Service Capable
            </label>
            <p className="text-sm text-gray-500 ml-6">
              This station can handle priority/VIP orders with special service.
            </p>
          </div>
        </div>
      </div>
      
      <div className="flex justify-end">
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded flex items-center"
          onClick={handleSubmit}
          disabled={isSubmitting}
        >
          {isSubmitting ? (
            <>
              <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              Updating...
            </>
          ) : 'Update Capabilities'}
        </button>
      </div>
      
      {capabilities.alt_milk_available && !capabilities.high_volume && !capabilities.vip_service && (
        <div className="mt-4 bg-blue-50 p-3 rounded text-blue-800 border-l-4 border-blue-500">
          This station is configured for standard service with alternative milks.
        </div>
      )}
      
      {capabilities.high_volume && (
        <div className="mt-4 bg-green-50 p-3 rounded text-green-800 border-l-4 border-green-500">
          This station is configured for high volume operations. It will receive more orders during busy periods.
        </div>
      )}
      
      {capabilities.vip_service && (
        <div className="mt-4 bg-purple-50 p-3 rounded text-purple-800 border-l-4 border-purple-500">
          This station is designated for VIP service. Priority orders will be directed here.
        </div>
      )}
    </div>
  );
};

export default StationCapabilities;
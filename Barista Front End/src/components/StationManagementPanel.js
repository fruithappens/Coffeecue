import React, { useState, useCallback } from 'react';
import { Settings, Coffee, Loader, Server } from 'lucide-react';
import useStations from '../hooks/useStations';
import SessionControlPanel from './SessionControlPanel';
import StationCapabilities from './StationCapabilities';
import StationLoadBalancer from './StationLoadBalancer';

/**
 * Station Management Panel Component
 * Manages settings for station sessions, capabilities, and load balancing
 */
const StationManagementPanel = () => {
  const { 
    stations, 
    updateStationSession, 
    updateStationCapabilities, 
    refreshData,
    loading
  } = useStations();
  
  const [activeTab, setActiveTab] = useState('session');
  const [selectedStationId, setSelectedStationId] = useState(null);

  // Find the currently selected station object
  const selectedStation = stations.find(s => s.id === selectedStationId);
  
  // Handler for session updates
  const handleSessionUpdate = useCallback(async (stationId, sessionData) => {
    console.log(`Updating session for station ${stationId}:`, sessionData);
    try {
      const result = await updateStationSession(stationId, sessionData);
      if (result) {
        console.log('Session update successful');
        refreshData(); // Refresh data to show updated stations
        return true;
      } else {
        console.error('Session update failed');
        return false;
      }
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    }
  }, [updateStationSession, refreshData]);
  
  // Handler for capabilities updates
  const handleCapabilitiesUpdate = useCallback(async (stationId, capabilities) => {
    console.log(`Updating capabilities for station ${stationId}:`, capabilities);
    try {
      const result = await updateStationCapabilities(stationId, capabilities);
      if (result) {
        console.log('Capabilities update successful');
        refreshData(); // Refresh data to show updated stations
        return true;
      } else {
        console.error('Capabilities update failed');
        return false;
      }
    } catch (error) {
      console.error('Error updating capabilities:', error);
      return false;
    }
  }, [updateStationCapabilities, refreshData]);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 my-4">
      <h2 className="text-2xl font-bold mb-6 flex items-center text-gray-800">
        <Settings className="mr-2" />
        Station Management
      </h2>
      
      {loading ? (
        <div className="flex justify-center items-center h-60">
          <Loader className="animate-spin h-8 w-8 text-blue-500" />
          <span className="ml-2 text-lg text-gray-600">Loading stations...</span>
        </div>
      ) : (
        <>
          {/* Station Selector */}
          <div className="mb-6">
            <label htmlFor="station-select" className="block text-sm font-medium text-gray-700 mb-2">
              Select Station:
            </label>
            <select
              id="station-select"
              value={selectedStationId || ''}
              onChange={(e) => setSelectedStationId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="block w-full py-2 px-3 border border-gray-300 bg-white rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a station...</option>
              {stations.map(station => (
                <option key={station.id} value={station.id}>
                  {station.name} {station.location ? `(${station.location})` : ''}
                </option>
              ))}
            </select>
          </div>
          
          {/* Tab Navigation */}
          <div className="border-b border-gray-200 mb-6">
            <nav className="flex -mb-px">
              <button
                onClick={() => setActiveTab('session')}
                className={`py-2 px-4 text-center border-b-2 font-medium text-sm flex items-center ${
                  activeTab === 'session'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Coffee className="mr-2 h-4 w-4" />
                Session Settings
              </button>
              <button
                onClick={() => setActiveTab('capabilities')}
                className={`py-2 px-4 text-center border-b-2 font-medium text-sm flex items-center ${
                  activeTab === 'capabilities'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Server className="mr-2 h-4 w-4" />
                Station Capabilities
              </button>
              <button
                onClick={() => setActiveTab('loadBalancer')}
                className={`py-2 px-4 text-center border-b-2 font-medium text-sm flex items-center ${
                  activeTab === 'loadBalancer'
                    ? 'border-blue-500 text-blue-600'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
              >
                <Settings className="mr-2 h-4 w-4" />
                Load Balancer
              </button>
            </nav>
          </div>
          
          {/* Content based on active tab */}
          <div>
            {activeTab === 'session' && (
              selectedStation ? (
                <SessionControlPanel 
                  station={selectedStation} 
                  onSessionUpdate={handleSessionUpdate} 
                />
              ) : (
                <div className="text-center p-8 text-gray-500">
                  Please select a station to manage its session settings
                </div>
              )
            )}
            
            {activeTab === 'capabilities' && (
              selectedStation ? (
                <StationCapabilities 
                  station={selectedStation} 
                  onUpdateCapabilities={handleCapabilitiesUpdate} 
                />
              ) : (
                <div className="text-center p-8 text-gray-500">
                  Please select a station to manage its capabilities
                </div>
              )
            )}
            
            {activeTab === 'loadBalancer' && (
              <StationLoadBalancer stations={stations} />
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default StationManagementPanel;
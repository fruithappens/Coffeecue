import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Monitor, ArrowLeft, Loader } from 'lucide-react';
import StationsService from '../services/StationsService';

const DisplaySelector = () => {
  const navigate = useNavigate();
  const [stations, setStations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Load stations on component mount
  useEffect(() => {
    const loadStations = async () => {
      try {
        setLoading(true);
        const stationsResponse = await StationsService.getStations();
        
        if (stationsResponse && stationsResponse.length > 0) {
          console.log('Loaded stations for display selector:', stationsResponse);
          setStations(stationsResponse);
        } else {
          setError('No stations found. Please create stations first in the Organiser interface.');
        }
      } catch (err) {
        console.error('Error loading stations:', err);
        setError('Failed to load stations: ' + (err.message || 'Unknown error'));
      } finally {
        setLoading(false);
      }
    };
    
    loadStations();
  }, []);

  // Go to display screen for a specific station
  const goToDisplayForStation = (stationId) => {
    navigate(`/display?station=${stationId}`);
  };

  // Go back to landing page
  const goBack = () => {
    navigate('/');
  };

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4">
        <div className="container mx-auto flex items-center">
          <button 
            onClick={goBack}
            className="mr-4 p-2 rounded-full hover:bg-blue-700 transition-colors"
          >
            <ArrowLeft size={24} />
          </button>
          <div className="flex items-center">
            <Monitor size={32} className="mr-2" />
            <h1 className="text-2xl font-bold">Display Screen Selector</h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-grow container mx-auto p-6">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-md p-6 mb-6">
            <h2 className="text-xl font-bold text-gray-800 mb-4">Select a Station Display</h2>
            <p className="text-gray-600 mb-6">
              Choose a barista station to view its display screen. Each display shows the orders in progress and ready for pickup at that station.
            </p>
            
            {/* Error Message */}
            {error && (
              <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-6">
                <p>{error}</p>
              </div>
            )}
            
            {/* Loading State */}
            {loading ? (
              <div className="flex justify-center items-center p-12">
                <Loader size={40} className="animate-spin text-blue-600" />
                <span className="ml-3 text-gray-600">Loading stations...</span>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stations.map(station => (
                  <div 
                    key={station.id}
                    className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                    onClick={() => goToDisplayForStation(station.id)}
                  >
                    <div className="flex items-start">
                      <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center mr-3">
                        <Coffee size={20} className="text-blue-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-800">{station.name}</h3>
                        <p className="text-sm text-gray-600">{station.location || 'No location specified'}</p>
                        <p className="mt-2 text-xs">
                          <span className={`inline-block rounded-full px-2 py-1 ${station.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                            {station.status === 'active' ? 'Active' : 'Inactive'}
                          </span>
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
                
                {/* All Stations Option */}
                <div 
                  className="border rounded-lg p-4 hover:shadow-md transition-shadow cursor-pointer"
                  onClick={() => goToDisplayForStation('all')}
                >
                  <div className="flex items-start">
                    <div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center mr-3">
                      <Monitor size={20} className="text-purple-600" />
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-800">All Stations</h3>
                      <p className="text-sm text-gray-600">Combined display of all station orders</p>
                      <p className="mt-2 text-xs">
                        <span className="inline-block rounded-full px-2 py-1 bg-purple-100 text-purple-800">
                          Overview
                        </span>
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
          
          <div className="text-center text-gray-500 text-sm">
            <p>Displays will automatically refresh every 20 seconds. You can also manually refresh using the button on the display screen.</p>
          </div>
        </div>
      </main>
    </div>
  );
};

export default DisplaySelector;
import React, { useState, useEffect } from 'react';
import { Coffee, Check, Clock, ArrowLeft, AlertTriangle, RefreshCw, MapPin } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import ApiNotificationBanner from './ApiNotificationBanner';
import OrderDataService from '../services/OrderDataService';
import StationsService from '../services/StationsService';
import SettingsService from '../services/SettingsService';
import ApiService from '../services/ApiService';
import { useSettings } from '../hooks/useSettings';

const DisplayScreen = () => {
  // Get station ID from URL query parameters
  const [searchParams] = useSearchParams();
  const stationId = searchParams.get('station');
  
  // Use settings hook to get display settings
  const { settings } = useSettings();
  
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [stations, setStations] = useState([]);
  const [currentStation, setCurrentStation] = useState(null);
  
  // Get display settings from settings or use defaults
  const displaySettings = settings?.displaySettings || {
    eventName: 'Coffee Event',
    organizationName: 'Coffee Cue',
    headerColor: '#1e40af',
    customMessage: 'Enjoy your coffee!',
    smsNumber: 'Not configured',
    showSponsor: false,
    sponsorName: '',
    sponsorMessage: ''
  };
  
  // Combine settings with station-specific info
  const [config, setConfig] = useState({
    system_name: 'Coffee Cue',
    event_name: displaySettings.eventName,
    sms_number: displaySettings.smsNumber,
    sponsor: {
      enabled: displaySettings.showSponsor,
      name: displaySettings.sponsorName,
      message: displaySettings.sponsorMessage
    },
    wait_time: settings?.waitTimeWarning || 15,
    header_color: displaySettings.headerColor,
    custom_message: displaySettings.customMessage
  });
  
  const [orders, setOrders] = useState({
    inProgress: [],
    ready: []
  });
  
  const [connected, setConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(new Date());
  const [smsPhoneNumber, setSmsPhoneNumber] = useState('Loading...');

  // Fetch SMS number and system settings from backend
  useEffect(() => {
    const fetchSystemSettings = async () => {
      try {
        // Get display configuration from backend
        const response = await ApiService.get('/display/config');
        if (response && response.config) {
          const backendConfig = response.config;
          setSmsPhoneNumber(backendConfig.sms_number || 'Not configured');
          
          // Update config with backend values
          setConfig(prev => ({
            ...prev,
            system_name: backendConfig.system_name || 'Coffee Cue',
            event_name: backendConfig.event_name || settings?.displaySettings?.eventName || 'Coffee Event',
            sms_number: backendConfig.sms_number || 'Not configured',
            sponsor: backendConfig.sponsor || prev.sponsor
          }));
        }
      } catch (error) {
        console.log('Could not fetch system settings:', error);
        // Use fallback values
        setSmsPhoneNumber(settings?.displaySettings?.smsNumber || 'Not configured');
      }
    };
    
    fetchSystemSettings();
  }, []);

  // Update config when settings change
  useEffect(() => {
    if (settings && settings.displaySettings) {
      setConfig({
        system_name: 'Coffee Cue',
        event_name: settings.displaySettings.eventName,
        sms_number: smsPhoneNumber || settings.displaySettings.smsNumber,
        sponsor: {
          enabled: settings.displaySettings.showSponsor,
          name: settings.displaySettings.sponsorName,
          message: settings.displaySettings.sponsorMessage
        },
        wait_time: settings.waitTimeWarning || 15,
        header_color: settings.displaySettings.headerColor,
        custom_message: settings.displaySettings.customMessage
      });
    }
  }, [settings, smsPhoneNumber]);

  // Load stations first
  useEffect(() => {
    const loadStations = async () => {
      try {
        console.log('Loading stations for display screen');
        const stationsResponse = await StationsService.getStations();
        
        if (stationsResponse && stationsResponse.length > 0) {
          console.log('Loaded stations:', stationsResponse);
          setStations(stationsResponse);
          
          // If a stationId is provided in the URL
          if (stationId) {
            // Special case for 'all' stations view
            if (stationId === 'all') {
              console.log('Using "all stations" view');
              // Create a virtual "all" station
              const allStationsVirtual = {
                id: 'all',
                name: 'All Stations',
                status: 'active'
              };
              setCurrentStation(allStationsVirtual);
            } else {
              // Try to find the specified station (convert to number for proper comparison)
              console.log(`Looking for station with ID ${stationId} in URL param`);
              console.log('Available stations:', stationsResponse.map(s => `${s.name} (ID: ${s.id}, type: ${typeof s.id})`));
              
              // Convert to number for comparison
              const numericStationId = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
              
              const station = stationsResponse.find(s => 
                s.id === numericStationId || // numeric match
                s.id === stationId || // exact match
                (typeof s.id === 'number' && typeof stationId === 'string' && s.id.toString() === stationId) // string comparison
              );
              
              if (station) {
                console.log('Found station from URL parameter:', station);
                setCurrentStation(station);
              } else {
                console.warn(`Station with ID ${stationId} not found, using first station`);
                setCurrentStation(stationsResponse[0]);
              }
            }
          } else {
            // If no stationId provided, use the first station
            console.log('No station ID provided, using first station:', stationsResponse[0]);
            setCurrentStation(stationsResponse[0]);
          }
          
          setConnected(true);
        } else {
          throw new Error('No stations found');
        }
      } catch (err) {
        console.error('Error loading stations:', err);
        setError('Failed to load stations: ' + (err.message || 'Unknown error'));
        setConnected(false);
      }
    };
    
    loadStations();
  }, [stationId]);
  
  // Load orders for the current station
  useEffect(() => {
    if (!currentStation) return;
    
    const loadOrdersForStation = async () => {
      setLoading(true);
      try {
        console.log(`Loading orders for station: ${currentStation.name} (ID: ${currentStation.id}, Type: ${typeof currentStation.id})`);
        
        let inProgressOrders, completedOrders;
        
        // Special handling for "all" stations view
        if (currentStation.id === 'all') {
          // For "all" view, get all orders without filtering by station
          inProgressOrders = await OrderDataService.getInProgressOrders();
          completedOrders = await OrderDataService.getCompletedOrders();
        } else {
          // For a specific station, filter by station ID
          // Ensure station ID is properly converted to number for consistency
          const stationId = typeof currentStation.id === 'string' && currentStation.id !== 'all' 
            ? parseInt(currentStation.id, 10) 
            : currentStation.id;
          
          console.log(`Fetching orders for station ID: ${stationId} (original: ${currentStation.id}, type: ${typeof currentStation.id})`);
          
          // Get all orders first
          const allInProgress = await OrderDataService.getInProgressOrders();
          const allCompleted = await OrderDataService.getCompletedOrders();
          
          console.log('All in-progress orders before filtering:', allInProgress);
          console.log('All completed orders before filtering:', allCompleted);
          
          // Filter by station ID
          inProgressOrders = allInProgress.filter(order => {
            const orderStationId = order.stationId || order.station_id;
            console.log(`Order ${order.id} has station ID: ${orderStationId} (comparing with ${stationId})`);
            return orderStationId === stationId || orderStationId === stationId.toString();
          });
          
          completedOrders = allCompleted.filter(order => {
            const orderStationId = order.stationId || order.station_id;
            return orderStationId === stationId || orderStationId === stationId.toString();
          });
        }
        
        console.log('In-progress orders:', inProgressOrders);
        console.log('Completed orders:', completedOrders);
        
        // Format orders for display
        const formattedOrders = {
          inProgress: inProgressOrders.map(order => ({
            id: order.id,
            order_number: order.orderNumber || order.id,
            customerName: order.customerName || 'Customer',
            displayPhone: order.phoneNumber ? order.phoneNumber.slice(-4) : 'xxxx',
            coffeeType: order.coffeeType || 'Coffee',
            milkType: order.milkType || 'Regular milk',
            status: 'in-progress',
            stationId: order.stationId || order.station_id // Include station ID for display
          })),
          ready: completedOrders.map(order => ({
            id: order.id,
            order_number: order.orderNumber || order.id,
            customerName: order.customerName || 'Customer',
            displayPhone: order.phoneNumber ? order.phoneNumber.slice(-4) : 'xxxx',
            coffeeType: order.coffeeType || 'Coffee',
            milkType: order.milkType || 'Regular milk',
            status: 'completed',
            stationId: order.stationId || order.station_id // Include station ID for display
          }))
        };
        
        setOrders(formattedOrders);
        setLastUpdated(new Date());
        setConnected(true);
        setLoading(false);
      } catch (err) {
        console.error('Error loading orders for station:', err);
        setError('Failed to load orders: ' + (err.message || 'Unknown error'));
        setConnected(false);
        setLoading(false);
      }
    };
    
    loadOrdersForStation();
    
    // Set up auto-refresh every 20 seconds
    const refreshInterval = setInterval(() => {
      loadOrdersForStation();
    }, 20000);
    
    return () => clearInterval(refreshInterval);
  }, [currentStation]);

  const handleBackClick = () => {
    window.location.href = '/';
  };
  
  // Modified manual refresh to use our services
  const handleManualRefresh = async () => {
    if (!currentStation) return;
    
    setLoading(true);
    try {
      let inProgressOrders, completedOrders;
      
      // Special handling for "all" stations view
      if (currentStation.id === 'all') {
        // For "all" view, get all orders without filtering by station
        inProgressOrders = await OrderDataService.getInProgressOrders();
        completedOrders = await OrderDataService.getCompletedOrders();
      } else {
        // For a specific station, filter by station ID
        // Ensure station ID is properly converted to number for consistency
        const stationId = typeof currentStation.id === 'string' && currentStation.id !== 'all' 
          ? parseInt(currentStation.id, 10) 
          : currentStation.id;
        
        console.log(`Manual refresh for station ID: ${stationId} (original type: ${typeof currentStation.id})`);
        inProgressOrders = await OrderDataService.getInProgressOrders(stationId);
        completedOrders = await OrderDataService.getCompletedOrders(stationId);
      }
      
      // Format orders for display
      const formattedOrders = {
        inProgress: inProgressOrders.map(order => ({
          id: order.id,
          order_number: order.orderNumber || order.id,
          customerName: order.customerName || 'Customer',
          displayPhone: order.phoneNumber ? order.phoneNumber.slice(-4) : 'xxxx',
          coffeeType: order.coffeeType || 'Coffee',
          milkType: order.milkType || 'Regular milk',
          status: 'in-progress',
          stationId: order.stationId || order.station_id // Include station ID for display
        })),
        ready: completedOrders.map(order => ({
          id: order.id,
          order_number: order.orderNumber || order.id,
          customerName: order.customerName || 'Customer',
          displayPhone: order.phoneNumber ? order.phoneNumber.slice(-4) : 'xxxx',
          coffeeType: order.coffeeType || 'Coffee',
          milkType: order.milkType || 'Regular milk',
          status: 'completed',
          stationId: order.stationId || order.station_id // Include station ID for display
        }))
      };
      
      setOrders(formattedOrders);
      setLastUpdated(new Date());
      setConnected(true);
      setLoading(false);
    } catch (err) {
      console.error('Error manually refreshing orders:', err);
      setConnected(false);
      setLoading(false);
    }
  };
  
  // Function to change the selected station
  const handleStationChange = (stationId) => {
    console.log(`Station change requested: ${stationId} (type: ${typeof stationId})`);
    
    // Special handling for "all" stations
    if (stationId === 'all') {
      const allStationsVirtual = {
        id: 'all',
        name: 'All Stations',
        status: 'active'
      };
      setCurrentStation(allStationsVirtual);
      
      // Update URL with 'all' station parameter
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('station', 'all');
      window.history.pushState({}, '', `${window.location.pathname}?${newSearchParams.toString()}`);
      return;
    }
    
    // Convert to number for comparison if it's a string
    const numericStationId = typeof stationId === 'string' ? parseInt(stationId, 10) : stationId;
    console.log(`Looking for station with ID ${numericStationId} (converted from ${stationId})`);
    
    // Log all stations for debugging
    console.log('Available stations:', stations.map(s => `${s.name} (ID: ${s.id}, type: ${typeof s.id})`));
    
    // Try to find with both string and numeric IDs to ensure match
    const station = stations.find(s => 
      s.id === numericStationId || // numeric match
      s.id === stationId || // exact match
      (typeof s.id === 'number' && typeof stationId === 'string' && s.id.toString() === stationId) // string comparison
    );
    
    if (station) {
      console.log(`Found matching station: ${station.name} (ID: ${station.id})`);
      setCurrentStation(station);
      
      // Update URL with the new station ID without page reload
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('station', station.id.toString()); // Use toString for consistency
      window.history.pushState({}, '', `${window.location.pathname}?${newSearchParams.toString()}`);
    } else {
      console.error(`No station found with ID: ${stationId}`);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header style={{ backgroundColor: config.header_color || '#1e40af' }} className="text-white p-4">
        <div className="container mx-auto flex justify-between items-center">
          <div className="flex items-center">
            <button 
              onClick={handleBackClick}
              className="mr-4 p-2 rounded-full hover:bg-opacity-80 transition-colors"
              style={{ backgroundColor: `${config.header_color}99` || '#1e40af99' }}
            >
              <ArrowLeft size={24} />
            </button>
            <Coffee size={32} className="mr-2" />
            <h1 className="text-3xl font-bold">{config.system_name}</h1>
          </div>
          <div className="text-2xl font-light flex items-center">
            {config.event_name}
          </div>
        </div>
      </header>

      {/* Connection Status */}
      {!connected && (
        <div className="bg-red-500 text-white p-2 text-center">
          <div className="container mx-auto flex items-center justify-center">
            <AlertTriangle size={20} className="mr-2" />
            <span>Not connected to backend API. Order data may be outdated.</span>
          </div>
        </div>
      )}

      {/* Station Information and Selector */}
      <div className="bg-white border-b shadow-sm">
        <div className="container mx-auto py-4 px-4">
          <div className="flex justify-between items-center">
            <div className="flex flex-col">
              <div className="flex items-center">
                <MapPin size={24} className="text-gray-500 mr-2" />
                <h2 className="text-2xl font-bold text-gray-800">
                  {currentStation 
                    ? `${currentStation.name} ${currentStation.location ? `- ${currentStation.location}` : ''}`
                    : "Select a station"
                  }
                </h2>
              </div>
              
              {/* Station Selector */}
              {stations.length > 1 && (
                <div className="mt-2">
                  <label htmlFor="station-select" className="text-sm text-gray-500 mr-2">Select Station:</label>
                  <select 
                    id="station-select"
                    value={currentStation?.id || ''}
                    onChange={(e) => handleStationChange(e.target.value)}
                    className="border rounded px-2 py-1 text-gray-700"
                  >
                    {/* Add "All Stations" option */}
                    <option value="all">All Stations</option>
                    
                    {stations.map(station => (
                      <option key={station.id} value={station.id}>
                        {station.name} {station.location ? `(${station.location})` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
            <div className="flex items-center">
              <div className="text-lg mr-4">
                <span className="text-gray-500">Last Updated:</span> <span className="font-bold">{lastUpdated.toLocaleTimeString()}</span>
              </div>
              <button 
                onClick={handleManualRefresh} 
                className="p-2 rounded-full bg-blue-50 text-blue-500 hover:bg-blue-100"
                disabled={loading || !currentStation}
              >
                <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="flex-grow container mx-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Notification Banner (only shown if there's an error or not connected) */}
        {(error || !connected) && (
          <div className="md:col-span-2 mb-2">
            <ApiNotificationBanner 
              title="Display Screen API Connection Issue" 
              message={error || "Unable to connect to the backend API. The display screen requires a connection to show real-time order data."}
            />
          </div>
        )}

        {/* In Progress Orders */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="bg-amber-500 text-white p-4">
            <div className="flex items-center">
              <Clock size={24} className="mr-2" />
              <h2 className="text-xl font-bold">In Progress</h2>
            </div>
          </div>
          
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="p-6 flex flex-col items-center justify-center text-gray-500">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-600 mb-4"></div>
                <p>Loading orders...</p>
              </div>
            ) : orders.inProgress.length > 0 ? (
              orders.inProgress.map(order => (
                <div key={order.id} className="p-4 flex justify-between items-center animate-pulse">
                  <div>
                    <div className="flex items-center">
                      <Coffee size={20} className="text-amber-500 mr-2" />
                      <span className="font-bold text-xl">{order.order_number}</span>
                    </div>
                    <div className="mt-1 text-gray-600">
                      For: {order.customerName} (xx{order.displayPhone})
                    </div>
                    <div className="text-gray-500">{order.coffeeType}</div>
                  </div>
                  <div className="bg-amber-100 text-amber-800 px-4 py-2 rounded-full font-medium">
                    Preparing
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 flex flex-col items-center justify-center text-gray-500">
                <Coffee size={48} className="mb-4 text-gray-300" />
                <p className="text-lg font-medium mb-2">No orders in progress</p>
                <p className="text-sm">Orders being prepared will appear here</p>
              </div>
            )}
          </div>
        </div>

        {/* Ready Orders */}
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="bg-green-600 text-white p-4">
            <div className="flex items-center">
              <Check size={24} className="mr-2" />
              <h2 className="text-xl font-bold">Ready for Pickup</h2>
            </div>
          </div>
          
          <div className="divide-y divide-gray-200">
            {loading ? (
              <div className="p-6 flex flex-col items-center justify-center text-gray-500">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-green-600 mb-4"></div>
                <p>Loading orders...</p>
              </div>
            ) : orders.ready.length > 0 ? (
              orders.ready.map(order => (
                <div key={order.id} className="p-4 flex justify-between items-center">
                  <div>
                    <div className="flex items-center">
                      <Coffee size={20} className="text-green-500 mr-2" />
                      <span className="font-bold text-xl">{order.order_number}</span>
                    </div>
                    <div className="mt-1 text-gray-600">
                      For: {order.customerName} (xx{order.displayPhone})
                    </div>
                    <div className="text-gray-500">{order.coffeeType}</div>
                  </div>
                  <div className="bg-green-100 text-green-800 px-4 py-2 rounded-full font-medium">
                    Ready
                  </div>
                </div>
              ))
            ) : (
              <div className="p-6 flex flex-col items-center justify-center text-gray-500">
                <Check size={48} className="mb-4 text-gray-300" />
                <p className="text-lg font-medium mb-2">No orders ready for pickup</p>
                <p className="text-sm">Ready orders will appear here</p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Promotional Footer */}
      <footer style={{ backgroundColor: config.header_color || '#1e40af' }} className="text-white py-4">
        <div className="container mx-auto px-4">
          <div className="flex flex-col md:flex-row justify-between items-center">
            <div className="mb-4 md:mb-0 text-center md:text-left">
              <h3 className="text-xl font-bold">Order your coffee via SMS!</h3>
              <p className="text-blue-100">Text your order to: {config.sms_number}</p>
            </div>
            <div className="text-center md:text-right">
              {config.sponsor.enabled && config.sponsor.name ? (
                <div className="text-xl font-bold">{config.sponsor.name}: {config.sponsor.message}</div>
              ) : (
                config.custom_message && (
                  <div className="text-xl font-bold">{config.custom_message}</div>
                )
              )}
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default DisplayScreen;
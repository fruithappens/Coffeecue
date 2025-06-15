// src/hooks/useStations.js
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAppMode } from '../context/AppContext';
import StationsService from '../services/StationsService';

export default function useStations() {
  // State management
  const [stations, setStations] = useState([]);
  const [selectedStation, setSelectedStation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isDemoMode } = useAppMode();
  
  // Add refs to prevent excessive fetching and manage component lifecycle
  const isMounted = useRef(true);
  const lastFetchTime = useRef(0);
  const throttleTime = 5000; // ms
  const initialRender = useRef(true);

  // Load stations from backend or localStorage for demo mode
  const loadStations = useCallback(async (forceRefresh = false) => {
    // Skip if component is unmounted
    if (!isMounted.current) return;
    
    // Implement throttling - don't fetch more than once per 5 seconds unless forced
    const now = Date.now();
    if (!forceRefresh && now - lastFetchTime.current < throttleTime) {
      console.log(`[useStations] Throttling loadStations - last call was ${(now - lastFetchTime.current)/1000}s ago`);
      return;
    }
    
    // Update the last fetch time
    lastFetchTime.current = now;
    
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      console.log('[useStations] Fetching stations data...');
      // For demo mode, use localStorage
      if (isDemoMode) {
        const savedStations = localStorage.getItem('coffee_cue_stations');
        if (savedStations && isMounted.current) {
          let parsedStations = JSON.parse(savedStations);
          
          // Apply any custom station names from localStorage
          parsedStations = parsedStations.map(station => {
            try {
              const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
              if (customName) {
                console.log(`[useStations] Applying custom name for station ${station.id}: ${customName}`);
                return { ...station, name: customName };
              }
            } catch (e) {
              console.error(`[useStations] Error getting custom name for station ${station.id}:`, e);
            }
            return station;
          });
          
          setStations(parsedStations);
        }
        
        const savedSelectedStation = localStorage.getItem('coffee_cue_selected_station');
        if (savedSelectedStation && isMounted.current) {
          setSelectedStation(parseInt(savedSelectedStation, 10));
        }
      } else {
        // Use real backend API via StationsService
        const fetchedStations = await StationsService.getStations();
        
        if (isMounted.current && fetchedStations) {
          // Apply any custom station names from localStorage - CRITICAL
          const enhancedStations = fetchedStations.map(station => {
            try {
              const customName = localStorage.getItem(`coffee_station_name_${station.id}`);
              if (customName) {
                console.log(`[useStations] Overriding station ${station.id} name from "${station.name}" to "${customName}"`);
                return { ...station, name: customName };
              }
            } catch (e) {
              console.error(`[useStations] Error getting custom name for station ${station.id}:`, e);
            }
            return station;
          });
          
          setStations(enhancedStations);
          
          // If we've saved the current station ID, make sure we restore it
          // Try to get the last used station from localStorage first
          const lastUsedStationId = localStorage.getItem('last_used_station_id');
          if (lastUsedStationId && enhancedStations.some(s => s.id === parseInt(lastUsedStationId, 10))) {
            console.log(`[useStations] Restoring saved station ID: ${lastUsedStationId}`);
            setSelectedStation(parseInt(lastUsedStationId, 10));
            localStorage.setItem('coffee_cue_selected_station', lastUsedStationId.toString());
            return;
          }
          
          // If we have stations but no selection, try to restore previous station
          if (enhancedStations.length > 0 && !selectedStation) {
            // Try to get the last used station from localStorage first
            let stationToSelect = null;
            try {
              // Check for last used station first
              const lastUsedId = localStorage.getItem('last_used_station_id');
              if (lastUsedId) {
                const parsedId = parseInt(lastUsedId, 10);
                if (!isNaN(parsedId) && enhancedStations.some(s => s.id === parsedId)) {
                  stationToSelect = parsedId;
                  console.log(`[useStations] Restoring last used station: ${stationToSelect}`);
                }
              }
              
              // If no last used station, check saved selection
              if (!stationToSelect) {
                const savedSelectedId = localStorage.getItem('coffee_cue_selected_station');
                if (savedSelectedId) {
                  const parsedId = parseInt(savedSelectedId, 10);
                  if (!isNaN(parsedId) && enhancedStations.some(s => s.id === parsedId)) {
                    stationToSelect = parsedId;
                    console.log(`[useStations] Restoring saved station selection: ${stationToSelect}`);
                  }
                }
              }
            } catch (e) {
              console.error('[useStations] Error restoring station selection:', e);
            }
            
            // If no saved station was found or valid, use the first active one
            if (!stationToSelect) {
              const activeStation = enhancedStations.find(s => s.status === 'active');
              stationToSelect = activeStation ? activeStation.id : enhancedStations[0].id;
              console.log(`[useStations] Using ${activeStation ? 'first active' : 'first'} station: ${stationToSelect}`);
            }
            
            // Set the selected station
            setSelectedStation(stationToSelect);
            
            // Store selected station in localStorage
            localStorage.setItem('coffee_cue_selected_station', stationToSelect.toString());
            localStorage.setItem('last_used_station_id', stationToSelect.toString());
          }
        }
      }
      
      if (isMounted.current) {
        setError(null);
        setLastUpdated(Date.now());
      }
    } catch (err) {
      console.error('[useStations] Error loading stations:', err);
      if (isMounted.current) {
        setError(`Failed to load stations: ${err.message}`);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [isDemoMode]);

  // Update station status
  const updateStationStatus = useCallback(async (stationId, status) => {
    if (!isMounted.current) return false;
    
    try {
      if (isDemoMode) {
        // For demo mode, update locally and save to localStorage
        const updatedStations = stations.map(station => 
          station.id === stationId ? { ...station, status } : station
        );
        
        localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
        setStations(updatedStations);
      } else {
        // For production mode, use the API
        const updatedStation = await StationsService.updateStationStatus(stationId, status);
        
        if (updatedStation && isMounted.current) {
          // Update stations list
          setStations(prev => prev.map(station => 
            station.id === stationId ? { ...station, status } : station
          ));
        }
      }
      
      if (isMounted.current) {
        setLastUpdated(Date.now());
      }
      return true;
    } catch (err) {
      console.error('[useStations] Error updating station status:', err);
      if (isMounted.current) {
        setError(`Failed to update station status: ${err.message}`);
      }
      return false;
    }
  }, [isDemoMode, stations]);

  // Update station details (like barista assignment, name, etc)
  const updateStation = useCallback(async (stationId, stationData) => {
    if (!isMounted.current) return false;
    
    console.log('[useStations] Updating station with ID:', stationId, 'Data:', stationData);
    
    try {
      if (isDemoMode) {
        // For demo mode, update locally and save to localStorage
        const updatedStations = stations.map(station => 
          station.id === stationId ? { ...station, ...stationData } : station
        );
        
        localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
        setStations(updatedStations);
      } else {
        // For production mode, use the API
        const updatedStation = await StationsService.updateStation(stationId, stationData);
        
        if (updatedStation && isMounted.current) {
          // Update stations list - ensure we properly merge the updated station
          setStations(prev => {
            const newStations = prev.map(station => 
              station.id === stationId 
                ? { 
                    ...station, 
                    ...updatedStation, 
                    // Ensure name is properly set from the returned data
                    name: updatedStation.name || station.name 
                  } 
                : station
            );
            
            // Also update localStorage for immediate access across components
            localStorage.setItem('coffee_cue_stations', JSON.stringify(newStations));
            
            return newStations;
          });
        }
      }
      
      if (isMounted.current) {
        setLastUpdated(Date.now());
      }
      return true;
    } catch (err) {
      console.error('[useStations] Error updating station:', err);
      if (isMounted.current) {
        setError(`Failed to update station: ${err.message}`);
      }
      return false;
    }
  }, [isDemoMode, stations]);

  // Create a new station
  const createStation = useCallback(async (stationData) => {
    if (!isMounted.current) return null;
    
    try {
      if (isDemoMode) {
        // For demo mode, create locally with generated ID
        const newId = Math.max(0, ...stations.map(s => s.id)) + 1;
        const newStation = {
          id: newId,
          ...stationData,
          currentLoad: 0
        };
        
        // Update stations only if component is still mounted
        if (isMounted.current) {
          setStations(prev => {
            const updatedStations = [...prev, newStation];
            localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
            return updatedStations;
          });
        }
        
        return newStation;
      } else {
        // For production mode, use the API
        const newStation = await StationsService.createStation(stationData);
        
        if (newStation && isMounted.current) {
          // Update stations list
          setStations(prev => [...prev, newStation]);
        }
        
        return newStation;
      }
    } catch (err) {
      console.error('[useStations] Error creating station:', err);
      if (isMounted.current) {
        setError(`Failed to create station: ${err.message}`);
      }
      return null;
    }
  }, [isDemoMode, stations]);

  // Delete a station
  const deleteStation = useCallback(async (stationId) => {
    if (!isMounted.current) return false;
    
    try {
      // Don't allow deleting the selected station
      if (stationId === selectedStation) {
        throw new Error('Cannot delete the currently selected station');
      }
      
      if (isDemoMode) {
        // For demo mode, update locally and save to localStorage
        if (isMounted.current) {
          setStations(prev => {
            const updatedStations = prev.filter(s => s.id !== stationId);
            localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
            return updatedStations;
          });
        }
      } else {
        // For production mode, use the API
        const success = await StationsService.deleteStation(stationId);
        
        if (success && isMounted.current) {
          // Update stations list
          setStations(prev => prev.filter(s => s.id !== stationId));
        }
      }
      
      return true;
    } catch (err) {
      console.error('[useStations] Error deleting station:', err);
      if (isMounted.current) {
        setError(`Failed to delete station: ${err.message}`);
      }
      return false;
    }
  }, [isDemoMode, selectedStation]);

  // Get station statistics
  const getStationStats = useCallback(async (stationId) => {
    if (!isMounted.current) return null;
    
    try {
      if (isDemoMode) {
        // For demo mode, return mock stats
        return {
          ordersToday: Math.floor(Math.random() * 50) + 10,
          avgWaitTime: Math.floor(Math.random() * 10) + 2,
          peakHour: '12:00 - 13:00',
          status: 'active'
        };
      } else {
        // For production mode, use the API
        return await StationsService.getStationStats(stationId);
      }
    } catch (err) {
      console.error('[useStations] Error getting station stats:', err);
      return null;
    }
  }, [isDemoMode]);
  
  // Update station capabilities
  const updateStationCapabilities = useCallback(async (stationId, capabilities) => {
    if (!isMounted.current) return false;
    
    try {
      console.log('[useStations] Updating station capabilities:', stationId, capabilities);
      
      if (isDemoMode) {
        // For demo mode, update locally and save to localStorage
        const updatedStations = stations.map(station => 
          station.id === stationId 
            ? { 
                ...station, 
                capabilities: capabilities
              } 
            : station
        );
        
        localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
        setStations(updatedStations);
        return true;
      } else {
        // For production mode, use the API
        const result = await StationsService.updateStationCapabilities(stationId, capabilities);
        
        if (result && isMounted.current) {
          // Update our local state
          setStations(prevStations => 
            prevStations.map(station => 
              station.id === stationId 
                ? {
                    ...station,
                    capabilities: capabilities
                  }
                : station
            )
          );
          
          return true;
        }
        return false;
      }
    } catch (err) {
      console.error('[useStations] Error updating station capabilities:', err);
      if (isMounted.current) {
        setError(`Failed to update station capabilities: ${err.message}`);
      }
      return false;
    }
  }, [isDemoMode, stations]);
  
  // Update station session (mode, delay, etc.)
  const updateStationSession = useCallback(async (stationId, sessionData) => {
    if (!isMounted.current) return false;
    
    try {
      console.log('[useStations] Updating station session:', stationId, sessionData);
      
      if (isDemoMode) {
        // For demo mode, update locally and save to localStorage
        const updatedStations = stations.map(station => 
          station.id === stationId 
            ? { 
                ...station, 
                session_mode: sessionData.mode, 
                session_delay_minutes: sessionData.delay_minutes 
              } 
            : station
        );
        
        localStorage.setItem('coffee_cue_stations', JSON.stringify(updatedStations));
        setStations(updatedStations);
        return true;
      } else {
        // For production mode, use the API
        const updatedSession = await StationsService.updateStationSession(stationId, sessionData);
        
        if (updatedSession && isMounted.current) {
          // Update our local state
          setStations(prevStations => 
            prevStations.map(station => 
              station.id === stationId 
                ? {
                    ...station,
                    session_mode: sessionData.mode,
                    session_delay_minutes: sessionData.delay_minutes
                  }
                : station
            )
          );
          
          return true;
        }
        return false;
      }
    } catch (err) {
      console.error('[useStations] Error updating station session:', err);
      if (isMounted.current) {
        setError(`Failed to update station session: ${err.message}`);
      }
      return false;
    }
  }, [isDemoMode, stations]);

  // Change selected station
  const changeSelectedStation = useCallback((stationId) => {
    if (!isMounted.current) return;
    
    console.log(`[useStations] Changing selected station to ${stationId}`);
    
    // Update the selected station state
    setSelectedStation(stationId);
    
    // Store in localStorage for persistence across app reloads
    localStorage.setItem('coffee_cue_selected_station', stationId.toString());
    
    // Also store as last used station
    localStorage.setItem('last_used_station_id', stationId.toString());
    
    // Trigger a refresh for the new station
    // Use setTimeout to ensure state is updated first
    setTimeout(() => {
      console.log(`[useStations] Refreshing data for new station ${stationId}`);
      loadStations(true);
    }, 100);
  }, [loadStations]);

  // Get current station
  const getCurrentStation = useCallback(() => {
    return stations.find(station => station.id === selectedStation) || (stations.length > 0 ? stations[0] : null);
  }, [stations, selectedStation]);

  // Manual refresh
  const refreshData = useCallback(() => {
    if (!isMounted.current) return;
    
    console.log(`[useStations] Manual refresh requested for station ${selectedStation}`);
    
    // Prevent the refresh from switching back to station 1
    if (selectedStation) {
      // Double-check localStorage for station consistency
      try {
        const savedStationId = localStorage.getItem('coffee_cue_selected_station');
        if (savedStationId && parseInt(savedStationId, 10) !== selectedStation) {
          console.warn(`Station ID mismatch during refresh: current=${selectedStation}, saved=${savedStationId}. Using current.`);
          localStorage.setItem('coffee_cue_selected_station', selectedStation.toString());
        }
      } catch (e) {
        console.error('Error checking station ID consistency during refresh:', e);
      }
    }
    
    setIsRefreshing(true);
    loadStations(true);
  }, [loadStations, selectedStation]);

  // Load stations on mount and when mode changes
  useEffect(() => {
    // Set isMounted to true - component is mounted
    isMounted.current = true;
    
    console.log('[useStations] Initial setup or mode changed, isDemoMode:', isDemoMode);
    
    // Skip the initial load to avoid double initialization
    if (initialRender.current) {
      initialRender.current = false;
      // Do initial load
      loadStations();
    }
    
    // Set up polling interval (every 30 seconds is reasonable)
    let pollInterval = null;
    
    // Only set up polling in production mode
    if (!isDemoMode) {
      pollInterval = setInterval(() => {
        if (isMounted.current) {
          console.log('[useStations] Scheduled refresh (30s interval)');
          loadStations();
        }
      }, 30000);
    }
    
    // When changing to production mode, ensure we have our custom stations in localStorage
    if (!isDemoMode) {
      const savedStations = localStorage.getItem('coffee_cue_stations');
      if (!savedStations || savedStations === '[]') {
        console.log('[useStations] No stations saved in localStorage, saving current stations');
        // Use a callback to reference current stations state, not the initial state
        setStations(currentStations => {
          if (currentStations.length > 0) {
            localStorage.setItem('coffee_cue_stations', JSON.stringify(currentStations));
          }
          return currentStations; // Return same state, no update needed
        });
      }
    }
    
    // Cleanup function
    return () => {
      console.log('[useStations] Component unmounting - cleaning up');
      isMounted.current = false;
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [isDemoMode]); // Removed loadStations from dependencies to avoid circular reference
  
  // Trigger an initial load when dependencies change
  useEffect(() => {
    // Only trigger a load if not the initial render (that's handled by the other effect)
    if (!initialRender.current) {
      loadStations();
    }
  }, [isDemoMode, loadStations]);

  return {
    // Data
    stations,
    selectedStation,
    
    // UI state
    loading,
    error,
    lastUpdated,
    isRefreshing,
    
    // Actions
    updateStationStatus,
    updateStation,
    createStation,
    deleteStation,
    getStationStats,
    changeSelectedStation,
    getCurrentStation,
    refreshData,
    updateStationSession,
    updateStationCapabilities,
    
    // Error handling
    clearError: () => setError(null)
  };
}
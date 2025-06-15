// src/hooks/useSchedule.js
import { useState, useEffect, useCallback } from 'react';
import { useAppMode } from '../context/AppContext';
import ScheduleService from '../services/ScheduleService';

export default function useSchedule() {
  // Empty schedule data structure - no hardcoded names or data
  const emptyScheduleData = {
    shifts: [],
    breaks: [],
    rushPeriods: []
  };

  // State management
  const [scheduleData, setScheduleData] = useState(emptyScheduleData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [stationId, setStationId] = useState(null);
  const { isDemoMode } = useAppMode();

  // Initialize localStorage schedule data (but don't clear the real schedule data)
  useEffect(() => {
    // Only clear the legacy format data
    localStorage.removeItem('coffee_cue_schedule');
    
    // Clear only demo data, NOT the real schedule data
    Object.keys(localStorage).forEach(key => {
      if (key.includes('demo_')) {
        localStorage.removeItem(key);
      }
    });
    
    // Only initialize the legacy key, don't touch the new one
    localStorage.setItem('coffee_cue_schedule', JSON.stringify(emptyScheduleData));
    
    console.log('Legacy schedule data cleared on hook init');
  }, []);

  // Load schedule data from backend
  const loadSchedule = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      console.log('Loading schedule data for station:', stationId);
      
      // Try to load the schedule from the ScheduleService
      let scheduleResponse;
      
      // If we have a station ID, try to get the schedule for today for this station
      if (stationId) {
        console.log(`Fetching schedule data for station ID: ${stationId}`);
        scheduleResponse = await ScheduleService.getTodaySchedule(stationId);
      } else {
        console.log('No station ID provided, fetching all schedules');
        scheduleResponse = await ScheduleService.getTodaySchedule();
      }
      
      console.log('Schedule response:', scheduleResponse);
      
      // Check if we got a valid response
      if (scheduleResponse && scheduleResponse.success) {
        // Get list of hidden demo items
        const hiddenDemoItems = JSON.parse(localStorage.getItem('coffee_cue_hidden_demo_items') || '[]');
        console.log('Hidden demo items:', hiddenDemoItems);
        
        // Filter out demo items that have been manually removed
        const filteredSchedules = scheduleResponse.schedules ? 
          scheduleResponse.schedules.filter(schedule => {
            // Keep all real items (not demo data)
            if (!schedule.isDemoData) return true;
            
            // For demo data items, only keep them if they haven't been manually hidden
            return !hiddenDemoItems.includes(schedule.id);
          }) : [];
        
        // Convert the response to our format
        const formattedScheduleData = {
          shifts: filteredSchedules,
          breaks: [], // Response doesn't include breaks yet
          rushPeriods: [] // Response doesn't include rush periods yet
        };
        
        console.log('Formatted schedule data (after filtering demo items):', formattedScheduleData);
        setScheduleData(formattedScheduleData);
      } else {
        console.log('No valid schedule data found, using empty data');
        setScheduleData(emptyScheduleData);
      }
      
      setLastUpdated(Date.now());
      setError(null);
    } catch (err) {
      console.error('Error loading schedule:', err);
      setError(`Failed to load schedule: ${err.message}`);
      setScheduleData(emptyScheduleData);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [emptyScheduleData, stationId]);

  // Update shift status
  const updateShiftStatus = useCallback(async (shiftId, status) => {
    try {
      // Update locally only since backend doesn't support schedule
      const updatedShifts = scheduleData.shifts.map(shift => 
        shift.id === shiftId ? { ...shift, status } : shift
      );
      
      setScheduleData(prev => ({
        ...prev,
        shifts: updatedShifts
      }));
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error('Error updating shift status:', err);
      setError(`Failed to update shift status: ${err.message}`);
      return false;
    }
  }, [scheduleData]);

  // Add new shift
  const addShift = useCallback(async (shift) => {
    try {
      // Generate ID locally
      const newShift = {
        ...shift,
        id: Date.now(),
        status: 'upcoming'
      };
      
      // Update local state
      setScheduleData(prev => ({
        ...prev,
        shifts: [...prev.shifts, newShift]
      }));
      
      return newShift;
    } catch (err) {
      console.error('Error adding shift:', err);
      setError(`Failed to add shift: ${err.message}`);
      return null;
    }
  }, []);

  // Remove a shift
  const removeShift = useCallback(async (shiftId) => {
    try {
      // Update locally only
      setScheduleData(prev => {
        // Find the shift by ID
        const shiftToRemove = prev.shifts.find(shift => shift.id === shiftId);
        
        // If it's demo data and we're in production mode, mark it to not reappear
        if (shiftToRemove && shiftToRemove.isDemoData) {
          // Store the ID in localStorage so we know not to show this demo item again
          const hiddenDemoItems = JSON.parse(localStorage.getItem('coffee_cue_hidden_demo_items') || '[]');
          if (!hiddenDemoItems.includes(shiftId)) {
            hiddenDemoItems.push(shiftId);
            localStorage.setItem('coffee_cue_hidden_demo_items', JSON.stringify(hiddenDemoItems));
            console.log(`Marked demo shift ${shiftId} as hidden permanently`);
          }
        }
        
        return {
          ...prev,
          shifts: prev.shifts.filter(shift => shift.id !== shiftId)
        };
      });
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error('Error removing shift:', err);
      setError(`Failed to remove shift: ${err.message}`);
      return false;
    }
  }, []);

  // Add new break
  const addBreak = useCallback(async (breakData) => {
    try {
      // Generate ID locally
      const newBreak = {
        ...breakData,
        id: Date.now(),
        status: 'upcoming'
      };
      
      // Update local state
      setScheduleData(prev => ({
        ...prev,
        breaks: [...prev.breaks, newBreak]
      }));
      
      return newBreak;
    } catch (err) {
      console.error('Error adding break:', err);
      setError(`Failed to add break: ${err.message}`);
      return null;
    }
  }, []);

  // Remove a break
  const removeBreak = useCallback(async (breakId) => {
    try {
      // Update locally only
      setScheduleData(prev => {
        // Find the break by ID
        const breakToRemove = prev.breaks.find(breakItem => breakItem.id === breakId);
        
        // If it's demo data and we're in production mode, mark it to not reappear
        if (breakToRemove && breakToRemove.isDemoData) {
          // Store the ID in localStorage so we know not to show this demo item again
          const hiddenDemoItems = JSON.parse(localStorage.getItem('coffee_cue_hidden_demo_items') || '[]');
          if (!hiddenDemoItems.includes(breakId)) {
            hiddenDemoItems.push(breakId);
            localStorage.setItem('coffee_cue_hidden_demo_items', JSON.stringify(hiddenDemoItems));
            console.log(`Marked demo break ${breakId} as hidden permanently`);
          }
        }
        
        return {
          ...prev,
          breaks: prev.breaks.filter(breakItem => breakItem.id !== breakId)
        };
      });
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error('Error removing break:', err);
      setError(`Failed to remove break: ${err.message}`);
      return false;
    }
  }, []);

  // Add rush period
  const addRushPeriod = useCallback(async (rushPeriodData) => {
    try {
      // Generate ID locally
      const newRushPeriod = {
        ...rushPeriodData,
        id: Date.now()
      };
      
      // Update local state
      setScheduleData(prev => ({
        ...prev,
        rushPeriods: [...prev.rushPeriods, newRushPeriod]
      }));
      
      return newRushPeriod;
    } catch (err) {
      console.error('Error adding rush period:', err);
      setError(`Failed to add rush period: ${err.message}`);
      return null;
    }
  }, []);

  // Set station filter
  const setStation = useCallback((newStationId) => {
    setStationId(newStationId);
    // Reload schedule with new station filter
    loadSchedule(true);
  }, [loadSchedule]);

  // Get current barista - return null since we have no real data
  const getCurrentBarista = useCallback(() => {
    return null;
  }, []);

  // Manual refresh - we need to memoize this but without the loadSchedule dependency
  const refreshData = useCallback(() => {
    setIsRefreshing(true);
    loadSchedule(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load schedule on mount and when mode changes, but not on every loadSchedule change
  useEffect(() => {
    // Only load schedule data on initial mount and when mode changes
    loadSchedule();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDemoMode]);

  return {
    // Data
    scheduleData,
    stationId,
    
    // UI state
    loading,
    error,
    lastUpdated,
    isRefreshing,
    
    // Actions
    updateShiftStatus,
    addShift,
    removeShift,
    addBreak,
    removeBreak,
    addRushPeriod,
    setStation,
    getCurrentBarista,
    refreshData,
    
    // Error handling
    clearError: () => setError(null)
  };
}
// src/hooks/useSettings.js
import { useState, useEffect, useCallback } from 'react';
import { useAppMode } from '../context/AppContext';
import SettingsService from '../services/SettingsService';

// Export named function for importing with curly braces
export function useSettings() {
  // State management - start with null to force loading from SettingsService
  const [settings, setSettings] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const { isDemoMode } = useAppMode();

  // Load settings from backend or localStorage for demo mode
  const loadSettings = useCallback(async (forceRefresh = false) => {
    if (forceRefresh) {
      setIsRefreshing(true);
    } else {
      setLoading(true);
    }
    
    try {
      // For demo mode, use localStorage
      if (isDemoMode) {
        const savedSettings = localStorage.getItem('coffee_cue_settings');
        if (savedSettings) {
          setSettings(JSON.parse(savedSettings));
        }
      } else {
        // Use real backend API via SettingsService
        const fetchedSettings = await SettingsService.getSettings(forceRefresh);
        setSettings(fetchedSettings);
      }
      
      setError(null);
      setLastUpdated(Date.now());
    } catch (err) {
      console.error('Error loading settings:', err);
      setError(`Failed to load settings: ${err.message}`);
    } finally {
      setLoading(false);
      setIsRefreshing(false);
    }
  }, [isDemoMode]);

  // Update multiple settings at once
  const saveSettings = useCallback(async (newSettings) => {
    try {
      console.log('[useSettings] Saving multiple settings:', newSettings);
      
      // Always update local state first to ensure UI responsiveness
      const updatedSettings = {
        ...(settings || {}),
        ...newSettings
      };
      
      // Update state immediately for better user experience
      setSettings(updatedSettings);
      
      if (isDemoMode) {
        // For demo mode, save to localStorage
        console.log('[useSettings] In demo mode, updating settings to:', updatedSettings);
        localStorage.setItem('coffee_cue_settings', JSON.stringify(updatedSettings));
        console.log('[useSettings] Updated settings state in demo mode');
      } else {
        // For production mode, try the API but continue if it fails
        console.log('[useSettings] In production mode, calling API with:', newSettings);
        try {
          await SettingsService.updateSettings(newSettings);
          console.log('[useSettings] API update successful');
        } catch (apiErr) {
          console.warn('[useSettings] API update failed, but UI state was updated:', apiErr);
          // Still keep the UI update even if API fails
        }
      }
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error('Error saving settings:', err);
      setError(`Failed to save settings: ${err.message}`);
      return false;
    }
  }, [settings, isDemoMode]);

  // Update a single setting
  const updateSetting = useCallback(async (key, value) => {
    try {
      console.log(`[useSettings] Updating setting ${key} with value:`, value);
      
      // Always update local state first to ensure UI responsiveness
      setSettings(prev => ({
        ...(prev || {}),
        [key]: value
      }));
      
      if (isDemoMode) {
        // For demo mode, save to localStorage
        console.log('[useSettings] In demo mode, saving to localStorage');
        const updatedSettings = {
          ...(settings || {}),
          [key]: value
        };
        localStorage.setItem('coffee_cue_settings', JSON.stringify(updatedSettings));
        console.log('[useSettings] Demo mode update completed');
      } else {
        // For production mode, try the API but continue if it fails
        console.log('[useSettings] In production mode, using API endpoint');
        try {
          await SettingsService.updateSetting(key, value);
          console.log('[useSettings] API update successful');
        } catch (apiErr) {
          console.warn('[useSettings] API update failed, but UI state was updated:', apiErr);
          // Still keep the UI update even if API fails
        }
      }
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error(`Error updating setting ${key}:`, err);
      setError(`Failed to update setting: ${err.message}`);
      return false;
    }
  }, [settings, isDemoMode]);

  // Reset settings to defaults
  const resetSettings = useCallback(async () => {
    try {
      if (isDemoMode) {
        // For demo mode, get defaults from SettingsService instead of hardcoded values
        localStorage.removeItem('coffee_cue_settings'); // Clear localStorage
        const defaultsFromService = await SettingsService.getSettings(true); // Force refresh to get defaults
        setSettings(defaultsFromService);
      } else {
        // For production mode, use the API
        const resetResult = await SettingsService.resetSettings();
        setSettings(resetResult);
      }
      
      setLastUpdated(Date.now());
      return true;
    } catch (err) {
      console.error('Error resetting settings:', err);
      setError(`Failed to reset settings: ${err.message}`);
      return false;
    }
  }, [isDemoMode]);

  // Update wait time
  const updateWaitTime = useCallback(async (waitTime) => {
    try {
      if (isDemoMode) {
        // For demo mode, update locally
        return await updateSetting('waitTimeWarning', waitTime);
      } else {
        // For production mode, use specific API endpoint
        await SettingsService.updateWaitTime(waitTime);
        
        // Update local state
        setSettings(prev => ({
          ...prev,
          waitTimeWarning: waitTime
        }));
        
        setLastUpdated(Date.now());
        return true;
      }
    } catch (err) {
      console.error('Error updating wait time:', err);
      setError(`Failed to update wait time: ${err.message}`);
      return false;
    }
  }, [isDemoMode, updateSetting]);

  // Manual refresh
  const refreshData = useCallback(() => {
    setIsRefreshing(true);
    loadSettings(true);
  }, [loadSettings]);

  // Load settings on mount and when mode changes
  useEffect(() => {
    loadSettings();
  }, [loadSettings, isDemoMode]);

  return {
    // Data - provide empty object as fallback while loading to prevent crashes
    settings: settings || {},
    
    // UI state
    loading,
    error,
    lastUpdated,
    isRefreshing,
    
    // Actions
    updateSetting,
    saveSettings,
    resetSettings,
    updateWaitTime,
    refreshData,
    
    // Error handling
    clearError: () => setError(null)
  };
}

// Also export as default for backward compatibility
export default useSettings;
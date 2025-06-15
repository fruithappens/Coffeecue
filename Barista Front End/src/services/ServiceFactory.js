// services/ServiceFactory.js
import { APP_MODES } from '../context/AppContext';

/**
 * Service Factory - Creates service instances based on current app mode
 * 
 * This factory allows dynamic switching between real API services and mock services
 * for demo/test mode without changing the application code.
 */
class ServiceFactory {
  constructor() {
    // Always default to PRODUCTION mode to ensure real API usage
    const savedMode = localStorage.getItem('coffee_cue_app_mode');
    this.currentMode = savedMode || APP_MODES.PRODUCTION;
    
    // Always ensure we start with PRODUCTION as default
    if (!savedMode) {
      localStorage.setItem('coffee_cue_app_mode', APP_MODES.PRODUCTION);
    }
    
    this.services = {};
    this.mockServices = {};
    this.realServices = {};
    
    // Listeners for mode changes
    this.listeners = [];
    
    // Monitor localStorage for mode changes from other components
    window.addEventListener('storage', (event) => {
      if (event.key === 'coffee_cue_app_mode' && event.newValue !== this.currentMode) {
        this.currentMode = event.newValue;
        this._notifyListeners();
      }
    });
  }

  /**
   * Register a service with the factory
   * @param {string} name - Service name
   * @param {object} realService - Real API service instance
   * @param {object} mockService - Mock service instance for demo/test mode
   */
  registerService(name, realService, mockService) {
    this.realServices[name] = realService;
    this.mockServices[name] = mockService;
    
    // Update current service based on mode
    this._updateService(name);
    
    return this;
  }

  /**
   * Get a service by name
   * @param {string} name - Service name
   * @returns {object} - Service instance
   */
  getService(name) {
    if (!this.services[name]) {
      throw new Error(`Service ${name} not registered`);
    }
    
    return this.services[name];
  }

  /**
   * Set the current application mode
   * @param {string} mode - New mode (from APP_MODES)
   */
  setMode(mode) {
    if (mode !== APP_MODES.PRODUCTION && mode !== APP_MODES.DEMO) {
      throw new Error(`Invalid mode: ${mode}`);
    }
    
    if (mode !== this.currentMode) {
      this.currentMode = mode;
      localStorage.setItem('coffee_cue_app_mode', mode);
      
      // Update all services based on new mode
      this._updateAllServices();
      
      // Notify listeners
      this._notifyListeners();
    }
  }

  /**
   * Get the current application mode
   * @returns {string} - Current mode
   */
  getMode() {
    return this.currentMode;
  }

  /**
   * Add listener for mode changes
   * @param {function} listener - Callback function
   */
  addModeChangeListener(listener) {
    this.listeners.push(listener);
  }

  /**
   * Remove listener for mode changes
   * @param {function} listener - Callback function to remove
   */
  removeModeChangeListener(listener) {
    this.listeners = this.listeners.filter(l => l !== listener);
  }

  /**
   * Update service based on current mode
   * @private
   * @param {string} name - Service name
   */
  _updateService(name) {
    if (this.currentMode === APP_MODES.DEMO) {
      this.services[name] = this.mockServices[name];
    } else {
      this.services[name] = this.realServices[name];
    }
  }

  /**
   * Update all services based on current mode
   * @private
   */
  _updateAllServices() {
    Object.keys(this.realServices).forEach(name => {
      this._updateService(name);
    });
  }

  /**
   * Notify listeners of mode changes
   * @private
   */
  _notifyListeners() {
    this.listeners.forEach(listener => {
      try {
        listener(this.currentMode);
      } catch (error) {
        console.error('Error in mode change listener:', error);
      }
    });
  }
}

// Create and export singleton instance
const serviceFactory = new ServiceFactory();
export default serviceFactory;
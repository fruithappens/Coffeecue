/**
 * Database Inventory Service - Replaces localStorage with database API calls
 * Fixes architectural flaw by using proper persistent storage
 */

import ApiService from './ApiService';

class DatabaseInventoryService {
    constructor() {
        this.apiService = new ApiService();
        this.cache = {
            event_inventory: null,
            event_stock_levels: null,
            station_inventory_configs: null,
            station_inventory_quantities: null,
            lastUpdate: null
        };
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Initialize the service and migrate any existing localStorage data
     */
    async initialize() {
        try {
            console.log('🔄 Initializing Database Inventory Service...');
            
            // Check if we have localStorage data to migrate
            const hasLocalStorageData = this.checkForLocalStorageData();
            
            if (hasLocalStorageData) {
                console.log('📦 Found localStorage data - initiating migration...');
                await this.migrateLocalStorageData();
            }
            
            // Load data from database
            await this.loadFromDatabase();
            
            console.log('✅ Database Inventory Service initialized successfully');
            return true;
        } catch (error) {
            console.error('❌ Failed to initialize Database Inventory Service:', error);
            return false;
        }
    }

    /**
     * Check if there's localStorage data that needs migration
     */
    checkForLocalStorageData() {
        const keys = [
            'event_inventory',
            'event_stock_levels', 
            'station_inventory_configs',
            'station_inventory_quantities'
        ];
        
        return keys.some(key => {
            const value = localStorage.getItem(key);
            return value && value !== 'null' && value !== 'undefined';
        });
    }

    /**
     * Migrate localStorage data to database
     */
    async migrateLocalStorageData() {
        try {
            const localStorageData = {};
            
            // Extract all relevant localStorage data
            const relevantKeys = [
                'event_inventory',
                'event_stock_levels', 
                'station_inventory_configs',
                'station_inventory_quantities',
                'branding_settings',
                'sms_settings',
                'system_settings',
                'coffee_system_token',
                'coffee_connection_status'
            ];
            
            for (const key of relevantKeys) {
                const value = localStorage.getItem(key);
                if (value && value !== 'null' && value !== 'undefined') {
                    try {
                        localStorageData[key] = JSON.parse(value);
                    } catch (e) {
                        localStorageData[key] = value;
                    }
                }
            }
            
            // Send to migration API
            const response = await this.apiService.post('/migration/export-localStorage', localStorageData);
            
            if (response.success) {
                console.log('✅ localStorage data migrated successfully');
                
                // Clear localStorage data (but keep tokens)
                const keysToKeep = ['coffee_system_token', 'coffee_system_refresh_token'];
                relevantKeys.forEach(key => {
                    if (!keysToKeep.includes(key)) {
                        localStorage.removeItem(key);
                    }
                });
                
                // Mark migration complete
                localStorage.setItem('migration_completed', 'true');
                localStorage.setItem('migration_date', new Date().toISOString());
                
                return true;
            } else {
                console.error('❌ Migration failed:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error during migration:', error);
            return false;
        }
    }

    /**
     * Load all inventory data from database
     */
    async loadFromDatabase() {
        try {
            const response = await this.apiService.get('/migration/get-inventory');
            
            if (response.success && response.data) {
                this.cache = {
                    ...response.data,
                    lastUpdate: Date.now()
                };
                
                console.log('📊 Inventory data loaded from database:', {
                    event_inventory: Object.keys(this.cache.event_inventory || {}).length,
                    event_stock_levels: Object.keys(this.cache.event_stock_levels || {}).length,
                    station_configs: Object.keys(this.cache.station_inventory_configs || {}).length,
                    station_quantities: Object.keys(this.cache.station_inventory_quantities || {}).length
                });
                
                return this.cache;
            } else {
                console.error('❌ Failed to load inventory data:', response.error);
                return null;
            }
        } catch (error) {
            console.error('❌ Error loading inventory data:', error);
            return null;
        }
    }

    /**
     * Check if cache is still valid
     */
    isCacheValid() {
        return this.cache.lastUpdate && 
               (Date.now() - this.cache.lastUpdate) < this.cacheTimeout;
    }

    /**
     * Get event inventory data
     */
    async getEventInventory() {
        if (!this.isCacheValid()) {
            await this.loadFromDatabase();
        }
        
        return this.cache.event_inventory || {};
    }

    /**
     * Get event stock levels
     */
    async getEventStockLevels() {
        if (!this.isCacheValid()) {
            await this.loadFromDatabase();
        }
        
        return this.cache.event_stock_levels || {};
    }

    /**
     * Get station inventory configurations
     */
    async getStationInventoryConfigs() {
        if (!this.isCacheValid()) {
            await this.loadFromDatabase();
        }
        
        return this.cache.station_inventory_configs || {};
    }

    /**
     * Get station inventory quantities
     */
    async getStationInventoryQuantities() {
        if (!this.isCacheValid()) {
            await this.loadFromDatabase();
        }
        
        return this.cache.station_inventory_quantities || {};
    }

    /**
     * Update event inventory item
     */
    async updateEventInventoryItem(category, itemName, enabled) {
        try {
            // Update in database via API
            const response = await this.apiService.post('/inventory/event-inventory/update', {
                category,
                item_name: itemName,
                enabled
            });
            
            if (response.success) {
                // Update cache
                if (!this.cache.event_inventory) this.cache.event_inventory = {};
                if (!this.cache.event_inventory[category]) this.cache.event_inventory[category] = {};
                this.cache.event_inventory[category][itemName] = { enabled };
                
                console.log(`✅ Updated event inventory: ${category}/${itemName} = ${enabled}`);
                return true;
            } else {
                console.error('❌ Failed to update event inventory:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error updating event inventory:', error);
            return false;
        }
    }

    /**
     * Update event stock level
     */
    async updateEventStockLevel(itemName, stockData) {
        try {
            const response = await this.apiService.post('/inventory/event-stock/update', {
                item_name: itemName,
                ...stockData
            });
            
            if (response.success) {
                // Update cache
                if (!this.cache.event_stock_levels) this.cache.event_stock_levels = {};
                this.cache.event_stock_levels[itemName] = stockData;
                
                console.log(`✅ Updated stock level: ${itemName}`, stockData);
                return true;
            } else {
                console.error('❌ Failed to update stock level:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error updating stock level:', error);
            return false;
        }
    }

    /**
     * Update station inventory configuration
     */
    async updateStationInventoryConfig(stationId, config) {
        try {
            const response = await this.apiService.post('/inventory/station-config/update', {
                station_id: stationId,
                config_data: config
            });
            
            if (response.success) {
                // Update cache
                if (!this.cache.station_inventory_configs) this.cache.station_inventory_configs = {};
                this.cache.station_inventory_configs[stationId] = config;
                
                console.log(`✅ Updated station config: ${stationId}`);
                return true;
            } else {
                console.error('❌ Failed to update station config:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error updating station config:', error);
            return false;
        }
    }

    /**
     * Update station inventory quantity
     */
    async updateStationInventoryQuantity(stationId, itemName, quantity) {
        try {
            const response = await this.apiService.post('/inventory/station-quantity/update', {
                station_id: stationId,
                item_name: itemName,
                quantity
            });
            
            if (response.success) {
                // Update cache
                if (!this.cache.station_inventory_quantities) this.cache.station_inventory_quantities = {};
                if (!this.cache.station_inventory_quantities[stationId]) this.cache.station_inventory_quantities[stationId] = {};
                this.cache.station_inventory_quantities[stationId][itemName] = quantity;
                
                console.log(`✅ Updated station quantity: ${stationId}/${itemName} = ${quantity}`);
                return true;
            } else {
                console.error('❌ Failed to update station quantity:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error updating station quantity:', error);
            return false;
        }
    }

    /**
     * Batch update multiple items
     */
    async batchUpdate(updates) {
        try {
            const response = await this.apiService.post('/inventory/batch-update', { updates });
            
            if (response.success) {
                // Reload from database to ensure consistency
                await this.loadFromDatabase();
                console.log('✅ Batch update completed successfully');
                return true;
            } else {
                console.error('❌ Batch update failed:', response.error);
                return false;
            }
        } catch (error) {
            console.error('❌ Error in batch update:', error);
            return false;
        }
    }

    /**
     * Clear cache and reload from database
     */
    async refresh() {
        this.cache.lastUpdate = null;
        return await this.loadFromDatabase();
    }

    /**
     * Get migration status
     */
    getMigrationStatus() {
        return {
            completed: localStorage.getItem('migration_completed') === 'true',
            date: localStorage.getItem('migration_date'),
            hasLocalStorageData: this.checkForLocalStorageData()
        };
    }

    /**
     * For backward compatibility - these methods now use database
     */
    
    // Legacy method for getting event inventory (from localStorage pattern)
    getInventoryData() {
        return this.getEventInventory();
    }
    
    // Legacy method for getting stock levels
    getStockData() {
        return this.getEventStockLevels();
    }
    
    // Legacy method for getting station configs
    getStationConfigs() {
        return this.getStationInventoryConfigs();
    }
    
    // Legacy method for getting station quantities
    getStationQuantities() {
        return this.getStationInventoryQuantities();
    }
}

// Create singleton instance
const databaseInventoryService = new DatabaseInventoryService();

// Export singleton instance
export default databaseInventoryService;
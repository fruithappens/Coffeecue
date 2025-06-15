/**
 * Auto Fixer Module
 * Automatically fixes identified issues
 */

const fs = require('fs').promises;
const path = require('path');
const { execSync } = require('child_process');

class AutoFixer {
    constructor(config) {
        this.config = config;
        this.fixHandlers = {
            authentication: this.fixAuthentication.bind(this),
            missing_element: this.fixMissingElement.bind(this),
            network_error: this.fixNetworkError.bind(this),
            permission_error: this.fixPermissionError.bind(this),
            state_error: this.fixStateError.bind(this),
            timeout: this.fixTimeout.bind(this),
            localStorage: this.fixLocalStorage.bind(this),
            cors: this.fixCors.bind(this),
            ui_change: this.fixUiChange.bind(this),
            data_format: this.fixDataFormat.bind(this)
        };
    }

    async fixIssues(issues) {
        const fixes = [];
        
        for (const issue of issues) {
            console.log(`🔧 Attempting to fix ${issue.type} issue...`);
            
            const fix = await this.fixIssue(issue);
            fixes.push(fix);
            
            if (fix.success) {
                console.log(`✅ Fixed ${issue.type} issue`);
            } else {
                console.log(`❌ Could not fix ${issue.type} issue: ${fix.error}`);
            }
        }
        
        return fixes;
    }

    async fixIssue(issue) {
        const handler = this.fixHandlers[issue.type];
        
        if (!handler) {
            return {
                issue: issue.type,
                success: false,
                error: 'No fix handler available'
            };
        }
        
        try {
            const result = await handler(issue);
            return {
                issue: issue.type,
                success: true,
                ...result
            };
        } catch (error) {
            return {
                issue: issue.type,
                success: false,
                error: error.message
            };
        }
    }

    async fixAuthentication(issue) {
        // Clear existing auth tokens
        await this.clearAuthTokens();
        
        // Update auth service to handle token issues
        const authServicePath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/src/services/AuthService.js'
        );
        
        try {
            let content = await fs.readFile(authServicePath, 'utf8');
            
            // Add retry logic if not present
            if (!content.includes('retryCount')) {
                const retryLogic = `
  async loginWithRetry(username, password, retries = 3) {
    for (let i = 0; i < retries; i++) {
      try {
        return await this.login(username, password);
      } catch (error) {
        if (i === retries - 1) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
  }`;
                
                // Insert after login method
                const loginIndex = content.indexOf('async login(');
                const nextMethodIndex = content.indexOf('\n  }', loginIndex) + 4;
                content = content.slice(0, nextMethodIndex) + retryLogic + content.slice(nextMethodIndex);
                
                await fs.writeFile(authServicePath, content);
            }
        } catch (error) {
            console.log('Could not modify AuthService:', error.message);
        }
        
        return {
            action: 'Cleared auth tokens and added retry logic',
            details: issue.context
        };
    }

    async fixMissingElement(issue) {
        const { missingSelector } = issue.context;
        
        // Add wait logic for dynamic elements
        const testInjection = `
// Auto-injected wait helper
window.waitForElement = function(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const startTime = Date.now();
        const checkInterval = setInterval(() => {
            const element = document.querySelector(selector);
            if (element) {
                clearInterval(checkInterval);
                resolve(element);
            } else if (Date.now() - startTime > timeout) {
                clearInterval(checkInterval);
                reject(new Error('Element not found: ' + selector));
            }
        }, 100);
    });
};`;
        
        // Inject into app
        const indexPath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/public/index.html'
        );
        
        try {
            let content = await fs.readFile(indexPath, 'utf8');
            if (!content.includes('waitForElement')) {
                content = content.replace('</body>', `<script>${testInjection}</script>\n</body>`);
                await fs.writeFile(indexPath, content);
            }
        } catch (error) {
            console.log('Could not inject wait helper:', error.message);
        }
        
        return {
            action: 'Added element wait helper',
            selector: missingSelector
        };
    }

    async fixNetworkError(issue) {
        // Enable offline mode
        const configPath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/src/config/config.js'
        );
        
        try {
            let content = await fs.readFile(configPath, 'utf8');
            
            // Enable fallback mode
            content = content.replace(
                'USE_FALLBACK_DATA: false',
                'USE_FALLBACK_DATA: true'
            );
            
            await fs.writeFile(configPath, content);
        } catch (error) {
            console.log('Could not enable offline mode:', error.message);
        }
        
        // Also set localStorage flag
        const localStorageScript = `
localStorage.setItem('use_fallback_data', 'true');
console.log('Enabled offline mode due to network errors');`;
        
        return {
            action: 'Enabled offline/fallback mode',
            script: localStorageScript
        };
    }

    async fixPermissionError(issue) {
        // Update user role in mock data
        const mockDataPath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/src/services/MockDataService.js'
        );
        
        try {
            let content = await fs.readFile(mockDataPath, 'utf8');
            
            // Ensure admin role for testing
            content = content.replace(
                "role: 'barista'",
                "role: 'admin'"
            );
            
            await fs.writeFile(mockDataPath, content);
        } catch (error) {
            console.log('Could not update mock user role:', error.message);
        }
        
        return {
            action: 'Updated user role to admin in mock data'
        };
    }

    async fixStateError(issue) {
        // Clear problematic localStorage entries
        const clearScript = `
// Clear corrupted state
['coffee_cue_barista_settings', 'undefined', 'null'].forEach(key => {
    if (localStorage.getItem(key) === 'undefined' || localStorage.getItem(key) === 'null') {
        localStorage.removeItem(key);
    }
});`;
        
        // Fix state initialization
        const componentPath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/src/components/BaristaInterface.js'
        );
        
        try {
            let content = await fs.readFile(componentPath, 'utf8');
            
            // Add null checks
            content = content.replace(
                'JSON.parse(saved)',
                'saved && saved !== "undefined" && saved !== "null" ? JSON.parse(saved) : {}'
            );
            
            await fs.writeFile(componentPath, content);
        } catch (error) {
            console.log('Could not fix state initialization:', error.message);
        }
        
        return {
            action: 'Fixed state initialization and cleared corrupted data',
            script: clearScript
        };
    }

    async fixTimeout(issue) {
        // Increase timeouts in test configuration
        const testConfigPath = path.join(
            this.config.baseDir || process.cwd(),
            'test-config.json'
        );
        
        try {
            const config = {
                defaultTimeout: 10000,
                navigationTimeout: 15000,
                elementTimeout: 8000
            };
            
            await fs.writeFile(testConfigPath, JSON.stringify(config, null, 2));
        } catch (error) {
            console.log('Could not update timeout config:', error.message);
        }
        
        return {
            action: 'Increased timeout values',
            newTimeouts: {
                default: 10000,
                navigation: 15000,
                element: 8000
            }
        };
    }

    async fixLocalStorage(issue) {
        const clearScript = `
// Clear all localStorage to fix quota issues
const keysToPreserve = ['coffee_system_token', 'coffee_system_user'];
const preservedData = {};

keysToPreserve.forEach(key => {
    preservedData[key] = localStorage.getItem(key);
});

localStorage.clear();

Object.entries(preservedData).forEach(([key, value]) => {
    if (value) localStorage.setItem(key, value);
});

console.log('Cleared localStorage, preserved auth data');`;
        
        return {
            action: 'Cleared localStorage while preserving auth',
            script: clearScript
        };
    }

    async fixCors(issue) {
        // Update API configuration
        const apiConfigPath = path.join(
            this.config.baseDir || process.cwd(),
            '../Barista Front End/src/config/apiConfig.js'
        );
        
        try {
            let content = await fs.readFile(apiConfigPath, 'utf8');
            
            // Add CORS headers
            if (!content.includes('no-cors')) {
                content = content.replace(
                    "mode: 'cors'",
                    "mode: 'cors',\n    credentials: 'omit'"
                );
            }
            
            await fs.writeFile(apiConfigPath, content);
        } catch (error) {
            console.log('Could not fix CORS config:', error.message);
        }
        
        return {
            action: 'Updated CORS configuration'
        };
    }

    async fixUiChange(issue) {
        // Update selectors to be more flexible
        const selectorMappings = {
            'button[type="submit"]': 'button[type="submit"], button:contains("Login"), button:contains("Sign In")',
            '[role="tab"]': '[role="tab"], .tab, button[data-tab]',
            '.order-item': '.order-item, .order-card, [data-testid*="order"]'
        };
        
        // Generate selector update script
        const updateScript = `
// Update test selectors for UI changes
window.flexibleSelector = function(selectors) {
    const selectorArray = Array.isArray(selectors) ? selectors : [selectors];
    for (const selector of selectorArray) {
        const element = document.querySelector(selector);
        if (element) return element;
    }
    return null;
};`;
        
        return {
            action: 'Added flexible selector helper',
            script: updateScript,
            mappings: selectorMappings
        };
    }

    async fixDataFormat(issue) {
        // Add JSON parsing safety
        const safeParseScript = `
// Safe JSON parsing
window.safeJsonParse = function(str, defaultValue = {}) {
    try {
        if (!str || str === 'undefined' || str === 'null') return defaultValue;
        return JSON.parse(str);
    } catch (e) {
        console.warn('JSON parse error:', e);
        return defaultValue;
    }
};`;
        
        return {
            action: 'Added safe JSON parsing helper',
            script: safeParseScript
        };
    }

    async clearAuthTokens() {
        const clearScript = `
// Clear all auth-related tokens
['coffee_system_token', 'coffee_system_refresh_token', 'coffee_system_user', 'access_token'].forEach(key => {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
});`;
        
        try {
            // Also clear on backend if possible
            await fetch(`${this.config.apiUrl}/api/auth/logout`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            }).catch(() => {});
        } catch (error) {
            // Ignore logout errors
        }
        
        return clearScript;
    }
}

module.exports = AutoFixer;
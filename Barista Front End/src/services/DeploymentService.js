// services/DeploymentService.js
import AuthService from './AuthService';

/**
 * Service to handle deployment updates and version changes
 */
class DeploymentService {
  constructor() {
    this.currentVersion = process.env.REACT_APP_VERSION || this.generateVersionFromBuild();
    this.checkInterval = 5 * 60 * 1000; // Check every 5 minutes
    this.intervalId = null;
    this.lastCheckTime = 0;
    this.versionEndpoint = '/version.json'; // File to check for version info
    
    console.log('DeploymentService initialized with version:', this.currentVersion);
    
    // Start periodic version checking
    this.startVersionChecking();
    
    // Listen for focus events to check version when user returns to tab
    window.addEventListener('focus', () => this.checkForUpdates());
    
    // Listen for online events to check version when connection restored
    window.addEventListener('online', () => this.checkForUpdates());
  }

  /**
   * Generate version string from build time if REACT_APP_VERSION not set
   */
  generateVersionFromBuild() {
    // Use build time as version if no explicit version set
    const buildTime = process.env.REACT_APP_BUILD_TIME || Date.now().toString();
    return `build-${buildTime}`;
  }

  /**
   * Start periodic version checking
   */
  startVersionChecking() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    
    this.intervalId = setInterval(() => {
      this.checkForUpdates();
    }, this.checkInterval);
    
    // Initial check after 30 seconds
    setTimeout(() => this.checkForUpdates(), 30000);
  }

  /**
   * Stop periodic version checking
   */
  stopVersionChecking() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /**
   * Check for application updates
   */
  async checkForUpdates() {
    // Don't check too frequently
    const now = Date.now();
    if (now - this.lastCheckTime < 60000) { // Minimum 1 minute between checks
      return;
    }
    this.lastCheckTime = now;

    try {
      console.log('Checking for application updates...');
      
      // Try to fetch version info from server
      const response = await fetch(this.versionEndpoint, {
        method: 'GET',
        cache: 'no-cache',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });

      if (response.ok) {
        const versionInfo = await response.json();
        const serverVersion = versionInfo.version || versionInfo.buildTime;
        
        if (serverVersion && serverVersion !== this.currentVersion) {
          console.log(`New version detected: ${this.currentVersion} → ${serverVersion}`);
          this.handleVersionChange(serverVersion);
          return;
        }
      }
      
      // If version.json doesn't exist, try checking main HTML for changes
      await this.checkHtmlForChanges();
      
    } catch (error) {
      console.log('Version check failed (this is normal):', error.message);
      // Silently fail - version checking is not critical
    }
  }

  /**
   * Check main HTML file for changes (fallback method)
   */
  async checkHtmlForChanges() {
    try {
      const response = await fetch('/', {
        method: 'HEAD',
        cache: 'no-cache'
      });
      
      if (response.ok) {
        const lastModified = response.headers.get('last-modified');
        const etag = response.headers.get('etag');
        
        const storedModified = localStorage.getItem('html_last_modified');
        const storedEtag = localStorage.getItem('html_etag');
        
        if (lastModified && storedModified && lastModified !== storedModified) {
          console.log('HTML file change detected via Last-Modified header');
          this.handleVersionChange(`modified-${Date.now()}`);
          return;
        }
        
        if (etag && storedEtag && etag !== storedEtag) {
          console.log('HTML file change detected via ETag header');
          this.handleVersionChange(`etag-${Date.now()}`);
          return;
        }
        
        // Store current values for next check
        if (lastModified) {
          localStorage.setItem('html_last_modified', lastModified);
        }
        if (etag) {
          localStorage.setItem('html_etag', etag);
        }
      }
    } catch (error) {
      // Silently fail
      console.log('HTML change check failed:', error.message);
    }
  }

  /**
   * Handle version change detection
   */
  handleVersionChange(newVersion) {
    console.log(`Handling version change: ${this.currentVersion} → ${newVersion}`);
    
    // Update stored version
    localStorage.setItem('app_version', newVersion);
    
    // Check if user is logged in
    const isLoggedIn = AuthService.isLoggedIn();
    
    if (isLoggedIn) {
      // Show user-friendly notification about update
      this.showUpdateNotification();
    } else {
      // Just reload if not logged in
      this.reloadApplication();
    }
  }

  /**
   * Show update notification to user
   */
  showUpdateNotification() {
    // Create or update notification element
    let notification = document.getElementById('update-notification');
    
    if (!notification) {
      notification = document.createElement('div');
      notification.id = 'update-notification';
      notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #1e40af;
        color: white;
        padding: 16px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        z-index: 10000;
        max-width: 350px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        font-size: 14px;
        line-height: 1.4;
      `;
      
      notification.innerHTML = `
        <div style="margin-bottom: 12px; font-weight: 600;">
          🔄 Update Available
        </div>
        <div style="margin-bottom: 12px; opacity: 0.9;">
          The application has been updated. Please save your work and refresh to get the latest features.
        </div>
        <div style="display: flex; gap: 8px;">
          <button id="refresh-now" style="
            background: white;
            color: #1e40af;
            border: none;
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            font-weight: 600;
            cursor: pointer;
          ">Refresh Now</button>
          <button id="dismiss-update" style="
            background: transparent;
            color: white;
            border: 1px solid rgba(255,255,255,0.3);
            padding: 6px 12px;
            border-radius: 4px;
            font-size: 12px;
            cursor: pointer;
          ">Later</button>
        </div>
      `;
      
      document.body.appendChild(notification);
      
      // Add event listeners
      document.getElementById('refresh-now').addEventListener('click', () => {
        this.reloadApplication();
      });
      
      document.getElementById('dismiss-update').addEventListener('click', () => {
        notification.remove();
        // Show again in 10 minutes
        setTimeout(() => this.showUpdateNotification(), 10 * 60 * 1000);
      });
      
      // Auto-dismiss after 30 seconds if no action
      setTimeout(() => {
        if (notification.parentNode) {
          notification.remove();
          // Show again in 5 minutes
          setTimeout(() => this.showUpdateNotification(), 5 * 60 * 1000);
        }
      }, 30000);
    }
  }

  /**
   * Reload the application cleanly
   */
  reloadApplication() {
    console.log('Reloading application for update...');
    
    // Clear any cached data that might be stale
    if ('caches' in window) {
      caches.keys().then(names => {
        names.forEach(name => {
          caches.delete(name);
        });
      });
    }
    
    // Force hard reload
    window.location.reload(true);
  }

  /**
   * Force check for updates (called by user action)
   */
  async forceCheckForUpdates() {
    this.lastCheckTime = 0; // Reset throttle
    await this.checkForUpdates();
  }

  /**
   * Get current version
   */
  getCurrentVersion() {
    return this.currentVersion;
  }
}

// Export singleton
export default new DeploymentService();
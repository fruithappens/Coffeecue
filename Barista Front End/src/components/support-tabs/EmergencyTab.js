import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
// Icon list trimmed after batch F removed the dead buttons (Power,
// Trash2, Upload, etc) — keep only what's still used in the JSX below so
// ESLint doesn't flag the leftovers. Lock/Unlock are back: their backend
// endpoints now exist, so the button is real again.
import {
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  Database,
  Coffee,
  Shield,
  Download,
  StopCircle,
  PlayCircle,
  Lock,
  Unlock,
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

// Create an instance of ApiService
const ApiService = new ApiServiceClass();

const EmergencyTab = () => {
  const [emergencyMode, setEmergencyMode] = useState(false);
  const [systemLocked, setSystemLocked] = useState(false);
  const [confirmations, setConfirmations] = useState({});
  const [actionLog, setActionLog] = useState([]);
  const [backupStatus, setBackupStatus] = useState(null);

  // Read the real state on mount. Both switches live in the settings
  // table, so a page refresh (or a second support laptop) used to show
  // "Stop everything" while operations were already stopped — the
  // buttons reflected React's initial state, not the system's.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await ApiService.get('/emergency/status');
        if (cancelled || !r) return;
        setEmergencyMode(!!r.emergency_mode);
        setSystemLocked(!!r.ordering_locked);
      } catch (e) {
        // Non-fatal: the buttons still work, they just start from their
        // default state. Never block the Emergency tab from rendering.
        console.warn('Could not read emergency status:', e);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const requireConfirmation = (action, callback) => {
    const confirmKey = `confirm_${Date.now()}`;
    setConfirmations(prev => ({
      ...prev,
      [confirmKey]: {
        action,
        callback,
        timestamp: Date.now()
      }
    }));
    return confirmKey;
  };

  const executeAction = async (confirmKey) => {
    const confirmation = confirmations[confirmKey];
    if (!confirmation) return;

    try {
      await confirmation.callback();
      logAction(confirmation.action, 'success');
    } catch (error) {
      logAction(confirmation.action, 'failed', error.message);
    } finally {
      setConfirmations(prev => {
        const updated = { ...prev };
        delete updated[confirmKey];
        return updated;
      });
    }
  };

  const cancelConfirmation = (confirmKey) => {
    setConfirmations(prev => {
      const updated = { ...prev };
      delete updated[confirmKey];
      return updated;
    });
  };

  const logAction = (action, status, details = '') => {
    setActionLog(prev => [{
      action,
      status,
      details,
      timestamp: new Date().toISOString(),
      user: 'support_admin' // Would come from auth context
    }, ...prev.slice(0, 49)]); // Keep last 50 actions
  };

  // Emergency Actions
  const stopAllOperations = () => {
    requireConfirmation('Stop everything', async () => {
      await ApiService.post('/emergency/stop-all');
      setEmergencyMode(true);
    });
  };

  const resumeOperations = () => {
    requireConfirmation('Resume Operations', async () => {
      await ApiService.post('/emergency/resume');
      setEmergencyMode(false);
    });
  };

  const clearAllQueues = () => {
    requireConfirmation('Clear ALL Order Queues', async () => {
      await ApiService.post('/emergency/clear-queues');
    });
  };

  const resetAllStations = () => {
    requireConfirmation('Reset all stations', async () => {
      await ApiService.post('/emergency/reset-stations');
    });
  };

  const lockSystem = () => {
    requireConfirmation('Lock System', async () => {
      await ApiService.post('/emergency/lock-system');
      setSystemLocked(true);
    });
  };

  const unlockSystem = () => {
    requireConfirmation('Unlock System', async () => {
      await ApiService.post('/emergency/unlock-system');
      setSystemLocked(false);
    });
  };

  const createBackup = async () => {
    try {
      setBackupStatus('creating');
      const response = await ApiService.post('/emergency/backup');
      setBackupStatus('completed');
      logAction('Create a backup', 'success', response.data.filename);
      
      // Download backup
      const blob = new Blob([JSON.stringify(response.data.backup)], { 
        type: 'application/json' 
      });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = response.data.filename;
      a.click();
    } catch (error) {
      setBackupStatus('failed');
      logAction('Create a backup', 'failed', error.message);
    }
  };

  const restoreFromBackup = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    requireConfirmation('Restore from Backup', async () => {
      const formData = new FormData();
      formData.append('backup', file);
      await ApiService.post('/emergency/restore', formData);
    });
  };

  const purgeOldData = () => {
    requireConfirmation('Purge Old Data (>30 days)', async () => {
      await ApiService.post('/emergency/purge-data', { 
        olderThan: 30 
      });
    });
  };

  const resetDatabase = () => {
    requireConfirmation('RESET ENTIRE DATABASE', async () => {
      const confirmation = prompt('Type "RESET DATABASE" to confirm this action:');
      if (confirmation !== 'RESET DATABASE') {
        throw new Error('Confirmation text did not match');
      }
      await ApiService.post('/emergency/reset-database');
    });
  };

  return (
    <div className="space-y-6">
      {/* Emergency Status */}
      <Card className={emergencyMode ? 'border-cq-alert' : ''}>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-cq-alert" />
              Emergency controls
            </span>
            <div className="flex items-center gap-2">
              {emergencyMode && (
                <Badge variant="destructive" className="animate-pulse">
                  EMERGENCY MODE ACTIVE
                </Badge>
              )}
              {systemLocked && (
                <Badge variant="warning">
                  SYSTEM LOCKED
                </Badge>
              )}
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-cq-alert-wash rounded-cq-md p-4 mb-4">
            <p className="text-sm text-cq-alert">
              <strong>WARNING:</strong> These controls can significantly impact system operations. 
              Use only in emergency situations. All actions are logged and require confirmation.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Button
              variant="destructive"
              className="h-20"
              onClick={emergencyMode ? resumeOperations : stopAllOperations}
              disabled={Object.keys(confirmations).length > 0}
            >
              {emergencyMode ? (
                <>
                  <PlayCircle className="h-6 w-6 mr-2" />
                  Resume All Operations
                </>
              ) : (
                <>
                  <StopCircle className="h-6 w-6 mr-2" />
                  Stop everything
                </>
              )}
            </Button>

            {/* Lock / Unlock — the softer switch. Stop All freezes the
                queue as well; this only closes the door on NEW orders so
                the baristas can work through what they already have. */}
            <Button
              variant="outline"
              className="h-20"
              onClick={systemLocked ? unlockSystem : lockSystem}
              disabled={Object.keys(confirmations).length > 0}
            >
              {systemLocked ? (
                <>
                  <Unlock className="h-6 w-6 mr-2" />
                  Start Taking Orders
                </>
              ) : (
                <>
                  <Lock className="h-6 w-6 mr-2" />
                  Stop taking new orders
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Reset */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <RefreshCw className="h-5 w-5" />
            Reset
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Button
              variant="outline"
              className="w-full justify-start text-cq-alert"
              onClick={clearAllQueues}
              disabled={Object.keys(confirmations).length > 0}
            >
              <Coffee className="h-4 w-4 mr-2" />
              Clear every queue
            </Button>

            {/* Reset all stations / Purge Old Data / RESET ENTIRE
                DATABASE are hidden — their backend endpoints don't
                exist yet (see audit batch F). Leaving them visible
                would silently 404 in an actual emergency, which is
                the worst possible time to discover. */}
          </div>
        </CardContent>
      </Card>

      {/* Backup */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Database className="h-5 w-5" />
            Backup
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-2">
              <Button
                onClick={createBackup}
                disabled={backupStatus === 'creating'}
              >
                <Download className="h-4 w-4 mr-2" />
                {backupStatus === 'creating' ? 'Creating...' : 'Create a backup'}
              </Button>
              {/* Restore from Backup is hidden — /api/emergency/restore
                  doesn't exist on the backend. */}
            </div>
            
            {backupStatus === 'completed' && (
              <p className="text-sm text-cq-ready">Backup created successfully</p>
            )}
            {backupStatus === 'failed' && (
              <p className="text-sm text-cq-alert">Backup failed</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Confirmations */}
      {Object.entries(confirmations).map(([key, confirm]) => (
        <Card key={key} className="border-cq-warn">
          <CardHeader>
            <CardTitle className="text-cq-warn">Are you sure?</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4">
              Are you sure you want to: <strong>{confirm.action}</strong>?
            </p>
            <div className="flex gap-2">
              <Button
                variant="destructive"
                onClick={() => executeAction(key)}
              >
                Yes, Proceed
              </Button>
              <Button
                variant="outline"
                onClick={() => cancelConfirmation(key)}
              >
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* What is NOT here, and where it lives instead.

          The old version of this card listed five "backend pending"
          controls. Three of them were never missing — Restore, Reset
          Database and Purge all have working, safer equivalents in
          Runner > Settings > Event data, which keeps stations,
          inventory and users instead of flattening everything. Listing
          them as pending sent support staff looking for a button that
          did not need to exist. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-cq-ink-3">
            <AlertCircle className="h-5 w-5" />
            Not on this tab
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-cq-ink-2 mb-2">
            These live elsewhere, and the versions there are safer:
          </p>
          <ul className="text-sm text-cq-ink-2 space-y-1 list-disc list-inside">
            <li>
              <strong>Restore from a backup</strong> — Runner &gt; Settings
              &gt; Event data &gt; Import
            </li>
            <li>
              <strong>Reset the event / clear customer data</strong> — Runner
              &gt; Settings &gt; Event data &gt; Wipe. Keeps stations,
              inventory and users; asks you to type WIPE first.
            </li>
          </ul>
          <p className="text-sm text-cq-ink-2 mt-3 mb-1">Still to build:</p>
          <ul className="text-sm text-cq-ink-2 space-y-1 list-disc list-inside">
            <li>
              <strong>Reset all stations</strong> — a bulk version of taking
              stations offline one at a time in Station Settings.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Action Log */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            What has been done
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="max-h-64 overflow-y-auto">
            {actionLog.length === 0 ? (
              <p className="text-sm text-cq-ink-3">Nothing has been done here.</p>
            ) : (
              <div className="space-y-2">
                {actionLog.map((entry, index) => (
                  <div key={index} className="border-b pb-2 last:border-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{entry.action}</span>
                      <Badge variant={entry.status === 'success' ? 'success' : 'destructive'}>
                        {entry.status}
                      </Badge>
                    </div>
                    <div className="text-sm text-cq-ink-2">
                      <p>{new Date(entry.timestamp).toLocaleString()}</p>
                      <p>By: {entry.user}</p>
                      {entry.details && <p>Details: {entry.details}</p>}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default EmergencyTab;
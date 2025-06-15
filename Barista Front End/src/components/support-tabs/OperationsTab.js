import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { 
  Settings, 
  RefreshCw, 
  Power, 
  AlertCircle,
  Coffee,
  Users,
  Clock,
  Send,
  Bell,
  MessageSquare,
  Pause,
  Play,
  RotateCw
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import SettingsService from '../../services/SettingsService';
import StationsService from '../../services/StationsService';
import StationMenuAssignment from '../StationMenuAssignment';
import MenuManagement from '../MenuManagement';

// Create an instance of ApiService
const ApiService = new ApiServiceClass();

const OperationsTab = () => {
  console.log('OperationsTab component loaded');
  const [stations, setStations] = useState([]);
  const [orderQueue, setOrderQueue] = useState([]);
  const [waitTime, setWaitTime] = useState(5);
  const [systemMode, setSystemMode] = useState('live');
  const [eventSettings, setEventSettings] = useState({
    vipEnabled: false,
    groupOrdersEnabled: true,
    walkInEnabled: true,
    maxOrderSize: 5
  });
  const [announcement, setAnnouncement] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadOperationalData();
    const interval = setInterval(loadOperationalData, 30000); // Refresh every 30 seconds
    return () => clearInterval(interval);
  }, []);

  const loadOperationalData = async () => {
    try {
      // Load stations data first (this works)
      const stationsData = await StationsService.getStations();
      setStations(stationsData);
      
      // Try to load orders, but handle failure gracefully
      try {
        const ordersData = await ApiService.get('/api/orders/pending');
        setOrderQueue(ordersData || []);
      } catch (orderError) {
        console.warn('Could not load pending orders:', orderError);
        // Use empty array if orders endpoint fails
        setOrderQueue([]);
      }
      
      // Load settings
      try {
        const settings = await SettingsService.getSettings();
        setWaitTime(settings.estimatedWaitTime || 5);
        setSystemMode(settings.systemMode || 'live');
        setEventSettings({
          vipEnabled: settings.vipEnabled || false,
          groupOrdersEnabled: settings.groupOrdersEnabled || true,
          walkInEnabled: settings.walkInEnabled || true,
          maxOrderSize: settings.maxOrderSize || 5
        });
      } catch (settingsError) {
        console.warn('Could not load settings:', settingsError);
        // Use defaults
      }
    } catch (error) {
      console.error('Error loading operational data:', error);
    }
  };

  const handleStationAction = async (stationId, action) => {
    setLoading(true);
    try {
      switch (action) {
        case 'restart':
          await ApiService.post(`/api/stations/${stationId}/restart`);
          break;
        case 'toggle':
          await ApiService.post(`/api/stations/${stationId}/toggle`);
          break;
        case 'clear':
          await ApiService.post(`/api/stations/${stationId}/clear-queue`);
          break;
        default:
          break;
      }
      await loadOperationalData();
    } catch (error) {
      console.error(`Error performing ${action} on station ${stationId}:`, error);
    } finally {
      setLoading(false);
    }
  };

  const updateWaitTime = async () => {
    try {
      await SettingsService.updateWaitTime(waitTime);
    } catch (error) {
      console.error('Error updating wait time:', error);
    }
  };

  const updateEventSetting = async (setting, value) => {
    try {
      const updatedSettings = { ...eventSettings, [setting]: value };
      setEventSettings(updatedSettings);
      await SettingsService.updateSettings(updatedSettings);
    } catch (error) {
      console.error('Error updating event setting:', error);
    }
  };

  const sendAnnouncement = async () => {
    if (!announcement.trim()) return;
    
    try {
      await ApiService.post('/api/messages/announcement', { 
        message: announcement,
        type: 'system_announcement'
      });
      setAnnouncement('');
    } catch (error) {
      console.error('Error sending announcement:', error);
    }
  };

  const clearAllQueues = async () => {
    if (!window.confirm('Are you sure you want to clear ALL station queues? This cannot be undone.')) {
      return;
    }
    
    try {
      await ApiService.post('/api/stations/clear-all-queues');
      await loadOperationalData();
    } catch (error) {
      console.error('Error clearing all queues:', error);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
        <h2 className="text-xl font-bold text-green-800">⚙️ Operations Tab</h2>
        <p className="text-green-600">Station management and queue control</p>
      </div>
      {/* Station Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Coffee className="h-5 w-5" />
              Station Management
            </span>
            <Button 
              variant="outline" 
              size="sm"
              onClick={clearAllQueues}
              className="text-red-600"
            >
              Clear All Queues
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stations.map(station => (
              <div key={station.id} className="border rounded-lg p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-medium">{station.name}</h3>
                  <Badge variant={station.is_active ? 'success' : 'secondary'}>
                    {station.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </div>
                
                <div className="text-sm text-gray-600 mb-3">
                  <p>Queue: {station.queue_count || 0} orders</p>
                  <p>Current: {station.current_order || 'None'}</p>
                  <p>Barista: {station.barista_name || 'Unassigned'}</p>
                </div>

                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStationAction(station.id, 'toggle')}
                    disabled={loading}
                  >
                    {station.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStationAction(station.id, 'restart')}
                    disabled={loading}
                  >
                    <RotateCw className="h-4 w-4" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => handleStationAction(station.id, 'clear')}
                    disabled={loading}
                    className="text-red-600"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Queue Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Queue Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <h3 className="font-medium mb-2">Current Wait Time</h3>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  value={waitTime}
                  onChange={(e) => setWaitTime(parseInt(e.target.value) || 5)}
                  className="w-20"
                  min="1"
                  max="60"
                />
                <span>minutes</span>
                <Button size="sm" onClick={updateWaitTime}>
                  Update
                </Button>
              </div>
            </div>

            <div>
              <h3 className="font-medium mb-2">Queue Status</h3>
              <div className="space-y-1 text-sm">
                <p>Total Orders: {orderQueue.length}</p>
                <p>VIP Orders: {orderQueue.filter(o => o.is_vip).length}</p>
                <p>Group Orders: {orderQueue.filter(o => o.order_type === 'group').length}</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Event Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Event Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">VIP Orders</label>
              <Switch
                checked={eventSettings.vipEnabled}
                onCheckedChange={(checked) => updateEventSetting('vipEnabled', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Group Orders</label>
              <Switch
                checked={eventSettings.groupOrdersEnabled}
                onCheckedChange={(checked) => updateEventSetting('groupOrdersEnabled', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Walk-in Orders</label>
              <Switch
                checked={eventSettings.walkInEnabled}
                onCheckedChange={(checked) => updateEventSetting('walkInEnabled', checked)}
              />
            </div>
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Max Order Size</label>
              <Input
                type="number"
                value={eventSettings.maxOrderSize}
                onChange={(e) => updateEventSetting('maxOrderSize', parseInt(e.target.value) || 5)}
                className="w-20"
                min="1"
                max="10"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Announcements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            System Announcements
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <Textarea
              placeholder="Type your announcement here..."
              value={announcement}
              onChange={(e) => setAnnouncement(e.target.value)}
              rows={3}
            />
            <div className="flex justify-end gap-2">
              <Button 
                variant="outline"
                onClick={() => setAnnouncement('')}
              >
                Clear
              </Button>
              <Button 
                onClick={sendAnnouncement}
                disabled={!announcement.trim()}
              >
                <Send className="h-4 w-4 mr-2" />
                Send to All Stations
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Menu Management */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coffee className="h-5 w-5" />
            Menu Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <MenuManagement />
        </CardContent>
      </Card>

      {/* Station Menu Assignment */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Settings className="h-5 w-5" />
            Station Menu Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StationMenuAssignment />
        </CardContent>
      </Card>
    </div>
  );
};

export default OperationsTab;
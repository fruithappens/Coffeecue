import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Textarea } from '../ui/textarea';
import { Badge } from '../ui/badge';
import { Switch } from '../ui/switch';
import { 
  Settings, 
  Palette, 
  Type,
  Image,
  Save,
  RotateCcw,
  Download,
  Upload,
  Globe,
  MessageSquare,
  Bell,
  Coffee,
  Smartphone
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import SettingsService from '../../services/SettingsService';

// Create an instance of ApiService
const ApiService = new ApiServiceClass();

const ConfigurationTab = () => {
  const [config, setConfig] = useState({
    // Branding
    eventName: '',
    organizationName: '',
    primaryColor: '#4F46E5',
    secondaryColor: '#10B981',
    logoUrl: '',
    
    // Messages
    welcomeMessage: '',
    orderConfirmationMessage: '',
    orderReadyMessage: '',
    
    // System Settings
    autoLogoutMinutes: 30,
    maxOrdersPerCustomer: 5,
    orderTimeout: 120,
    enableSounds: true,
    enableNotifications: true,
    
    // Menu Configuration
    coffeeTypes: [],
    milkOptions: [],
    defaultCoffeeType: 'latte',
    defaultMilkType: 'full',
    
    // SMS Settings
    twilioPhoneNumber: '',
    smsEnabled: true,
    smsPrefix: 'Coffee Cue:',
    maxSmsLength: 160
  });
  
  const [unsavedChanges, setUnsavedChanges] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadConfiguration();
  }, []);

  const loadConfiguration = async () => {
    try {
      const settings = await SettingsService.getSettings();
      setConfig({
        ...config,
        ...settings
      });
    } catch (error) {
      console.error('Error loading configuration:', error);
    }
  };

  const handleConfigChange = (section, field, value) => {
    setConfig(prev => ({
      ...prev,
      [field]: value
    }));
    setUnsavedChanges(true);
  };

  const handleArrayChange = (field, index, value) => {
    const updated = [...config[field]];
    updated[index] = value;
    setConfig(prev => ({
      ...prev,
      [field]: updated
    }));
    setUnsavedChanges(true);
  };

  const addArrayItem = (field, defaultValue = '') => {
    setConfig(prev => ({
      ...prev,
      [field]: [...prev[field], defaultValue]
    }));
    setUnsavedChanges(true);
  };

  const removeArrayItem = (field, index) => {
    setConfig(prev => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== index)
    }));
    setUnsavedChanges(true);
  };

  const saveConfiguration = async () => {
    setLoading(true);
    try {
      await SettingsService.updateSettings(config);
      setUnsavedChanges(false);
      alert('Configuration saved successfully!');
    } catch (error) {
      console.error('Error saving configuration:', error);
      alert('Failed to save configuration');
    } finally {
      setLoading(false);
    }
  };

  const resetConfiguration = () => {
    if (!window.confirm('Are you sure you want to reset to default configuration?')) {
      return;
    }
    loadConfiguration();
    setUnsavedChanges(false);
  };

  const exportConfiguration = () => {
    const blob = new Blob([JSON.stringify(config, null, 2)], { 
      type: 'application/json' 
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `coffeecue_config_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
  };

  const importConfiguration = (event) => {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const imported = JSON.parse(e.target.result);
        setConfig(prev => ({
          ...prev,
          ...imported
        }));
        setUnsavedChanges(true);
      } catch (error) {
        alert('Invalid configuration file');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-6">
      {/* Configuration Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              System Configuration
            </span>
            <div className="flex items-center gap-2">
              {unsavedChanges && (
                <Badge variant="warning">Unsaved Changes</Badge>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={exportConfiguration}
              >
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".json"
                  onChange={importConfiguration}
                  className="hidden"
                />
                <Button variant="outline" size="sm" as="span">
                  <Upload className="h-4 w-4 mr-2" />
                  Import
                </Button>
              </label>
              <Button
                variant="outline"
                size="sm"
                onClick={resetConfiguration}
              >
                <RotateCcw className="h-4 w-4 mr-2" />
                Reset
              </Button>
              <Button
                size="sm"
                onClick={saveConfiguration}
                disabled={loading || !unsavedChanges}
              >
                <Save className="h-4 w-4 mr-2" />
                Save
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
      </Card>

      {/* Branding Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5" />
            Branding & Appearance
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Event Name</label>
              <Input
                value={config.eventName}
                onChange={(e) => handleConfigChange('branding', 'eventName', e.target.value)}
                placeholder="TechConf 2024"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Organization</label>
              <Input
                value={config.organizationName}
                onChange={(e) => handleConfigChange('branding', 'organizationName', e.target.value)}
                placeholder="Coffee Cue Inc."
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Primary Color</label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={config.primaryColor}
                  onChange={(e) => handleConfigChange('branding', 'primaryColor', e.target.value)}
                  className="w-20"
                />
                <Input
                  value={config.primaryColor}
                  onChange={(e) => handleConfigChange('branding', 'primaryColor', e.target.value)}
                  placeholder="#4F46E5"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Secondary Color</label>
              <div className="flex gap-2">
                <Input
                  type="color"
                  value={config.secondaryColor}
                  onChange={(e) => handleConfigChange('branding', 'secondaryColor', e.target.value)}
                  className="w-20"
                />
                <Input
                  value={config.secondaryColor}
                  onChange={(e) => handleConfigChange('branding', 'secondaryColor', e.target.value)}
                  placeholder="#10B981"
                />
              </div>
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1">Logo URL</label>
              <Input
                value={config.logoUrl}
                onChange={(e) => handleConfigChange('branding', 'logoUrl', e.target.value)}
                placeholder="https://example.com/logo.png"
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message Templates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Message Templates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Welcome Message</label>
              <Textarea
                value={config.welcomeMessage}
                onChange={(e) => handleConfigChange('messages', 'welcomeMessage', e.target.value)}
                placeholder="Welcome to Coffee Cue! Text your coffee order to get started."
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Order Confirmation</label>
              <Textarea
                value={config.orderConfirmationMessage}
                onChange={(e) => handleConfigChange('messages', 'orderConfirmationMessage', e.target.value)}
                placeholder="Thanks! Your order #{orderNumber} has been received. Estimated wait: {waitTime} minutes."
                rows={2}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Order Ready</label>
              <Textarea
                value={config.orderReadyMessage}
                onChange={(e) => handleConfigChange('messages', 'orderReadyMessage', e.target.value)}
                placeholder="Your coffee is ready! Please collect order #{orderNumber} from {stationName}."
                rows={2}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Menu Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Coffee className="h-5 w-5" />
            Menu Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Coffee Types</label>
              <div className="space-y-2">
                {(config.coffeeTypes || []).map((type, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={type}
                      onChange={(e) => handleArrayChange('coffeeTypes', index, e.target.value)}
                      placeholder="e.g., Latte"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeArrayItem('coffeeTypes', index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addArrayItem('coffeeTypes')}
                >
                  Add Coffee Type
                </Button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium mb-1">Milk Options</label>
              <div className="space-y-2">
                {(config.milkOptions || []).map((option, index) => (
                  <div key={index} className="flex gap-2">
                    <Input
                      value={option}
                      onChange={(e) => handleArrayChange('milkOptions', index, e.target.value)}
                      placeholder="e.g., Oat"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => removeArrayItem('milkOptions', index)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => addArrayItem('milkOptions')}
                >
                  Add Milk Option
                </Button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Default Coffee</label>
                <select
                  value={config.defaultCoffeeType}
                  onChange={(e) => handleConfigChange('menu', 'defaultCoffeeType', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  {(config.coffeeTypes || []).map(type => (
                    <option key={type} value={type.toLowerCase()}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Default Milk</label>
                <select
                  value={config.defaultMilkType}
                  onChange={(e) => handleConfigChange('menu', 'defaultMilkType', e.target.value)}
                  className="w-full px-3 py-2 border rounded-md"
                >
                  {(config.milkOptions || []).map(option => (
                    <option key={option} value={option.toLowerCase()}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            System Settings
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Auto Logout (minutes)</label>
                <Input
                  type="number"
                  value={config.autoLogoutMinutes}
                  onChange={(e) => handleConfigChange('system', 'autoLogoutMinutes', parseInt(e.target.value) || 30)}
                  min="5"
                  max="120"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max Orders per Customer</label>
                <Input
                  type="number"
                  value={config.maxOrdersPerCustomer}
                  onChange={(e) => handleConfigChange('system', 'maxOrdersPerCustomer', parseInt(e.target.value) || 5)}
                  min="1"
                  max="20"
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Order Timeout (seconds)</label>
                <Input
                  type="number"
                  value={config.orderTimeout}
                  onChange={(e) => handleConfigChange('system', 'orderTimeout', parseInt(e.target.value) || 120)}
                  min="30"
                  max="600"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Enable Sound Effects</label>
                <Switch
                  checked={config.enableSounds}
                  onCheckedChange={(checked) => handleConfigChange('system', 'enableSounds', checked)}
                />
              </div>
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Enable Notifications</label>
                <Switch
                  checked={config.enableNotifications}
                  onCheckedChange={(checked) => handleConfigChange('system', 'enableNotifications', checked)}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* SMS Configuration */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5" />
            SMS Configuration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between mb-4">
              <label className="text-sm font-medium">SMS Enabled</label>
              <Switch
                checked={config.smsEnabled}
                onCheckedChange={(checked) => handleConfigChange('sms', 'smsEnabled', checked)}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">Twilio Phone Number</label>
                <Input
                  value={config.twilioPhoneNumber}
                  onChange={(e) => handleConfigChange('sms', 'twilioPhoneNumber', e.target.value)}
                  placeholder="+1234567890"
                  disabled={!config.smsEnabled}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">SMS Prefix</label>
                <Input
                  value={config.smsPrefix}
                  onChange={(e) => handleConfigChange('sms', 'smsPrefix', e.target.value)}
                  placeholder="Coffee Cue:"
                  disabled={!config.smsEnabled}
                />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Max SMS Length</label>
                <Input
                  type="number"
                  value={config.maxSmsLength}
                  onChange={(e) => handleConfigChange('sms', 'maxSmsLength', parseInt(e.target.value) || 160)}
                  min="50"
                  max="320"
                  disabled={!config.smsEnabled}
                />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConfigurationTab;
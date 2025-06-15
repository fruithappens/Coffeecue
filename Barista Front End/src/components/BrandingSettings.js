import React, { useState, useEffect } from 'react';
import { 
  Palette, Globe, Type, Coffee, Save, Eye, 
  AlertCircle, Check, Upload, Download, RotateCcw
} from 'lucide-react';
import SettingsService from '../services/SettingsService';
import brandingConfig, { updateBranding, resetBranding } from '../config/brandingConfig';

/**
 * Branding Settings Component
 * Allows customization of app branding, colors, and multi-language support
 */
const BrandingSettings = () => {
  const [settings, setSettings] = useState({
    // Brand Identity
    systemName: brandingConfig.systemName || 'Coffee Cue',
    companyName: brandingConfig.companyName || 'Coffee Cue',
    shortName: brandingConfig.shortName || 'Coffee Cue',
    landingTitle: brandingConfig.landingTitle || 'Coffee Cue Ordering System',
    landingSubtitle: brandingConfig.landingSubtitle || 'Select your role to continue',
    adminPanelTitle: brandingConfig.adminPanelTitle || 'Coffee Cue Admin',
    baristaPanelTitle: brandingConfig.baristaPanelTitle || 'Coffee Cue Barista',
    tagline: brandingConfig.tagline || 'Skip the Queue, Get Your Cue',
    footerText: brandingConfig.footerText || '© 2025 Expresso Coffee System | ANZCA ASM 2025 Cairns',
    customBranding: true,
    clientName: '',
    clientLogo: brandingConfig.logo || '',
    
    // Color Theme
    primaryColor: brandingConfig.primaryColor || '#D97706',
    secondaryColor: brandingConfig.primaryColorHover || '#B45309',
    textColor: brandingConfig.accentColor || '#92400E',
    backgroundColor: '#f9fafb',
    
    // Language Settings
    defaultLanguage: 'en',
    availableLanguages: ['en'],
    translations: {
      en: {
        welcomeMessage: "Welcome to {systemName}! I'll take your coffee order. What's your first name?",
        orderConfirmation: "Thanks {name}! Your {coffee} order has been received.",
        readyNotification: "Hi {name}, your {coffee} is ready for pickup!",
        stationChat: "Message from {station}",
        // Add more translatable strings
      },
      es: {
        welcomeMessage: "¡Bienvenido a {systemName}! Tomaré tu pedido de café. ¿Cuál es tu nombre?",
        orderConfirmation: "¡Gracias {name}! Tu pedido de {coffee} ha sido recibido.",
        readyNotification: "Hola {name}, tu {coffee} está listo para recoger!",
        stationChat: "Mensaje de {station}",
      },
      zh: {
        welcomeMessage: "欢迎来到{systemName}！我来为您点咖啡。请问您的名字是？",
        orderConfirmation: "谢谢{name}！您的{coffee}订单已收到。",
        readyNotification: "您好{name}，您的{coffee}已经准备好了！",
        stationChat: "来自{station}的消息",
      }
    }
  });
  
  const [previewMode, setPreviewMode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Preset color themes
  const colorThemes = {
    coffeeCue: {
      name: 'Coffee Cue Default',
      primaryColor: '#D97706',
      secondaryColor: '#B45309',
      textColor: '#92400E',
      backgroundColor: '#f9fafb'
    },
    corporate: {
      name: 'Corporate Blue',
      primaryColor: '#1e3a8a',
      secondaryColor: '#64748b',
      textColor: '#0f172a',
      backgroundColor: '#f8fafc'
    },
    warm: {
      name: 'Warm Coffee',
      primaryColor: '#92400e',
      secondaryColor: '#ea580c',
      textColor: '#451a03',
      backgroundColor: '#fef3c7'
    },
    modern: {
      name: 'Modern Dark',
      primaryColor: '#4f46e5',
      secondaryColor: '#ec4899',
      textColor: '#1e293b',
      backgroundColor: '#f1f5f9'
    }
  };
  
  // Load settings on mount
  useEffect(() => {
    loadSettings();
  }, []);
  
  const loadSettings = async () => {
    try {
      const brandingSettings = await SettingsService.getBrandingSettings();
      if (brandingSettings) {
        setSettings(prevSettings => ({
          ...prevSettings,
          ...brandingSettings
        }));
      }
    } catch (err) {
      console.error('Error loading branding settings:', err);
      setError('Failed to load branding settings');
    }
  };
  
  const handleSave = async () => {
    setSaving(true);
    setError('');
    setSuccess('');
    
    try {
      // Update centralized branding config
      updateBranding({
        companyName: settings.companyName,
        systemName: settings.systemName,
        shortName: settings.shortName,
        tagline: settings.tagline,
        landingTitle: settings.landingTitle,
        landingSubtitle: settings.landingSubtitle,
        adminPanelTitle: settings.adminPanelTitle,
        baristaPanelTitle: settings.baristaPanelTitle,
        footerText: settings.footerText,
        primaryColor: settings.primaryColor,
        primaryColorHover: settings.secondaryColor,
        accentColor: settings.textColor,
        logo: settings.clientLogo,
        customCSS: settings.customCSS || ''
      });
      
      // Also save to backend if available
      try {
        await SettingsService.updateBrandingSettings(settings);
      } catch (err) {
        console.log('Backend save failed, but local branding updated');
      }
      
      setSuccess('Branding settings saved successfully! Page will reload...');
      
      // Apply theme colors to document
      if (settings.customBranding) {
        document.documentElement.style.setProperty('--primary-color', settings.primaryColor);
        document.documentElement.style.setProperty('--secondary-color', settings.secondaryColor);
        document.documentElement.style.setProperty('--text-color', settings.textColor);
        document.documentElement.style.setProperty('--bg-color', settings.backgroundColor);
      }
    } catch (err) {
      console.error('Error saving branding settings:', err);
      setError('Failed to save branding settings');
    } finally {
      setSaving(false);
    }
  };
  
  const applyTheme = (theme) => {
    setSettings(prev => ({
      ...prev,
      ...theme,
      customBranding: true
    }));
  };
  
  const addLanguage = (langCode) => {
    if (!settings.availableLanguages.includes(langCode)) {
      setSettings(prev => ({
        ...prev,
        availableLanguages: [...prev.availableLanguages, langCode],
        translations: {
          ...prev.translations,
          [langCode]: prev.translations[langCode] || {}
        }
      }));
    }
  };
  
  const updateTranslation = (lang, key, value) => {
    setSettings(prev => ({
      ...prev,
      translations: {
        ...prev.translations,
        [lang]: {
          ...prev.translations[lang],
          [key]: value
        }
      }
    }));
  };
  
  const exportSettings = () => {
    const dataStr = JSON.stringify(settings, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `branding-settings-${new Date().toISOString().split('T')[0]}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };
  
  const importSettings = (event) => {
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const imported = JSON.parse(e.target.result);
          setSettings(imported);
          setSuccess('Settings imported successfully!');
        } catch (err) {
          setError('Invalid settings file');
        }
      };
      reader.readAsText(file);
    }
  };
  
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-2xl font-bold mb-4 flex items-center">
          <Palette className="mr-2" />
          Branding & Customization
        </h2>
        
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center text-red-700">
            <AlertCircle className="mr-2" size={20} />
            {error}
          </div>
        )}
        
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg flex items-center text-green-700">
            <Check className="mr-2" size={20} />
            {success}
          </div>
        )}
        
        {/* Custom Branding Toggle */}
        <div className="mb-6">
          <label className="flex items-center space-x-3">
            <input
              type="checkbox"
              checked={settings.customBranding}
              onChange={(e) => setSettings({...settings, customBranding: e.target.checked})}
              className="w-5 h-5 text-blue-600 rounded focus:ring-blue-500"
            />
            <span className="text-lg font-medium">Enable Custom Branding</span>
          </label>
          <p className="text-sm text-gray-600 mt-1 ml-8">
            Override default CoffeeCue branding with custom client branding
          </p>
        </div>
        
        {settings.customBranding && (
          <div className="space-y-4 ml-8">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Client Name
              </label>
              <input
                type="text"
                value={settings.clientName}
                onChange={(e) => setSettings({...settings, clientName: e.target.value})}
                placeholder="Sydney Convention Centre"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                System Name
              </label>
              <input
                type="text"
                value={settings.systemName}
                onChange={(e) => setSettings({...settings, systemName: e.target.value})}
                placeholder="Coffee Cue"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Company Name
              </label>
              <input
                type="text"
                value={settings.companyName}
                onChange={(e) => setSettings({...settings, companyName: e.target.value})}
                placeholder="Coffee Cue"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Short Name (for compact views)
                </label>
                <input
                  type="text"
                  value={settings.shortName}
                  onChange={(e) => setSettings({...settings, shortName: e.target.value})}
                  placeholder="Coffee Cue"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tagline
                </label>
                <input
                  type="text"
                  value={settings.tagline}
                  onChange={(e) => setSettings({...settings, tagline: e.target.value})}
                  placeholder="Skip the Queue, Get Your Cue"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Landing Page Title
                </label>
                <input
                  type="text"
                  value={settings.landingTitle}
                  onChange={(e) => setSettings({...settings, landingTitle: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Landing Page Subtitle
                </label>
                <input
                  type="text"
                  value={settings.landingSubtitle}
                  onChange={(e) => setSettings({...settings, landingSubtitle: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Admin Panel Title
                </label>
                <input
                  type="text"
                  value={settings.adminPanelTitle}
                  onChange={(e) => setSettings({...settings, adminPanelTitle: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Barista Panel Title
                </label>
                <input
                  type="text"
                  value={settings.baristaPanelTitle}
                  onChange={(e) => setSettings({...settings, baristaPanelTitle: e.target.value})}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Footer Text
              </label>
              <input
                type="text"
                value={settings.footerText}
                onChange={(e) => setSettings({...settings, footerText: e.target.value})}
                placeholder="© 2025 Expresso Coffee System | ANZCA ASM 2025 Cairns"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">
                This text appears at the bottom of the main page
              </p>
            </div>
          </div>
        )}
      </div>
      
      {/* Color Theme */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Palette className="mr-2" size={20} />
          Color Theme
        </h3>
        
        {/* Preset Themes */}
        <div className="mb-6">
          <p className="text-sm text-gray-600 mb-3">Quick Themes:</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Object.entries(colorThemes).map(([key, theme]) => (
              <button
                key={key}
                onClick={() => applyTheme(theme)}
                className="p-3 border rounded-lg hover:border-blue-500 transition-colors"
                style={{
                  borderColor: theme.primaryColor,
                  backgroundColor: theme.backgroundColor
                }}
              >
                <div className="flex items-center justify-center mb-2">
                  <div 
                    className="w-6 h-6 rounded-full mr-2"
                    style={{backgroundColor: theme.primaryColor}}
                  />
                  <div 
                    className="w-6 h-6 rounded-full"
                    style={{backgroundColor: theme.secondaryColor}}
                  />
                </div>
                <p className="text-xs font-medium" style={{color: theme.textColor}}>
                  {theme.name}
                </p>
              </button>
            ))}
          </div>
        </div>
        
        {/* Custom Colors */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Primary Color
            </label>
            <div className="flex space-x-2">
              <input
                type="color"
                value={settings.primaryColor}
                onChange={(e) => setSettings({...settings, primaryColor: e.target.value})}
                className="h-10 w-20"
              />
              <input
                type="text"
                value={settings.primaryColor}
                onChange={(e) => setSettings({...settings, primaryColor: e.target.value})}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Secondary Color
            </label>
            <div className="flex space-x-2">
              <input
                type="color"
                value={settings.secondaryColor}
                onChange={(e) => setSettings({...settings, secondaryColor: e.target.value})}
                className="h-10 w-20"
              />
              <input
                type="text"
                value={settings.secondaryColor}
                onChange={(e) => setSettings({...settings, secondaryColor: e.target.value})}
                className="flex-1 px-3 py-2 border border-gray-300 rounded-lg"
              />
            </div>
          </div>
        </div>
        
        {/* Preview Button */}
        <button
          onClick={() => setPreviewMode(!previewMode)}
          className="mt-4 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center"
        >
          <Eye className="mr-2" size={16} />
          {previewMode ? 'Hide' : 'Show'} Preview
        </button>
      </div>
      
      {/* Language Settings */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Globe className="mr-2" size={20} />
          Multi-Language Support
        </h3>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Default Language
          </label>
          <select
            value={settings.defaultLanguage}
            onChange={(e) => setSettings({...settings, defaultLanguage: e.target.value})}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="en">English</option>
            <option value="es">Español</option>
            <option value="zh">中文</option>
            <option value="fr">Français</option>
            <option value="de">Deutsch</option>
            <option value="ja">日本語</option>
          </select>
        </div>
        
        <div className="mb-4">
          <p className="text-sm font-medium text-gray-700 mb-2">Available Languages:</p>
          <div className="flex flex-wrap gap-2">
            {settings.availableLanguages.map(lang => (
              <span key={lang} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm">
                {lang}
              </span>
            ))}
            <button
              onClick={() => addLanguage('es')}
              className="px-3 py-1 bg-gray-100 text-gray-700 rounded-full text-sm hover:bg-gray-200"
            >
              + Add Language
            </button>
          </div>
        </div>
        
        {/* Translation Editor */}
        <div className="border-t pt-4">
          <h4 className="text-sm font-medium text-gray-700 mb-3">Message Translations</h4>
          <div className="space-y-3">
            {Object.keys(settings.translations[settings.defaultLanguage] || {}).map(key => (
              <div key={key} className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500">{key} (English)</label>
                  <input
                    type="text"
                    value={settings.translations.en[key]}
                    onChange={(e) => updateTranslation('en', key, e.target.value)}
                    className="w-full px-3 py-1 border border-gray-300 rounded text-sm"
                  />
                </div>
                {settings.availableLanguages.filter(l => l !== 'en').map(lang => (
                  <div key={lang}>
                    <label className="text-xs text-gray-500">{key} ({lang})</label>
                    <input
                      type="text"
                      value={settings.translations[lang]?.[key] || ''}
                      onChange={(e) => updateTranslation(lang, key, e.target.value)}
                      className="w-full px-3 py-1 border border-gray-300 rounded text-sm"
                    />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
      
      {/* Import/Export */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h3 className="text-lg font-semibold mb-4">Import/Export Settings</h3>
        <div className="flex space-x-4">
          <button
            onClick={exportSettings}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center"
          >
            <Download className="mr-2" size={16} />
            Export Settings
          </button>
          <label className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center cursor-pointer">
            <Upload className="mr-2" size={16} />
            Import Settings
            <input
              type="file"
              accept=".json"
              onChange={importSettings}
              className="hidden"
            />
          </label>
        </div>
      </div>
      
      {/* Save Button */}
      <div className="flex justify-between">
        <button
          onClick={() => {
            if (window.confirm('Are you sure you want to reset to default Coffee Cue branding? This will reload the page.')) {
              resetBranding();
            }
          }}
          className="px-6 py-3 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center"
        >
          <RotateCcw className="mr-2" size={20} />
          Reset to Default
        </button>
        
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent mr-2"></div>
              Saving...
            </>
          ) : (
            <>
              <Save className="mr-2" size={20} />
              Save Branding Settings
            </>
          )}
        </button>
      </div>
      
      {/* Preview */}
      {previewMode && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg max-w-md w-full p-6">
            <div 
              className="p-4 rounded-lg mb-4"
              style={{
                backgroundColor: settings.primaryColor,
                color: 'white'
              }}
            >
              <h2 className="text-2xl font-bold flex items-center">
                <Coffee className="mr-2" />
                {settings.customBranding && settings.clientName ? settings.clientName : settings.systemName}
              </h2>
            </div>
            
            <div className="space-y-3">
              <div 
                className="p-3 rounded"
                style={{
                  backgroundColor: settings.backgroundColor,
                  color: settings.textColor
                }}
              >
                <p className="text-sm">Welcome message preview:</p>
                <p className="font-medium">
                  {settings.translations[settings.defaultLanguage].welcomeMessage.replace('{systemName}', settings.systemName)}
                </p>
              </div>
              
              <button
                style={{
                  backgroundColor: settings.secondaryColor,
                  color: 'white'
                }}
                className="w-full py-2 rounded-lg font-medium"
              >
                Sample Button
              </button>
            </div>
            
            <button
              onClick={() => setPreviewMode(false)}
              className="mt-4 w-full py-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default BrandingSettings;
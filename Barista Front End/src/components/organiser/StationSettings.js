import React, { useState, useEffect } from 'react';
import { 
  Settings, Coffee, MapPin, Users, Save, Plus, Trash2, 
  Edit3, X, AlertCircle, CheckCircle
} from 'lucide-react';
import StationDefaults from './StationDefaults';

/**
 * Simplified Station Settings Component
 * Manages basic station configuration without confusing session controls
 */
const StationSettings = ({ stations, onStationUpdate, onAddStation, onDeleteStation }) => {
  const [selectedStation, setSelectedStation] = useState(null);
  const [stationData, setStationData] = useState({
    name: '',
    location: '',
    status: 'active',
    description: '',
    maxConcurrentOrders: 3
  });
  const [isEditing, setIsEditing] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newStation, setNewStation] = useState({
    name: '',
    location: '',
    description: '',
    status: 'active',
    maxConcurrentOrders: 3
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  // Update station data when selection changes
  useEffect(() => {
    if (selectedStation) {
      setStationData({
        name: selectedStation.name || '',
        location: selectedStation.location || '',
        status: selectedStation.status || 'active',
        description: selectedStation.description || '',
        maxConcurrentOrders: selectedStation.maxConcurrentOrders || 3
      });
      setIsEditing(false);
    }
  }, [selectedStation]);

  // Handle station save
  const handleSave = async () => {
    if (!selectedStation || !stationData.name.trim()) return;

    setIsSaving(true);
    setSaveStatus(null);

    try {
      const success = await onStationUpdate(selectedStation.id, stationData);
      if (success) {
        setSaveStatus('success');
        setIsEditing(false);
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (error) {
      console.error('Error saving station:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle adding new station
  const handleAddStation = async () => {
    if (!newStation.name.trim()) return;

    setIsSaving(true);
    try {
      const success = await onAddStation(newStation);
      if (success) {
        setShowAddForm(false);
        setNewStation({
          name: '',
          location: '',
          description: '',
          status: 'active',
          maxConcurrentOrders: 3
        });
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (error) {
      console.error('Error adding station:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  // Handle station deletion
  const handleDeleteStation = async (stationId) => {
    if (!window.confirm('Are you sure you want to delete this station? This action cannot be undone.')) {
      return;
    }

    setIsSaving(true);
    try {
      const success = await onDeleteStation(stationId);
      if (success) {
        if (selectedStation?.id === stationId) {
          setSelectedStation(null);
        }
        setSaveStatus('success');
        setTimeout(() => setSaveStatus(null), 3000);
      } else {
        setSaveStatus('error');
        setTimeout(() => setSaveStatus(null), 3000);
      }
    } catch (error) {
      console.error('Error deleting station:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus(null), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <h2 className="text-xl sm:text-2xl font-bold text-gray-800 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Settings className="shrink-0" />
          Station Settings
          <span className="px-2 py-1 bg-green-100 text-green-800 text-sm rounded-md whitespace-nowrap">
            ✨ New Interface
          </span>
        </h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center justify-center w-full sm:w-auto shrink-0 px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
        >
          <Plus size={16} className="mr-2" />
          Add Station
        </button>
      </div>

      {/* Status Messages */}
      {saveStatus && (
        <div className={`mb-4 p-3 rounded-md flex items-center ${
          saveStatus === 'success' 
            ? 'bg-green-100 text-green-800 border border-green-200' 
            : 'bg-red-100 text-red-800 border border-red-200'
        }`}>
          {saveStatus === 'success' ? (
            <CheckCircle size={16} className="mr-2" />
          ) : (
            <AlertCircle size={16} className="mr-2" />
          )}
          {saveStatus === 'success' ? 'Changes saved successfully!' : 'Error saving changes. Please try again.'}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6">
        {/* Station List */}
        <div className="lg:col-span-4">
          <h3 className="text-lg font-semibold mb-4 text-gray-700">Stations</h3>
          <div className="space-y-2">
            {stations.map(station => (
              <div
                key={station.id}
                className={`p-3 rounded-md border cursor-pointer transition-colors ${
                  selectedStation?.id === station.id
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-gray-200 hover:bg-gray-50'
                }`}
                onClick={() => setSelectedStation(station)}
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h4 className="font-medium text-gray-900">{station.name}</h4>
                    {station.location && (
                      <p className="text-sm text-gray-600 flex items-center mt-1">
                        <MapPin size={12} className="mr-1" />
                        {station.location}
                      </p>
                    )}
                    <div className="flex items-center mt-1">
                      <div className={`w-2 h-2 rounded-full mr-2 ${
                        station.status === 'active' ? 'bg-green-500' :
                        station.status === 'maintenance' ? 'bg-amber-500' : 'bg-red-500'
                      }`} />
                      <span className="text-xs text-gray-500 capitalize">
                        {station.status || 'unknown'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {/* Quick one-tap toggle. Steve hit the previous
                        version: 'Activate' button on an inactive
                        station was GREEN — read as 'this is active'
                        because the green next to the red Inactive dot
                        was confusing. Now:
                          - Active station   → RED 'Take offline' (warns
                            you're about to remove it from the rota)
                          - Inactive station → BLUE 'Bring online'
                            (clearly an action, not a status)
                        The verbs are unambiguous and the colours
                        match the action's tone, not the future state. */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        const newStatus = station.status === 'active' ? 'inactive' : 'active';
                        if (onStationUpdate) {
                          onStationUpdate(station.id, { ...station, status: newStatus });
                        }
                      }}
                      className={`px-2 py-1 text-xs rounded font-medium ${
                        station.status === 'active'
                          ? 'bg-red-100 text-red-800 hover:bg-red-200 border border-red-300'
                          : 'bg-blue-100 text-blue-800 hover:bg-blue-200 border border-blue-300'
                      }`}
                      title={station.status === 'active'
                        ? 'Take this station offline (no new orders will be routed here)'
                        : 'Bring this station back online'}
                    >
                      {station.status === 'active' ? 'Take offline' : 'Bring online'}
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteStation(station.id);
                      }}
                      className="text-red-600 hover:bg-red-100 p-1 rounded"
                      title="Delete station (permanent)"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {stations.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              <Coffee size={48} className="mx-auto mb-4 text-gray-400" />
              <p>No stations configured</p>
              <p className="text-sm">Add your first station to get started</p>
            </div>
          )}
        </div>

        {/* Station Details */}
        <div className="lg:col-span-8">
          {selectedStation ? (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Configure Station</h3>
                <div className="flex space-x-2">
                  {/* Always-editable form. Save button enables only
                      when there are unsaved changes (compare current
                      stationData against the loaded selectedStation).
                      Removed the Edit → Save → View dance — settings
                      panels should just be directly editable. */}
                  {(() => {
                    const dirty = !!selectedStation && (
                      stationData.name !== (selectedStation.name || '') ||
                      stationData.location !== (selectedStation.location || '') ||
                      stationData.status !== (selectedStation.status || 'active') ||
                      stationData.description !== (selectedStation.description || '') ||
                      Number(stationData.maxConcurrentOrders || 0) !== Number(selectedStation.maxConcurrentOrders || 3)
                    );
                    return (
                      <>
                        {dirty && (
                          <button
                            onClick={() => {
                              setStationData({
                                name: selectedStation.name || '',
                                location: selectedStation.location || '',
                                status: selectedStation.status || 'active',
                                description: selectedStation.description || '',
                                maxConcurrentOrders: selectedStation.maxConcurrentOrders || 3
                              });
                            }}
                            className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 flex items-center"
                          >
                            <X size={16} className="mr-2" />
                            Discard
                          </button>
                        )}
                        <button
                          onClick={handleSave}
                          disabled={isSaving || !dirty}
                          className={`px-4 py-2 rounded-md flex items-center ${
                            !dirty
                              ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                              : 'bg-amber-600 text-white hover:bg-amber-700'
                          } disabled:opacity-50`}
                          title={!dirty ? 'No changes to save' : 'Save the changes you made'}
                        >
                          <Save size={16} className="mr-2" />
                          {isSaving ? 'Saving...' : (dirty ? 'Save Changes' : 'Saved')}
                        </button>
                      </>
                    );
                  })()}
                </div>
              </div>

              <div className="space-y-6">
                {/* Basic Information */}
                <div className="bg-gray-50 rounded-md p-4">
                  <h4 className="text-lg font-medium mb-4">Basic Information</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Station Name
                      </label>
                      <input
                        type="text"
                        value={stationData.name}
                        onChange={(e) => setStationData({ ...stationData, name: e.target.value })}
                        
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500 disabled:bg-gray-100"
                        placeholder="Enter station name..."
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Location
                      </label>
                      <input
                        type="text"
                        value={stationData.location}
                        onChange={(e) => setStationData({ ...stationData, location: e.target.value })}
                        
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500 disabled:bg-gray-100"
                        placeholder="Enter location..."
                      />
                    </div>
                  </div>

                  <div className="mt-4">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <textarea
                      value={stationData.description}
                      onChange={(e) => setStationData({ ...stationData, description: e.target.value })}
                      
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500 disabled:bg-gray-100"
                      placeholder="Optional description..."
                    />
                  </div>
                </div>

                {/* Operational Settings */}
                <div className="bg-gray-50 rounded-md p-4">
                  <h4 className="text-lg font-medium mb-4">Operational Settings</h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Status
                      </label>
                      <select
                        value={stationData.status}
                        onChange={(e) => setStationData({ ...stationData, status: e.target.value })}
                        
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500 disabled:bg-gray-100"
                      >
                        <option value="active">Active</option>
                        <option value="inactive">Inactive</option>
                        <option value="maintenance">Maintenance</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Max Concurrent Orders
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="10"
                        value={stationData.maxConcurrentOrders}
                        onChange={(e) => setStationData({ ...stationData, maxConcurrentOrders: parseInt(e.target.value) || 1 })}
                        
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Walk-in defaults for THIS station.
                  Used to be its own tab with its own station picker, which
                  meant choosing a station twice to configure one station. */}
              <div className="mt-8 pt-6 border-t border-gray-200">
                <StationDefaults stationId={selectedStation.id} />
              </div>
            </div>
          ) : (
            <div className="text-center py-12 text-gray-500">
              <Settings size={48} className="mx-auto mb-4 text-gray-400" />
              <p>Select a station to configure its settings</p>
            </div>
          )}
        </div>
      </div>

      {/* Add Station Form */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-xl font-semibold mb-4">Add New Station</h3>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Station Name *
                </label>
                <input
                  type="text"
                  value={newStation.name}
                  onChange={(e) => setNewStation({ ...newStation, name: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500"
                  placeholder="Enter station name..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={newStation.location}
                  onChange={(e) => setNewStation({ ...newStation, location: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500"
                  placeholder="Enter location..."
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Description
                </label>
                <textarea
                  value={newStation.description}
                  onChange={(e) => setNewStation({ ...newStation, description: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500"
                  placeholder="Optional description..."
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Status
                  </label>
                  <select
                    value={newStation.status}
                    onChange={(e) => setNewStation({ ...newStation, status: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Max Orders
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    value={newStation.maxConcurrentOrders}
                    onChange={(e) => setNewStation({ ...newStation, maxConcurrentOrders: parseInt(e.target.value) || 1 })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-amber-500 focus:border-blue-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end space-x-2 mt-6">
              <button
                onClick={() => {
                  setShowAddForm(false);
                  setNewStation({
                    name: '',
                    location: '',
                    description: '',
                    status: 'active',
                    maxConcurrentOrders: 3
                  });
                }}
                className="px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400"
              >
                Cancel
              </button>
              <button
                onClick={handleAddStation}
                disabled={!newStation.name.trim() || isSaving}
                className="px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600 disabled:opacity-50"
              >
                {isSaving ? 'Adding...' : 'Add Station'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StationSettings;
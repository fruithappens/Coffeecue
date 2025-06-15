import React, { useState, useEffect } from 'react';
import { 
  Settings, Coffee, MapPin, Users, Save, Plus, Trash2, 
  Edit3, X, AlertCircle, CheckCircle
} from 'lucide-react';

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
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center">
          <Settings className="mr-2" />
          Station Settings
          <span className="ml-3 px-2 py-1 bg-green-100 text-green-800 text-sm rounded-md">
            ✨ New Interface
          </span>
        </h2>
        <button
          onClick={() => setShowAddForm(true)}
          className="flex items-center px-4 py-2 bg-green-500 text-white rounded-md hover:bg-green-600"
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

      <div className="grid grid-cols-12 gap-6">
        {/* Station List */}
        <div className="col-span-4">
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
                        station.status === 'active' ? 'bg-green-500' : 'bg-red-500'
                      }`} />
                      <span className="text-xs text-gray-500">
                        {station.status === 'active' ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteStation(station.id);
                    }}
                    className="text-red-600 hover:bg-red-100 p-1 rounded"
                  >
                    <Trash2 size={14} />
                  </button>
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
        <div className="col-span-8">
          {selectedStation ? (
            <div>
              <div className="flex justify-between items-center mb-4">
                <h3 className="text-xl font-semibold">Configure Station</h3>
                <div className="flex space-x-2">
                  {isEditing ? (
                    <>
                      <button
                        onClick={() => {
                          setIsEditing(false);
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
                        Cancel
                      </button>
                      <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center disabled:opacity-50"
                      >
                        <Save size={16} className="mr-2" />
                        {isSaving ? 'Saving...' : 'Save Changes'}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => setIsEditing(true)}
                      className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600 flex items-center"
                    >
                      <Edit3 size={16} className="mr-2" />
                      Edit Station
                    </button>
                  )}
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
                        disabled={!isEditing}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
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
                        disabled={!isEditing}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
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
                      disabled={!isEditing}
                      rows={3}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
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
                        disabled={!isEditing}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
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
                        disabled={!isEditing}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100"
                      />
                    </div>
                  </div>
                </div>
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
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
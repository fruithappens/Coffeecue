import React, { useState, useEffect } from 'react';
import { Calendar, Clock, Plus, Trash2, Users, Coffee } from 'lucide-react';

/**
 * Schedule Management Component for Organiser Interface
 * Allows event organizers to create and manage barista schedules
 */
const ScheduleManagement = () => {
  const [schedules, setSchedules] = useState([]);
  const [stations, setStations] = useState([]);
  const [users, setUsers] = useState([]);
  const [showAddShift, setShowAddShift] = useState(false);
  const [newShift, setNewShift] = useState({
    staff_name: '',
    staff_id: '',
    station_id: '',
    start_time: '',
    end_time: '',
    date: new Date().toISOString().split('T')[0] // Today's date
  });

  // Load stations, users, and schedules on mount
  useEffect(() => {
    loadStations();
    loadUsers();
    loadSchedules();
  }, []);

  // Load stations from localStorage
  const loadStations = () => {
    try {
      const savedStations = localStorage.getItem('coffee_cue_stations');
      if (savedStations) {
        setStations(JSON.parse(savedStations));
      }
    } catch (error) {
      console.error('Error loading stations:', error);
    }
  };

  // Load users from localStorage
  const loadUsers = () => {
    try {
      const savedUsers = localStorage.getItem('coffee_system_users');
      if (savedUsers) {
        const allUsers = JSON.parse(savedUsers);
        // Filter to only active baristas and organizers
        const availableUsers = allUsers.filter(user => 
          user.active && (user.role === 'barista' || user.role === 'organizer')
        );
        setUsers(availableUsers);
      }
    } catch (error) {
      console.error('Error loading users:', error);
    }
  };

  // Load schedules from localStorage
  const loadSchedules = () => {
    try {
      const savedSchedules = localStorage.getItem('event_schedules');
      if (savedSchedules) {
        setSchedules(JSON.parse(savedSchedules));
      }
    } catch (error) {
      console.error('Error loading schedules:', error);
    }
  };

  // Save schedules to localStorage
  const saveSchedules = (newSchedules) => {
    try {
      localStorage.setItem('event_schedules', JSON.stringify(newSchedules));
      setSchedules(newSchedules);
      
      // Trigger update event for other components
      window.dispatchEvent(new CustomEvent('schedule:updated', { 
        detail: { schedules: newSchedules } 
      }));
    } catch (error) {
      console.error('Error saving schedules:', error);
    }
  };

  // Add new shift
  const handleAddShift = () => {
    if (!newShift.staff_id || !newShift.station_id || !newShift.start_time || !newShift.end_time) {
      alert('Please select a barista and fill in all fields');
      return;
    }

    const shift = {
      id: Date.now(),
      ...newShift,
      status: 'scheduled',
      created_at: new Date().toISOString()
    };

    const updatedSchedules = [...schedules, shift];
    saveSchedules(updatedSchedules);

    // Reset form
    setNewShift({
      staff_name: '',
      staff_id: '',
      station_id: '',
      start_time: '',
      end_time: '',
      date: new Date().toISOString().split('T')[0]
    });
    setShowAddShift(false);
  };

  // Delete shift
  const handleDeleteShift = (shiftId) => {
    if (window.confirm('Are you sure you want to delete this shift?')) {
      const updatedSchedules = schedules.filter(s => s.id !== shiftId);
      saveSchedules(updatedSchedules);
    }
  };

  // Get schedules for today
  const todaySchedules = schedules.filter(schedule => 
    schedule.date === new Date().toISOString().split('T')[0]
  );

  // Group schedules by station
  const schedulesByStation = todaySchedules.reduce((acc, schedule) => {
    const stationId = schedule.station_id;
    if (!acc[stationId]) {
      acc[stationId] = [];
    }
    acc[stationId].push(schedule);
    return acc;
  }, {});

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-800 flex items-center">
          <Calendar size={28} className="mr-3 text-amber-600" />
          Schedule Management
        </h2>
        <button
          onClick={() => setShowAddShift(true)}
          className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center"
        >
          <Plus size={20} className="mr-2" />
          Add Shift
        </button>
      </div>

      {/* Add Shift Form */}
      {showAddShift && (
        <div className="mb-6 p-4 border border-gray-200 rounded-lg bg-gray-50">
          <h3 className="text-lg font-semibold mb-4">Add New Shift</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Barista
              </label>
              <select
                value={newShift.staff_id}
                onChange={(e) => {
                  const selectedUser = users.find(u => u.id === e.target.value);
                  setNewShift({
                    ...newShift, 
                    staff_id: e.target.value,
                    staff_name: selectedUser ? selectedUser.fullName : ''
                  });
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select barista</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.fullName} ({user.experience})
                    {user.preferredStation && ` - Prefers Station ${user.preferredStation}`}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Station
              </label>
              <select
                value={newShift.station_id}
                onChange={(e) => setNewShift({...newShift, station_id: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select station</option>
                {stations.map(station => (
                  <option key={station.id} value={station.id}>
                    {station.name || `Station ${station.id}`}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Start Time
              </label>
              <input
                type="time"
                value={newShift.start_time}
                onChange={(e) => setNewShift({...newShift, start_time: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                End Time
              </label>
              <input
                type="time"
                value={newShift.end_time}
                onChange={(e) => setNewShift({...newShift, end_time: e.target.value})}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          
          <div className="mt-4 flex justify-end space-x-2">
            <button
              onClick={() => setShowAddShift(false)}
              className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleAddShift}
              className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
            >
              Add Shift
            </button>
          </div>
        </div>
      )}

      {/* Today's Schedule */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold mb-4 flex items-center">
          <Clock size={20} className="mr-2 text-amber-600" />
          Today's Schedule ({new Date().toLocaleDateString()})
        </h3>
        
        {Object.keys(schedulesByStation).length > 0 ? (
          <div className="space-y-4">
            {Object.entries(schedulesByStation).map(([stationId, stationSchedules]) => {
              const station = stations.find(s => s.id === parseInt(stationId));
              return (
                <div key={stationId} className="border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium mb-3 flex items-center">
                    <Coffee size={18} className="mr-2 text-amber-600" />
                    {station?.name || `Station ${stationId}`}
                  </h4>
                  <div className="space-y-2">
                    {stationSchedules.sort((a, b) => a.start_time.localeCompare(b.start_time)).map(schedule => (
                      <div key={schedule.id} className="flex items-center justify-between bg-gray-50 p-3 rounded">
                        <div className="flex items-center">
                          <Users size={16} className="mr-2 text-gray-600" />
                          <span className="font-medium">{schedule.staff_name}</span>
                          <span className="ml-4 text-gray-600">
                            {schedule.start_time} - {schedule.end_time}
                          </span>
                        </div>
                        <button
                          onClick={() => handleDeleteShift(schedule.id)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="text-center py-8 text-gray-500">
            <Users size={48} className="mx-auto mb-4 text-gray-400" />
            <p>No schedules for today</p>
            <p className="text-sm mt-2">Click "Add Shift" to create a schedule</p>
          </div>
        )}
      </div>

      {/* Info panel */}
      <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-800">
          <strong>Note:</strong> Schedules created here will automatically sync to the Barista interface. 
          Each barista will see their assigned shifts when they log into their station.
        </p>
      </div>
    </div>
  );
};

export default ScheduleManagement;
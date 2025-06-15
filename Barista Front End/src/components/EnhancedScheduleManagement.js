import React, { useState, useEffect, useRef } from 'react';
import { 
  Calendar, Clock, Plus, Trash2, Users, Coffee, Lock, Unlock, AlertTriangle,
  PlayCircle, PauseCircle, Bell, Timer, Shield, UserCheck, ChevronLeft,
  ChevronRight, MessageSquare, Activity, RefreshCw, Settings, AlertCircle,
  CheckCircle, XCircle, User, Star, Award
} from 'lucide-react';
import ScheduleService from '../services/ScheduleService';
import StationsService from '../services/StationsService';
import MessageService from '../services/MessageService';

/**
 * Enhanced Schedule Management Component for Organiser Interface
 * Comprehensive event schedule management with timeline visualization,
 * station control, session management, and real-time controls
 */
const EnhancedScheduleManagement = () => {
  // Core state
  const [sessions, setSessions] = useState([]);
  const [stations, setStations] = useState([]);
  const [baristas, setBaristas] = useState([]);
  const [currentTime, setCurrentTime] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  
  // UI state
  const [activeTab, setActiveTab] = useState('timeline');
  const [showAddSession, setShowAddSession] = useState(false);
  const [showAssignBarista, setShowAssignBarista] = useState(false);
  const [selectedSession, setSelectedSession] = useState(null);
  const [selectedStation, setSelectedStation] = useState(null);
  
  // Real-time state
  const [sessionStatuses, setSessionStatuses] = useState({});
  const [stationLocks, setStationLocks] = useState({});
  const [preOrderWindows, setPreOrderWindows] = useState({});
  const [emergencyOverride, setEmergencyOverride] = useState(false);
  
  // Timeline ref for auto-scrolling
  const timelineRef = useRef(null);
  
  // Update current time every minute
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(timer);
  }, []);
  
  // Load initial data
  useEffect(() => {
    loadStations();
    loadBaristas();
    loadSessions();
    loadSessionStatuses();
  }, [selectedDate]);
  
  // Auto-scroll timeline to current time
  useEffect(() => {
    if (timelineRef.current && activeTab === 'timeline') {
      const currentHour = currentTime.getHours();
      const scrollPosition = (currentHour - 6) * 120; // Assuming 120px per hour
      timelineRef.current.scrollLeft = Math.max(0, scrollPosition - 200);
    }
  }, [currentTime, activeTab]);
  
  // Load stations
  const loadStations = async () => {
    try {
      const response = await StationsService.getStations();
      if (response && response.stations) {
        setStations(response.stations);
        
        // Initialize station locks from localStorage
        const savedLocks = localStorage.getItem('station_locks');
        if (savedLocks) {
          setStationLocks(JSON.parse(savedLocks));
        }
      }
    } catch (error) {
      console.error('Error loading stations:', error);
      // Fallback to localStorage
      const savedStations = localStorage.getItem('coffee_cue_stations');
      if (savedStations) {
        setStations(JSON.parse(savedStations));
      }
    }
  };
  
  // Load baristas
  const loadBaristas = () => {
    const savedUsers = localStorage.getItem('coffee_system_users');
    if (savedUsers) {
      const allUsers = JSON.parse(savedUsers);
      const baristasAndOrganizers = allUsers.filter(user => 
        user.active && (user.role === 'barista' || user.role === 'organizer')
      );
      setBaristas(baristasAndOrganizers);
    }
  };
  
  // Load sessions for selected date
  const loadSessions = () => {
    const savedSessions = localStorage.getItem('event_sessions');
    if (savedSessions) {
      const allSessions = JSON.parse(savedSessions);
      const dateSessions = allSessions.filter(session => 
        session.date === selectedDate
      );
      setSessions(dateSessions.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    }
  };
  
  // Load session statuses
  const loadSessionStatuses = () => {
    const savedStatuses = localStorage.getItem('session_statuses');
    if (savedStatuses) {
      setSessionStatuses(JSON.parse(savedStatuses));
    }
  };
  
  // Save sessions
  const saveSessions = (newSessions) => {
    const allSessions = JSON.parse(localStorage.getItem('event_sessions') || '[]');
    const otherSessions = allSessions.filter(s => s.date !== selectedDate);
    const updatedSessions = [...otherSessions, ...newSessions];
    
    localStorage.setItem('event_sessions', JSON.stringify(updatedSessions));
    setSessions(newSessions.sort((a, b) => a.startTime.localeCompare(b.startTime)));
    
    // Trigger update event
    window.dispatchEvent(new CustomEvent('sessions:updated', { 
      detail: { sessions: updatedSessions } 
    }));
  };
  
  // Create new session
  const createSession = (sessionData) => {
    const newSession = {
      id: Date.now(),
      ...sessionData,
      date: selectedDate,
      status: 'scheduled',
      preOrderWindow: 15, // Default 15 mins
      baristaPrep: sessionData.type === 'keynote' ? 60 : 30, // 1hr for first session, 30 mins for others
      assignedBaristas: [],
      createdAt: new Date().toISOString()
    };
    
    const updatedSessions = [...sessions, newSession];
    saveSessions(updatedSessions);
    setShowAddSession(false);
  };
  
  // Update session
  const updateSession = (sessionId, updates) => {
    const updatedSessions = sessions.map(session => 
      session.id === sessionId ? { ...session, ...updates } : session
    );
    saveSessions(updatedSessions);
  };
  
  // Delete session
  const deleteSession = (sessionId) => {
    if (window.confirm('Are you sure you want to delete this session?')) {
      const updatedSessions = sessions.filter(s => s.id !== sessionId);
      saveSessions(updatedSessions);
    }
  };
  
  // Toggle station lock
  const toggleStationLock = async (stationId) => {
    const newLocks = {
      ...stationLocks,
      [stationId]: !stationLocks[stationId]
    };
    
    setStationLocks(newLocks);
    localStorage.setItem('station_locks', JSON.stringify(newLocks));
    
    // Notify stations
    const message = newLocks[stationId] ? 
      'Station locked - no new orders' : 
      'Station unlocked - accepting orders';
    
    await MessageService.broadcastToStations({
      type: 'station_lock_update',
      stationId,
      locked: newLocks[stationId],
      message
    });
  };
  
  // Emergency override - unlock all stations
  const activateEmergencyOverride = async () => {
    setEmergencyOverride(true);
    
    // Unlock all stations
    const unlockedStations = {};
    stations.forEach(station => {
      unlockedStations[station.id] = false;
    });
    
    setStationLocks(unlockedStations);
    localStorage.setItem('station_locks', JSON.stringify(unlockedStations));
    
    // Notify all stations
    await MessageService.broadcastToStations({
      type: 'emergency_override',
      message: 'EMERGENCY: All stations unlocked by organizer'
    });
    
    // Auto-disable after 30 minutes
    setTimeout(() => {
      setEmergencyOverride(false);
    }, 30 * 60 * 1000);
  };
  
  // Update session status
  const updateSessionStatus = (sessionId, status) => {
    const newStatuses = {
      ...sessionStatuses,
      [sessionId]: {
        status,
        updatedAt: new Date().toISOString()
      }
    };
    
    setSessionStatuses(newStatuses);
    localStorage.setItem('session_statuses', JSON.stringify(newStatuses));
    
    // Update the session itself
    updateSession(sessionId, { status });
  };
  
  // Extend session time
  const extendSessionTime = (sessionId, minutes) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    const [hours, mins] = session.endTime.split(':').map(Number);
    const endDate = new Date();
    endDate.setHours(hours, mins + minutes);
    
    const newEndTime = `${String(endDate.getHours()).padStart(2, '0')}:${String(endDate.getMinutes()).padStart(2, '0')}`;
    
    updateSession(sessionId, { 
      endTime: newEndTime,
      extended: true,
      extensionMinutes: (session.extensionMinutes || 0) + minutes
    });
    
    // Notify baristas
    MessageService.broadcastToStations({
      type: 'session_extended',
      sessionId,
      sessionName: session.name,
      newEndTime,
      extensionMinutes: minutes
    });
  };
  
  // Assign barista to station for session
  const assignBaristaToStation = (sessionId, baristaId, stationId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    const assignment = {
      baristaId,
      stationId,
      assignedAt: new Date().toISOString()
    };
    
    const updatedAssignments = [
      ...(session.assignedBaristas || []).filter(a => 
        a.baristaId !== baristaId && a.stationId !== stationId
      ),
      assignment
    ];
    
    updateSession(sessionId, { assignedBaristas: updatedAssignments });
  };
  
  // Get current and upcoming sessions
  const getCurrentAndUpcomingSessions = () => {
    const now = new Date();
    const currentTimeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    
    return sessions.filter(session => {
      return session.endTime >= currentTimeStr;
    }).slice(0, 3);
  };
  
  // Calculate timeline hours
  const timelineHours = Array.from({ length: 15 }, (_, i) => i + 6); // 6 AM to 8 PM
  
  // Get position on timeline
  const getTimelinePosition = (timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const totalMinutes = (hours - 6) * 60 + minutes;
    return (totalMinutes / 60) * 120; // 120px per hour
  };
  
  // Get session width on timeline
  const getSessionWidth = (startTime, endTime) => {
    const start = getTimelinePosition(startTime);
    const end = getTimelinePosition(endTime);
    return end - start;
  };
  
  // Get barista skill level icon
  const getSkillIcon = (experience) => {
    switch (experience) {
      case 'expert':
        return <Award className="w-4 h-4 text-yellow-500" />;
      case 'intermediate':
        return <Star className="w-4 h-4 text-blue-500" />;
      default:
        return <User className="w-4 h-4 text-gray-500" />;
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-lg">
      {/* Header */}
      <div className="p-6 border-b border-gray-200">
        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800 flex items-center">
            <Calendar size={28} className="mr-3 text-amber-600" />
            Enhanced Schedule Management
          </h2>
          
          <div className="flex items-center space-x-4">
            {/* Date selector */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const date = new Date(selectedDate);
                  date.setDate(date.getDate() - 1);
                  setSelectedDate(date.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <ChevronLeft size={20} />
              </button>
              
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded-md"
              />
              
              <button
                onClick={() => {
                  const date = new Date(selectedDate);
                  date.setDate(date.getDate() + 1);
                  setSelectedDate(date.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-gray-100 rounded"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            
            {/* Emergency override */}
            {emergencyOverride ? (
              <div className="px-4 py-2 bg-red-100 text-red-700 rounded-lg flex items-center">
                <Shield size={20} className="mr-2" />
                Emergency Override Active
              </div>
            ) : (
              <button
                onClick={() => {
                  if (window.confirm('Activate emergency override? This will unlock ALL stations immediately.')) {
                    activateEmergencyOverride();
                  }
                }}
                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center"
              >
                <Shield size={20} className="mr-2" />
                Emergency Override
              </button>
            )}
          </div>
        </div>
        
        {/* Tabs */}
        <div className="mt-6 flex space-x-4 border-b border-gray-200">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`pb-2 px-4 ${activeTab === 'timeline' ? 'border-b-2 border-amber-500 text-amber-600' : 'text-gray-600'}`}
          >
            Timeline View
          </button>
          <button
            onClick={() => setActiveTab('stations')}
            className={`pb-2 px-4 ${activeTab === 'stations' ? 'border-b-2 border-amber-500 text-amber-600' : 'text-gray-600'}`}
          >
            Station Control
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`pb-2 px-4 ${activeTab === 'sessions' ? 'border-b-2 border-amber-500 text-amber-600' : 'text-gray-600'}`}
          >
            Session Management
          </button>
          <button
            onClick={() => setActiveTab('assignments')}
            className={`pb-2 px-4 ${activeTab === 'assignments' ? 'border-b-2 border-amber-500 text-amber-600' : 'text-gray-600'}`}
          >
            Barista Assignments
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-6">
        {/* Timeline View */}
        {activeTab === 'timeline' && (
          <div>
            <div className="mb-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Event Timeline</h3>
              <button
                onClick={() => setShowAddSession(true)}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center"
              >
                <Plus size={20} className="mr-2" />
                Add Session
              </button>
            </div>
            
            {/* Timeline */}
            <div className="relative overflow-x-auto" ref={timelineRef}>
              <div className="relative" style={{ width: `${timelineHours.length * 120}px`, height: '400px' }}>
                {/* Hour markers */}
                <div className="absolute top-0 left-0 right-0 h-8 border-b border-gray-300 flex">
                  {timelineHours.map(hour => (
                    <div key={hour} className="w-30 text-center text-sm text-gray-600" style={{ width: '120px' }}>
                      {hour}:00
                    </div>
                  ))}
                </div>
                
                {/* Current time indicator */}
                <div
                  className="absolute top-8 bottom-0 w-0.5 bg-red-500 z-20"
                  style={{ left: `${getTimelinePosition(`${currentTime.getHours()}:${currentTime.getMinutes()}`)}px` }}
                >
                  <div className="absolute -top-2 -left-3 w-6 h-6 bg-red-500 rounded-full flex items-center justify-center">
                    <Clock size={12} className="text-white" />
                  </div>
                </div>
                
                {/* Sessions */}
                {sessions.map((session, index) => {
                  const sessionStatus = sessionStatuses[session.id];
                  const isActive = sessionStatus?.status === 'active';
                  const isPaused = sessionStatus?.status === 'paused';
                  const isRunningLate = sessionStatus?.status === 'running_late';
                  
                  return (
                    <div
                      key={session.id}
                      className={`absolute rounded-lg p-3 cursor-pointer transition-all ${
                        isActive ? 'bg-green-100 border-2 border-green-500' :
                        isPaused ? 'bg-yellow-100 border-2 border-yellow-500' :
                        isRunningLate ? 'bg-red-100 border-2 border-red-500' :
                        'bg-blue-100 border-2 border-blue-300'
                      }`}
                      style={{
                        left: `${getTimelinePosition(session.startTime)}px`,
                        width: `${getSessionWidth(session.startTime, session.endTime)}px`,
                        top: `${60 + (index % 5) * 60}px`,
                        height: '50px'
                      }}
                      onClick={() => setSelectedSession(session)}
                    >
                      <div className="flex items-center justify-between h-full">
                        <div className="flex-1">
                          <div className="font-semibold text-sm truncate">{session.name}</div>
                          <div className="text-xs text-gray-600">
                            {session.startTime} - {session.endTime}
                          </div>
                        </div>
                        {isActive && <Activity size={16} className="text-green-600 animate-pulse" />}
                        {isPaused && <PauseCircle size={16} className="text-yellow-600" />}
                        {isRunningLate && <AlertCircle size={16} className="text-red-600" />}
                      </div>
                      
                      {/* Pre-order window indicator */}
                      <div
                        className="absolute top-0 bottom-0 bg-orange-200 opacity-50 rounded-l-lg"
                        style={{
                          right: '100%',
                          width: `${(session.preOrderWindow / 60) * 120}px`
                        }}
                      />
                      
                      {/* Barista prep time indicator */}
                      <div
                        className="absolute top-0 bottom-0 bg-purple-200 opacity-50 rounded-l-lg"
                        style={{
                          right: '100%',
                          width: `${(session.baristaPrep / 60) * 120}px`
                        }}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
            
            {/* Legend */}
            <div className="mt-4 flex items-center space-x-6 text-sm">
              <div className="flex items-center">
                <div className="w-4 h-4 bg-blue-100 border border-blue-300 rounded mr-2" />
                <span>Scheduled Session</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-orange-200 rounded mr-2" />
                <span>Pre-order Window</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-purple-200 rounded mr-2" />
                <span>Barista Prep Time</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-green-100 border-2 border-green-500 rounded mr-2" />
                <span>Active</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-red-100 border-2 border-red-500 rounded mr-2" />
                <span>Running Late</span>
              </div>
            </div>
          </div>
        )}
        
        {/* Station Control */}
        {activeTab === 'stations' && (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Station Control Panel</h3>
              <p className="text-gray-600">Lock/unlock stations to control order flow during breaks</p>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {stations.map(station => {
                const isLocked = stationLocks[station.id];
                const hasActiveBarista = sessions.some(s => 
                  s.assignedBaristas?.some(a => a.stationId === station.id)
                );
                
                return (
                  <div
                    key={station.id}
                    className={`p-4 rounded-lg border-2 ${
                      isLocked ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-300'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold flex items-center">
                        <Coffee size={20} className="mr-2" />
                        {station.name || `Station ${station.id}`}
                      </h4>
                      <button
                        onClick={() => toggleStationLock(station.id)}
                        className={`p-2 rounded-lg ${
                          isLocked ? 'bg-red-500 hover:bg-red-600 text-white' : 'bg-green-500 hover:bg-green-600 text-white'
                        }`}
                      >
                        {isLocked ? <Lock size={20} /> : <Unlock size={20} />}
                      </button>
                    </div>
                    
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Status:</span>
                        <span className={`font-medium ${isLocked ? 'text-red-600' : 'text-green-600'}`}>
                          {isLocked ? 'Locked' : 'Open'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-gray-600">Barista:</span>
                        <span className={hasActiveBarista ? 'text-green-600' : 'text-gray-500'}>
                          {hasActiveBarista ? 'Assigned' : 'None'}
                        </span>
                      </div>
                    </div>
                    
                    {isLocked && (
                      <div className="mt-3 text-xs text-red-600 bg-red-100 p-2 rounded">
                        Station locked - not accepting new orders
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="mt-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
              <h4 className="font-semibold text-blue-800 mb-2">Quick Actions</h4>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    const locked = {};
                    stations.forEach(s => locked[s.id] = true);
                    setStationLocks(locked);
                    localStorage.setItem('station_locks', JSON.stringify(locked));
                  }}
                  className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
                >
                  Lock All Stations
                </button>
                <button
                  onClick={() => {
                    const unlocked = {};
                    stations.forEach(s => unlocked[s.id] = false);
                    setStationLocks(unlocked);
                    localStorage.setItem('station_locks', JSON.stringify(unlocked));
                  }}
                  className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white rounded-lg"
                >
                  Unlock All Stations
                </button>
                <button
                  onClick={() => {
                    // Keep one station open (first available)
                    const locked = {};
                    stations.forEach((s, i) => locked[s.id] = i !== 0);
                    setStationLocks(locked);
                    localStorage.setItem('station_locks', JSON.stringify(locked));
                  }}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
                >
                  Quiet Period Mode
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Session Management */}
        {activeTab === 'sessions' && (
          <div>
            <div className="mb-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Real-time Session Control</h3>
              <button
                onClick={() => setShowAddSession(true)}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg flex items-center"
              >
                <Plus size={20} className="mr-2" />
                Add Session
              </button>
            </div>
            
            {/* Current and upcoming sessions */}
            <div className="space-y-4">
              {getCurrentAndUpcomingSessions().map(session => {
                const sessionStatus = sessionStatuses[session.id];
                const isActive = sessionStatus?.status === 'active';
                const isPaused = sessionStatus?.status === 'paused';
                const isRunningLate = sessionStatus?.status === 'running_late';
                
                return (
                  <div
                    key={session.id}
                    className={`p-6 rounded-lg border-2 ${
                      isActive ? 'bg-green-50 border-green-300' :
                      isPaused ? 'bg-yellow-50 border-yellow-300' :
                      isRunningLate ? 'bg-red-50 border-red-300' :
                      'bg-gray-50 border-gray-300'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-xl font-semibold mb-2">{session.name}</h4>
                        <div className="flex items-center space-x-4 text-sm text-gray-600 mb-4">
                          <span className="flex items-center">
                            <Clock size={16} className="mr-1" />
                            {session.startTime} - {session.endTime}
                          </span>
                          <span className="flex items-center">
                            <Users size={16} className="mr-1" />
                            {session.assignedBaristas?.length || 0} baristas
                          </span>
                          {session.extended && (
                            <span className="text-orange-600">
                              Extended by {session.extensionMinutes} mins
                            </span>
                          )}
                        </div>
                        
                        {/* Status controls */}
                        <div className="flex items-center space-x-3">
                          {!isActive && !isPaused && !isRunningLate && (
                            <button
                              onClick={() => updateSessionStatus(session.id, 'active')}
                              className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center text-sm"
                            >
                              <PlayCircle size={16} className="mr-1" />
                              Start
                            </button>
                          )}
                          
                          {isActive && (
                            <>
                              <button
                                onClick={() => updateSessionStatus(session.id, 'paused')}
                                className="px-3 py-1 bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg flex items-center text-sm"
                              >
                                <PauseCircle size={16} className="mr-1" />
                                Pause
                              </button>
                              <button
                                onClick={() => updateSessionStatus(session.id, 'running_late')}
                                className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white rounded-lg flex items-center text-sm"
                              >
                                <AlertCircle size={16} className="mr-1" />
                                Running Late
                              </button>
                            </>
                          )}
                          
                          {(isPaused || isRunningLate) && (
                            <button
                              onClick={() => updateSessionStatus(session.id, 'active')}
                              className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-lg flex items-center text-sm"
                            >
                              <PlayCircle size={16} className="mr-1" />
                              Resume
                            </button>
                          )}
                          
                          {/* Quick extend buttons */}
                          <div className="flex items-center space-x-2 ml-4 pl-4 border-l border-gray-300">
                            <span className="text-sm text-gray-600">Extend:</span>
                            <button
                              onClick={() => extendSessionTime(session.id, 5)}
                              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
                            >
                              +5m
                            </button>
                            <button
                              onClick={() => extendSessionTime(session.id, 10)}
                              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
                            >
                              +10m
                            </button>
                            <button
                              onClick={() => extendSessionTime(session.id, 15)}
                              className="px-2 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-sm"
                            >
                              +15m
                            </button>
                          </div>
                        </div>
                      </div>
                      
                      {/* Quick actions */}
                      <div className="flex flex-col space-y-2 ml-4">
                        <button
                          onClick={() => {
                            MessageService.broadcastToStations({
                              type: 'session_alert',
                              sessionId: session.id,
                              sessionName: session.name,
                              message: `Alert: ${session.name} update`
                            });
                          }}
                          className="p-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg"
                          title="Send alert to all stations"
                        >
                          <Bell size={20} />
                        </button>
                        <button
                          onClick={() => deleteSession(session.id)}
                          className="p-2 bg-red-500 hover:bg-red-600 text-white rounded-lg"
                          title="Delete session"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                    
                    {/* Pre-order control */}
                    <div className="mt-4 pt-4 border-t border-gray-200">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <span className="text-sm font-medium">Pre-orders:</span>
                          <button
                            onClick={() => {
                              const newWindows = { ...preOrderWindows };
                              newWindows[session.id] = !preOrderWindows[session.id];
                              setPreOrderWindows(newWindows);
                            }}
                            className={`px-3 py-1 rounded-lg text-sm ${
                              preOrderWindows[session.id] ? 
                              'bg-green-500 text-white' : 
                              'bg-gray-300 text-gray-700'
                            }`}
                          >
                            {preOrderWindows[session.id] ? 'Open' : 'Closed'}
                          </button>
                          <span className="text-sm text-gray-600">
                            Window: {session.preOrderWindow} mins before session
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {getCurrentAndUpcomingSessions().length === 0 && (
                <div className="text-center py-12 text-gray-500">
                  <Clock size={48} className="mx-auto mb-4 text-gray-400" />
                  <p>No current or upcoming sessions</p>
                </div>
              )}
            </div>
            
            {/* Communication panel */}
            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-lg">
              <h4 className="font-semibold text-purple-800 mb-3 flex items-center">
                <MessageSquare size={20} className="mr-2" />
                Quick Communication
              </h4>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    const message = prompt('Enter message for all stations:');
                    if (message) {
                      MessageService.broadcastToStations({
                        type: 'organizer_message',
                        message,
                        priority: 'normal'
                      });
                    }
                  }}
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg"
                >
                  Broadcast Message
                </button>
                <button
                  onClick={() => {
                    MessageService.broadcastToStations({
                      type: 'session_update',
                      message: 'Session times have been updated. Please check schedule.',
                      priority: 'high'
                    });
                  }}
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-lg"
                >
                  Alert: Schedule Change
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Barista Assignments */}
        {activeTab === 'assignments' && (
          <div>
            <div className="mb-4">
              <h3 className="text-lg font-semibold mb-2">Barista Assignment Matrix</h3>
              <p className="text-gray-600">Assign baristas to stations for each session</p>
            </div>
            
            {sessions.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <Users size={48} className="mx-auto mb-4 text-gray-400" />
                <p>No sessions scheduled for {new Date(selectedDate).toLocaleDateString()}</p>
                <button
                  onClick={() => setShowAddSession(true)}
                  className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white rounded-lg"
                >
                  Add Session
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {sessions.map(session => (
                  <div key={session.id} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold">{session.name}</h4>
                        <span className="text-sm text-gray-600">
                          {session.startTime} - {session.endTime}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedSession(session);
                          setShowAssignBarista(true);
                        }}
                        className="px-3 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded-lg text-sm"
                      >
                        Assign Barista
                      </button>
                    </div>
                    
                    {/* Station grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {stations.map(station => {
                        const assignment = session.assignedBaristas?.find(a => 
                          a.stationId === station.id
                        );
                        const barista = assignment ? 
                          baristas.find(b => b.id === assignment.baristaId) : null;
                        
                        return (
                          <div
                            key={station.id}
                            className={`p-3 rounded-lg border ${
                              assignment ? 'bg-green-50 border-green-300' : 'bg-gray-50 border-gray-300'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                <Coffee size={16} className="mr-2 text-gray-600" />
                                <span className="font-medium text-sm">
                                  {station.name || `Station ${station.id}`}
                                </span>
                              </div>
                              {assignment && (
                                <button
                                  onClick={() => {
                                    const updatedAssignments = session.assignedBaristas.filter(
                                      a => a.stationId !== station.id
                                    );
                                    updateSession(session.id, { 
                                      assignedBaristas: updatedAssignments 
                                    });
                                  }}
                                  className="text-red-500 hover:text-red-700"
                                >
                                  <XCircle size={16} />
                                </button>
                              )}
                            </div>
                            
                            {barista ? (
                              <div className="mt-2 flex items-center">
                                {getSkillIcon(barista.experience)}
                                <span className="ml-2 text-sm">{barista.fullName}</span>
                              </div>
                            ) : (
                              <div className="mt-2 text-sm text-gray-500">
                                No barista assigned
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      
      {/* Add Session Modal */}
      {showAddSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">Add New Session</h3>
            
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                createSession({
                  name: formData.get('name'),
                  type: formData.get('type'),
                  startTime: formData.get('startTime'),
                  endTime: formData.get('endTime'),
                  preOrderWindow: parseInt(formData.get('preOrderWindow')),
                  baristaPrep: parseInt(formData.get('baristaPrep'))
                });
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Session Name
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="e.g., Morning Keynote"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Session Type
                  </label>
                  <select
                    name="type"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="keynote">Keynote</option>
                    <option value="break">Break</option>
                    <option value="lunch">Lunch</option>
                    <option value="workshop">Workshop</option>
                    <option value="networking">Networking</option>
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Start Time
                    </label>
                    <input
                      name="startTime"
                      type="time"
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      End Time
                    </label>
                    <input
                      name="endTime"
                      type="time"
                      required
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Pre-order Window (mins)
                    </label>
                    <input
                      name="preOrderWindow"
                      type="number"
                      defaultValue="15"
                      min="5"
                      max="60"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Barista Prep (mins)
                    </label>
                    <input
                      name="baristaPrep"
                      type="number"
                      defaultValue="30"
                      min="15"
                      max="120"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    />
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddSession(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Add Session
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Assign Barista Modal */}
      {showAssignBarista && selectedSession && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              Assign Barista to {selectedSession.name}
            </h3>
            
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const formData = new FormData(e.target);
                assignBaristaToStation(
                  selectedSession.id,
                  formData.get('baristaId'),
                  formData.get('stationId')
                );
                setShowAssignBarista(false);
              }}
            >
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Select Barista
                  </label>
                  <select
                    name="baristaId"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Choose barista...</option>
                    {baristas.map(barista => (
                      <option key={barista.id} value={barista.id}>
                        {barista.fullName} - {barista.experience}
                        {barista.specialization && ` (${barista.specialization})`}
                      </option>
                    ))}
                  </select>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Assign to Station
                  </label>
                  <select
                    name="stationId"
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="">Choose station...</option>
                    {stations.map(station => {
                      const isAssigned = selectedSession.assignedBaristas?.some(
                        a => a.stationId === station.id
                      );
                      return (
                        <option 
                          key={station.id} 
                          value={station.id}
                          disabled={isAssigned}
                        >
                          {station.name || `Station ${station.id}`}
                          {isAssigned && ' (Already assigned)'}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAssignBarista(false)}
                  className="px-4 py-2 border border-gray-300 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Assign
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
      
      {/* Selected Session Details Modal */}
      {selectedSession && !showAssignBarista && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50"
          onClick={() => setSelectedSession(null)}
        >
          <div 
            className="bg-white rounded-lg p-6 w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{selectedSession.name}</h3>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-gray-500 hover:text-gray-700"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-gray-600">Time:</span>
                  <p className="font-medium">
                    {selectedSession.startTime} - {selectedSession.endTime}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Type:</span>
                  <p className="font-medium capitalize">{selectedSession.type}</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Pre-order Window:</span>
                  <p className="font-medium">{selectedSession.preOrderWindow} minutes</p>
                </div>
                <div>
                  <span className="text-sm text-gray-600">Barista Prep Time:</span>
                  <p className="font-medium">{selectedSession.baristaPrep} minutes</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-medium mb-2">Assigned Baristas</h4>
                {selectedSession.assignedBaristas?.length > 0 ? (
                  <div className="space-y-2">
                    {selectedSession.assignedBaristas.map((assignment, index) => {
                      const barista = baristas.find(b => b.id === assignment.baristaId);
                      const station = stations.find(s => s.id === assignment.stationId);
                      
                      return (
                        <div key={index} className="flex items-center justify-between bg-gray-50 p-2 rounded">
                          <div className="flex items-center">
                            {getSkillIcon(barista?.experience)}
                            <span className="ml-2">{barista?.fullName || 'Unknown'}</span>
                            <span className="mx-2 text-gray-500">→</span>
                            <span>{station?.name || `Station ${assignment.stationId}`}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-gray-500">No baristas assigned yet</p>
                )}
              </div>
              
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowAssignBarista(true);
                  }}
                  className="px-4 py-2 bg-blue-500 text-white rounded-md hover:bg-blue-600"
                >
                  Assign Barista
                </button>
                <button
                  onClick={() => deleteSession(selectedSession.id)}
                  className="px-4 py-2 bg-red-500 text-white rounded-md hover:bg-red-600"
                >
                  Delete Session
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EnhancedScheduleManagement;
import React, { useState, useEffect, useRef } from 'react';
import {
  Calendar, Clock, Plus, Trash2, Users, Coffee, Lock, Unlock, AlertTriangle,
  PlayCircle, PauseCircle, Bell, Timer, Shield, UserCheck, ChevronLeft,
  ChevronRight, MessageSquare, Activity, RefreshCw, Settings, AlertCircle,
  CheckCircle, XCircle, User, Star, Award
} from 'lucide-react';
import ScheduleService from '../../services/ScheduleService';
import StationsService from '../../services/StationsService';
import MessageService from '../../services/MessageService';
import ApiServiceClass from '../../services/ApiService';
import QuickSetupStatusBanner from './QuickSetupStatusBanner';

// Backend-backed event_sessions + session_statuses. The /settings/
// event-sessions KV endpoint persists these to Postgres so a
// coordinator opening the schedule on a different device sees the
// same sessions. localStorage still acts as a fast first-paint cache.
const _apiService = new ApiServiceClass();

const _refreshSessionsFromBackend = async () => {
  try {
    const resp = await _apiService.get('/settings/event-sessions');
    if (resp?.success !== false) {
      if (Array.isArray(resp?.sessions)) {
        localStorage.setItem('event_sessions', JSON.stringify(resp.sessions));
      }
      if (resp?.statuses && typeof resp.statuses === 'object') {
        localStorage.setItem('session_statuses', JSON.stringify(resp.statuses));
      }
    }
    return resp;
  } catch (err) {
    console.warn('Could not refresh sessions from backend; using localStorage cache:', err);
    return null;
  }
};

const _persistSessionsToBackend = async ({ sessions, statuses }) => {
  const payload = {};
  if (sessions !== undefined) payload.sessions = sessions;
  if (statuses !== undefined) payload.statuses = statuses;
  if (Object.keys(payload).length === 0) return;
  try {
    await _apiService.post('/settings/event-sessions', payload);
  } catch (err) {
    console.warn('Could not save sessions to backend; localStorage cache kept:', err);
  }
};

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
  
  // Load initial data. Pull authoritative sessions + statuses from
  // the backend KV so a coordinator on a tablet sees the same
  // schedule as a coordinator on a laptop; localStorage caches let
  // the panel render instantly while the fetch is in flight.
  useEffect(() => {
    loadStations();
    loadBaristas();
    loadSessions();
    loadSessionStatuses();
    (async () => {
      const resp = await _refreshSessionsFromBackend();
      if (resp) {
        loadSessions();
        loadSessionStatuses();
      }
    })();
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
  
  // Save sessions. Writes localStorage immediately for instant UI
  // feedback, then mirrors the full sessions list to the backend so
  // it persists cross-device. Other-date sessions are preserved.
  const saveSessions = (newSessions) => {
    const allSessions = JSON.parse(localStorage.getItem('event_sessions') || '[]');
    const otherSessions = allSessions.filter(s => s.date !== selectedDate);
    const updatedSessions = [...otherSessions, ...newSessions];

    localStorage.setItem('event_sessions', JSON.stringify(updatedSessions));
    setSessions(newSessions.sort((a, b) => a.startTime.localeCompare(b.startTime)));

    // Best-effort backend mirror. We send the whole sessions list
    // (across all dates), so a partial network failure can't desync
    // one date from another.
    _persistSessionsToBackend({ sessions: updatedSessions });

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
    // Mirror to backend KV so the next device sees the same status.
    _persistSessionsToBackend({ statuses: newStatuses });
    
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
        return <Award className="w-4 h-4 text-cq-warn" />;
      case 'intermediate':
        return <Star className="w-4 h-4 text-cq-caramel-deep" />;
      default:
        return <User className="w-4 h-4 text-cq-ink-3" />;
    }
  };
  
  return (
    <div className="bg-cq-milk rounded-cq-lg shadow-cq-card-lg">
      <div className="px-6 pt-6">
        <QuickSetupStatusBanner section="schedule" />
      </div>
      {/* Header */}
      <div className="p-4 sm:p-6 border-b border-cq-line">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-3">
          <h2 className="text-lg sm:text-2xl font-bold text-cq-roast flex items-center">
            <Calendar size={28} className="mr-3 shrink-0 text-cq-caramel" />
            Enhanced Schedule Management
          </h2>
          
          <div className="flex flex-wrap items-center gap-3">
            {/* Date selector */}
            <div className="flex items-center space-x-2">
              <button
                onClick={() => {
                  const date = new Date(selectedDate);
                  date.setDate(date.getDate() - 1);
                  setSelectedDate(date.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-cq-wash rounded"
              >
                <ChevronLeft size={20} />
              </button>
              
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="px-3 py-2 border border-cq-line rounded-md"
              />
              
              <button
                onClick={() => {
                  const date = new Date(selectedDate);
                  date.setDate(date.getDate() + 1);
                  setSelectedDate(date.toISOString().split('T')[0]);
                }}
                className="p-2 hover:bg-cq-wash rounded"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            
            {/* Emergency override */}
            {emergencyOverride ? (
              <div className="px-4 py-2 bg-cq-alert-wash text-cq-alert rounded-cq-md flex items-center">
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
                className="px-4 py-2 bg-cq-alert-wash0 hover:bg-cq-alert text-white rounded-cq-md flex items-center"
              >
                <Shield size={20} className="mr-2" />
                Emergency Override
              </button>
            )}
          </div>
        </div>
        
        {/* Tabs */}
        <div className="mt-6 flex space-x-4 border-b border-cq-line overflow-x-auto">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`pb-2 px-4 whitespace-nowrap shrink-0 ${activeTab === 'timeline' ? 'border-b-2 border-cq-caramel text-cq-caramel' : 'text-cq-ink-2'}`}
          >
            Timeline View
          </button>
          <button
            onClick={() => setActiveTab('stations')}
            className={`pb-2 px-4 whitespace-nowrap shrink-0 ${activeTab === 'stations' ? 'border-b-2 border-cq-caramel text-cq-caramel' : 'text-cq-ink-2'}`}
          >
            Station Control
          </button>
          <button
            onClick={() => setActiveTab('sessions')}
            className={`pb-2 px-4 whitespace-nowrap shrink-0 ${activeTab === 'sessions' ? 'border-b-2 border-cq-caramel text-cq-caramel' : 'text-cq-ink-2'}`}
          >
            Session Management
          </button>
          <button
            onClick={() => setActiveTab('assignments')}
            className={`pb-2 px-4 whitespace-nowrap shrink-0 ${activeTab === 'assignments' ? 'border-b-2 border-cq-caramel text-cq-caramel' : 'text-cq-ink-2'}`}
          >
            Barista Assignments
          </button>
        </div>
      </div>
      
      {/* Content */}
      <div className="p-3 sm:p-6">
        {/* Timeline View */}
        {activeTab === 'timeline' && (
          <div>
            <div className="mb-4 flex justify-between items-center">
              <h3 className="text-lg font-semibold">Event Timeline</h3>
              <button
                onClick={() => setShowAddSession(true)}
                className="px-4 py-2 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded-cq-md flex items-center"
              >
                <Plus size={20} className="mr-2" />
                Add Session
              </button>
            </div>
            
            {/* Timeline */}
            <div className="relative overflow-x-auto" ref={timelineRef}>
              <div className="relative" style={{ width: `${timelineHours.length * 120}px`, height: '400px' }}>
                {/* Hour markers */}
                <div className="absolute top-0 left-0 right-0 h-8 border-b border-cq-line flex">
                  {timelineHours.map(hour => (
                    <div key={hour} className="w-30 text-center text-sm text-cq-ink-2" style={{ width: '120px' }}>
                      {hour}:00
                    </div>
                  ))}
                </div>
                
                {/* Current time indicator */}
                <div
                  className="absolute top-8 bottom-0 w-0.5 bg-cq-alert-wash0 z-20"
                  style={{ left: `${getTimelinePosition(`${currentTime.getHours()}:${currentTime.getMinutes()}`)}px` }}
                >
                  <div className="absolute -top-2 -left-3 w-6 h-6 bg-cq-alert-wash0 rounded-full flex items-center justify-center">
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
                      className={`absolute rounded-cq-md p-3 cursor-pointer transition-all ${
                        isActive ? 'bg-cq-ready-wash border-2 border-cq-ready' :
                        isPaused ? 'bg-cq-warn-wash border-2 border-cq-warn' :
                        isRunningLate ? 'bg-cq-alert-wash border-2 border-cq-alert' :
                        'bg-cq-caramel-wash border-2 border-cq-line'
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
                          <div className="text-xs text-cq-ink-2">
                            {session.startTime} - {session.endTime}
                          </div>
                        </div>
                        {isActive && <Activity size={16} className="text-cq-ready animate-pulse" />}
                        {isPaused && <PauseCircle size={16} className="text-cq-warn" />}
                        {isRunningLate && <AlertCircle size={16} className="text-cq-alert" />}
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
            <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
              <div className="flex items-center whitespace-nowrap">
                <div className="w-4 h-4 bg-cq-caramel-wash border border-cq-line rounded mr-2 shrink-0" />
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
                <div className="w-4 h-4 bg-cq-ready-wash border-2 border-cq-ready rounded mr-2" />
                <span>Active</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-cq-alert-wash border-2 border-cq-alert rounded mr-2" />
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
              <p className="text-cq-ink-2">Lock/unlock stations to control order flow during breaks</p>
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
                    className={`p-4 rounded-cq-md border-2 ${
                      isLocked ? 'bg-cq-alert-wash border-cq-alert' : 'bg-cq-ready-wash border-cq-ready'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h4 className="font-semibold flex items-center">
                        <Coffee size={20} className="mr-2" />
                        {station.name || `Station ${station.id}`}
                      </h4>
                      <button
                        onClick={() => toggleStationLock(station.id)}
                        className={`p-2 rounded-cq-md ${
                          isLocked ? 'bg-cq-alert-wash0 hover:bg-cq-alert text-white' : 'bg-cq-ready-wash0 hover:bg-cq-ready text-white'
                        }`}
                      >
                        {isLocked ? <Lock size={20} /> : <Unlock size={20} />}
                      </button>
                    </div>
                    
                    <div className="space-y-1 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="text-cq-ink-2">Status:</span>
                        <span className={`font-medium ${isLocked ? 'text-cq-alert' : 'text-cq-ready'}`}>
                          {isLocked ? 'Locked' : 'Open'}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-cq-ink-2">Barista:</span>
                        <span className={hasActiveBarista ? 'text-cq-ready' : 'text-cq-ink-3'}>
                          {hasActiveBarista ? 'Assigned' : 'None'}
                        </span>
                      </div>
                    </div>
                    
                    {isLocked && (
                      <div className="mt-3 text-xs text-cq-alert bg-cq-alert-wash p-2 rounded">
                        Station locked - not accepting new orders
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            
            <div className="mt-6 p-4 bg-cq-caramel-wash border border-cq-line rounded-cq-md">
              <h4 className="font-semibold text-cq-caramel-deep mb-2">Quick Actions</h4>
              <div className="flex space-x-3">
                <button
                  onClick={() => {
                    const locked = {};
                    stations.forEach(s => locked[s.id] = true);
                    setStationLocks(locked);
                    localStorage.setItem('station_locks', JSON.stringify(locked));
                  }}
                  className="px-4 py-2 bg-cq-alert-wash0 hover:bg-cq-alert text-white rounded-cq-md"
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
                  className="px-4 py-2 bg-cq-ready-wash0 hover:bg-cq-ready text-white rounded-cq-md"
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
                  className="px-4 py-2 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded-cq-md"
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
                className="px-4 py-2 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded-cq-md flex items-center"
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
                    className={`p-6 rounded-cq-md border-2 ${
                      isActive ? 'bg-cq-ready-wash border-cq-ready' :
                      isPaused ? 'bg-cq-warn-wash border-cq-warn' :
                      isRunningLate ? 'bg-cq-alert-wash border-cq-alert' :
                      'bg-cq-wash border-cq-line'
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <h4 className="text-xl font-semibold mb-2">{session.name}</h4>
                        <div className="flex items-center space-x-4 text-sm text-cq-ink-2 mb-4">
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
                              className="px-3 py-1 bg-cq-ready-wash0 hover:bg-cq-ready text-white rounded-cq-md flex items-center text-sm"
                            >
                              <PlayCircle size={16} className="mr-1" />
                              Start
                            </button>
                          )}
                          
                          {isActive && (
                            <>
                              <button
                                onClick={() => updateSessionStatus(session.id, 'paused')}
                                className="px-3 py-1 bg-cq-warn-wash0 hover:bg-cq-warn text-white rounded-cq-md flex items-center text-sm"
                              >
                                <PauseCircle size={16} className="mr-1" />
                                Pause
                              </button>
                              <button
                                onClick={() => updateSessionStatus(session.id, 'running_late')}
                                className="px-3 py-1 bg-cq-alert-wash0 hover:bg-cq-alert text-white rounded-cq-md flex items-center text-sm"
                              >
                                <AlertCircle size={16} className="mr-1" />
                                Running Late
                              </button>
                            </>
                          )}
                          
                          {(isPaused || isRunningLate) && (
                            <button
                              onClick={() => updateSessionStatus(session.id, 'active')}
                              className="px-3 py-1 bg-cq-ready-wash0 hover:bg-cq-ready text-white rounded-cq-md flex items-center text-sm"
                            >
                              <PlayCircle size={16} className="mr-1" />
                              Resume
                            </button>
                          )}
                          
                          {/* Quick extend buttons */}
                          <div className="flex items-center space-x-2 ml-4 pl-4 border-l border-cq-line">
                            <span className="text-sm text-cq-ink-2">Extend:</span>
                            <button
                              onClick={() => extendSessionTime(session.id, 5)}
                              className="px-2 py-1 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded text-sm"
                            >
                              +5m
                            </button>
                            <button
                              onClick={() => extendSessionTime(session.id, 10)}
                              className="px-2 py-1 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded text-sm"
                            >
                              +10m
                            </button>
                            <button
                              onClick={() => extendSessionTime(session.id, 15)}
                              className="px-2 py-1 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded text-sm"
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
                          className="p-2 bg-purple-500 hover:bg-purple-600 text-white rounded-cq-md"
                          title="Send alert to all stations"
                        >
                          <Bell size={20} />
                        </button>
                        <button
                          onClick={() => deleteSession(session.id)}
                          className="p-2 bg-cq-alert-wash0 hover:bg-cq-alert text-white rounded-cq-md"
                          title="Delete session"
                        >
                          <Trash2 size={20} />
                        </button>
                      </div>
                    </div>
                    
                    {/* Pre-order control */}
                    <div className="mt-4 pt-4 border-t border-cq-line">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-4">
                          <span className="text-sm font-medium">Pre-orders:</span>
                          <button
                            onClick={() => {
                              const newWindows = { ...preOrderWindows };
                              newWindows[session.id] = !preOrderWindows[session.id];
                              setPreOrderWindows(newWindows);
                            }}
                            className={`px-3 py-1 rounded-cq-md text-sm ${
                              preOrderWindows[session.id] ? 
                              'bg-cq-ready-wash0 text-white' : 
                              'bg-cq-line text-cq-ink-2'
                            }`}
                          >
                            {preOrderWindows[session.id] ? 'Open' : 'Closed'}
                          </button>
                          <span className="text-sm text-cq-ink-2">
                            Window: {session.preOrderWindow} mins before session
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              
              {getCurrentAndUpcomingSessions().length === 0 && (
                <div className="text-center py-12 text-cq-ink-3">
                  <Clock size={48} className="mx-auto mb-4 text-cq-ink-3" />
                  <p>No current or upcoming sessions</p>
                </div>
              )}
            </div>
            
            {/* Communication panel */}
            <div className="mt-6 p-4 bg-purple-50 border border-purple-200 rounded-cq-md">
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
                  className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-cq-md"
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
                  className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-cq-md"
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
              <p className="text-cq-ink-2">Assign baristas to stations for each session</p>
            </div>
            
            {sessions.length === 0 ? (
              <div className="text-center py-12 text-cq-ink-3">
                <Users size={48} className="mx-auto mb-4 text-cq-ink-3" />
                <p>No sessions scheduled for {new Date(selectedDate).toLocaleDateString()}</p>
                <button
                  onClick={() => setShowAddSession(true)}
                  className="mt-4 px-4 py-2 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded-cq-md"
                >
                  Add Session
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                {sessions.map(session => (
                  <div key={session.id} className="border border-cq-line rounded-cq-md p-4">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h4 className="font-semibold">{session.name}</h4>
                        <span className="text-sm text-cq-ink-2">
                          {session.startTime} - {session.endTime}
                        </span>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedSession(session);
                          setShowAssignBarista(true);
                        }}
                        className="px-3 py-1 bg-cq-roast hover:bg-cq-caramel-deep text-white rounded-cq-md text-sm"
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
                            className={`p-3 rounded-cq-md border ${
                              assignment ? 'bg-cq-ready-wash border-cq-ready' : 'bg-cq-wash border-cq-line'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center">
                                <Coffee size={16} className="mr-2 text-cq-ink-2" />
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
                                  className="text-cq-alert hover:text-cq-alert"
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
                              <div className="mt-2 text-sm text-cq-ink-3">
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
          <div className="bg-white rounded-cq-md p-6 w-full max-w-md">
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
                  <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                    Session Name
                  </label>
                  <input
                    name="name"
                    type="text"
                    required
                    className="w-full px-3 py-2 border border-cq-line rounded-md"
                    placeholder="e.g., Morning Keynote"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                    Session Type
                  </label>
                  <select
                    name="type"
                    className="w-full px-3 py-2 border border-cq-line rounded-md"
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
                    <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                      Start Time
                    </label>
                    <input
                      name="startTime"
                      type="time"
                      required
                      className="w-full px-3 py-2 border border-cq-line rounded-md"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                      End Time
                    </label>
                    <input
                      name="endTime"
                      type="time"
                      required
                      className="w-full px-3 py-2 border border-cq-line rounded-md"
                    />
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                      Pre-order Window (mins)
                    </label>
                    <input
                      name="preOrderWindow"
                      type="number"
                      defaultValue="15"
                      min="5"
                      max="60"
                      className="w-full px-3 py-2 border border-cq-line rounded-md"
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                      Barista Prep (mins)
                    </label>
                    <input
                      name="baristaPrep"
                      type="number"
                      defaultValue="30"
                      min="15"
                      max="120"
                      className="w-full px-3 py-2 border border-cq-line rounded-md"
                    />
                  </div>
                </div>
              </div>
              
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowAddSession(false)}
                  className="px-4 py-2 border border-cq-line rounded-md hover:bg-cq-wash"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cq-roast text-white rounded-md hover:bg-cq-caramel-deep"
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
          <div className="bg-white rounded-cq-md p-6 w-full max-w-md">
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
                  <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                    Select Barista
                  </label>
                  <select
                    name="baristaId"
                    required
                    className="w-full px-3 py-2 border border-cq-line rounded-md"
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
                  <label className="block text-sm font-medium text-cq-ink-2 mb-1">
                    Assign to Station
                  </label>
                  <select
                    name="stationId"
                    required
                    className="w-full px-3 py-2 border border-cq-line rounded-md"
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
                  className="px-4 py-2 border border-cq-line rounded-md hover:bg-cq-wash"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-cq-roast text-white rounded-md hover:bg-cq-caramel-deep"
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
            className="bg-white rounded-cq-md p-6 w-full max-w-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">{selectedSession.name}</h3>
              <button
                onClick={() => setSelectedSession(null)}
                className="text-cq-ink-3 hover:text-cq-ink-2"
              >
                <XCircle size={24} />
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-sm text-cq-ink-2">Time:</span>
                  <p className="font-medium">
                    {selectedSession.startTime} - {selectedSession.endTime}
                  </p>
                </div>
                <div>
                  <span className="text-sm text-cq-ink-2">Type:</span>
                  <p className="font-medium capitalize">{selectedSession.type}</p>
                </div>
                <div>
                  <span className="text-sm text-cq-ink-2">Pre-order Window:</span>
                  <p className="font-medium">{selectedSession.preOrderWindow} minutes</p>
                </div>
                <div>
                  <span className="text-sm text-cq-ink-2">Barista Prep Time:</span>
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
                        <div key={index} className="flex items-center justify-between bg-cq-wash p-2 rounded">
                          <div className="flex items-center">
                            {getSkillIcon(barista?.experience)}
                            <span className="ml-2">{barista?.fullName || 'Unknown'}</span>
                            <span className="mx-2 text-cq-ink-3">→</span>
                            <span>{station?.name || `Station ${assignment.stationId}`}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-cq-ink-3">No baristas assigned yet</p>
                )}
              </div>
              
              <div className="flex justify-end space-x-3 pt-4 border-t">
                <button
                  onClick={() => {
                    setShowAssignBarista(true);
                  }}
                  className="px-4 py-2 bg-cq-roast text-white rounded-md hover:bg-cq-caramel-deep"
                >
                  Assign Barista
                </button>
                <button
                  onClick={() => deleteSession(selectedSession.id)}
                  className="px-4 py-2 bg-cq-alert-wash0 text-white rounded-md hover:bg-cq-alert"
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
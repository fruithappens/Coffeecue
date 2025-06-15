import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { 
  Calendar, Clock, TrendingUp, Users, Coffee, 
  AlertCircle, CheckCircle, Play, Pause, FastForward,
  Settings, BarChart2, Zap, Sun, Moon, Activity
} from 'lucide-react';
import useOrders from '../hooks/useOrders';
import useStations from '../hooks/useStations';
import useSettings from '../hooks/useSettings';

const EventLifecycleManagement = () => {
  const { pendingOrders, inProgressOrders, completedOrders } = useOrders();
  const { stations, updateStation } = useStations();
  const { settings, updateSettings } = useSettings();
  
  // Create ordersData object for backward compatibility
  const ordersData = {
    pending: pendingOrders || [],
    inProgress: inProgressOrders || [],
    completed: completedOrders || []
  };
  
  // Event phases
  const EVENT_PHASES = {
    SETUP: 'setup',
    PRE_EVENT: 'pre_event',
    EARLY_MORNING: 'early_morning',
    MORNING_PEAK: 'morning_peak',
    MID_MORNING: 'mid_morning',
    LUNCH_BREAK: 'lunch_break',
    AFTERNOON: 'afternoon',
    AFTERNOON_PEAK: 'afternoon_peak',
    WIND_DOWN: 'wind_down',
    CLEANUP: 'cleanup'
  };
  
  const [currentPhase, setCurrentPhase] = useState(EVENT_PHASES.MORNING_PEAK);
  const [phaseHistory, setPhaseHistory] = useState([]);
  const [automatedPhaseTransition, setAutomatedPhaseTransition] = useState(true);
  const [phaseOverrides, setPhaseOverrides] = useState({});
  const [selectedPhaseConfig, setSelectedPhaseConfig] = useState(null);
  
  // Phase configurations
  const phaseConfigurations = {
    [EVENT_PHASES.SETUP]: {
      name: 'Setup Phase',
      icon: <Settings className="text-gray-500" size={20} />,
      timeRange: '06:00 - 07:00',
      characteristics: {
        orderVolume: 'none',
        staffRequired: 'setup_crew',
        menuAvailability: 'testing_only',
        stationConfig: 'preparation_mode'
      },
      automations: {
        preHeatMachines: true,
        stockCheck: true,
        systemTest: true,
        staffBriefing: true
      },
      recommendations: [
        'Run machine diagnostics',
        'Verify all stock levels',
        'Test order system end-to-end',
        'Brief staff on special requirements'
      ]
    },
    [EVENT_PHASES.PRE_EVENT]: {
      name: 'Pre-Event',
      icon: <Sun className="text-yellow-500" size={20} />,
      timeRange: '07:00 - 08:00',
      characteristics: {
        orderVolume: 'low',
        staffRequired: 'partial',
        menuAvailability: 'limited_quick_drinks',
        stationConfig: 'warm_up'
      },
      menuRestrictions: {
        availableDrinks: ['espresso', 'long_black', 'americano'],
        preparationMode: 'quick_serve',
        maxComplexity: 'simple'
      },
      recommendations: [
        'Open 1-2 stations only',
        'Focus on quick drinks',
        'Build initial stock buffer'
      ]
    },
    [EVENT_PHASES.MORNING_PEAK]: {
      name: 'Morning Peak',
      icon: <TrendingUp className="text-red-500" size={20} />,
      timeRange: '08:00 - 10:30',
      characteristics: {
        orderVolume: 'very_high',
        staffRequired: 'full',
        menuAvailability: 'full_menu',
        stationConfig: 'high_performance'
      },
      optimizations: {
        batchProcessing: true,
        priorityRouting: true,
        dynamicStaffing: true,
        stockPreloading: true
      },
      alerts: {
        waitTimeThreshold: 10, // minutes
        queueLengthThreshold: 15,
        stockLevelThreshold: 30 // percentage
      },
      recommendations: [
        'All stations fully operational',
        'Enable batch processing',
        'Monitor wait times closely',
        'Pre-stage popular milk types'
      ]
    },
    [EVENT_PHASES.MID_MORNING]: {
      name: 'Mid-Morning Lull',
      icon: <Coffee className="text-blue-500" size={20} />,
      timeRange: '10:30 - 11:30',
      characteristics: {
        orderVolume: 'moderate',
        staffRequired: 'standard',
        menuAvailability: 'full_menu',
        stationConfig: 'balanced'
      },
      opportunities: {
        stockReplenishment: true,
        staffRotation: true,
        equipmentCleaning: true,
        customerEngagement: true
      },
      recommendations: [
        'Rotate staff for breaks',
        'Replenish stock levels',
        'Clean equipment between rushes',
        'Engage with customers'
      ]
    },
    [EVENT_PHASES.LUNCH_BREAK]: {
      name: 'Lunch Break',
      icon: <Clock className="text-green-500" size={20} />,
      timeRange: '11:30 - 13:00',
      characteristics: {
        orderVolume: 'low',
        staffRequired: 'minimal',
        menuAvailability: 'limited',
        stationConfig: 'conservation'
      },
      strategies: {
        consolidateStations: true,
        reducedMenu: true,
        staffLunch: true,
        prepForAfternoon: true
      },
      recommendations: [
        'Consolidate to 1-2 stations',
        'Staggered staff lunch breaks',
        'Prepare for afternoon session'
      ]
    },
    [EVENT_PHASES.AFTERNOON_PEAK]: {
      name: 'Afternoon Peak',
      icon: <Zap className="text-orange-500" size={20} />,
      timeRange: '14:00 - 15:30',
      characteristics: {
        orderVolume: 'high',
        staffRequired: 'increased',
        menuAvailability: 'full_menu_plus_iced',
        stationConfig: 'flexible'
      },
      specialConsiderations: {
        icedDrinkDemand: 'high',
        decafRequests: 'increased',
        customizations: 'frequent',
        socialOrders: 'common'
      },
      recommendations: [
        'Prepare iced drink station',
        'Stock extra alternative milks',
        'Enable customization options',
        'Focus on quality over speed'
      ]
    },
    [EVENT_PHASES.WIND_DOWN]: {
      name: 'Wind Down',
      icon: <Moon className="text-purple-500" size={20} />,
      timeRange: '16:00 - 17:00',
      characteristics: {
        orderVolume: 'declining',
        staffRequired: 'reduced',
        menuAvailability: 'simplified',
        stationConfig: 'consolidation'
      },
      endOfDayTasks: {
        lastCallAnnouncement: true,
        stockDepletion: true,
        equipmentWindDown: true,
        orderCutoff: true
      },
      recommendations: [
        'Announce last call',
        'Start depleting perishable stock',
        'Begin equipment shutdown sequence',
        'Process final orders'
      ]
    }
  };
  
  // Calculate phase efficiency
  const calculatePhaseEfficiency = useCallback((phase, orders, stations) => {
    const config = phaseConfigurations[phase];
    if (!config) return 0;
    
    let score = 100;
    
    // Check wait times
    const avgWait = orders.pending.reduce((sum, o) => sum + (o.waitTime || 0), 0) / 
                    (orders.pending.length || 1);
    if (config.alerts?.waitTimeThreshold && avgWait > config.alerts.waitTimeThreshold) {
      score -= 20;
    }
    
    // Check queue length
    if (config.alerts?.queueLengthThreshold && orders.pending.length > config.alerts.queueLengthThreshold) {
      score -= 15;
    }
    
    // Check staff utilization
    const activeStations = stations.filter(s => s.status === 'active').length;
    const expectedStations = config.characteristics.staffRequired === 'full' ? stations.length : 
                           config.characteristics.staffRequired === 'minimal' ? 1 : 
                           Math.ceil(stations.length / 2);
    
    if (Math.abs(activeStations - expectedStations) > 1) {
      score -= 10;
    }
    
    return Math.max(0, score);
  }, []);
  
  // Calculate staff utilization
  const calculateStaffUtilization = useCallback((stations) => {
    const active = stations.filter(s => s.status === 'active' && s.current_barista).length;
    const total = stations.filter(s => s.current_barista).length;
    return total > 0 ? Math.round((active / total) * 100) : 0;
  }, []);

  // Calculate current event metrics
  const eventMetrics = useMemo(() => {
    const now = new Date();
    const eventStart = new Date(now);
    eventStart.setHours(7, 0, 0, 0);
    
    const hoursElapsed = (now - eventStart) / (1000 * 60 * 60);
    const totalOrders = ordersData.completed.length + ordersData.inProgress.length + ordersData.pending.length;
    const ordersPerHour = hoursElapsed > 0 ? totalOrders / hoursElapsed : 0;
    
    // Phase-specific metrics
    const currentConfig = phaseConfigurations[currentPhase];
    const phaseEfficiency = calculatePhaseEfficiency(currentPhase, ordersData, stations);
    
    return {
      hoursElapsed: hoursElapsed.toFixed(1),
      totalOrders,
      ordersPerHour: ordersPerHour.toFixed(1),
      phaseEfficiency,
      activeStations: stations.filter(s => s.status === 'active').length,
      staffUtilization: calculateStaffUtilization(stations),
      recommendedActions: currentConfig?.recommendations || []
    };
  }, [ordersData, stations, currentPhase, calculatePhaseEfficiency, calculateStaffUtilization]);
  
  // Auto-detect phase based on time and metrics
  useEffect(() => {
    if (!automatedPhaseTransition) return;
    
    const detectPhase = () => {
      const now = new Date();
      const hour = now.getHours();
      const minute = now.getMinutes();
      const time = hour + minute / 60;
      
      let detectedPhase = EVENT_PHASES.SETUP;
      
      if (time >= 6 && time < 7) detectedPhase = EVENT_PHASES.SETUP;
      else if (time >= 7 && time < 8) detectedPhase = EVENT_PHASES.PRE_EVENT;
      else if (time >= 8 && time < 10.5) detectedPhase = EVENT_PHASES.MORNING_PEAK;
      else if (time >= 10.5 && time < 11.5) detectedPhase = EVENT_PHASES.MID_MORNING;
      else if (time >= 11.5 && time < 13) detectedPhase = EVENT_PHASES.LUNCH_BREAK;
      else if (time >= 13 && time < 14) detectedPhase = EVENT_PHASES.AFTERNOON;
      else if (time >= 14 && time < 15.5) detectedPhase = EVENT_PHASES.AFTERNOON_PEAK;
      else if (time >= 15.5 && time < 17) detectedPhase = EVENT_PHASES.WIND_DOWN;
      else detectedPhase = EVENT_PHASES.CLEANUP;
      
      // Check for overrides
      if (phaseOverrides[detectedPhase]) {
        detectedPhase = phaseOverrides[detectedPhase];
      }
      
      if (detectedPhase !== currentPhase) {
        handlePhaseTransition(detectedPhase);
      }
    };
    
    const interval = setInterval(detectPhase, 60000); // Check every minute
    detectPhase(); // Run immediately
    
    return () => clearInterval(interval);
  }, [automatedPhaseTransition, currentPhase, phaseOverrides]);
  
  // Handle phase transition
  const handlePhaseTransition = (newPhase) => {
    console.log(`Transitioning from ${currentPhase} to ${newPhase}`);
    
    // Log transition
    setPhaseHistory(prev => [...prev, {
      from: currentPhase,
      to: newPhase,
      timestamp: new Date(),
      automatic: automatedPhaseTransition
    }]);
    
    // Apply phase-specific configurations
    applyPhaseConfigurations(newPhase);
    
    setCurrentPhase(newPhase);
  };
  
  // Apply phase-specific configurations
  const applyPhaseConfigurations = (phase) => {
    const config = phaseConfigurations[phase];
    if (!config) return;
    
    // Update system settings based on phase
    const updates = {};
    
    if (config.optimizations?.batchProcessing !== undefined) {
      updates.batchProcessingEnabled = config.optimizations.batchProcessing;
    }
    
    if (config.menuRestrictions) {
      updates.menuRestrictions = config.menuRestrictions;
    }
    
    if (Object.keys(updates).length > 0) {
      updateSettings(updates);
    }
    
    // Update station configurations
    if (config.characteristics.stationConfig === 'preparation_mode') {
      stations.forEach(station => {
        updateStation(station.id, { status: 'preparing' });
      });
    } else if (config.characteristics.stationConfig === 'high_performance') {
      stations.forEach(station => {
        updateStation(station.id, { 
          status: 'active',
          high_performance_mode: true 
        });
      });
    }
  };
  
  // Get phase progress
  const getPhaseProgress = () => {
    const now = new Date();
    const config = phaseConfigurations[currentPhase];
    if (!config?.timeRange) return 0;
    
    const [start, end] = config.timeRange.split(' - ');
    const [startHour, startMin] = start.split(':').map(Number);
    const [endHour, endMin] = end.split(':').map(Number);
    
    const startTime = new Date(now);
    startTime.setHours(startHour, startMin, 0);
    
    const endTime = new Date(now);
    endTime.setHours(endHour, endMin, 0);
    
    const total = endTime - startTime;
    const elapsed = now - startTime;
    
    return Math.max(0, Math.min(100, (elapsed / total) * 100));
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900 flex items-center">
          <Calendar className="mr-2" size={24} />
          Event Lifecycle Management
        </h2>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={automatedPhaseTransition}
              onChange={(e) => setAutomatedPhaseTransition(e.target.checked)}
              className="h-4 w-4"
            />
            <span>Automated Transitions</span>
          </label>
          <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
            Configure Phases
          </button>
        </div>
      </div>

      {/* Current Phase Overview */}
      <div className="bg-white rounded-lg shadow-lg p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            {phaseConfigurations[currentPhase]?.icon}
            <div>
              <h3 className="text-xl font-bold">{phaseConfigurations[currentPhase]?.name}</h3>
              <p className="text-sm text-gray-500">{phaseConfigurations[currentPhase]?.timeRange}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-3xl font-bold text-blue-600">{eventMetrics.phaseEfficiency}%</div>
            <div className="text-sm text-gray-500">Phase Efficiency</div>
          </div>
        </div>
        
        {/* Phase Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>Phase Progress</span>
            <span>{getPhaseProgress().toFixed(0)}%</span>
          </div>
          <div className="bg-gray-200 h-3 rounded-full overflow-hidden">
            <div 
              className="bg-blue-500 h-full transition-all"
              style={{ width: `${getPhaseProgress()}%` }}
            />
          </div>
        </div>
        
        {/* Phase Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          <div>
            <div className="text-sm text-gray-500">Order Volume</div>
            <div className="font-semibold capitalize">
              {phaseConfigurations[currentPhase]?.characteristics.orderVolume.replace('_', ' ')}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Staff Required</div>
            <div className="font-semibold capitalize">
              {phaseConfigurations[currentPhase]?.characteristics.staffRequired.replace('_', ' ')}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Menu</div>
            <div className="font-semibold capitalize">
              {phaseConfigurations[currentPhase]?.characteristics.menuAvailability.replace('_', ' ')}
            </div>
          </div>
          <div>
            <div className="text-sm text-gray-500">Active Stations</div>
            <div className="font-semibold">{eventMetrics.activeStations} / {stations.length}</div>
          </div>
        </div>
        
        {/* Phase Recommendations */}
        <div className="border-t pt-4">
          <h4 className="font-medium mb-2">Recommended Actions</h4>
          <div className="space-y-2">
            {eventMetrics.recommendedActions.map((action, index) => (
              <div key={index} className="flex items-center space-x-2 text-sm">
                <CheckCircle className="text-green-500" size={16} />
                <span>{action}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Phase Timeline */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Event Timeline</h3>
        <div className="relative">
          <div className="absolute left-0 top-0 bottom-0 w-1 bg-gray-200"></div>
          {Object.entries(phaseConfigurations).map(([phase, config], index) => {
            const isActive = phase === currentPhase;
            const isPast = phaseHistory.some(h => h.from === phase);
            
            return (
              <div key={phase} className="relative pl-8 pb-6 last:pb-0">
                <div className={`absolute left-0 w-8 h-8 rounded-full flex items-center justify-center ${
                  isActive ? 'bg-blue-500' : isPast ? 'bg-green-500' : 'bg-gray-300'
                }`}>
                  {isActive ? (
                    <Activity className="text-white" size={16} />
                  ) : isPast ? (
                    <CheckCircle className="text-white" size={16} />
                  ) : (
                    <div className="w-3 h-3 bg-white rounded-full" />
                  )}
                </div>
                
                <div className={`${isActive ? 'bg-blue-50 -mx-4 px-4' : ''} rounded-lg py-2`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center space-x-2">
                        {config.icon}
                        <span className={`font-medium ${isActive ? 'text-blue-700' : ''}`}>
                          {config.name}
                        </span>
                      </div>
                      <div className="text-sm text-gray-500 mt-1">{config.timeRange}</div>
                    </div>
                    {!automatedPhaseTransition && !isActive && !isPast && (
                      <button
                        onClick={() => handlePhaseTransition(phase)}
                        className="text-sm bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
                      >
                        Activate
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Event Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <Coffee className="text-brown-500" size={20} />
            <span className="text-xs text-gray-500">Total</span>
          </div>
          <div className="text-3xl font-bold">{eventMetrics.totalOrders}</div>
          <div className="text-sm text-gray-500">Orders Processed</div>
          <div className="text-xs text-gray-400 mt-1">{eventMetrics.ordersPerHour}/hour avg</div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <Users className="text-blue-500" size={20} />
            <span className="text-xs text-gray-500">Current</span>
          </div>
          <div className="text-3xl font-bold">{eventMetrics.staffUtilization}%</div>
          <div className="text-sm text-gray-500">Staff Utilization</div>
          <div className="text-xs text-gray-400 mt-1">{eventMetrics.activeStations} stations active</div>
        </div>
        
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between mb-2">
            <Clock className="text-green-500" size={20} />
            <span className="text-xs text-gray-500">Elapsed</span>
          </div>
          <div className="text-3xl font-bold">{eventMetrics.hoursElapsed}h</div>
          <div className="text-sm text-gray-500">Event Duration</div>
          <div className="text-xs text-gray-400 mt-1">Since 7:00 AM</div>
        </div>
      </div>

      {/* Phase-Specific Controls */}
      {currentPhase === EVENT_PHASES.MORNING_PEAK && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
          <h4 className="font-medium text-yellow-800 mb-2">Peak Hour Optimizations Active</h4>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <label className="flex items-center space-x-2">
              <input type="checkbox" defaultChecked className="h-4 w-4" />
              <span>Batch Processing</span>
            </label>
            <label className="flex items-center space-x-2">
              <input type="checkbox" defaultChecked className="h-4 w-4" />
              <span>Priority Routing</span>
            </label>
            <label className="flex items-center space-x-2">
              <input type="checkbox" defaultChecked className="h-4 w-4" />
              <span>Dynamic Staffing</span>
            </label>
            <label className="flex items-center space-x-2">
              <input type="checkbox" defaultChecked className="h-4 w-4" />
              <span>Stock Preloading</span>
            </label>
          </div>
        </div>
      )}

      {/* Phase History */}
      <div className="bg-white rounded-lg shadow p-6">
        <h3 className="text-lg font-semibold mb-4">Phase Transition History</h3>
        <div className="space-y-2 max-h-48 overflow-y-auto">
          {phaseHistory.length > 0 ? (
            phaseHistory.map((transition, index) => (
              <div key={index} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                <div className="flex items-center space-x-3">
                  <span className="text-gray-400">
                    {new Date(transition.timestamp).toLocaleTimeString()}
                  </span>
                  <span className="text-gray-600">
                    {phaseConfigurations[transition.from]?.name} → {phaseConfigurations[transition.to]?.name}
                  </span>
                </div>
                <span className={`text-xs px-2 py-1 rounded ${
                  transition.automatic ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-700'
                }`}>
                  {transition.automatic ? 'Automatic' : 'Manual'}
                </span>
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-400">
              <Calendar size={32} className="mx-auto mb-2" />
              <p>No phase transitions yet</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EventLifecycleManagement;
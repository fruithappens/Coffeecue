import React, { useState, useEffect } from 'react';
import { 
  Users, Clock, Award, AlertCircle, Coffee, 
  TrendingUp, Calendar, Plus, Edit, UserCheck,
  BarChart, Activity, ChevronRight, MapPin, CheckCircle
} from 'lucide-react';

/**
 * Comprehensive Staff Management Dashboard
 * Complete staff oversight and optimization
 */
const StaffManagementPanel = () => {
  const [activeView, setActiveView] = useState('current'); // current, schedule, performance
  const [selectedStaff, setSelectedStaff] = useState(null);
  
  // Mock staff data
  const [staffData, setStaffData] = useState([
    {
      id: 1,
      name: 'John Davis',
      role: 'Senior Barista',
      station: 1,
      status: 'active',
      shift: { start: '08:00', end: '16:00' },
      onBreak: false,
      breakEnd: null,
      performance: {
        ordersToday: 47,
        avgTime: 4.2,
        rating: 4.8,
        errorRate: 0.02
      },
      skills: ['espresso', 'latte_art', 'speed_service'],
      certifications: ['Food Safety', 'Barista Level 2']
    },
    {
      id: 2,
      name: 'Sarah Martinez',
      role: 'Barista',
      station: 2,
      status: 'on_break',
      shift: { start: '09:00', end: '17:00' },
      onBreak: true,
      breakEnd: '12:30',
      performance: {
        ordersToday: 38,
        avgTime: 5.1,
        rating: 4.6,
        errorRate: 0.03
      },
      skills: ['espresso', 'customer_service'],
      certifications: ['Food Safety']
    },
    {
      id: 3,
      name: 'Mike Chen',
      role: 'Junior Barista',
      station: 3,
      status: 'active',
      shift: { start: '10:00', end: '18:00' },
      onBreak: false,
      breakEnd: null,
      performance: {
        ordersToday: 25,
        avgTime: 6.3,
        rating: 4.4,
        errorRate: 0.05
      },
      skills: ['basic_coffee'],
      certifications: ['Food Safety']
    },
    {
      id: 4,
      name: 'Emma Wilson',
      role: 'Barista',
      station: null,
      status: 'scheduled',
      shift: { start: '14:00', end: '22:00' },
      onBreak: false,
      breakEnd: null,
      performance: {
        ordersToday: 0,
        avgTime: 4.8,
        rating: 4.7,
        errorRate: 0.02
      },
      skills: ['espresso', 'speed_service'],
      certifications: ['Food Safety', 'Barista Level 1']
    }
  ]);
  
  // Calculate staff metrics
  const staffMetrics = {
    totalActive: staffData.filter(s => s.status === 'active').length,
    onBreak: staffData.filter(s => s.status === 'on_break').length,
    scheduled: staffData.filter(s => s.status === 'scheduled').length,
    avgPerformance: staffData.reduce((acc, s) => acc + s.performance.rating, 0) / staffData.length,
    totalOrders: staffData.reduce((acc, s) => acc + s.performance.ordersToday, 0)
  };
  
  // Get stress indicators for a staff member
  const getStressIndicator = (staff) => {
    if (staff.performance.errorRate > 0.05) return 'high';
    if (staff.performance.avgTime > 6) return 'medium';
    if (staff.performance.ordersToday > 60) return 'medium';
    return 'low';
  };
  
  // Suggest break time based on workload
  const suggestBreakTime = (staff) => {
    const now = new Date();
    const shiftStart = new Date();
    const [startHour, startMin] = staff.shift.start.split(':');
    shiftStart.setHours(parseInt(startHour), parseInt(startMin));
    
    const hoursWorked = (now - shiftStart) / (1000 * 60 * 60);
    
    if (hoursWorked > 4 && !staff.onBreak) {
      return 'Suggest break soon (4+ hours worked)';
    }
    if (staff.performance.ordersToday > 50) {
      return 'High order volume - schedule break';
    }
    return null;
  };
  
  return (
    <div className="space-y-6">
      {/* Header with Metrics */}
      <div className="bg-white rounded-lg shadow-sm p-6">
        <h2 className="text-xl font-semibold mb-4">Staff Overview</h2>
        
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="text-center">
            <p className="text-3xl font-bold text-green-600">{staffMetrics.totalActive}</p>
            <p className="text-sm text-gray-600">Active Now</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-amber-600">{staffMetrics.onBreak}</p>
            <p className="text-sm text-gray-600">On Break</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-blue-600">{staffMetrics.scheduled}</p>
            <p className="text-sm text-gray-600">Scheduled</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-purple-600">{staffMetrics.avgPerformance.toFixed(1)}</p>
            <p className="text-sm text-gray-600">Avg Rating</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-bold text-indigo-600">{staffMetrics.totalOrders}</p>
            <p className="text-sm text-gray-600">Orders Today</p>
          </div>
        </div>
      </div>
      
      {/* View Selector */}
      <div className="bg-white rounded-lg shadow-sm p-2 flex space-x-2">
        <button
          onClick={() => setActiveView('current')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeView === 'current' 
              ? 'bg-purple-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Activity className="w-4 h-4" />
          <span>Current Shift</span>
        </button>
        <button
          onClick={() => setActiveView('schedule')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeView === 'schedule' 
              ? 'bg-purple-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <Calendar className="w-4 h-4" />
          <span>Schedule</span>
        </button>
        <button
          onClick={() => setActiveView('performance')}
          className={`flex-1 py-2 px-4 rounded-md flex items-center justify-center space-x-2 ${
            activeView === 'performance' 
              ? 'bg-purple-500 text-white' 
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          <BarChart className="w-4 h-4" />
          <span>Performance</span>
        </button>
      </div>
      
      {/* Current Shift View */}
      {activeView === 'current' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">Current Shift Status</h3>
          
          <div className="space-y-4">
            {staffData.map(staff => {
              const stressLevel = getStressIndicator(staff);
              const breakSuggestion = suggestBreakTime(staff);
              
              return (
                <div 
                  key={staff.id}
                  className={`border rounded-lg p-4 cursor-pointer transition-all ${
                    selectedStaff?.id === staff.id ? 'border-purple-500 bg-purple-50' : ''
                  }`}
                  onClick={() => setSelectedStaff(staff)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-start space-x-4">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-bold ${
                        staff.status === 'active' ? 'bg-green-500' :
                        staff.status === 'on_break' ? 'bg-amber-500' :
                        'bg-gray-400'
                      }`}>
                        {staff.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      
                      <div>
                        <h4 className="font-semibold">{staff.name}</h4>
                        <p className="text-sm text-gray-600">{staff.role}</p>
                        <div className="flex items-center space-x-3 mt-1 text-sm">
                          {staff.station && (
                            <span className="flex items-center text-gray-500">
                              <MapPin className="w-3 h-3 mr-1" />
                              Station {staff.station}
                            </span>
                          )}
                          <span className="flex items-center text-gray-500">
                            <Clock className="w-3 h-3 mr-1" />
                            {staff.shift.start} - {staff.shift.end}
                          </span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="text-right">
                      <div className="flex items-center justify-end space-x-2 mb-2">
                        <span className={`px-2 py-1 text-xs rounded-full ${
                          staff.status === 'active' ? 'bg-green-100 text-green-800' :
                          staff.status === 'on_break' ? 'bg-amber-100 text-amber-800' :
                          'bg-gray-100 text-gray-800'
                        }`}>
                          {staff.status === 'on_break' ? `Break until ${staff.breakEnd}` : staff.status}
                        </span>
                        
                        {stressLevel !== 'low' && (
                          <span className={`px-2 py-1 text-xs rounded-full ${
                            stressLevel === 'high' ? 'bg-red-100 text-red-800' : 'bg-amber-100 text-amber-800'
                          }`}>
                            {stressLevel} stress
                          </span>
                        )}
                      </div>
                      
                      <div className="grid grid-cols-2 gap-x-4 text-sm">
                        <div>
                          <p className="text-gray-500">Orders</p>
                          <p className="font-semibold">{staff.performance.ordersToday}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Avg Time</p>
                          <p className="font-semibold">{staff.performance.avgTime}min</p>
                        </div>
                      </div>
                    </div>
                  </div>
                  
                  {breakSuggestion && (
                    <div className="mt-3 p-2 bg-amber-50 rounded flex items-center justify-between">
                      <div className="flex items-center space-x-2">
                        <AlertCircle className="w-4 h-4 text-amber-600" />
                        <span className="text-sm text-amber-800">{breakSuggestion}</span>
                      </div>
                      <button className="text-sm text-amber-600 hover:text-amber-700 font-medium">
                        Schedule Break
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          
          {/* Quick Actions */}
          <div className="mt-6 flex space-x-3">
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center space-x-2">
              <Plus className="w-4 h-4" />
              <span>Add Staff</span>
            </button>
            <button className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center space-x-2">
              <UserCheck className="w-4 h-4" />
              <span>Optimize Assignments</span>
            </button>
          </div>
        </div>
      )}
      
      {/* Schedule View */}
      {activeView === 'schedule' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">Staff Schedule</h3>
          
          {/* Weekly Calendar Grid */}
          <div className="overflow-x-auto">
            <div className="min-w-[800px]">
              <div className="grid grid-cols-8 gap-px bg-gray-200">
                <div className="bg-white p-2 font-medium text-sm">Staff</div>
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                  <div key={day} className="bg-white p-2 text-center font-medium text-sm">
                    {day}
                  </div>
                ))}
              </div>
              
              {staffData.map(staff => (
                <div key={staff.id} className="grid grid-cols-8 gap-px bg-gray-200 mt-px">
                  <div className="bg-white p-2 text-sm font-medium">{staff.name}</div>
                  {[1, 2, 3, 4, 5, 6, 7].map(day => (
                    <div key={day} className="bg-white p-2 text-center text-xs">
                      {day <= 5 ? (
                        <div className="bg-purple-100 text-purple-800 rounded px-1 py-1">
                          {staff.shift.start}-{staff.shift.end}
                        </div>
                      ) : (
                        <span className="text-gray-400">Off</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </div>
          
          <div className="mt-4 text-sm text-gray-600">
            <p>Drag and drop to adjust schedules. Click on a shift to edit details.</p>
          </div>
        </div>
      )}
      
      {/* Performance View */}
      {activeView === 'performance' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="text-lg font-semibold mb-4">Performance Metrics</h3>
          
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <th className="pb-3">Staff Member</th>
                  <th className="pb-3">Orders/Hour</th>
                  <th className="pb-3">Avg Time</th>
                  <th className="pb-3">Quality Rating</th>
                  <th className="pb-3">Error Rate</th>
                  <th className="pb-3">Skills</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {staffData.map(staff => {
                  const ordersPerHour = staff.performance.ordersToday / 8; // Assuming 8 hour shift
                  
                  return (
                    <tr key={staff.id}>
                      <td className="py-3">
                        <div>
                          <p className="font-medium">{staff.name}</p>
                          <p className="text-sm text-gray-500">{staff.role}</p>
                        </div>
                      </td>
                      <td className="py-3">
                        <div className="flex items-center">
                          <span className="font-medium">{ordersPerHour.toFixed(1)}</span>
                          {ordersPerHour > 6 && <TrendingUp className="w-4 h-4 ml-1 text-green-500" />}
                        </div>
                      </td>
                      <td className="py-3">{staff.performance.avgTime}min</td>
                      <td className="py-3">
                        <div className="flex items-center">
                          <Award className="w-4 h-4 mr-1 text-amber-500" />
                          <span>{staff.performance.rating}/5.0</span>
                        </div>
                      </td>
                      <td className="py-3">
                        <span className={`${
                          staff.performance.errorRate < 0.03 ? 'text-green-600' : 
                          staff.performance.errorRate < 0.05 ? 'text-amber-600' : 
                          'text-red-600'
                        }`}>
                          {(staff.performance.errorRate * 100).toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3">
                        <div className="flex flex-wrap gap-1">
                          {staff.skills.map(skill => (
                            <span key={skill} className="px-2 py-1 text-xs bg-blue-100 text-blue-800 rounded">
                              {skill.replace(/_/g, ' ')}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Staff Detail Panel */}
      {selectedStaff && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex justify-between items-start mb-4">
            <h3 className="text-lg font-semibold">Staff Details: {selectedStaff.name}</h3>
            <button 
              onClick={() => setSelectedStaff(null)}
              className="text-gray-400 hover:text-gray-600"
            >
              ×
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-medium mb-2">Certifications</h4>
              <div className="space-y-1">
                {selectedStaff.certifications.map(cert => (
                  <div key={cert} className="flex items-center space-x-2">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <span className="text-sm">{cert}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Today's Performance</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Total Orders:</span>
                  <span className="font-medium">{selectedStaff.performance.ordersToday}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Average Time:</span>
                  <span className="font-medium">{selectedStaff.performance.avgTime} minutes</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-600">Customer Rating:</span>
                  <span className="font-medium">{selectedStaff.performance.rating}/5.0</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffManagementPanel;
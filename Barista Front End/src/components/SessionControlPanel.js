import React, { useState, useEffect } from 'react';

const SessionControlPanel = ({ station, onSessionUpdate }) => {
  const [sessionMode, setSessionMode] = useState('active');
  const [delayMinutes, setDelayMinutes] = useState(10);
  const [startTime, setStartTime] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  
  // Format current time as HH:MM for default start time
  useEffect(() => {
    const now = new Date();
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setStartTime(`${hours}:${minutes}`);
    
    // Set initial values from station if available
    if (station) {
      setSessionMode(station.session_mode || 'active');
      setDelayMinutes(station.session_delay_minutes || 10);
    }
  }, [station]);
  
  const handleSubmit = async () => {
    if (!station) return;
    
    setIsSubmitting(true);
    try {
      const result = await onSessionUpdate(station.id, {
        mode: sessionMode,
        delay_minutes: delayMinutes,
        start_time: startTime
      });
      
      if (result) {
        console.log(`Station ${station.name || station.id} session updated to ${sessionMode} mode`);
      } else {
        console.error('Session update returned false');
      }
    } catch (error) {
      console.error('Failed to update session:', error);
    } finally {
      setIsSubmitting(false);
    }
  };
  
  if (!station) return null;
  
  return (
    <div className="bg-white rounded-lg shadow-md p-4 mb-4">
      <h2 className="text-xl font-bold mb-3">Session Controls</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Session Mode
          </label>
          <select 
            value={sessionMode}
            onChange={(e) => setSessionMode(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="active">Active (Accepting Orders)</option>
            <option value="paused">Paused (Delay New Orders)</option>
            <option value="pre-orders-only">Pre-Orders Only</option>
            <option value="closed">Closed (No New Orders)</option>
          </select>
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Delay Minutes
          </label>
          <input 
            type="number"
            min="0"
            max="120"
            value={delayMinutes}
            onChange={(e) => setDelayMinutes(parseInt(e.target.value))}
            className="w-full p-2 border rounded"
            disabled={sessionMode !== 'paused' && sessionMode !== 'pre-orders-only'}
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Session Start Time (HH:MM)
          </label>
          <input 
            type="time"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
            className="w-full p-2 border rounded"
          />
        </div>
        
        <div className="flex items-end">
          <button 
            className={`w-full p-2 rounded font-medium ${
              sessionMode === 'active' ? 'bg-green-500 text-white' : 
              sessionMode === 'paused' ? 'bg-amber-500 text-white' :
              sessionMode === 'pre-orders-only' ? 'bg-blue-500 text-white' :
              'bg-red-500 text-white'
            }`}
            onClick={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Updating...' : 'Update Session'}
          </button>
        </div>
      </div>
      
      {sessionMode === 'paused' && (
        <div className="bg-amber-100 p-3 rounded-lg border-l-4 border-amber-500">
          <p className="text-amber-800">
            <strong>Paused Mode:</strong> New orders will be accepted but delayed by {delayMinutes} minutes.
            Baristas should finish current orders first.
          </p>
        </div>
      )}
      
      {sessionMode === 'pre-orders-only' && (
        <div className="bg-blue-100 p-3 rounded-lg border-l-4 border-blue-500">
          <p className="text-blue-800">
            <strong>Pre-Orders Only:</strong> New orders will be queued for later preparation, {delayMinutes} minutes from now.
            Walk-in orders will still be taken but marked as delayed.
          </p>
        </div>
      )}
      
      {sessionMode === 'closed' && (
        <div className="bg-red-100 p-3 rounded-lg border-l-4 border-red-500">
          <p className="text-red-800">
            <strong>Closed:</strong> Station is fully closed and will not accept new orders.
            Existing orders still need to be completed.
          </p>
        </div>
      )}
      
      <div className="mt-4 flex justify-end">
        {sessionMode !== 'active' && (
          <button 
            className="px-4 py-2 bg-green-500 text-white rounded"
            onClick={() => {
              setSessionMode('active');
              setTimeout(handleSubmit, 100); // Submit after state update
            }}
          >
            Start Making Now
          </button>
        )}
      </div>
    </div>
  );
};

export default SessionControlPanel;
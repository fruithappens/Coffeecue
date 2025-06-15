// ScheduleTab.js
import React from 'react';
import { Calendar } from 'lucide-react';

// DismissibleInfoPanel component reused from StockTab
const DismissibleInfoPanel = ({ id, title, message, borderColor, bgColor, isDismissed, onDismiss, extraContent }) => {
  if (isDismissed) return null;
  
  return (
    <div className={`mb-4 rounded-lg shadow-md p-4 border-l-4 border-${borderColor}-500 bg-${bgColor}-50`}>
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold text-lg">{title}</h3>
          <p className="text-gray-700">{message}</p>
          {extraContent}
        </div>
        <button 
          className="text-gray-400 hover:text-gray-600" 
          onClick={() => onDismiss(id)}
          aria-label="Dismiss"
        >
          ✕
        </button>
      </div>
    </div>
  );
};

// Schedule item renderer component
const ScheduleItem = ({ item, type }) => {
  // Format display based on schedule item type
  let bgColor, icon, timeDisplay;
  
  switch(type) {
    case 'shift':
      bgColor = 'bg-green-100';
      timeDisplay = `${item.start || '9:00'} - ${item.end || '17:00'}`;
      break;
    case 'break':
      bgColor = 'bg-blue-100';
      timeDisplay = `${item.start || '12:00'} - ${item.end || '13:00'}`;
      break;
    case 'rush':
      bgColor = 'bg-amber-100';
      timeDisplay = `${item.start || '8:00'} - ${item.end || '10:00'}`;
      break;
    default:
      bgColor = 'bg-gray-100';
      timeDisplay = 'Time not specified';
  }
  
  return (
    <div className={`${bgColor} rounded-lg p-3 flex justify-between items-center`}>
      <div>
        <div className="font-medium">
          {type === 'shift' ? item.barista || 'Barista' : 
           type === 'break' ? 'Break Time' : 
           type === 'rush' ? 'Rush Period' : 'Schedule Item'}
        </div>
        <div className="text-sm text-gray-600">{timeDisplay}</div>
      </div>
      <div>
        {type === 'shift' && (
          <span className={`inline-block px-2 py-1 rounded-full text-xs
            ${item.status === 'active' ? 'bg-green-500 text-white' : 
              item.status === 'pending' ? 'bg-amber-500 text-white' : 
              'bg-gray-500 text-white'}`}>
            {item.status || 'Unknown'}
          </span>
        )}
        {type === 'rush' && (
          <span className="inline-block px-2 py-1 rounded-full text-xs bg-red-500 text-white">
            Expected: {item.expectedVolume || 'High'} volume
          </span>
        )}
      </div>
    </div>
  );
};

const ScheduleTab = ({
  dismissedPanels,
  dismissPanel,
  scheduleLoading,
  scheduleData = { shifts: [], breaks: [], rushPeriods: [] },
  scheduleError
}) => {
  return (
    <div className="p-4">
      {/* API Not Implemented Notification */}
      <DismissibleInfoPanel
        id="scheduleInfoPanel"
        title="Schedule API Not Implemented"
        message="The schedule backend API has not been implemented yet. This section will show real data once the backend API is connected."
        borderColor="amber"
        bgColor="amber"
        isDismissed={dismissedPanels.scheduleInfoPanel}
        onDismiss={dismissPanel}
      />
    
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-xl font-bold mb-4">Today's Schedule</h2>
          <div className="space-y-2">
            {scheduleLoading ? (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                <p className="mt-2 text-gray-500">Loading schedule data...</p>
              </div>
            ) : scheduleData.shifts && scheduleData.shifts.length > 0 ? (
              scheduleData.shifts.map(item => {
                // Format the schedule item for display
                const formattedItem = {
                  id: item.id,
                  start: item.start_time || '9:00',
                  end: item.end_time || '17:00',
                  status: item.status || 'active',
                  barista: item.staff_name || 'Barista'
                };
                return <ScheduleItem key={item.id} item={formattedItem} type="shift" />;
              })
            ) : (
              <div className="text-center py-6 text-gray-500">
                <p>No schedule data available for this station</p>
                <p className="text-sm text-gray-400">Create schedules in the Organiser interface</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-4">
          <h2 className="text-xl font-bold mb-4">Breaks</h2>
          <div className="space-y-2">
            {scheduleLoading ? (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                <p className="mt-2 text-gray-500">Loading break data...</p>
              </div>
            ) : scheduleData.breaks && scheduleData.breaks.length > 0 ? (
              scheduleData.breaks.map(item => <ScheduleItem key={item.id} item={item} type="break" />)
            ) : (
              <div className="text-center py-6 text-gray-500">
                <p>No break data available</p>
                <p className="text-sm text-gray-400">Break scheduling will be added soon</p>
              </div>
            )}
          </div>
        </div>
        
        <div className="bg-white rounded-lg shadow-md p-4 md:col-span-2">
          <h2 className="text-xl font-bold mb-4">Predicted Rush Periods</h2>
          <div className="space-y-2">
            {scheduleLoading ? (
              <div className="text-center py-6">
                <div className="animate-spin rounded-full h-6 w-6 border-t-2 border-b-2 border-amber-600 mx-auto"></div>
                <p className="mt-2 text-gray-500">Loading rush period data...</p>
              </div>
            ) : scheduleData.rushPeriods && scheduleData.rushPeriods.length > 0 ? (
              scheduleData.rushPeriods.map(item => <ScheduleItem key={item.id} item={item} type="rush" />)
            ) : (
              <div className="text-center py-6 text-gray-500">
                <p>No rush period data available</p>
                <p className="text-sm text-gray-400">Rush period analytics will be added soon</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ScheduleTab;
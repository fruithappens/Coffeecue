// components/dialogs/WaitTimeDialog.js
import React, { useState } from 'react';
import { XCircle } from 'lucide-react';

const WaitTimeDialog = ({ currentWaitTime, onSubmit, onClose }) => {
  const [waitTime, setWaitTime] = useState(currentWaitTime);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSubmit(waitTime);
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Adjust Wait Time</h3>
          <button 
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            <XCircle size={20} />
          </button>
        </div>
        
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Current Wait Time: {currentWaitTime} minutes
            </label>
            <input 
              type="number" 
              min="1" 
              max="60"
              value={waitTime}
              onChange={(e) => setWaitTime(parseInt(e.target.value))}
              className="w-full p-2 border rounded"
              required
            />
          </div>
          
          <div className="flex justify-end space-x-2">
            <button 
              type="button"
              className="px-4 py-2 bg-gray-300 rounded hover:bg-gray-400"
              onClick={onClose}
            >
              Cancel
            </button>
            <button 
              type="submit"
              className="px-4 py-2 bg-amber-600 text-white rounded hover:bg-amber-700"
            >
              Update
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default WaitTimeDialog;

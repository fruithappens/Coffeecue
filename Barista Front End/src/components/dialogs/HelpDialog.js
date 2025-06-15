// components/dialogs/HelpDialog.js
import React, { useState } from 'react';
import { XCircle } from 'lucide-react';

const HelpDialog = ({ onClose }) => {
  const [helpType, setHelpType] = useState('supply');
  const [helpMessage, setHelpMessage] = useState('');
  
  const handleSendHelp = (urgency) => {
    // In a real application, this would call an API to send a help request
    console.log('Sending help request:', {
      type: helpType,
      message: helpMessage,
      urgency
    });
    
    alert(`Your ${urgency} urgency help request has been sent.`);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-gray-800 bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-lg p-6 max-w-md w-full">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-bold">Request Help</h3>
          <button 
            className="text-gray-500 hover:text-gray-700"
            onClick={onClose}
          >
            <XCircle size={20} />
          </button>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Help Type
          </label>
          <select 
            value={helpType}
            onChange={(e) => setHelpType(e.target.value)}
            className="w-full p-2 border rounded"
          >
            <option value="supply">Supply Shortage</option>
            <option value="equipment">Equipment Problem</option>
            <option value="staff">Need Additional Staff</option>
            <option value="customer">Customer Issue</option>
            <option value="other">Other</option>
          </select>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Details
          </label>
          <textarea 
            value={helpMessage}
            onChange={(e) => setHelpMessage(e.target.value)}
            className="w-full p-2 border rounded"
            rows="4"
            placeholder="Provide details about the issue..."
          ></textarea>
        </div>
        
        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Urgency
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button 
              className="py-2 bg-green-100 text-green-700 rounded hover:bg-green-200"
              onClick={() => handleSendHelp('low')}
            >
              Low
            </button>
            <button 
              className="py-2 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200"
              onClick={() => handleSendHelp('medium')}
            >
              Medium
            </button>
            <button 
              className="py-2 bg-red-100 text-red-700 rounded hover:bg-red-200"
              onClick={() => handleSendHelp('high')}
            >
              High
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default HelpDialog;

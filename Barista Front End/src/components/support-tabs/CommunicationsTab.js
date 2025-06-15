import React, { useState } from 'react';
import { 
  MessageSquare, Phone, Send, AlertTriangle, 
  CheckCircle, Settings, DollarSign, TestTube,
  FileText, Users, Search, Filter
} from 'lucide-react';

const CommunicationsTab = () => {
  const [activeSection, setActiveSection] = useState('overview');
  const [twilioConfig, setTwilioConfig] = useState({
    phoneNumber: '+61 XXX XXX XXX',
    accountSid: 'AC***hidden***',
    authToken: '***hidden***',
    messagingServiceSid: 'MG***hidden***',
    balance: 123.45,
    monthlyMessages: 45231,
    status: 'active'
  });
  
  const [testSmsForm, setTestSmsForm] = useState({
    to: '',
    message: 'Test message from Expresso Support'
  });
  
  const [messageTemplates, setMessageTemplates] = useState([
    { id: 1, name: 'Welcome Message', content: 'Welcome to {event_name}! ☕\nWhat\'s your first name?' },
    { id: 2, name: 'Order Confirmation', content: '✅ Order #{order_number} confirmed!\nWe\'re finding the shortest queue for you.' },
    { id: 3, name: 'Order Ready', content: '☕ Your order #{order_number} is ready!\nPickup at Station {station_id}' },
    { id: 4, name: 'System Maintenance', content: '🔧 System maintenance in progress. Orders temporarily paused. Back soon!' }
  ]);
  
  const [recentSms, setRecentSms] = useState([
    { id: 1, phone: '+61 4XX XXX 123', message: 'Large oat latte', direction: 'in', time: '2 min ago', status: 'processed' },
    { id: 2, phone: '+61 4XX XXX 456', message: '✅ Order #A123 confirmed!', direction: 'out', time: '3 min ago', status: 'delivered' },
    { id: 3, phone: '+61 4XX XXX 789', message: 'STATUS', direction: 'in', time: '5 min ago', status: 'processed' },
    { id: 4, phone: '+61 4XX XXX 789', message: 'Your order is being prepared...', direction: 'out', time: '5 min ago', status: 'delivered' }
  ]);
  
  const handleTestSms = () => {
    console.log('Sending test SMS:', testSmsForm);
    // API call to send test SMS
  };
  
  const handleUpdateTwilioConfig = () => {
    console.log('Updating Twilio config...');
    // API call to update config
  };
  
  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Communications Center</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveSection('overview')}
            className={`px-4 py-2 rounded-lg ${activeSection === 'overview' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveSection('twilio')}
            className={`px-4 py-2 rounded-lg ${activeSection === 'twilio' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Twilio Config
          </button>
          <button
            onClick={() => setActiveSection('templates')}
            className={`px-4 py-2 rounded-lg ${activeSection === 'templates' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Templates
          </button>
          <button
            onClick={() => setActiveSection('history')}
            className={`px-4 py-2 rounded-lg ${activeSection === 'history' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            History
          </button>
        </div>
      </div>
      
      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              icon={<MessageSquare className="w-6 h-6 text-blue-600" />}
              label="Messages Today"
              value="3,421"
            />
            <StatCard
              icon={<CheckCircle className="w-6 h-6 text-green-600" />}
              label="Delivery Rate"
              value="99.2%"
            />
            <StatCard
              icon={<DollarSign className="w-6 h-6 text-yellow-600" />}
              label="Balance"
              value={`$${twilioConfig.balance}`}
            />
            <StatCard
              icon={<AlertTriangle className="w-6 h-6 text-red-600" />}
              label="Failed"
              value="12"
            />
          </div>
          
          {/* Test SMS */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold text-lg mb-4 flex items-center">
              <TestTube className="w-5 h-5 mr-2" />
              Send Test SMS
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <input
                type="tel"
                placeholder="Phone number"
                value={testSmsForm.to}
                onChange={(e) => setTestSmsForm({ ...testSmsForm, to: e.target.value })}
                className="px-4 py-2 border rounded-lg"
              />
              <input
                type="text"
                placeholder="Message"
                value={testSmsForm.message}
                onChange={(e) => setTestSmsForm({ ...testSmsForm, message: e.target.value })}
                className="px-4 py-2 border rounded-lg"
              />
            </div>
            <button
              onClick={handleTestSms}
              className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
            >
              <Send className="w-4 h-4 mr-2" />
              Send Test Message
            </button>
          </div>
          
          {/* Recent Activity */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h3 className="font-semibold text-lg mb-4">Recent SMS Activity</h3>
            <div className="space-y-2">
              {recentSms.map(sms => (
                <SmsRow key={sms.id} sms={sms} />
              ))}
            </div>
          </div>
        </div>
      )}
      
      {/* Twilio Configuration */}
      {activeSection === 'twilio' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-semibold text-lg mb-6 flex items-center">
            <Settings className="w-5 h-5 mr-2" />
            Twilio Configuration
          </h3>
          
          <div className="space-y-4">
            <ConfigField
              label="Phone Number"
              value={twilioConfig.phoneNumber}
              editable={false}
            />
            <ConfigField
              label="Account SID"
              value={twilioConfig.accountSid}
              sensitive={true}
            />
            <ConfigField
              label="Auth Token"
              value={twilioConfig.authToken}
              sensitive={true}
            />
            <ConfigField
              label="Messaging Service SID"
              value={twilioConfig.messagingServiceSid}
              sensitive={true}
            />
            
            <div className="pt-4 border-t">
              <button
                onClick={handleUpdateTwilioConfig}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                Update Configuration
              </button>
              <button className="ml-2 px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                Test Connection
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Message Templates */}
      {activeSection === 'templates' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg flex items-center">
              <FileText className="w-5 h-5 mr-2" />
              Message Templates
            </h3>
            <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors">
              Add Template
            </button>
          </div>
          
          <div className="space-y-4">
            {messageTemplates.map(template => (
              <TemplateCard key={template.id} template={template} />
            ))}
          </div>
        </div>
      )}
      
      {/* SMS History */}
      {activeSection === 'history' && (
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-semibold text-lg">SMS History</h3>
            <div className="flex space-x-2">
              <button className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <Search className="w-5 h-5" />
              </button>
              <button className="p-2 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors">
                <Filter className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b">
                <tr>
                  <th className="text-left py-2">Time</th>
                  <th className="text-left py-2">Phone</th>
                  <th className="text-left py-2">Message</th>
                  <th className="text-left py-2">Direction</th>
                  <th className="text-left py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {recentSms.map(sms => (
                  <tr key={sms.id} className="border-b hover:bg-gray-50">
                    <td className="py-2">{sms.time}</td>
                    <td className="py-2">{sms.phone}</td>
                    <td className="py-2">{sms.message}</td>
                    <td className="py-2">
                      {sms.direction === 'in' ? (
                        <span className="text-blue-600">Inbound</span>
                      ) : (
                        <span className="text-green-600">Outbound</span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-1 rounded-full text-xs ${
                        sms.status === 'delivered' ? 'bg-green-100 text-green-800' :
                        sms.status === 'processed' ? 'bg-blue-100 text-blue-800' :
                        'bg-red-100 text-red-800'
                      }`}>
                        {sms.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

const StatCard = ({ icon, label, value }) => (
  <div className="bg-white rounded-lg shadow-sm p-4">
    <div className="flex items-center justify-between mb-2">
      {icon}
      <span className="text-2xl font-bold">{value}</span>
    </div>
    <div className="text-sm text-gray-600">{label}</div>
  </div>
);

const ConfigField = ({ label, value, sensitive, editable = true }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
    <input
      type={sensitive ? "password" : "text"}
      value={value}
      readOnly={!editable}
      className="w-full px-4 py-2 border rounded-lg bg-gray-50"
    />
  </div>
);

const SmsRow = ({ sms }) => (
  <div className="flex items-center justify-between p-3 hover:bg-gray-50 rounded">
    <div className="flex items-center space-x-3">
      {sms.direction === 'in' ? (
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
          <MessageSquare className="w-4 h-4 text-blue-600" />
        </div>
      ) : (
        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
          <Send className="w-4 h-4 text-green-600" />
        </div>
      )}
      <div>
        <p className="font-medium">{sms.phone}</p>
        <p className="text-sm text-gray-600">{sms.message}</p>
      </div>
    </div>
    <div className="text-right">
      <p className="text-sm text-gray-500">{sms.time}</p>
      <p className="text-xs text-gray-400">{sms.status}</p>
    </div>
  </div>
);

const TemplateCard = ({ template }) => (
  <div className="border rounded-lg p-4 hover:bg-gray-50">
    <div className="flex items-center justify-between mb-2">
      <h4 className="font-medium">{template.name}</h4>
      <div className="flex space-x-2">
        <button className="text-blue-600 hover:text-blue-800">Edit</button>
        <button className="text-red-600 hover:text-red-800">Delete</button>
      </div>
    </div>
    <p className="text-sm text-gray-600 whitespace-pre-wrap">{template.content}</p>
  </div>
);

export default CommunicationsTab;
import React, { useState } from 'react';
import {
  MessageSquare, Phone, Send, AlertTriangle,
  CheckCircle, Settings, DollarSign, TestTube,
  FileText, Users, Search, Filter, Megaphone
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';

// Broadcast cap kept in sync with the backend
// (BROADCAST_MAX_RECIPIENTS in routes/support_api_routes.py).
const BROADCAST_MAX_RECIPIENTS = 500;
const BROADCAST_MAX_LEN = 480;

const CommunicationsTab = () => {
  // Default to 'broadcast' — overview/twilio/templates/history were
  // hardcoded mock content, hidden until backed by real endpoints.
  const [activeSection, setActiveSection] = useState('broadcast');
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

  // --- Broadcast SMS form state -------------------------------------------
  const [broadcast, setBroadcast] = useState({
    audience: 'today',
    message: '',
  });
  const [broadcastBusy, setBroadcastBusy] = useState(false);
  const [broadcastPreview, setBroadcastPreview] = useState(null);
  const [broadcastResult, setBroadcastResult] = useState(null);

  const broadcastRequest = async (method, path, body) => {
    const api = new ApiServiceClass();
    return api.request(path, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  };

  const handleBroadcastPreview = async () => {
    setBroadcastBusy(true);
    setBroadcastResult(null);
    try {
      const resp = await broadcastRequest(
        'GET',
        `/support/broadcast/preview?audience=${encodeURIComponent(broadcast.audience)}`,
      );
      setBroadcastPreview(resp);
    } catch (e) {
      setBroadcastResult({ error: e.message || String(e) });
    } finally {
      setBroadcastBusy(false);
    }
  };

  const handleBroadcastSend = async () => {
    if (!broadcast.message.trim()) return;
    // Always confirm before sending — this hits real customers.
    const ok = window.confirm(
      `Send this message to ${broadcastPreview?.recipient_count ?? 'everyone matching the audience'}?\n\n` +
      `"${broadcast.message.trim()}"\n\nThis cannot be undone.`,
    );
    if (!ok) return;
    setBroadcastBusy(true);
    setBroadcastResult(null);
    try {
      const resp = await broadcastRequest(
        'POST',
        '/support/broadcast/customers',
        { audience: broadcast.audience, message: broadcast.message.trim() },
      );
      setBroadcastResult(resp);
    } catch (e) {
      setBroadcastResult({ error: e.message || String(e) });
    } finally {
      setBroadcastBusy(false);
    }
  };
  
  return (
    // Gutter comes from the Support shell's <main className="p-6">.
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold">Communications Center</h2>
        <div className="flex space-x-2">
          <button
            onClick={() => setActiveSection('broadcast')}
            className={`px-4 py-2 rounded-lg ${activeSection === 'broadcast' ? 'bg-blue-600 text-white' : 'bg-gray-100'}`}
          >
            Broadcast
          </button>
          {/* The Overview / Twilio Config / Templates / History
              sub-tabs were hardcoded mock content with no backend
              behind them ($123.45 Twilio balance was a literal
              constant in the file). Hidden until the corresponding
              backends are real. Broadcast is the only working
              section — kept visible. */}
        </div>
      </div>
      
      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="space-y-6">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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

      {/* Broadcast SMS */}
      {activeSection === 'broadcast' && (
        <div className="bg-white rounded-lg shadow-sm p-6 max-w-3xl">
          <h3 className="font-semibold text-lg mb-2 flex items-center">
            <Megaphone className="w-5 h-5 mr-2" />
            Broadcast SMS
          </h3>
          <p className="text-sm text-gray-600 mb-6">
            Send a one-off message to a group of customers. Useful for "coffee break in 10 minutes",
            schedule changes, or end-of-event thank-yous. Capped at {BROADCAST_MAX_RECIPIENTS} recipients
            per send.
          </p>

          <label className="block text-sm font-medium mb-1">Audience</label>
          <select
            value={broadcast.audience}
            onChange={(e) => {
              setBroadcast({ ...broadcast, audience: e.target.value });
              setBroadcastPreview(null);
              setBroadcastResult(null);
            }}
            className="w-full px-4 py-2 border rounded-lg mb-4"
            disabled={broadcastBusy}
          >
            <option value="today">Everyone who ordered today</option>
            <option value="active_today">Today's customers with an open order</option>
            <option value="in_progress">Currently being made (in-progress only)</option>
          </select>

          <label className="block text-sm font-medium mb-1">Message</label>
          <textarea
            value={broadcast.message}
            onChange={(e) => setBroadcast({ ...broadcast, message: e.target.value })}
            placeholder="Coffee break starts in 10 minutes — see you at the station!"
            rows={4}
            maxLength={BROADCAST_MAX_LEN}
            className="w-full px-4 py-2 border rounded-lg mb-1"
            disabled={broadcastBusy}
          />
          <p className="text-xs text-gray-500 mb-4">
            {broadcast.message.length} / {BROADCAST_MAX_LEN} characters
            {broadcast.message.length > 160 && (
              <span className="ml-2 text-yellow-700">
                (over 160 chars — Twilio will bill as multiple segments)
              </span>
            )}
          </p>

          <div className="flex space-x-2">
            <button
              onClick={handleBroadcastPreview}
              disabled={broadcastBusy}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 rounded-lg disabled:opacity-50"
            >
              Preview recipients
            </button>
            <button
              onClick={handleBroadcastSend}
              disabled={broadcastBusy || !broadcast.message.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center"
            >
              <Send className="w-4 h-4 mr-2" />
              Send broadcast
            </button>
          </div>

          {broadcastPreview && (
            <div className="mt-4 p-4 border-l-4 border-blue-500 bg-blue-50 rounded">
              <p className="text-sm">
                <strong>{broadcastPreview.recipient_count}</strong> recipient
                {broadcastPreview.recipient_count === 1 ? '' : 's'} match the
                <code className="mx-1 px-1 bg-white rounded text-xs">{broadcastPreview.audience}</code>
                audience.
                {broadcastPreview.recipient_count > BROADCAST_MAX_RECIPIENTS && (
                  <span className="block text-yellow-800 mt-1">
                    ⚠ Will be capped at {BROADCAST_MAX_RECIPIENTS} on send.
                  </span>
                )}
              </p>
              {broadcastPreview.sample && broadcastPreview.sample.length > 0 && (
                <p className="text-xs text-gray-600 mt-2">
                  Sample numbers: {broadcastPreview.sample.join(', ')}
                </p>
              )}
            </div>
          )}

          {broadcastResult && broadcastResult.error && (
            <div className="mt-4 p-4 border-l-4 border-red-500 bg-red-50 rounded">
              <p className="text-sm text-red-700">
                <strong>Broadcast failed:</strong> {broadcastResult.error}
              </p>
            </div>
          )}

          {broadcastResult && !broadcastResult.error && broadcastResult.sent !== undefined && (
            <div className="mt-4 p-4 border-l-4 border-green-500 bg-green-50 rounded">
              <p className="text-sm text-green-800">
                <strong>Sent {broadcastResult.sent}</strong>
                {broadcastResult.failed > 0 && (
                  <span> · {broadcastResult.failed} failed</span>
                )}
                {broadcastResult.capped && (
                  <span> · capped at {BROADCAST_MAX_RECIPIENTS}</span>
                )}
              </p>
              {broadcastResult.sample_failures && broadcastResult.sample_failures.length > 0 && (
                <p className="text-xs text-red-700 mt-1">
                  Sample failures: {broadcastResult.sample_failures.join(', ')}
                </p>
              )}
            </div>
          )}
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
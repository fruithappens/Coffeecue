import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Textarea } from '../ui/textarea';
import { 
  Activity, 
  Terminal, 
  Database,
  Wifi,
  Server,
  HardDrive,
  Clock,
  AlertTriangle,
  CheckCircle,
  XCircle,
  Download,
  RefreshCw,
  Play,
  FileText,
  Bug,
  MessageSquare
} from 'lucide-react';
import ApiServiceClass from '../../services/ApiService';
import ClientCrashesPanel from './ClientCrashesPanel';

// Create an instance of ApiService
const ApiService = new ApiServiceClass();

const DiagnosticsTab = () => {
  const [diagnostics, setDiagnostics] = useState({
    api: { status: 'checking', message: '' },
    database: { status: 'checking', message: '' },
    websocket: { status: 'checking', message: '' },
    sms: { status: 'checking', message: '' },
    storage: { status: 'checking', message: '' },
    network: { status: 'checking', message: '' }
  });
  
  const [logs, setLogs] = useState([]);
  const [performanceMetrics, setPerformanceMetrics] = useState({
    apiResponseTime: 0,
    dbQueryTime: 0,
    memoryUsage: 0,
    cpuUsage: 0
  });
  
  const [testResults, setTestResults] = useState([]);
  const [runningTest, setRunningTest] = useState(false);
  const [selectedTest, setSelectedTest] = useState('all');

  useEffect(() => {
    runDiagnostics();
    loadSystemLogs();
    const interval = setInterval(() => {
      updatePerformanceMetrics();
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  const runDiagnostics = async () => {
    // API Health Check
    try {
      const start = Date.now();
      await ApiService.get('/health');
      const responseTime = Date.now() - start;
      setDiagnostics(prev => ({
        ...prev,
        api: { 
          status: responseTime < 1000 ? 'healthy' : 'warning', 
          message: `Response time: ${responseTime}ms` 
        }
      }));
    } catch (error) {
      setDiagnostics(prev => ({
        ...prev,
        api: { status: 'error', message: error.message }
      }));
    }

    // Database Check
    try {
      const dbCheck = await ApiService.get('/diagnostics/database');
      setDiagnostics(prev => ({
        ...prev,
        database: { 
          status: dbCheck?.status || 'error', 
          message: dbCheck?.message || 'Unknown status'
        }
      }));
    } catch (error) {
      setDiagnostics(prev => ({
        ...prev,
        database: { status: 'error', message: 'Database unreachable' }
      }));
    }

    // WebSocket Check
    try {
      // For now, just check if WebSocket is available
      if (typeof WebSocket !== 'undefined') {
        setDiagnostics(prev => ({
          ...prev,
          websocket: { status: 'warning', message: 'WebSocket available but not tested' }
        }));
      } else {
        setDiagnostics(prev => ({
          ...prev,
          websocket: { status: 'error', message: 'WebSocket not supported' }
        }));
      }
    } catch (error) {
      setDiagnostics(prev => ({
        ...prev,
        websocket: { status: 'error', message: error.message }
      }));
    }

    // SMS Service Check
    try {
      const smsCheck = await ApiService.get('/diagnostics/sms');
      setDiagnostics(prev => ({
        ...prev,
        sms: { 
          status: smsCheck?.status || 'error', 
          message: smsCheck?.message || 'SMS status unknown'
        }
      }));
    } catch (error) {
      setDiagnostics(prev => ({
        ...prev,
        sms: { status: 'warning', message: 'SMS service check failed' }
      }));
    }

    // Storage Check
    const storageUsed = JSON.stringify(localStorage).length;
    const storageStatus = storageUsed < 4000000 ? 'healthy' : 'warning';
    setDiagnostics(prev => ({
      ...prev,
      storage: { 
        status: storageStatus, 
        message: `Using ${(storageUsed / 1024).toFixed(2)} KB` 
      }
    }));

    // Network Check
    setDiagnostics(prev => ({
      ...prev,
      network: { 
        status: navigator.onLine ? 'healthy' : 'error', 
        message: navigator.onLine ? 'Online' : 'Offline' 
      }
    }));
  };

  const loadSystemLogs = async () => {
    try {
      const response = await ApiService.get('/diagnostics/logs?limit=50');
      // The response IS the data array directly
      setLogs(Array.isArray(response) ? response : []);
    } catch (error) {
      console.error('Error loading logs:', error);
      setLogs([]);
    }
  };

  const updatePerformanceMetrics = async () => {
    try {
      const metrics = await ApiService.get('/diagnostics/performance');
      // The response IS the metrics object directly
      setPerformanceMetrics(metrics || {
        apiResponseTime: 0,
        dbQueryTime: 0,
        memoryUsage: 0,
        cpuUsage: 0
      });
    } catch (error) {
      console.error('Error loading performance metrics:', error);
    }
  };

  const runSystemTest = async (testType) => {
    setRunningTest(true);
    setTestResults([]);
    
    try {
      const response = await ApiService.post('/diagnostics/test', { 
        type: testType 
      });
      // The response should have a results property directly
      setTestResults(response?.results || []);
    } catch (error) {
      setTestResults([{
        test: 'Error',
        status: 'failed',
        message: error.message
      }]);
    } finally {
      setRunningTest(false);
    }
  };

  const downloadLogs = () => {
    const logContent = logs.map(log => 
      `[${log?.timestamp || 'Unknown'}] ${log?.level || 'INFO'}: ${log?.message || 'No message'}`
    ).join('\n');
    
    const blob = new Blob([logContent], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `system_logs_${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'healthy':
      case 'passed':
        return <CheckCircle className="h-5 w-5 text-cq-ready" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-cq-warn" />;
      case 'error':
      case 'failed':
        return <XCircle className="h-5 w-5 text-cq-alert" />;
      default:
        return <Clock className="h-5 w-5 text-cq-ink-3 animate-spin" />;
    }
  };

  const getStatusBadge = (status) => {
    const variants = {
      healthy: 'success',
      warning: 'warning',
      error: 'destructive',
      checking: 'secondary',
      passed: 'success',
      failed: 'destructive'
    };
    return variants[status] || 'secondary';
  };

  return (
    <div className="space-y-6">
      {/* Frontend crashes captured by ErrorBoundary. Lives at the top
          because it's the most actionable "is anything broken right
          now?" signal — colour-coded, refreshes every 30s. */}
      <ClientCrashesPanel />

      {/* System Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              System Status
            </span>
            <Button 
              variant="outline" 
              size="sm"
              onClick={runDiagnostics}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Refresh
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Object.entries(diagnostics).map(([service, info]) => (
              <div key={service} className="border-2 border-cq-line rounded-cq-md bg-cq-milk-cq-md p-4">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {service === 'api' && <Server className="h-4 w-4" />}
                    {service === 'database' && <Database className="h-4 w-4" />}
                    {service === 'websocket' && <Wifi className="h-4 w-4" />}
                    {service === 'sms' && <MessageSquare className="h-4 w-4" />}
                    {service === 'storage' && <HardDrive className="h-4 w-4" />}
                    {service === 'network' && <Wifi className="h-4 w-4" />}
                    <span className="font-medium capitalize">{service}</span>
                  </div>
                  {getStatusIcon(info.status)}
                </div>
                <Badge variant={getStatusBadge(info.status)} className="mb-2">
                  {info.status}
                </Badge>
                <p className="text-sm text-cq-ink-2">{info.message}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Performance Metrics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Performance Metrics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center">
              <p className="text-2xl font-bold">{performanceMetrics.apiResponseTime}ms</p>
              <p className="text-sm text-cq-ink-2">API Response</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{performanceMetrics.dbQueryTime}ms</p>
              <p className="text-sm text-cq-ink-2">DB Query</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{performanceMetrics.memoryUsage}%</p>
              <p className="text-sm text-cq-ink-2">Memory Usage</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold">{performanceMetrics.cpuUsage}%</p>
              <p className="text-sm text-cq-ink-2">CPU Usage</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* System Tests */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bug className="h-5 w-5" />
            System Tests
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex gap-2">
              <select
                value={selectedTest}
                onChange={(e) => setSelectedTest(e.target.value)}
                className="px-3 py-2 border-2 border-cq-line rounded-cq-md bg-cq-milk-md"
                disabled={runningTest}
              >
                <option value="all">All Tests</option>
                <option value="api">API Tests</option>
                <option value="database">Database Tests</option>
                <option value="authentication">Auth Tests</option>
                <option value="orders">Order Flow Tests</option>
                <option value="stations">Station Tests</option>
              </select>
              <Button
                onClick={() => runSystemTest(selectedTest)}
                disabled={runningTest}
              >
                <Play className="h-4 w-4 mr-2" />
                {runningTest ? 'Running...' : 'Run Tests'}
              </Button>
            </div>

            {testResults.length > 0 && (
              <div className="border-2 border-cq-line rounded-cq-md bg-cq-milk-cq-md p-4 max-h-96 overflow-y-auto">
                <h3 className="font-medium mb-2">Test Results</h3>
                <div className="space-y-2">
                  {testResults.map((result, index) => (
                    <div key={index} className="flex items-center justify-between">
                      <span className="text-sm">{result?.test || 'Unknown test'}</span>
                      <div className="flex items-center gap-2">
                        {getStatusIcon(result?.status || 'error')}
                        <Badge variant={getStatusBadge(result?.status || 'error')}>
                          {result?.status || 'error'}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* System Logs */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Terminal className="h-5 w-5" />
              System Logs
            </span>
            <div className="flex gap-2">
              <Button 
                variant="outline" 
                size="sm"
                onClick={loadSystemLogs}
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Refresh
              </Button>
              <Button 
                variant="outline" 
                size="sm"
                onClick={downloadLogs}
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="bg-cq-roast-deep text-cq-cream p-4 rounded-cq-md font-mono text-sm max-h-96 overflow-y-auto">
            {logs.length === 0 ? (
              <p className="text-cq-ink-3">No logs available</p>
            ) : (
              logs.map((log, index) => (
                <div key={index} className={`mb-1 ${
                  log?.level === 'ERROR' ? 'text-cq-alert' :
                  log?.level === 'WARN' ? 'text-cq-warn' :
                  'text-cq-line'
                }`}>
                  [{log?.timestamp || 'Unknown'}] {log?.level || 'INFO'}: {log?.message || 'No message'}
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default DiagnosticsTab;
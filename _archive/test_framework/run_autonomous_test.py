#!/usr/bin/env python3
"""
Simplified autonomous test runner that focuses on testing the integration
"""

import asyncio
import json
import os
import sys
import time
import subprocess
from datetime import datetime
from pathlib import Path

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

import requests
from typing import Dict, List, Optional, Tuple

class AutonomousTestRunner:
    def __init__(self):
        self.backend_url = "http://localhost:5001"
        self.frontend_url = "http://localhost:3000"
        self.test_results = []
        self.fixes_applied = []
        
    def check_services(self) -> Dict[str, bool]:
        """Check if backend and frontend services are running"""
        results = {}
        
        # Check backend - even 401 means it's running
        try:
            resp = requests.get(f"{self.backend_url}/api/orders", timeout=5)
            # 401 Unauthorized still means the backend is running
            results['backend'] = resp.status_code in [200, 401, 403, 404]
        except:
            results['backend'] = False
            
        # Check frontend
        try:
            resp = requests.get(self.frontend_url, timeout=5)
            results['frontend'] = resp.status_code == 200
        except:
            results['frontend'] = False
            
        return results
        
    def test_api_endpoints(self) -> List[Dict]:
        """Test critical API endpoints"""
        test_results = []
        
        # First, try to login to get a token
        auth_token = None
        try:
            login_resp = requests.post(f"{self.backend_url}/api/auth/login", 
                                     json={"username": "barista", "password": "barista123"},
                                     timeout=5)
            if login_resp.status_code == 200:
                auth_token = login_resp.json().get('access_token')
        except:
            pass
            
        headers = {"Authorization": f"Bearer {auth_token}"} if auth_token else {}
        
        # Test endpoints
        endpoints = [
            ("GET", "/api/orders", None),
            ("GET", "/api/stations", None),
            ("GET", "/api/inventory", None),
            ("GET", "/api/settings", None),
            ("POST", "/sms", {"From": "+1234567890", "Body": "Large cappuccino"}),
        ]
        
        for method, endpoint, data in endpoints:
            result = {
                'endpoint': endpoint,
                'method': method,
                'success': False,
                'error': None,
                'response_time': 0
            }
            
            try:
                start = time.time()
                url = f"{self.backend_url}{endpoint}"
                
                if method == "GET":
                    resp = requests.get(url, headers=headers, timeout=10)
                else:
                    resp = requests.post(url, json=data, headers=headers, timeout=10)
                    
                result['response_time'] = time.time() - start
                result['status_code'] = resp.status_code
                
                if resp.status_code < 500:
                    result['success'] = True
                    try:
                        result['data'] = resp.json()
                    except:
                        result['data'] = resp.text
                else:
                    result['error'] = f"Server error: {resp.status_code}"
                    
            except Exception as e:
                result['error'] = str(e)
                
            test_results.append(result)
            
        return test_results
        
    def test_frontend_integration(self) -> List[Dict]:
        """Test frontend localStorage and API integration"""
        test_results = []
        
        # Check if frontend is using localStorage vs APIs
        test_script = """
        // Check localStorage usage
        const localStorageKeys = Object.keys(localStorage);
        const orderKeys = localStorageKeys.filter(k => k.includes('order'));
        const hasLocalOrders = orderKeys.length > 0;
        
        // Check API service
        const hasApiService = window.ApiService !== undefined;
        const hasOrderService = window.OrderDataService !== undefined;
        
        return {
            localStorageKeys: localStorageKeys.length,
            orderKeys: orderKeys,
            hasLocalOrders: hasLocalOrders,
            hasApiService: hasApiService,
            hasOrderService: hasOrderService
        };
        """
        
        result = {
            'test': 'frontend_integration',
            'success': False,
            'issues': []
        }
        
        # Would need Selenium or similar to execute JS in browser
        # For now, we'll check the source files
        
        frontend_path = Path(__file__).parent.parent / "Barista Front End" / "src"
        
        # Check for localStorage usage in services
        services_path = frontend_path / "services"
        if services_path.exists():
            for service_file in services_path.glob("*.js"):
                with open(service_file, 'r') as f:
                    content = f.read()
                    if 'localStorage' in content:
                        count = content.count('localStorage')
                        result['issues'].append(f"{service_file.name} uses localStorage {count} times")
                        
        result['success'] = len(result['issues']) == 0
        test_results.append(result)
        
        return test_results
        
    def analyze_issues(self, test_results: List[Dict]) -> List[Dict]:
        """Analyze test results to identify patterns and issues"""
        issues = []
        
        # Check API availability
        api_errors = [r for r in test_results if r.get('method') and not r['success']]
        if api_errors:
            issues.append({
                'type': 'api_availability',
                'severity': 'critical',
                'description': f"{len(api_errors)} API endpoints are failing",
                'affected': [r['endpoint'] for r in api_errors]
            })
            
        # Check frontend integration
        frontend_issues = [r for r in test_results if r.get('test') == 'frontend_integration' and r['issues']]
        if frontend_issues:
            issues.append({
                'type': 'frontend_integration',
                'severity': 'high',
                'description': "Frontend is using localStorage instead of APIs",
                'affected': frontend_issues[0]['issues']
            })
            
        return issues
        
    def generate_fixes(self, issues: List[Dict]) -> List[Dict]:
        """Generate fixes for identified issues"""
        fixes = []
        
        for issue in issues:
            if issue['type'] == 'api_availability':
                fixes.append({
                    'issue': issue,
                    'fix_type': 'backend_api',
                    'description': 'Implement missing API endpoints',
                    'file_path': 'routes/api_routes.py',
                    'code_changes': self._generate_api_fix(issue['affected'])
                })
                
            elif issue['type'] == 'frontend_integration':
                fixes.append({
                    'issue': issue,
                    'fix_type': 'frontend_service',
                    'description': 'Update frontend services to use APIs',
                    'file_path': 'Barista Front End/src/services/OrderDataService.js',
                    'code_changes': self._generate_frontend_fix()
                })
                
        return fixes
        
    def _generate_api_fix(self, endpoints: List[str]) -> str:
        """Generate code to fix missing API endpoints"""
        fix_code = """
# Add these routes to fix missing endpoints
"""
        for endpoint in endpoints:
            if 'status' in endpoint:
                fix_code += """
@app.route('/api/orders/status', methods=['GET'])
def get_order_status():
    order_id = request.args.get('order_id')
    # Implementation here
    return jsonify({'status': 'success', 'data': {}})
"""
        return fix_code
        
    def _generate_frontend_fix(self) -> str:
        """Generate code to fix frontend localStorage usage"""
        return """
// Replace localStorage usage with API calls
async fetchOrders(stationId) {
    try {
        const response = await ApiService.get(`/orders?station_id=${stationId}`);
        return response.data || [];
    } catch (error) {
        console.error('Error fetching orders:', error);
        // Fallback to localStorage only if API fails
        return this.getLocalOrders(stationId);
    }
}
"""
        
    def generate_report(self) -> str:
        """Generate comprehensive test report"""
        report = f"""
# Autonomous Test Report
Generated: {datetime.now().isoformat()}

## Service Status
- Backend: {'✓ Running' if self.check_services().get('backend') else '✗ Not Running'}
- Frontend: {'✓ Running' if self.check_services().get('frontend') else '✗ Not Running'}

## Test Results Summary
Total tests run: {len(self.test_results)}
Successful: {len([r for r in self.test_results if r.get('success')])}
Failed: {len([r for r in self.test_results if not r.get('success')])}

## API Endpoint Tests
"""
        for result in self.test_results:
            if result.get('method'):
                status = '✓' if result['success'] else '✗'
                report += f"- {status} {result['method']} {result['endpoint']}"
                if result.get('error'):
                    report += f" - Error: {result['error']}"
                report += f" ({result['response_time']:.2f}s)\n"
                
        report += "\n## Issues Identified\n"
        issues = self.analyze_issues(self.test_results)
        for issue in issues:
            report += f"\n### {issue['type']} ({issue['severity']})\n"
            report += f"{issue['description']}\n"
            if issue.get('affected'):
                report += "Affected:\n"
                for item in issue['affected']:
                    report += f"- {item}\n"
                    
        report += "\n## Recommended Fixes\n"
        fixes = self.generate_fixes(issues)
        for fix in fixes:
            report += f"\n### {fix['fix_type']}\n"
            report += f"Description: {fix['description']}\n"
            report += f"File: {fix['file_path']}\n"
            report += f"```python\n{fix['code_changes']}\n```\n"
            
        return report
        
    async def run(self):
        """Run the autonomous test suite"""
        print("Starting Autonomous Test Runner...")
        
        # Check services
        services = self.check_services()
        print(f"Backend: {'✓' if services['backend'] else '✗'}")
        print(f"Frontend: {'✓' if services['frontend'] else '✗'}")
        
        if not services['backend']:
            print("Backend not running. Please start it with: python run_server.py")
            return
            
        # Run tests
        print("\nRunning API tests...")
        api_results = self.test_api_endpoints()
        self.test_results.extend(api_results)
        
        print("Checking frontend integration...")
        frontend_results = self.test_frontend_integration()
        self.test_results.extend(frontend_results)
        
        # Generate report
        report = self.generate_report()
        
        # Save report
        report_path = Path(__file__).parent / f"autonomous_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(report_path, 'w') as f:
            f.write(report)
            
        print(f"\nReport saved to: {report_path}")
        print("\n" + "="*50)
        print(report)
        
        # Save results as JSON
        results_path = Path(__file__).parent / f"test_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_path, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'services': services,
                'test_results': self.test_results,
                'issues': self.analyze_issues(self.test_results),
                'fixes': self.generate_fixes(self.analyze_issues(self.test_results))
            }, f, indent=2)
            
        print(f"\nDetailed results saved to: {results_path}")

if __name__ == "__main__":
    runner = AutonomousTestRunner()
    asyncio.run(runner.run())
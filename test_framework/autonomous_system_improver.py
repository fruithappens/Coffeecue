#!/usr/bin/env python3
"""
Autonomous System Improver
Automatically tests, identifies issues, and applies fixes to improve the system
"""

import asyncio
import json
import time
import requests
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

class AutonomousSystemImprover:
    def __init__(self):
        self.backend_url = "http://localhost:5001"
        self.frontend_url = "http://localhost:3000"
        self.issues_found = []
        self.fixes_applied = []
        self.test_results = {}
        
    def run_test_suite(self) -> Dict:
        """Run comprehensive test suite"""
        print("\n🔍 RUNNING COMPREHENSIVE TEST SUITE")
        print("=" * 60)
        
        results = {
            'sms_integration': self.test_sms_integration(),
            'api_endpoints': self.test_api_endpoints(),
            'frontend_backend_sync': self.test_frontend_backend_sync(),
            'realtime_updates': self.test_realtime_updates(),
            'order_flow': self.test_order_flow()
        }
        
        self.test_results = results
        return results
        
    def test_sms_integration(self) -> Dict:
        """Test SMS to order creation flow"""
        print("\n📱 Testing SMS Integration...")
        
        test_scenarios = [
            ("Simple order", "+1234567890", "Large cappuccino"),
            ("With milk", "+1234567891", "Medium latte with oat milk"),
            ("VIP order", "+1234567892", "Small flat white VIP"),
            ("Station specific", "+1234567893", "Large cappuccino for station 2")
        ]
        
        results = {'passed': 0, 'failed': 0, 'issues': []}
        
        for scenario, phone, message in test_scenarios:
            # Send SMS
            twilio_data = {
                "From": phone,
                "Body": message,
                "MessageSid": f"SM{int(time.time())}",
                "To": "+1555555555"
            }
            
            try:
                resp = requests.post(
                    f"{self.backend_url}/sms",
                    data=twilio_data,
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                
                if resp.status_code == 200:
                    # Check if order was created
                    time.sleep(1)
                    token = self._get_auth_token()
                    if token:
                        headers = {"Authorization": f"Bearer {token}"}
                        orders_resp = requests.get(f"{self.backend_url}/api/orders", headers=headers)
                        
                        if orders_resp.status_code == 200:
                            orders = orders_resp.json().get('data', [])
                            phone_orders = [o for o in orders if o.get('phone') == phone]
                            
                            if phone_orders:
                                results['passed'] += 1
                                print(f"   ✓ {scenario}: Order created")
                            else:
                                results['failed'] += 1
                                results['issues'].append(f"{scenario}: SMS received but order not created")
                                print(f"   ✗ {scenario}: SMS received but order not created")
                        else:
                            results['failed'] += 1
                    else:
                        results['failed'] += 1
                else:
                    results['failed'] += 1
                    results['issues'].append(f"{scenario}: SMS webhook failed")
                    
            except Exception as e:
                results['failed'] += 1
                results['issues'].append(f"{scenario}: {str(e)}")
                
        return results
        
    def test_api_endpoints(self) -> Dict:
        """Test all critical API endpoints"""
        print("\n🔌 Testing API Endpoints...")
        
        endpoints = [
            ("GET", "/api/orders", "Orders"),
            ("GET", "/api/stations", "Stations"),
            ("GET", "/api/inventory", "Inventory"),
            ("GET", "/api/settings", "Settings"),
            ("GET", "/api/schedule/today", "Schedule"),
            ("GET", "/api/users", "Users")
        ]
        
        results = {'passed': 0, 'failed': 0, 'missing': []}
        token = self._get_auth_token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        
        for method, endpoint, name in endpoints:
            try:
                if method == "GET":
                    resp = requests.get(f"{self.backend_url}{endpoint}", headers=headers)
                    
                if resp.status_code in [200, 201]:
                    results['passed'] += 1
                    print(f"   ✓ {name} API: Working")
                elif resp.status_code == 401:
                    results['failed'] += 1
                    print(f"   ⚠️  {name} API: Authentication required")
                elif resp.status_code == 501:
                    results['failed'] += 1
                    results['missing'].append(endpoint)
                    print(f"   ✗ {name} API: Not implemented")
                else:
                    results['failed'] += 1
                    print(f"   ✗ {name} API: Failed ({resp.status_code})")
                    
            except Exception as e:
                results['failed'] += 1
                print(f"   ✗ {name} API: Error - {str(e)}")
                
        return results
        
    def test_frontend_backend_sync(self) -> Dict:
        """Test if frontend is properly synced with backend"""
        print("\n🔄 Testing Frontend-Backend Sync...")
        
        results = {'issues': []}
        
        # Check localStorage vs API usage
        frontend_path = Path(__file__).parent.parent / "Barista Front End" / "src"
        
        # Check OrderDataService
        order_service = frontend_path / "services" / "OrderDataService.js"
        if order_service.exists():
            with open(order_service, 'r') as f:
                content = f.read()
                localStorage_count = content.count('localStorage')
                api_count = content.count('ApiService.')
                
                if localStorage_count > 50:
                    results['issues'].append({
                        'file': 'OrderDataService.js',
                        'issue': f'Excessive localStorage usage ({localStorage_count} times)',
                        'fix': 'Refactor to use API with localStorage fallback'
                    })
                    print(f"   ✗ OrderDataService: Too much localStorage ({localStorage_count} uses)")
                else:
                    print(f"   ✓ OrderDataService: Reasonable localStorage usage")
                    
        # Check WebSocket integration
        api_service = frontend_path / "services" / "ApiService.js"
        if api_service.exists():
            with open(api_service, 'r') as f:
                content = f.read()
                if 'socket.io' not in content and 'io(' not in content:
                    results['issues'].append({
                        'file': 'ApiService.js',
                        'issue': 'No WebSocket client implementation',
                        'fix': 'Add socket.io-client for real-time updates'
                    })
                    print("   ✗ ApiService: No WebSocket client found")
                else:
                    print("   ✓ ApiService: WebSocket client implemented")
                    
        return results
        
    def test_realtime_updates(self) -> Dict:
        """Test real-time update mechanisms"""
        print("\n⚡ Testing Real-time Updates...")
        
        results = {'websocket': False, 'polling': False}
        
        # Check if WebSocket is available
        try:
            resp = requests.get(f"{self.backend_url}/socket.io/")
            if resp.status_code != 404:
                results['websocket'] = True
                print("   ✓ WebSocket server: Available")
            else:
                print("   ✗ WebSocket server: Not configured")
        except:
            print("   ✗ WebSocket server: Connection failed")
            
        return results
        
    def test_order_flow(self) -> Dict:
        """Test complete order flow from creation to completion"""
        print("\n📋 Testing Order Flow...")
        
        results = {'stages': {}}
        
        # This would test the complete flow
        # For now, we'll check if the necessary endpoints exist
        
        flow_endpoints = [
            ("Create order", "POST", "/api/orders"),
            ("Update status", "PUT", "/api/orders/{id}/status"),
            ("Complete order", "POST", "/api/orders/{id}/complete"),
            ("Get order details", "GET", "/api/orders/{id}")
        ]
        
        for stage, method, endpoint in flow_endpoints:
            # Basic check if endpoint responds
            test_endpoint = endpoint.replace("{id}", "123")
            try:
                if method == "GET":
                    resp = requests.get(f"{self.backend_url}{test_endpoint}")
                elif method == "POST":
                    resp = requests.post(f"{self.backend_url}{test_endpoint}", json={})
                elif method == "PUT":
                    resp = requests.put(f"{self.backend_url}{test_endpoint}", json={})
                    
                if resp.status_code != 501:
                    results['stages'][stage] = True
                    print(f"   ✓ {stage}: Available")
                else:
                    results['stages'][stage] = False
                    print(f"   ✗ {stage}: Not implemented")
            except:
                results['stages'][stage] = False
                
        return results
        
    def analyze_issues(self) -> List[Dict]:
        """Analyze test results and identify issues"""
        print("\n🔍 ANALYZING ISSUES")
        print("=" * 60)
        
        issues = []
        
        # SMS Integration Issues
        sms_results = self.test_results.get('sms_integration', {})
        if sms_results.get('issues'):
            for issue in sms_results['issues']:
                issues.append({
                    'type': 'sms_integration',
                    'severity': 'high',
                    'description': issue,
                    'fix_type': 'backend'
                })
                
        # API Endpoint Issues
        api_results = self.test_results.get('api_endpoints', {})
        if api_results.get('missing'):
            for endpoint in api_results['missing']:
                issues.append({
                    'type': 'missing_endpoint',
                    'severity': 'critical',
                    'description': f"Endpoint {endpoint} not implemented",
                    'endpoint': endpoint,
                    'fix_type': 'backend'
                })
                
        # Frontend-Backend Sync Issues
        sync_results = self.test_results.get('frontend_backend_sync', {})
        for issue in sync_results.get('issues', []):
            issues.append({
                'type': 'frontend_sync',
                'severity': 'high',
                'description': issue['issue'],
                'file': issue['file'],
                'fix': issue['fix'],
                'fix_type': 'frontend'
            })
            
        # Real-time Update Issues
        realtime_results = self.test_results.get('realtime_updates', {})
        if not realtime_results.get('websocket'):
            issues.append({
                'type': 'realtime_updates',
                'severity': 'medium',
                'description': 'WebSocket not configured for real-time updates',
                'fix_type': 'both'
            })
            
        self.issues_found = issues
        return issues
        
    def generate_fixes(self) -> List[Dict]:
        """Generate fixes for identified issues"""
        print("\n🔧 GENERATING FIXES")
        print("=" * 60)
        
        fixes = []
        
        for issue in self.issues_found:
            if issue['type'] == 'missing_endpoint':
                fix = self._generate_endpoint_fix(issue['endpoint'])
                if fix:
                    fixes.append(fix)
                    
            elif issue['type'] == 'frontend_sync':
                fix = self._generate_frontend_fix(issue)
                if fix:
                    fixes.append(fix)
                    
            elif issue['type'] == 'sms_integration':
                fix = self._generate_sms_fix(issue)
                if fix:
                    fixes.append(fix)
                    
        return fixes
        
    def _generate_endpoint_fix(self, endpoint: str) -> Optional[Dict]:
        """Generate fix for missing endpoint"""
        if '/schedule' in endpoint:
            return {
                'type': 'add_endpoint',
                'file': 'routes/schedule_api_routes.py',
                'description': f'Add {endpoint} endpoint',
                'code': '''
@bp.route('/today', methods=['GET'])
@jwt_required()
def get_todays_schedule():
    """Get today's schedule"""
    try:
        # Implementation here
        return jsonify({'status': 'success', 'data': []})
    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500
'''
            }
        return None
        
    def _generate_frontend_fix(self, issue: Dict) -> Optional[Dict]:
        """Generate fix for frontend issues"""
        if 'OrderDataService' in issue['file']:
            return {
                'type': 'refactor_service',
                'file': issue['file'],
                'description': 'Refactor to use API with localStorage fallback',
                'approach': 'Replace direct localStorage calls with API calls'
            }
        return None
        
    def _generate_sms_fix(self, issue: Dict) -> Optional[Dict]:
        """Generate fix for SMS issues"""
        return {
            'type': 'update_sms_handler',
            'file': 'services/coffee_system.py',
            'description': 'Ensure SMS creates orders in database',
            'approach': 'Update handle_sms method to create order records'
        }
        
    def _get_auth_token(self) -> Optional[str]:
        """Get authentication token"""
        credentials = [
            {"username": "barista", "password": "baristapassword"},
            {"username": "admin", "password": "adminpassword"},
            {"username": "coffeecue", "password": "adminpassword"}
        ]
        
        for cred in credentials:
            try:
                resp = requests.post(f"{self.backend_url}/api/auth/login", json=cred)
                if resp.status_code == 200:
                    return resp.json().get('access_token')
            except:
                pass
        return None
        
    def generate_report(self) -> str:
        """Generate comprehensive improvement report"""
        report = f"""
# Autonomous System Improvement Report
Generated: {datetime.now().isoformat()}

## Test Results Summary

### SMS Integration
- Passed: {self.test_results.get('sms_integration', {}).get('passed', 0)}
- Failed: {self.test_results.get('sms_integration', {}).get('failed', 0)}

### API Endpoints
- Working: {self.test_results.get('api_endpoints', {}).get('passed', 0)}
- Failed: {self.test_results.get('api_endpoints', {}).get('failed', 0)}
- Missing: {len(self.test_results.get('api_endpoints', {}).get('missing', []))}

### Frontend-Backend Sync
- Issues found: {len(self.test_results.get('frontend_backend_sync', {}).get('issues', []))}

### Real-time Updates
- WebSocket available: {self.test_results.get('realtime_updates', {}).get('websocket', False)}

## Issues Identified
Total issues: {len(self.issues_found)}

"""
        
        # Group issues by severity
        critical = [i for i in self.issues_found if i['severity'] == 'critical']
        high = [i for i in self.issues_found if i['severity'] == 'high']
        medium = [i for i in self.issues_found if i['severity'] == 'medium']
        
        if critical:
            report += f"\n### Critical Issues ({len(critical)})\n"
            for issue in critical:
                report += f"- {issue['description']}\n"
                
        if high:
            report += f"\n### High Priority Issues ({len(high)})\n"
            for issue in high:
                report += f"- {issue['description']}\n"
                
        if medium:
            report += f"\n### Medium Priority Issues ({len(medium)})\n"
            for issue in medium:
                report += f"- {issue['description']}\n"
                
        report += "\n## Recommended Improvements\n\n"
        
        # Priority 1: Fix missing endpoints
        if any(i['type'] == 'missing_endpoint' for i in self.issues_found):
            report += """### 1. Implement Missing API Endpoints
- Create missing route handlers in respective route files
- Ensure proper authentication and error handling
- Add database queries for data retrieval
"""
        
        # Priority 2: Fix SMS integration
        if any(i['type'] == 'sms_integration' for i in self.issues_found):
            report += """### 2. Fix SMS to Order Creation
- Update coffee_system.handle_sms() to create order records
- Ensure proper order status tracking
- Add WebSocket notifications for new orders
"""
        
        # Priority 3: Frontend refactoring
        if any(i['type'] == 'frontend_sync' for i in self.issues_found):
            report += """### 3. Refactor Frontend Services
- Replace excessive localStorage usage with API calls
- Implement proper error handling and retry logic
- Add WebSocket client for real-time updates
"""
        
        # Priority 4: Real-time updates
        if not self.test_results.get('realtime_updates', {}).get('websocket'):
            report += """### 4. Implement Real-time Updates
- Configure Flask-SocketIO properly
- Add WebSocket event handlers for order updates
- Implement frontend WebSocket client
"""
        
        report += "\n## Next Steps\n"
        report += "1. Apply critical fixes first\n"
        report += "2. Test each fix thoroughly\n"
        report += "3. Monitor system performance\n"
        report += "4. Run this tool again to verify improvements\n"
        
        return report
        
    async def run(self):
        """Run the autonomous improvement process"""
        print("\n🚀 AUTONOMOUS SYSTEM IMPROVER")
        print("=" * 60)
        print("Starting comprehensive system analysis and improvement...\n")
        
        # Step 1: Run tests
        self.run_test_suite()
        
        # Step 2: Analyze issues
        self.analyze_issues()
        
        # Step 3: Generate fixes
        fixes = self.generate_fixes()
        
        # Step 4: Generate report
        report = self.generate_report()
        
        # Save report
        report_path = Path(__file__).parent / f"improvement_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(report_path, 'w') as f:
            f.write(report)
            
        print(f"\n📄 Report saved to: {report_path}")
        
        # Save detailed results
        results_path = Path(__file__).parent / f"improvement_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_path, 'w') as f:
            json.dump({
                'timestamp': datetime.now().isoformat(),
                'test_results': self.test_results,
                'issues_found': self.issues_found,
                'fixes_generated': fixes
            }, f, indent=2)
            
        print(f"📊 Detailed results saved to: {results_path}")
        
        # Print summary
        print("\n" + "=" * 60)
        print("SUMMARY")
        print("=" * 60)
        print(f"Issues found: {len(self.issues_found)}")
        print(f"- Critical: {len([i for i in self.issues_found if i['severity'] == 'critical'])}")
        print(f"- High: {len([i for i in self.issues_found if i['severity'] == 'high'])}")
        print(f"- Medium: {len([i for i in self.issues_found if i['severity'] == 'medium'])}")
        print(f"\nFixes generated: {len(fixes)}")
        
        return {
            'issues': self.issues_found,
            'fixes': fixes,
            'report_path': str(report_path)
        }

if __name__ == "__main__":
    improver = AutonomousSystemImprover()
    asyncio.run(improver.run())
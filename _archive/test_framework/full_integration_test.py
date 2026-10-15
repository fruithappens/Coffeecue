#!/usr/bin/env python3
"""
Full Integration Test - SMS to Frontend Flow
Tests the complete flow from SMS order to frontend display
"""

import asyncio
import json
import time
import requests
from datetime import datetime
from pathlib import Path
import subprocess
import sys

# Add parent directory to path
sys.path.append(str(Path(__file__).parent.parent))

class FullIntegrationTester:
    def __init__(self):
        self.backend_url = "http://localhost:5001"
        self.frontend_url = "http://localhost:3000"
        self.test_results = {
            'sms_tests': [],
            'api_tests': [],
            'integration_issues': [],
            'improvements': []
        }
        
    def get_auth_token(self):
        """Get authentication token"""
        # Try multiple credentials
        credentials = [
            {"username": "barista", "password": "barista123"},
            {"username": "barista", "password": "baristapassword"},
            {"username": "admin", "password": "admin123"},
            {"username": "admin", "password": "adminpassword"},
            {"username": "coffeecue", "password": "adminpassword"}
        ]
        
        for cred in credentials:
            try:
                resp = requests.post(f"{self.backend_url}/api/auth/login", json=cred)
                if resp.status_code == 200:
                    print(f"   ✓ Authenticated as {cred['username']}")
                    return resp.json().get('access_token')
            except:
                pass
                
        print("   ✗ Failed to authenticate with any credentials")
        return None
        
    def test_sms_order_flow(self):
        """Test complete SMS order flow"""
        print("\n1. Testing SMS Order Flow")
        print("-" * 50)
        
        test_phone = "+1234567890"
        test_message = "Large cappuccino with oat milk"
        
        # Send SMS
        print(f"   Sending SMS from {test_phone}: '{test_message}'")
        
        twilio_data = {
            "From": test_phone,
            "Body": test_message,
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
                print("   ✓ SMS received and processed")
                self.test_results['sms_tests'].append({
                    'test': 'SMS Reception',
                    'success': True,
                    'response': resp.text[:100]
                })
                
                # Check if response is valid TwiML
                if "<Response>" in resp.text and "</Response>" in resp.text:
                    print("   ✓ Valid TwiML response returned")
                else:
                    print("   ✗ Invalid TwiML response")
                    self.test_results['integration_issues'].append({
                        'issue': 'Invalid TwiML Response',
                        'severity': 'high',
                        'details': 'SMS webhook not returning proper TwiML format'
                    })
            else:
                print(f"   ✗ SMS processing failed (HTTP {resp.status_code})")
                self.test_results['sms_tests'].append({
                    'test': 'SMS Reception',
                    'success': False,
                    'error': f'HTTP {resp.status_code}'
                })
                
        except Exception as e:
            print(f"   ✗ SMS test failed: {e}")
            self.test_results['sms_tests'].append({
                'test': 'SMS Reception',
                'success': False,
                'error': str(e)
            })
            
    def test_order_in_database(self):
        """Check if SMS order was created in database"""
        print("\n2. Checking Order in Database")
        print("-" * 50)
        
        token = self.get_auth_token()
        if not token:
            return
            
        headers = {"Authorization": f"Bearer {token}"}
        
        try:
            # Get all orders
            resp = requests.get(f"{self.backend_url}/api/orders", headers=headers)
            
            if resp.status_code == 200:
                orders = resp.json().get('data', [])
                print(f"   Found {len(orders)} total orders")
                
                # Look for recent SMS orders
                sms_orders = [o for o in orders if o.get('source') == 'sms' or o.get('phone') == '+1234567890']
                
                if sms_orders:
                    print(f"   ✓ Found {len(sms_orders)} SMS orders")
                    for order in sms_orders[:3]:  # Show up to 3 recent orders
                        print(f"     - Order {order.get('order_number')}: {order.get('items', 'No items')}")
                else:
                    print("   ✗ No SMS orders found in database")
                    self.test_results['integration_issues'].append({
                        'issue': 'SMS Orders Not Created',
                        'severity': 'critical',
                        'details': 'SMS messages not being converted to orders in database'
                    })
                    
                self.test_results['api_tests'].append({
                    'test': 'Order Creation from SMS',
                    'success': len(sms_orders) > 0,
                    'orders_found': len(sms_orders)
                })
                
            else:
                print(f"   ✗ Failed to fetch orders (HTTP {resp.status_code})")
                
        except Exception as e:
            print(f"   ✗ Database check failed: {e}")
            
    def test_websocket_notifications(self):
        """Test if WebSocket notifications are configured"""
        print("\n3. Checking WebSocket Configuration")
        print("-" * 50)
        
        # Check if SocketIO is configured in backend
        try:
            # Try to connect to socket.io endpoint
            resp = requests.get(f"{self.backend_url}/socket.io/")
            
            if resp.status_code != 404:
                print("   ✓ WebSocket endpoint available")
                self.test_results['api_tests'].append({
                    'test': 'WebSocket Availability',
                    'success': True
                })
            else:
                print("   ✗ WebSocket endpoint not found")
                self.test_results['integration_issues'].append({
                    'issue': 'WebSocket Not Configured',
                    'severity': 'high',
                    'details': 'Real-time updates not available'
                })
                
        except Exception as e:
            print(f"   ✗ WebSocket check failed: {e}")
            
    def test_frontend_integration(self):
        """Test frontend localStorage vs API usage"""
        print("\n4. Checking Frontend Integration")
        print("-" * 50)
        
        # Check frontend service files
        frontend_path = Path(__file__).parent.parent / "Barista Front End" / "src" / "services"
        
        if not frontend_path.exists():
            print("   ✗ Frontend services directory not found")
            return
            
        localStorage_usage = {}
        api_usage = {}
        
        for service_file in frontend_path.glob("*.js"):
            if service_file.name.endswith('.test.js'):
                continue
                
            with open(service_file, 'r') as f:
                content = f.read()
                
                # Count localStorage usage
                localStorage_count = content.count('localStorage')
                if localStorage_count > 0:
                    localStorage_usage[service_file.name] = localStorage_count
                    
                # Count API usage
                api_patterns = ['ApiService.', 'fetch(', 'axios.', '.get(', '.post(', '.put(', '.delete(']
                api_count = sum(content.count(pattern) for pattern in api_patterns)
                if api_count > 0:
                    api_usage[service_file.name] = api_count
                    
        print(f"   Services using localStorage: {len(localStorage_usage)}")
        for service, count in sorted(localStorage_usage.items(), key=lambda x: x[1], reverse=True)[:5]:
            print(f"     - {service}: {count} times")
            
        print(f"\n   Services using API calls: {len(api_usage)}")
        for service, count in sorted(api_usage.items(), key=lambda x: x[1], reverse=True)[:5]:
            print(f"     - {service}: {count} times")
            
        # Check if OrderDataService uses APIs
        if 'OrderDataService.js' in localStorage_usage and localStorage_usage['OrderDataService.js'] > 50:
            self.test_results['integration_issues'].append({
                'issue': 'Excessive localStorage Usage',
                'severity': 'high',
                'details': f"OrderDataService uses localStorage {localStorage_usage['OrderDataService.js']} times",
                'recommendation': 'Refactor to use backend APIs with localStorage as fallback only'
            })
            
    def analyze_and_recommend(self):
        """Analyze results and provide recommendations"""
        print("\n5. Analysis and Recommendations")
        print("-" * 50)
        
        # Count issues by severity
        critical_issues = [i for i in self.test_results['integration_issues'] if i['severity'] == 'critical']
        high_issues = [i for i in self.test_results['integration_issues'] if i['severity'] == 'high']
        
        if critical_issues:
            print(f"\n   🚨 {len(critical_issues)} CRITICAL issues found:")
            for issue in critical_issues:
                print(f"      - {issue['issue']}: {issue['details']}")
                
        if high_issues:
            print(f"\n   ⚠️  {len(high_issues)} HIGH priority issues found:")
            for issue in high_issues:
                print(f"      - {issue['issue']}: {issue['details']}")
                
        # Generate improvements
        improvements = []
        
        # Check SMS to Order conversion
        sms_order_issue = next((i for i in self.test_results['integration_issues'] 
                               if i['issue'] == 'SMS Orders Not Created'), None)
        if sms_order_issue:
            improvements.append({
                'area': 'SMS Processing',
                'fix': 'Update coffee_system.handle_sms() to create orders in database',
                'priority': 'critical',
                'files': ['services/coffee_system.py', 'services/nlp.py']
            })
            
        # Check WebSocket
        websocket_issue = next((i for i in self.test_results['integration_issues'] 
                               if i['issue'] == 'WebSocket Not Configured'), None)
        if websocket_issue:
            improvements.append({
                'area': 'Real-time Updates',
                'fix': 'Implement WebSocket events for order updates',
                'priority': 'high',
                'files': ['app.py', 'routes/websocket_routes.py', 'Barista Front End/src/services/ApiService.js']
            })
            
        # Check localStorage usage
        localStorage_issue = next((i for i in self.test_results['integration_issues'] 
                                  if i['issue'] == 'Excessive localStorage Usage'), None)
        if localStorage_issue:
            improvements.append({
                'area': 'Frontend Integration',
                'fix': 'Refactor services to use APIs with localStorage fallback',
                'priority': 'high',
                'files': ['Barista Front End/src/services/OrderDataService.js', 
                         'Barista Front End/src/hooks/useOrders.js']
            })
            
        self.test_results['improvements'] = improvements
        
        if improvements:
            print("\n   📋 Recommended Improvements:")
            for imp in improvements:
                print(f"\n   {imp['priority'].upper()}: {imp['area']}")
                print(f"   Fix: {imp['fix']}")
                print(f"   Files to modify:")
                for file in imp['files']:
                    print(f"     - {file}")
                    
    def generate_report(self):
        """Generate comprehensive test report"""
        report = f"""
# Full Integration Test Report
Generated: {datetime.now().isoformat()}

## Executive Summary
- SMS Tests: {len([t for t in self.test_results['sms_tests'] if t['success']])} / {len(self.test_results['sms_tests'])} passed
- API Tests: {len([t for t in self.test_results['api_tests'] if t['success']])} / {len(self.test_results['api_tests'])} passed
- Integration Issues: {len(self.test_results['integration_issues'])}
- Recommended Improvements: {len(self.test_results['improvements'])}

## Integration Issues
"""
        
        for issue in self.test_results['integration_issues']:
            report += f"\n### {issue['issue']} ({issue['severity']})\n"
            report += f"{issue['details']}\n"
            if issue.get('recommendation'):
                report += f"**Recommendation:** {issue['recommendation']}\n"
                
        report += "\n## Improvement Plan\n"
        
        for imp in self.test_results['improvements']:
            report += f"\n### {imp['area']} (Priority: {imp['priority']})\n"
            report += f"**Fix:** {imp['fix']}\n"
            report += "**Files to modify:**\n"
            for file in imp['files']:
                report += f"- {file}\n"
                
        report += "\n## Next Steps\n"
        report += "1. Fix critical issues first (SMS order creation)\n"
        report += "2. Implement WebSocket for real-time updates\n"
        report += "3. Refactor frontend services to use APIs\n"
        report += "4. Add comprehensive error handling\n"
        report += "5. Implement retry logic for failed API calls\n"
        
        return report
        
    async def run(self):
        """Run full integration test"""
        print("=" * 70)
        print("FULL INTEGRATION TEST - SMS to Frontend Flow")
        print("=" * 70)
        
        # Run all tests
        self.test_sms_order_flow()
        time.sleep(2)  # Give backend time to process
        
        self.test_order_in_database()
        self.test_websocket_notifications()
        self.test_frontend_integration()
        self.analyze_and_recommend()
        
        # Generate report
        report = self.generate_report()
        
        # Save report
        report_path = Path(__file__).parent / f"integration_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(report_path, 'w') as f:
            f.write(report)
            
        print(f"\n\nFull report saved to: {report_path}")
        
        # Save JSON results
        results_path = Path(__file__).parent / f"integration_results_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
        with open(results_path, 'w') as f:
            json.dump(self.test_results, f, indent=2)
            
        return self.test_results

if __name__ == "__main__":
    tester = FullIntegrationTester()
    asyncio.run(tester.run())
#!/usr/bin/env python3
"""
Test SMS integration comprehensively
"""

import requests
import json
import time
from datetime import datetime
from pathlib import Path

class SMSIntegrationTester:
    def __init__(self):
        self.backend_url = "http://localhost:5001"
        self.results = []
        
    def get_auth_token(self):
        """Get authentication token"""
        try:
            resp = requests.post(f"{self.backend_url}/api/auth/login", 
                               json={"username": "barista", "password": "barista123"})
            if resp.status_code == 200:
                return resp.json().get('access_token')
        except:
            pass
        return None
        
    def test_sms_scenarios(self):
        """Test various SMS scenarios"""
        scenarios = [
            {
                "name": "Simple order",
                "message": "Large cappuccino",
                "from": "+1234567890"
            },
            {
                "name": "Order with milk preference",
                "message": "Medium latte with oat milk",
                "from": "+1234567891"
            },
            {
                "name": "VIP order",
                "message": "Small flat white VIP",
                "from": "+1234567892"
            },
            {
                "name": "Group order",
                "message": "Group order: 5 lattes, 3 cappuccinos for conference room A",
                "from": "+1234567893"
            },
            {
                "name": "Order status check",
                "message": "Status",
                "from": "+1234567890"  # Same number as first order
            },
            {
                "name": "Cancel order",
                "message": "Cancel",
                "from": "+1234567890"  # Same number
            }
        ]
        
        token = self.get_auth_token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        
        for scenario in scenarios:
            print(f"\nTesting: {scenario['name']}")
            
            # Test Twilio webhook
            twilio_data = {
                "From": scenario["from"],
                "Body": scenario["message"],
                "MessageSid": f"SM{int(time.time())}",
                "To": "+1555555555"
            }
            
            result = {
                "scenario": scenario["name"],
                "request": twilio_data,
                "tests": []
            }
            
            # Test 1: SMS webhook
            try:
                resp = requests.post(
                    f"{self.backend_url}/sms",  # SMS route is not under /api
                    data=twilio_data,  # Twilio sends form data, not JSON
                    headers={"Content-Type": "application/x-www-form-urlencoded"}
                )
                
                test_result = {
                    "test": "SMS Webhook",
                    "status_code": resp.status_code,
                    "success": resp.status_code in [200, 201],
                    "response": resp.text[:200]
                }
                
                # Check if response is valid TwiML
                if test_result["success"] and "<Response>" in resp.text:
                    test_result["twiml_valid"] = True
                    
                result["tests"].append(test_result)
                print(f"  - SMS Webhook: {'✓' if test_result['success'] else '✗'} ({resp.status_code})")
                
            except Exception as e:
                result["tests"].append({
                    "test": "SMS Webhook",
                    "success": False,
                    "error": str(e)
                })
                print(f"  - SMS Webhook: ✗ (Error: {e})")
                
            # Test 2: Check if order was created
            if "status" not in scenario["message"].lower() and "cancel" not in scenario["message"].lower():
                time.sleep(1)  # Give backend time to process
                
                try:
                    resp = requests.get(
                        f"{self.backend_url}/api/orders",
                        headers=headers
                    )
                    
                    if resp.status_code == 200:
                        orders = resp.json().get('data', [])
                        # Look for order from this phone number
                        matching_orders = [o for o in orders if o.get('customer_phone') == scenario['from']]
                        
                        test_result = {
                            "test": "Order Created",
                            "success": len(matching_orders) > 0,
                            "orders_found": len(matching_orders)
                        }
                        
                        result["tests"].append(test_result)
                        print(f"  - Order Created: {'✓' if test_result['success'] else '✗'}")
                        
                except Exception as e:
                    print(f"  - Order Created: ✗ (Error: {e})")
                    
            # Test 3: Check WebSocket notifications
            # Would need WebSocket client to test this properly
            
            self.results.append(result)
            
    def test_frontend_integration(self):
        """Test if frontend receives SMS orders"""
        print("\nTesting Frontend Integration:")
        
        # Check if frontend has WebSocket connection
        # This would require Selenium or similar to test properly
        
        # For now, check if the services are configured for real-time updates
        token = self.get_auth_token()
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        
        try:
            # Check if there are any orders in the system
            resp = requests.get(f"{self.backend_url}/api/orders", headers=headers)
            if resp.status_code == 200:
                orders = resp.json().get('data', [])
                print(f"  - Total orders in system: {len(orders)}")
                
                # Check order sources
                sms_orders = [o for o in orders if o.get('source') == 'sms']
                web_orders = [o for o in orders if o.get('source') == 'web']
                
                print(f"  - SMS orders: {len(sms_orders)}")
                print(f"  - Web orders: {len(web_orders)}")
                
        except Exception as e:
            print(f"  - Error checking orders: {e}")
            
    def generate_report(self):
        """Generate test report"""
        report = f"""
# SMS Integration Test Report
Generated: {datetime.now().isoformat()}

## Test Summary
Total scenarios tested: {len(self.results)}

## Detailed Results
"""
        
        for result in self.results:
            report += f"\n### {result['scenario']}\n"
            report += f"Phone: {result['request']['From']}\n"
            report += f"Message: {result['request']['Body']}\n\n"
            
            for test in result['tests']:
                status = '✓' if test.get('success') else '✗'
                report += f"- {status} {test['test']}"
                
                if test.get('status_code'):
                    report += f" (HTTP {test['status_code']})"
                if test.get('error'):
                    report += f" - Error: {test['error']}"
                if test.get('orders_found'):
                    report += f" - Found {test['orders_found']} orders"
                    
                report += "\n"
                
        # Add recommendations
        report += "\n## Recommendations\n"
        
        # Check for common issues
        webhook_failures = sum(1 for r in self.results 
                             for t in r['tests'] 
                             if t['test'] == 'SMS Webhook' and not t.get('success'))
        
        if webhook_failures > 0:
            report += f"- ⚠️  SMS webhook failing ({webhook_failures} failures) - Check Twilio configuration\n"
            report += "  - Ensure TWILIO_AUTH_TOKEN is set in environment\n"
            report += "  - Verify webhook URL is correctly configured in Twilio console\n"
            report += "  - Check if ngrok is running for local testing\n"
            
        order_creation_failures = sum(1 for r in self.results 
                                    for t in r['tests'] 
                                    if t['test'] == 'Order Created' and not t.get('success'))
        
        if order_creation_failures > 0:
            report += f"- ⚠️  Orders not being created from SMS ({order_creation_failures} failures)\n"
            report += "  - Check NLP processing in backend\n"
            report += "  - Verify database connection\n"
            report += "  - Check order validation logic\n"
            
        return report
        
    def run(self):
        """Run all tests"""
        print("SMS Integration Tester")
        print("=" * 50)
        
        # Test SMS scenarios
        self.test_sms_scenarios()
        
        # Test frontend integration
        self.test_frontend_integration()
        
        # Generate report
        report = self.generate_report()
        
        # Save report
        report_path = Path(__file__).parent / f"sms_test_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
        with open(report_path, 'w') as f:
            f.write(report)
            
        print(f"\n\nReport saved to: {report_path}")
        print("\n" + "="*50)
        print(report)

if __name__ == "__main__":
    tester = SMSIntegrationTester()
    tester.run()
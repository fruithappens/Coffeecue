"""
SMS Customer Simulator and System Test Framework
Simulates various customer scenarios and monitors system responses
"""
import asyncio
import aiohttp
import json
import random
import string
import time
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple
import logging
import re
from dataclasses import dataclass
from enum import Enum

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('test_results.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)

class OrderStatus(Enum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"

class CustomerType(Enum):
    REGULAR = "regular"
    VIP = "vip"
    STAFF = "staff"
    GROUP = "group"
    PROBLEM = "problem"  # Customers who send problematic messages

@dataclass
class TestScenario:
    name: str
    customer_type: CustomerType
    messages: List[str]
    expected_responses: List[str]
    expected_order_status: OrderStatus
    station_preference: Optional[int] = None
    timing: Optional[str] = None  # "rush_hour", "quiet", "closing"
    
@dataclass
class TestResult:
    scenario: TestScenario
    success: bool
    actual_responses: List[str]
    actual_order_status: Optional[OrderStatus]
    errors: List[str]
    warnings: List[str]
    duration: float
    backend_logs: List[str]
    frontend_events: List[str]

class SMSSimulator:
    def __init__(self, backend_url: str = "http://localhost:5001", 
                 frontend_url: str = "http://localhost:3000"):
        self.backend_url = backend_url
        self.frontend_url = frontend_url
        self.session = None
        self.auth_token = None
        self.test_results: List[TestResult] = []
        self.phone_numbers = self._generate_phone_numbers(50)
        
    def _generate_phone_numbers(self, count: int) -> List[str]:
        """Generate realistic Australian phone numbers for testing"""
        return [f"+614{random.randint(10000000, 99999999)}" for _ in range(count)]
    
    def _generate_scenarios(self) -> List[TestScenario]:
        """Generate comprehensive test scenarios"""
        scenarios = []
        
        # Basic order scenarios
        scenarios.extend([
            TestScenario(
                name="Simple coffee order",
                customer_type=CustomerType.REGULAR,
                messages=["Large flat white with skim milk please"],
                expected_responses=["order confirmed", "wait time"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Order with station preference",
                customer_type=CustomerType.REGULAR,
                messages=["Medium cappuccino for station 2"],
                expected_responses=["order confirmed", "station 2"],
                expected_order_status=OrderStatus.PENDING,
                station_preference=2
            ),
            TestScenario(
                name="Complex order with modifications",
                customer_type=CustomerType.REGULAR,
                messages=["Small latte with almond milk, extra hot, 2 sugars"],
                expected_responses=["order confirmed", "almond milk", "extra hot", "2 sugars"],
                expected_order_status=OrderStatus.PENDING
            ),
        ])
        
        # VIP scenarios
        scenarios.extend([
            TestScenario(
                name="VIP order",
                customer_type=CustomerType.VIP,
                messages=["Flat white please, I'm a VIP member"],
                expected_responses=["priority", "order confirmed"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Staff order",
                customer_type=CustomerType.STAFF,
                messages=["Staff order: large cappuccino"],
                expected_responses=["staff", "priority", "order confirmed"],
                expected_order_status=OrderStatus.PENDING
            ),
        ])
        
        # Group order scenarios
        scenarios.extend([
            TestScenario(
                name="Group order request",
                customer_type=CustomerType.GROUP,
                messages=["Group order for conference room A: 5 flat whites, 3 lattes"],
                expected_responses=["group order", "confirmed"],
                expected_order_status=OrderStatus.PENDING
            ),
        ])
        
        # Status check scenarios
        scenarios.extend([
            TestScenario(
                name="Order status check",
                customer_type=CustomerType.REGULAR,
                messages=["Large latte", "STATUS"],
                expected_responses=["order confirmed", "status"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Order cancellation",
                customer_type=CustomerType.REGULAR,
                messages=["Medium flat white", "CANCEL"],
                expected_responses=["order confirmed", "cancelled"],
                expected_order_status=OrderStatus.CANCELLED
            ),
        ])
        
        # Edge cases and problem scenarios
        scenarios.extend([
            TestScenario(
                name="Gibberish message",
                customer_type=CustomerType.PROBLEM,
                messages=["asdfjkl qwerty"],
                expected_responses=["didn't understand", "help"],
                expected_order_status=None
            ),
            TestScenario(
                name="Multiple orders rapid fire",
                customer_type=CustomerType.PROBLEM,
                messages=["Flat white", "No wait, latte", "Actually cappuccino"],
                expected_responses=["order confirmed"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Order during closing time",
                customer_type=CustomerType.REGULAR,
                messages=["Large flat white please"],
                expected_responses=["closed", "sorry"],
                expected_order_status=None,
                timing="closing"
            ),
            TestScenario(
                name="Out of stock item",
                customer_type=CustomerType.REGULAR,
                messages=["Latte with oat milk"],
                expected_responses=["sorry", "out of", "alternative"],
                expected_order_status=None
            ),
            TestScenario(
                name="Station full",
                customer_type=CustomerType.REGULAR,
                messages=["Cappuccino for station 1"],
                expected_responses=["station", "busy", "alternative"],
                expected_order_status=OrderStatus.PENDING,
                station_preference=1,
                timing="rush_hour"
            ),
        ])
        
        # Conversation flow scenarios
        scenarios.extend([
            TestScenario(
                name="Multi-turn conversation",
                customer_type=CustomerType.REGULAR,
                messages=[
                    "Hi, what coffee do you have?",
                    "MENU",
                    "Large flat white with soy milk",
                    "How long will it take?",
                    "STATUS"
                ],
                expected_responses=["menu", "flat white", "cappuccino", "order confirmed", "wait time"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Order modification",
                customer_type=CustomerType.REGULAR,
                messages=[
                    "Medium latte",
                    "Actually, can you make it large?",
                    "And add an extra shot"
                ],
                expected_responses=["order confirmed", "updated", "large", "extra shot"],
                expected_order_status=OrderStatus.PENDING
            ),
        ])
        
        # System boundary scenarios
        scenarios.extend([
            TestScenario(
                name="Maximum order limit",
                customer_type=CustomerType.PROBLEM,
                messages=[f"Coffee {i}" for i in range(10)],
                expected_responses=["limit", "maximum"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Unicode and emoji",
                customer_type=CustomerType.REGULAR,
                messages=["☕ Café latte s'il vous plaît 🥛"],
                expected_responses=["order confirmed", "latte"],
                expected_order_status=OrderStatus.PENDING
            ),
            TestScenario(
                name="Very long message",
                customer_type=CustomerType.PROBLEM,
                messages=["I would like to order a " + " very" * 50 + " large coffee please"],
                expected_responses=["order confirmed", "large"],
                expected_order_status=OrderStatus.PENDING
            ),
        ])
        
        return scenarios
    
    async def setup(self):
        """Initialize session and authenticate"""
        self.session = aiohttp.ClientSession()
        
        # Login to get auth token
        try:
            async with self.session.post(
                f"{self.backend_url}/api/auth/login",
                json={"username": "test_system", "password": "test123"}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    self.auth_token = data.get('access_token')
                    logger.info("Authentication successful")
                else:
                    logger.error(f"Authentication failed: {resp.status}")
        except Exception as e:
            logger.error(f"Setup failed: {e}")
    
    async def teardown(self):
        """Clean up session"""
        if self.session:
            await self.session.close()
    
    async def send_sms(self, phone_number: str, message: str) -> Dict:
        """Simulate sending an SMS to the system"""
        try:
            async with self.session.post(
                f"{self.backend_url}/sms",
                data={
                    'From': phone_number,
                    'Body': message,
                    'To': '+61489263333'  # System number
                }
            ) as resp:
                response_text = await resp.text()
                return {
                    'status': resp.status,
                    'response': response_text,
                    'headers': dict(resp.headers)
                }
        except Exception as e:
            logger.error(f"SMS send failed: {e}")
            return {'status': 500, 'response': str(e), 'headers': {}}
    
    async def check_order_status(self, phone_number: str) -> Optional[OrderStatus]:
        """Check the status of orders for a phone number"""
        try:
            headers = {'Authorization': f'Bearer {self.auth_token}'}
            async with self.session.get(
                f"{self.backend_url}/api/orders",
                headers=headers,
                params={'phone': phone_number}
            ) as resp:
                if resp.status == 200:
                    data = await resp.json()
                    orders = data.get('data', {}).get('orders', [])
                    if orders:
                        # Get the most recent order
                        latest_order = sorted(orders, key=lambda x: x.get('created_at', ''), reverse=True)[0]
                        return OrderStatus(latest_order.get('status', 'unknown'))
        except Exception as e:
            logger.error(f"Order status check failed: {e}")
        return None
    
    async def monitor_websocket_events(self, duration: int = 5) -> List[str]:
        """Monitor WebSocket events for a duration"""
        events = []
        # This would connect to the WebSocket and collect events
        # For now, we'll simulate it
        await asyncio.sleep(duration)
        return events
    
    async def get_backend_logs(self, start_time: datetime, end_time: datetime) -> List[str]:
        """Retrieve backend logs for the test period"""
        # In a real implementation, this would query the backend logging system
        return ["Backend log entries would go here"]
    
    async def run_scenario(self, scenario: TestScenario) -> TestResult:
        """Run a single test scenario"""
        logger.info(f"Running scenario: {scenario.name}")
        start_time = datetime.now()
        errors = []
        warnings = []
        actual_responses = []
        
        # Select a phone number for this scenario
        phone_number = random.choice(self.phone_numbers)
        
        try:
            # Send each message in the scenario
            for i, message in enumerate(scenario.messages):
                # Add delay between messages to simulate real conversation
                if i > 0:
                    await asyncio.sleep(random.uniform(1, 3))
                
                response = await self.send_sms(phone_number, message)
                
                if response['status'] != 200:
                    errors.append(f"SMS failed with status {response['status']}")
                
                actual_responses.append(response['response'])
                
                # Parse TwiML response
                if '<Message>' in response['response']:
                    sms_content = re.search(r'<Message>(.*?)</Message>', 
                                          response['response'], re.DOTALL)
                    if sms_content:
                        actual_responses[-1] = sms_content.group(1).strip()
            
            # Wait for order processing
            await asyncio.sleep(2)
            
            # Check order status
            actual_status = await self.check_order_status(phone_number)
            
            # Monitor WebSocket events
            ws_events = await self.monitor_websocket_events(5)
            
            # Get backend logs
            end_time = datetime.now()
            backend_logs = await self.get_backend_logs(start_time, end_time)
            
            # Validate responses
            success = True
            for expected in scenario.expected_responses:
                found = any(expected.lower() in resp.lower() for resp in actual_responses)
                if not found:
                    warnings.append(f"Expected response '{expected}' not found")
                    success = False
            
            # Validate order status
            if scenario.expected_order_status and actual_status != scenario.expected_order_status:
                errors.append(f"Expected status {scenario.expected_order_status.value}, "
                            f"got {actual_status.value if actual_status else 'None'}")
                success = False
            
            duration = (end_time - start_time).total_seconds()
            
            return TestResult(
                scenario=scenario,
                success=success and len(errors) == 0,
                actual_responses=actual_responses,
                actual_order_status=actual_status,
                errors=errors,
                warnings=warnings,
                duration=duration,
                backend_logs=backend_logs,
                frontend_events=ws_events
            )
            
        except Exception as e:
            logger.error(f"Scenario failed with exception: {e}")
            return TestResult(
                scenario=scenario,
                success=False,
                actual_responses=actual_responses,
                actual_order_status=None,
                errors=[str(e)],
                warnings=warnings,
                duration=(datetime.now() - start_time).total_seconds(),
                backend_logs=[],
                frontend_events=[]
            )
    
    async def run_load_test(self, concurrent_users: int = 10, duration: int = 60):
        """Run load test with multiple concurrent users"""
        logger.info(f"Starting load test: {concurrent_users} users for {duration} seconds")
        
        async def user_session(user_id: int):
            """Simulate a single user session"""
            phone = self.phone_numbers[user_id % len(self.phone_numbers)]
            messages = [
                "Large flat white",
                "STATUS",
                "Medium latte with soy",
                "CANCEL",
                "Small cappuccino"
            ]
            
            start = time.time()
            message_count = 0
            
            while time.time() - start < duration:
                message = random.choice(messages)
                await self.send_sms(phone, message)
                message_count += 1
                await asyncio.sleep(random.uniform(2, 10))
            
            return message_count
        
        # Run concurrent user sessions
        tasks = [user_session(i) for i in range(concurrent_users)]
        results = await asyncio.gather(*tasks)
        
        total_messages = sum(results)
        logger.info(f"Load test complete: {total_messages} messages sent")
        
        return {
            'total_messages': total_messages,
            'messages_per_second': total_messages / duration,
            'concurrent_users': concurrent_users,
            'duration': duration
        }
    
    async def run_all_tests(self):
        """Run all test scenarios"""
        await self.setup()
        
        scenarios = self._generate_scenarios()
        logger.info(f"Running {len(scenarios)} test scenarios")
        
        for scenario in scenarios:
            result = await self.run_scenario(scenario)
            self.test_results.append(result)
            
            # Log result
            status = "✓" if result.success else "✗"
            logger.info(f"{status} {scenario.name}: "
                       f"{len(result.errors)} errors, {len(result.warnings)} warnings")
        
        # Run load test
        load_results = await self.run_load_test()
        
        await self.teardown()
        
        # Generate report
        self.generate_report(load_results)
    
    def generate_report(self, load_results: Dict):
        """Generate comprehensive test report"""
        total_tests = len(self.test_results)
        passed_tests = sum(1 for r in self.test_results if r.success)
        failed_tests = total_tests - passed_tests
        
        report = f"""
# Expresso System Test Report
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Summary
- Total Scenarios: {total_tests}
- Passed: {passed_tests} ({passed_tests/total_tests*100:.1f}%)
- Failed: {failed_tests} ({failed_tests/total_tests*100:.1f}%)

## Load Test Results
- Total Messages: {load_results['total_messages']}
- Messages/Second: {load_results['messages_per_second']:.2f}
- Concurrent Users: {load_results['concurrent_users']}
- Duration: {load_results['duration']}s

## Detailed Results

"""
        
        # Group results by category
        for customer_type in CustomerType:
            type_results = [r for r in self.test_results 
                          if r.scenario.customer_type == customer_type]
            if not type_results:
                continue
                
            report += f"### {customer_type.value.title()} Customer Scenarios\n\n"
            
            for result in type_results:
                status = "PASS" if result.success else "FAIL"
                report += f"#### {result.scenario.name} [{status}]\n"
                report += f"- Duration: {result.duration:.2f}s\n"
                
                if result.errors:
                    report += f"- Errors:\n"
                    for error in result.errors:
                        report += f"  - {error}\n"
                
                if result.warnings:
                    report += f"- Warnings:\n"
                    for warning in result.warnings:
                        report += f"  - {warning}\n"
                
                report += f"- Messages sent: {result.scenario.messages}\n"
                report += f"- Responses received: {result.actual_responses}\n"
                report += f"- Final order status: {result.actual_order_status.value if result.actual_order_status else 'None'}\n"
                report += "\n"
        
        # Common issues
        report += "## Common Issues Found\n\n"
        
        all_errors = []
        all_warnings = []
        for result in self.test_results:
            all_errors.extend(result.errors)
            all_warnings.extend(result.warnings)
        
        error_counts = {}
        for error in all_errors:
            # Group similar errors
            key = re.sub(r'\d+', 'X', error)  # Replace numbers with X
            error_counts[key] = error_counts.get(key, 0) + 1
        
        for error, count in sorted(error_counts.items(), key=lambda x: x[1], reverse=True):
            report += f"- {error} (occurred {count} times)\n"
        
        # Recommendations
        report += "\n## Recommendations\n\n"
        
        if failed_tests > 0:
            report += "1. **Failed Scenarios**: Address the failing scenarios, particularly:\n"
            for result in self.test_results:
                if not result.success:
                    report += f"   - {result.scenario.name}\n"
        
        if load_results['messages_per_second'] < 1:
            report += "2. **Performance**: System is processing less than 1 message per second under load\n"
        
        # Find patterns in failures
        station_failures = [r for r in self.test_results 
                          if not r.success and r.scenario.station_preference]
        if station_failures:
            report += "3. **Station Assignment**: Issues with station-specific orders\n"
        
        vip_failures = [r for r in self.test_results 
                       if not r.success and r.scenario.customer_type in 
                       [CustomerType.VIP, CustomerType.STAFF]]
        if vip_failures:
            report += "4. **Priority Handling**: VIP/Staff orders not being prioritized correctly\n"
        
        # Save report
        with open('test_report.md', 'w') as f:
            f.write(report)
        
        logger.info(f"Test report generated: test_report.md")

async def main():
    """Run the test suite"""
    simulator = SMSSimulator()
    await simulator.run_all_tests()

if __name__ == "__main__":
    asyncio.run(main())
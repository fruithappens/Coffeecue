"""
Autonomous Testing and Improvement System
Tests, analyzes, and automatically improves the Expresso system
"""
import asyncio
import aiohttp
import json
import os
import subprocess
import re
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any
import logging
from dataclasses import dataclass, field
from enum import Enum
import pandas as pd
from collections import defaultdict
import numpy as np

# Import the SMS simulator
from sms_simulator import SMSSimulator, TestScenario, TestResult, CustomerType, OrderStatus

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

@dataclass
class SystemIssue:
    category: str  # "backend", "frontend", "integration", "performance"
    severity: str  # "critical", "high", "medium", "low"
    description: str
    affected_scenarios: List[str]
    suggested_fix: str
    file_path: Optional[str] = None
    line_number: Optional[int] = None
    
@dataclass
class PerformanceMetrics:
    response_times: List[float] = field(default_factory=list)
    error_rates: Dict[str, float] = field(default_factory=dict)
    throughput: float = 0.0
    availability: float = 0.0
    order_completion_rate: float = 0.0
    customer_satisfaction_score: float = 0.0

class AutonomousTester:
    def __init__(self, project_root: str = "/Users/stevewf/expresso"):
        self.project_root = project_root
        self.backend_path = project_root
        self.frontend_path = os.path.join(project_root, "Barista Front End")
        self.issues: List[SystemIssue] = []
        self.metrics = PerformanceMetrics()
        self.improvement_history: List[Dict] = []
        
    async def start_system(self):
        """Start backend and frontend services"""
        logger.info("Starting system services...")
        
        # Start backend
        self.backend_process = subprocess.Popen(
            ["python", "run_server.py"],
            cwd=self.backend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE
        )
        
        # Start frontend
        self.frontend_process = subprocess.Popen(
            ["npm", "start"],
            cwd=self.frontend_path,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env={**os.environ, "BROWSER": "none"}  # Don't open browser
        )
        
        # Wait for services to start
        await asyncio.sleep(10)
        logger.info("Services started")
    
    async def stop_system(self):
        """Stop all services"""
        logger.info("Stopping services...")
        if hasattr(self, 'backend_process'):
            self.backend_process.terminate()
        if hasattr(self, 'frontend_process'):
            self.frontend_process.terminate()
        await asyncio.sleep(2)
    
    async def monitor_logs(self, duration: int = 60) -> Dict[str, List[str]]:
        """Monitor backend and frontend logs"""
        logs = {
            'backend': [],
            'frontend': [],
            'errors': [],
            'warnings': []
        }
        
        start_time = time.time()
        
        while time.time() - start_time < duration:
            # Read backend logs
            if hasattr(self, 'backend_process'):
                line = self.backend_process.stdout.readline()
                if line:
                    line_str = line.decode('utf-8').strip()
                    logs['backend'].append(line_str)
                    
                    if 'ERROR' in line_str:
                        logs['errors'].append(('backend', line_str))
                    elif 'WARNING' in line_str:
                        logs['warnings'].append(('backend', line_str))
            
            # Read frontend logs
            if hasattr(self, 'frontend_process'):
                line = self.frontend_process.stdout.readline()
                if line:
                    line_str = line.decode('utf-8').strip()
                    logs['frontend'].append(line_str)
                    
                    if 'error' in line_str.lower():
                        logs['errors'].append(('frontend', line_str))
                    elif 'warning' in line_str.lower():
                        logs['warnings'].append(('frontend', line_str))
            
            await asyncio.sleep(0.1)
        
        return logs
    
    async def analyze_test_results(self, test_results: List[TestResult]) -> List[SystemIssue]:
        """Analyze test results and identify system issues"""
        issues = []
        
        # Analyze failures by category
        failure_patterns = defaultdict(list)
        
        for result in test_results:
            if not result.success:
                # Categorize failures
                if "station" in str(result.errors).lower():
                    failure_patterns['station_assignment'].append(result)
                elif "vip" in str(result.errors).lower() or "priority" in str(result.errors).lower():
                    failure_patterns['priority_handling'].append(result)
                elif "stock" in str(result.errors).lower() or "inventory" in str(result.errors).lower():
                    failure_patterns['inventory_management'].append(result)
                elif "closed" in str(result.errors).lower():
                    failure_patterns['schedule_management'].append(result)
                elif "timeout" in str(result.errors).lower():
                    failure_patterns['performance'].append(result)
                else:
                    failure_patterns['general'].append(result)
        
        # Create issues based on patterns
        for category, failures in failure_patterns.items():
            if len(failures) >= 2:  # Pattern detected
                severity = self._calculate_severity(category, len(failures))
                issue = self._create_issue(category, failures, severity)
                issues.append(issue)
        
        # Analyze performance
        response_times = [r.duration for r in test_results]
        avg_response_time = np.mean(response_times)
        
        if avg_response_time > 5.0:
            issues.append(SystemIssue(
                category="performance",
                severity="high",
                description=f"Average response time {avg_response_time:.2f}s exceeds 5s threshold",
                affected_scenarios=[r.scenario.name for r in test_results if r.duration > 5],
                suggested_fix="Implement caching and optimize database queries"
            ))
        
        # Analyze error patterns in logs
        log_issues = await self._analyze_logs(test_results)
        issues.extend(log_issues)
        
        return issues
    
    def _calculate_severity(self, category: str, failure_count: int) -> str:
        """Calculate issue severity based on category and frequency"""
        if category in ['station_assignment', 'priority_handling'] and failure_count > 5:
            return "critical"
        elif category == 'performance' and failure_count > 3:
            return "high"
        elif failure_count > 10:
            return "high"
        elif failure_count > 5:
            return "medium"
        else:
            return "low"
    
    def _create_issue(self, category: str, failures: List[TestResult], severity: str) -> SystemIssue:
        """Create a system issue from failure pattern"""
        issue_templates = {
            'station_assignment': {
                'description': "Station assignment logic failing for {count} scenarios",
                'fix': "Review station filtering in useOrders.js and SMS parsing in sms_routes.py",
                'file': "routes/sms_routes.py",
                'line': 45  # Approximate line number
            },
            'priority_handling': {
                'description': "VIP/Priority orders not being handled correctly in {count} cases",
                'fix': "Update priority detection in coffee_system.py and order sorting in frontend",
                'file': "services/coffee_system.py",
                'line': 234
            },
            'inventory_management': {
                'description': "Inventory checks failing, affecting {count} order scenarios",
                'fix': "Implement proper inventory validation in walk-in orders and SMS orders",
                'file': "services/InventoryIntegrationService.js",
                'line': 156
            },
            'schedule_management': {
                'description': "Schedule/closing time checks not working in {count} scenarios",
                'fix': "Implement operating hours check in order processing",
                'file': "routes/api_routes.py",
                'line': 89
            },
            'performance': {
                'description': "Performance issues detected in {count} scenarios",
                'fix': "Add database indexes and implement Redis caching",
                'file': "app.py",
                'line': None
            }
        }
        
        template = issue_templates.get(category, {
            'description': f"Unknown issue category {category} affecting {{count}} scenarios",
            'fix': "Investigate error patterns and implement appropriate fixes",
            'file': None,
            'line': None
        })
        
        return SystemIssue(
            category="backend" if category in ['station_assignment', 'schedule_management'] else "integration",
            severity=severity,
            description=template['description'].format(count=len(failures)),
            affected_scenarios=[f.scenario.name for f in failures[:5]],  # First 5 examples
            suggested_fix=template['fix'],
            file_path=template.get('file'),
            line_number=template.get('line')
        )
    
    async def _analyze_logs(self, test_results: List[TestResult]) -> List[SystemIssue]:
        """Analyze logs for additional issues"""
        issues = []
        
        # Collect all backend logs
        all_logs = []
        for result in test_results:
            all_logs.extend(result.backend_logs)
        
        # Look for common error patterns
        error_patterns = {
            r"CORS.*error": ("CORS configuration issues", "backend", "Update CORS settings in app.py"),
            r"JWT.*expired": ("JWT token expiration issues", "backend", "Implement token refresh logic"),
            r"WebSocket.*failed": ("WebSocket connection failures", "integration", "Check SocketIO configuration"),
            r"Database.*timeout": ("Database performance issues", "backend", "Optimize queries and add connection pooling"),
            r"undefined.*milk": ("Milk type handling errors", "frontend", "Fix milk type validation in components")
        }
        
        for pattern, (description, category, fix) in error_patterns.items():
            matches = [log for log in all_logs if re.search(pattern, log, re.IGNORECASE)]
            if len(matches) > 2:
                issues.append(SystemIssue(
                    category=category,
                    severity="medium" if len(matches) < 10 else "high",
                    description=f"{description} ({len(matches)} occurrences)",
                    affected_scenarios=[],
                    suggested_fix=fix
                ))
        
        return issues
    
    async def apply_automatic_fixes(self, issues: List[SystemIssue]) -> List[Dict]:
        """Automatically apply fixes for known issues"""
        fixes_applied = []
        
        for issue in issues:
            if issue.severity in ["critical", "high"] and issue.file_path:
                fix_result = await self._apply_fix(issue)
                if fix_result:
                    fixes_applied.append(fix_result)
        
        return fixes_applied
    
    async def _apply_fix(self, issue: SystemIssue) -> Optional[Dict]:
        """Apply a specific fix to the codebase"""
        fix_strategies = {
            'station_assignment': self._fix_station_assignment,
            'priority_handling': self._fix_priority_handling,
            'inventory_management': self._fix_inventory_management,
            'performance': self._fix_performance
        }
        
        # Find matching strategy
        for category, fix_func in fix_strategies.items():
            if category in issue.description.lower():
                result = await fix_func(issue)
                if result:
                    return {
                        'issue': issue.description,
                        'fix_applied': result,
                        'timestamp': datetime.now().isoformat()
                    }
        
        return None
    
    async def _fix_station_assignment(self, issue: SystemIssue) -> Optional[str]:
        """Fix station assignment issues"""
        # Read the SMS routes file
        file_path = os.path.join(self.backend_path, "routes/sms_routes.py")
        
        try:
            with open(file_path, 'r') as f:
                content = f.read()
            
            # Improve station detection regex
            old_pattern = r'station_match = re.search\(r".*?"\)'
            new_pattern = '''station_match = re.search(
                r'(?:(?:for|to|at|station)\\s*)?(?:#|number|no\\.?)?\\s*(\\d+)|station\\s*(\\d+)',
                body.lower()
            )'''
            
            if 'station_match = re.search' in content:
                # Update the regex pattern
                content = re.sub(old_pattern, new_pattern, content)
                
                with open(file_path, 'w') as f:
                    f.write(content)
                
                return "Updated station detection regex to handle more formats"
        except Exception as e:
            logger.error(f"Failed to apply station assignment fix: {e}")
        
        return None
    
    async def _fix_priority_handling(self, issue: SystemIssue) -> Optional[str]:
        """Fix VIP/priority handling"""
        # Update both backend and frontend
        fixes = []
        
        # Backend fix
        backend_file = os.path.join(self.backend_path, "services/coffee_system.py")
        try:
            with open(backend_file, 'r') as f:
                content = f.read()
            
            # Add VIP keywords if not present
            if 'vip_keywords' not in content:
                vip_section = '''
        # Enhanced VIP detection
        vip_keywords = ['vip', 'staff', 'priority', 'urgent', 'event staff', 'organizer', 'organiser']
        is_vip = any(keyword in body.lower() for keyword in vip_keywords)
        if is_vip:
            order.priority = True
            order.vip = True
'''
                # Insert after order creation
                content = content.replace('order = Order(', f'{vip_section}\n        order = Order(')
                
                with open(backend_file, 'w') as f:
                    f.write(content)
                
                fixes.append("Added enhanced VIP keyword detection")
        except Exception as e:
            logger.error(f"Failed to apply backend priority fix: {e}")
        
        # Frontend fix
        frontend_file = os.path.join(self.frontend_path, "src/utils/orderUtils.js")
        try:
            with open(frontend_file, 'r') as f:
                content = f.read()
            
            # Update order sorting to prioritize VIP
            if 'sortOrders' not in content:
                sort_function = '''
export const sortOrders = (orders) => {
  return orders.sort((a, b) => {
    // VIP/Priority orders first
    if (a.priority && !b.priority) return -1;
    if (!a.priority && b.priority) return 1;
    if (a.vip && !b.vip) return -1;
    if (!a.vip && b.vip) return 1;
    
    // Then by wait time ratio
    const ratioA = a.waitTime / a.promisedTime;
    const ratioB = b.waitTime / b.promisedTime;
    return ratioB - ratioA;
  });
};
'''
                content += f"\n{sort_function}"
                
                with open(frontend_file, 'w') as f:
                    f.write(content)
                
                fixes.append("Added VIP order sorting function")
        except Exception as e:
            logger.error(f"Failed to apply frontend priority fix: {e}")
        
        return " and ".join(fixes) if fixes else None
    
    async def _fix_inventory_management(self, issue: SystemIssue) -> Optional[str]:
        """Fix inventory validation issues"""
        # Add inventory checking to SMS orders
        file_path = os.path.join(self.backend_path, "services/coffee_system.py")
        
        try:
            with open(file_path, 'r') as f:
                content = f.read()
            
            # Add inventory check function
            inventory_check = '''
    def check_inventory_availability(self, coffee_type, milk_type, station_id=None):
        """Check if ingredients are available"""
        try:
            # Query inventory for the station
            from models.inventory import StationInventory, InventoryItem
            
            # Check coffee availability
            coffee_items = InventoryItem.query.filter_by(category='coffee').all()
            coffee_available = any(item.current_amount > 0 for item in coffee_items)
            
            if not coffee_available:
                return False, "Sorry, we're out of coffee at the moment."
            
            # Check milk availability if needed
            if milk_type and milk_type.lower() not in ['no milk', 'black']:
                milk_id = f'milk_{milk_type.lower().replace(" ", "_")}'
                milk_item = InventoryItem.query.filter_by(item_id=milk_id).first()
                
                if milk_item and milk_item.current_amount <= 0:
                    return False, f"Sorry, we're out of {milk_type}. Would you like a different milk?"
            
            return True, None
        except Exception as e:
            logger.error(f"Inventory check failed: {e}")
            return True, None  # Allow order if check fails
'''
            
            if 'check_inventory_availability' not in content:
                # Add the function
                content = content.replace('class CoffeeOrderSystem:', 
                                        f'class CoffeeOrderSystem:{inventory_check}')
                
                # Use it in order creation
                content = content.replace(
                    'order = Order(',
                    '''# Check inventory first
        available, message = self.check_inventory_availability(coffee_type, milk_type)
        if not available:
            return message
        
        order = Order('''
                )
                
                with open(file_path, 'w') as f:
                    f.write(content)
                
                return "Added inventory availability checking for SMS orders"
        except Exception as e:
            logger.error(f"Failed to apply inventory fix: {e}")
        
        return None
    
    async def _fix_performance(self, issue: SystemIssue) -> Optional[str]:
        """Apply performance optimizations"""
        fixes = []
        
        # Add database indexes
        migration_file = os.path.join(self.backend_path, "migrations/add_indexes.py")
        try:
            migration_content = '''
"""Add performance indexes"""
from alembic import op
import sqlalchemy as sa

def upgrade():
    # Add indexes for common queries
    op.create_index('idx_orders_phone', 'orders', ['phone_number'])
    op.create_index('idx_orders_status', 'orders', ['status'])
    op.create_index('idx_orders_station', 'orders', ['station_id'])
    op.create_index('idx_orders_created', 'orders', ['created_at'])
    op.create_index('idx_station_inventory', 'station_inventory', ['station_id', 'inventory_item_id'])

def downgrade():
    op.drop_index('idx_orders_phone')
    op.drop_index('idx_orders_status')
    op.drop_index('idx_orders_station')
    op.drop_index('idx_orders_created')
    op.drop_index('idx_station_inventory')
'''
            with open(migration_file, 'w') as f:
                f.write(migration_content)
            
            # Run migration
            subprocess.run(['python', '-m', 'flask', 'db', 'upgrade'], 
                         cwd=self.backend_path, capture_output=True)
            
            fixes.append("Added database indexes for performance")
        except Exception as e:
            logger.error(f"Failed to add indexes: {e}")
        
        # Add caching configuration
        cache_file = os.path.join(self.backend_path, "utils/cache.py")
        try:
            cache_content = '''
"""Simple caching utility"""
from functools import wraps
from datetime import datetime, timedelta
import json

_cache = {}

def cache_result(duration_seconds=300):
    """Cache function results for specified duration"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            # Create cache key
            key = f"{func.__name__}:{str(args)}:{str(kwargs)}"
            
            # Check cache
            if key in _cache:
                result, timestamp = _cache[key]
                if datetime.now() - timestamp < timedelta(seconds=duration_seconds):
                    return result
            
            # Call function and cache result
            result = func(*args, **kwargs)
            _cache[key] = (result, datetime.now())
            return result
        return wrapper
    return decorator

def clear_cache():
    """Clear all cached results"""
    _cache.clear()
'''
            with open(cache_file, 'w') as f:
                f.write(cache_content)
            
            fixes.append("Added caching utility for API responses")
        except Exception as e:
            logger.error(f"Failed to add caching: {e}")
        
        return " and ".join(fixes) if fixes else None
    
    async def generate_improvement_report(self, test_results: List[TestResult], 
                                        issues: List[SystemIssue], 
                                        fixes_applied: List[Dict]) -> str:
        """Generate comprehensive improvement report"""
        report = f"""
# Autonomous Testing and Improvement Report
Generated: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}

## Test Summary
- Total Test Scenarios: {len(test_results)}
- Successful: {sum(1 for r in test_results if r.success)}
- Failed: {sum(1 for r in test_results if not r.success)}
- Success Rate: {sum(1 for r in test_results if r.success) / len(test_results) * 100:.1f}%

## Performance Metrics
- Average Response Time: {np.mean([r.duration for r in test_results]):.2f}s
- 95th Percentile Response Time: {np.percentile([r.duration for r in test_results], 95):.2f}s
- Error Rate: {sum(1 for r in test_results if r.errors) / len(test_results) * 100:.1f}%

## Issues Identified
"""
        
        # Group issues by severity
        for severity in ['critical', 'high', 'medium', 'low']:
            severity_issues = [i for i in issues if i.severity == severity]
            if severity_issues:
                report += f"\n### {severity.title()} Severity Issues ({len(severity_issues)})\n"
                for issue in severity_issues:
                    report += f"\n**{issue.description}**\n"
                    report += f"- Category: {issue.category}\n"
                    report += f"- Affected Scenarios: {', '.join(issue.affected_scenarios[:3])}\n"
                    report += f"- Suggested Fix: {issue.suggested_fix}\n"
                    if issue.file_path:
                        report += f"- Location: {issue.file_path}"
                        if issue.line_number:
                            report += f":{issue.line_number}"
                        report += "\n"
        
        report += f"\n## Automatic Fixes Applied ({len(fixes_applied)})\n"
        for fix in fixes_applied:
            report += f"\n### {fix['issue']}\n"
            report += f"- Fix: {fix['fix_applied']}\n"
            report += f"- Applied at: {fix['timestamp']}\n"
        
        # Recommendations
        report += "\n## Recommendations for Manual Review\n"
        
        unfixed_critical = [i for i in issues if i.severity == 'critical' 
                           and not any(f['issue'] == i.description for f in fixes_applied)]
        
        if unfixed_critical:
            report += "\n### Critical Issues Requiring Manual Intervention\n"
            for issue in unfixed_critical:
                report += f"1. **{issue.description}**\n"
                report += f"   - {issue.suggested_fix}\n"
        
        # Next steps
        report += "\n## Next Steps\n"
        report += "1. Review and test the automatic fixes applied\n"
        report += "2. Address remaining critical and high severity issues\n"
        report += "3. Re-run the test suite to verify improvements\n"
        report += "4. Monitor production metrics for 24 hours\n"
        
        # Save report
        report_path = os.path.join(self.project_root, 'autonomous_test_report.md')
        with open(report_path, 'w') as f:
            f.write(report)
        
        logger.info(f"Improvement report saved to: {report_path}")
        
        return report
    
    async def continuous_improvement_loop(self, iterations: int = 3):
        """Run continuous testing and improvement cycles"""
        logger.info(f"Starting continuous improvement loop ({iterations} iterations)")
        
        for i in range(iterations):
            logger.info(f"\n=== Iteration {i+1}/{iterations} ===")
            
            # Start services
            await self.start_system()
            
            # Run tests
            simulator = SMSSimulator()
            await simulator.setup()
            
            scenarios = simulator._generate_scenarios()
            test_results = []
            
            # Run scenarios with log monitoring
            log_monitor_task = asyncio.create_task(self.monitor_logs(len(scenarios) * 10))
            
            for scenario in scenarios:
                result = await simulator.run_scenario(scenario)
                test_results.append(result)
            
            logs = await log_monitor_task
            
            # Analyze results
            issues = await self.analyze_test_results(test_results)
            
            # Apply automatic fixes
            fixes_applied = await self.apply_automatic_fixes(issues)
            
            # Generate report
            report = await self.generate_improvement_report(test_results, issues, fixes_applied)
            
            # Stop services
            await self.stop_system()
            
            # If no critical issues or all tests pass, we're done
            if not any(i.severity == 'critical' for i in issues) or \
               all(r.success for r in test_results):
                logger.info("System is functioning well, ending improvement loop")
                break
            
            # Wait before next iteration to let fixes settle
            if i < iterations - 1:
                logger.info("Waiting 30 seconds before next iteration...")
                await asyncio.sleep(30)
        
        logger.info("Continuous improvement loop complete")

async def main():
    """Run the autonomous testing system"""
    tester = AutonomousTester()
    
    # Run the continuous improvement loop
    await tester.continuous_improvement_loop(iterations=3)
    
    logger.info("Autonomous testing complete")

if __name__ == "__main__":
    import time
    asyncio.run(main())
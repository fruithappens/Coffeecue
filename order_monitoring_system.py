#!/usr/bin/env python3
"""
Order Monitoring and Fallback System
- Monitors orders that aren't appearing in barista interfaces
- Provides fallback assignment for lost orders
- Notifies support of problematic orders
- Creates support dashboard alerts
"""
import psycopg2
import json
from datetime import datetime, timedelta
import config
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class OrderMonitoringSystem:
    def __init__(self):
        self.conn = psycopg2.connect(config.DATABASE_URL)
        
    def check_orders_by_station(self, station_id=None):
        """Check orders for a specific station or all stations"""
        try:
            cur = self.conn.cursor()
            
            if station_id:
                cur.execute("""
                    SELECT o.id, o.order_number, o.status, o.station_id, o.created_at, 
                           o.order_details, s.barista_name, s.status as station_status
                    FROM orders o
                    LEFT JOIN station_stats s ON o.station_id = s.station_id
                    WHERE o.station_id = %s AND o.status IN ('pending', 'in_progress')
                    ORDER BY o.created_at ASC
                """, (station_id,))
                print(f"📋 Orders for Station {station_id}:")
            else:
                cur.execute("""
                    SELECT o.id, o.order_number, o.status, o.station_id, o.created_at, 
                           o.order_details, s.barista_name, s.status as station_status
                    FROM orders o
                    LEFT JOIN station_stats s ON o.station_id = s.station_id
                    WHERE o.status IN ('pending', 'in_progress')
                    ORDER BY o.station_id, o.created_at ASC
                """)
                print("📋 All active orders by station:")
            
            orders = cur.fetchall()
            
            current_station = None
            for order in orders:
                order_id, order_number, status, station_id, created_at, order_details, barista_name, station_status = order
                
                if current_station != station_id:
                    current_station = station_id
                    print(f"\n  Station {station_id} ({barista_name or 'No barista'}) - {station_status or 'Unknown'}:")
                
                try:
                    details = json.loads(order_details)
                    customer_name = details.get('name', 'Unknown')
                    drink_type = details.get('type', 'Unknown')
                    milk_type = details.get('milk', 'Unknown')
                    size = details.get('size', 'Unknown')
                except:
                    customer_name = drink_type = milk_type = size = 'Unknown'
                
                age_minutes = int((datetime.now() - created_at).total_seconds() / 60)
                
                status_icon = "🟡" if status == "pending" else "🔵"
                age_warning = " ⚠️" if age_minutes > 15 else ""
                
                print(f"    {status_icon} {order_number}: {customer_name} - {size} {drink_type} w/ {milk_type} ({age_minutes}min){age_warning}")
            
            if not orders:
                print("  No active orders found")
            
            return orders
            
        except Exception as e:
            logger.error(f"Error checking orders: {e}")
            return []
    
    def create_support_notification(self, order_number, issue_description, alert_type="info"):
        """Create a support notification for problematic orders"""
        try:
            cur = self.conn.cursor()
            
            # Create a notification in the order_messages table (modified for general notifications)
            notification_content = {
                "type": alert_type,
                "order_number": order_number,
                "issue": issue_description,
                "timestamp": datetime.now().isoformat(),
                "requires_action": alert_type in ["warning", "error"]
            }
            
            # Insert into SMS messages table as a system notification
            cur.execute("""
                INSERT INTO sms_messages (phone, message, message_sid, sent_at)
                VALUES (%s, %s, %s, %s)
            """, (
                "SUPPORT_SYSTEM",
                f"ORDER ALERT: {order_number} - {issue_description}",
                f"SUPPORT_{datetime.now().strftime('%Y%m%d_%H%M%S')}",
                datetime.now()
            ))
            
            self.conn.commit()
            print(f"📝 Created support notification for {order_number}: {issue_description}")
            
            return True
            
        except Exception as e:
            logger.error(f"Error creating support notification: {e}")
            return False
    
    def check_station_capabilities_vs_orders(self):
        """Check if stations can actually handle their assigned orders"""
        try:
            cur = self.conn.cursor()
            
            print("\n🔍 Checking station capabilities vs assigned orders...")
            
            # Get all pending orders with station capabilities
            cur.execute("""
                SELECT o.order_number, o.order_details, o.station_id, 
                       s.capabilities, s.barista_name, s.status
                FROM orders o
                LEFT JOIN station_stats s ON o.station_id = s.station_id
                WHERE o.status = 'pending'
                ORDER BY o.created_at ASC
            """)
            
            orders = cur.fetchall()
            issues_found = 0
            
            for order_number, order_details, station_id, capabilities, barista_name, station_status in orders:
                issues = []
                
                # Check if station exists
                if not station_status:
                    issues.append(f"Station {station_id} doesn't exist")
                elif station_status != 'active':
                    issues.append(f"Station {station_id} is {station_status}")
                
                # Parse order requirements
                try:
                    details = json.loads(order_details)
                    coffee_type = details.get('type', '').lower()
                    milk_type = details.get('milk', '').lower() 
                    cup_size = details.get('size', '').lower()
                    
                    # Check capabilities if they exist
                    if capabilities:
                        caps = json.loads(capabilities) if isinstance(capabilities, str) else capabilities
                        
                        coffee_types = [ct.lower() for ct in caps.get('coffee_types', [])]
                        milk_options = [mt.lower() for mt in caps.get('milk_options', [])]
                        cup_sizes = [cs.lower() for cs in caps.get('cup_sizes', [])]
                        
                        if coffee_types and coffee_type and coffee_type not in coffee_types:
                            issues.append(f"Can't make {coffee_type}")
                        
                        if milk_options and milk_type and milk_type not in milk_options:
                            issues.append(f"No {milk_type} milk")
                        
                        if cup_sizes and cup_size and cup_size not in cup_sizes:
                            issues.append(f"No {cup_size} cups")
                    
                except Exception as e:
                    issues.append(f"Invalid order data: {e}")
                
                if issues:
                    issues_found += 1
                    issue_description = "; ".join(issues)
                    print(f"  ⚠️  {order_number} (Station {station_id}): {issue_description}")
                    
                    # Create support notification for serious issues
                    if any(term in issue_description.lower() for term in ['doesn\'t exist', 'can\'t make']):
                        self.create_support_notification(
                            order_number, 
                            f"Station assignment issue: {issue_description}",
                            "error"
                        )
            
            if issues_found == 0:
                print("  ✅ All orders properly assigned to capable stations")
            else:
                print(f"  ⚠️  Found {issues_found} orders with assignment issues")
            
            return issues_found
            
        except Exception as e:
            logger.error(f"Error checking capabilities: {e}")
            return -1
    
    def auto_fix_problematic_orders(self, dry_run=True):
        """Automatically fix orders that can't be handled by their assigned stations"""
        try:
            cur = self.conn.cursor()
            
            print(f"\n🔧 {'[DRY RUN] ' if dry_run else ''}Auto-fixing problematic orders...")
            
            # Find orders assigned to non-existent or inactive stations
            cur.execute("""
                SELECT o.id, o.order_number, o.station_id, o.order_details
                FROM orders o
                LEFT JOIN station_stats s ON o.station_id = s.station_id
                WHERE o.status = 'pending' 
                AND (s.station_id IS NULL OR s.status != 'active')
            """)
            
            problematic_orders = cur.fetchall()
            fixed_count = 0
            
            for order_id, order_number, old_station_id, order_details in problematic_orders:
                # Try to find a suitable station
                new_station_id = self.find_suitable_station(order_details)
                
                if new_station_id:
                    print(f"  🔄 {order_number}: Station {old_station_id} → Station {new_station_id}")
                    
                    if not dry_run:
                        cur.execute("""
                            UPDATE orders 
                            SET station_id = %s, updated_at = %s
                            WHERE id = %s
                        """, (new_station_id, datetime.now(), order_id))
                        
                        self.create_support_notification(
                            order_number,
                            f"Auto-reassigned from Station {old_station_id} to Station {new_station_id}",
                            "info"
                        )
                    
                    fixed_count += 1
                else:
                    # Move to fallback station
                    print(f"  🚨 {order_number}: Station {old_station_id} → FALLBACK (999)")
                    
                    if not dry_run:
                        cur.execute("""
                            UPDATE orders 
                            SET station_id = 999, updated_at = %s
                            WHERE id = %s
                        """, (datetime.now(), order_id))
                        
                        self.create_support_notification(
                            order_number,
                            f"FALLBACK: Moved to support station (original: {old_station_id})",
                            "warning"
                        )
                    
                    fixed_count += 1
            
            if not dry_run and fixed_count > 0:
                self.conn.commit()
                print(f"  ✅ Fixed {fixed_count} orders")
            elif fixed_count > 0:
                print(f"  📋 Would fix {fixed_count} orders (dry run)")
            else:
                print("  ✅ No orders need fixing")
            
            return fixed_count
            
        except Exception as e:
            logger.error(f"Error auto-fixing orders: {e}")
            if not dry_run:
                self.conn.rollback()
            return -1
    
    def find_suitable_station(self, order_details):
        """Find a station that can handle the given order"""
        try:
            cur = self.conn.cursor()
            
            # Parse order requirements
            if isinstance(order_details, str):
                order_details = json.loads(order_details)
            
            coffee_type = order_details.get('type', '').lower()
            milk_type = order_details.get('milk', '').lower()
            cup_size = order_details.get('size', '').lower()
            
            # Get all active stations (except fallback 999)
            cur.execute("""
                SELECT station_id, capabilities, current_load
                FROM station_stats 
                WHERE status = 'active' AND station_id < 999
                ORDER BY current_load ASC
            """)
            
            stations = cur.fetchall()
            
            for station_id, capabilities, current_load in stations:
                if not capabilities:
                    # If no capabilities defined, assume it can handle basic orders
                    return station_id
                
                caps = json.loads(capabilities) if isinstance(capabilities, str) else capabilities
                
                # Check compatibility
                coffee_types = [ct.lower() for ct in caps.get('coffee_types', [])]
                milk_options = [mt.lower() for mt in caps.get('milk_options', [])]
                cup_sizes = [cs.lower() for cs in caps.get('cup_sizes', [])]
                
                can_make_coffee = not coffee_types or coffee_type in coffee_types
                can_make_milk = not milk_options or milk_type in milk_options
                can_make_size = not cup_sizes or cup_size in cup_sizes
                
                if can_make_coffee and can_make_milk and can_make_size:
                    return station_id
            
            return None
            
        except Exception as e:
            logger.error(f"Error finding suitable station: {e}")
            return None
    
    def run_comprehensive_check(self, fix_issues=False):
        """Run a comprehensive check of the order system"""
        print("🔍 COMPREHENSIVE ORDER SYSTEM CHECK")
        print("=" * 60)
        
        # Check orders by station
        self.check_orders_by_station()
        
        # Check station capabilities vs orders
        issues_found = self.check_station_capabilities_vs_orders()
        
        # Auto-fix if requested
        if fix_issues and issues_found > 0:
            fixed_count = self.auto_fix_problematic_orders(dry_run=False)
            if fixed_count > 0:
                print(f"\n✅ Fixed {fixed_count} problematic orders")
        elif issues_found > 0:
            print(f"\n💡 Run with fix_issues=True to automatically fix {issues_found} issues")
        
        print("\n" + "=" * 60)
        print("✅ Comprehensive check complete")
    
    def close(self):
        """Close database connection"""
        self.conn.close()

def main():
    """Main function - run comprehensive order monitoring"""
    monitor = OrderMonitoringSystem()
    
    try:
        # Check specific station first (Station 1 where our missing order should be)
        print("🎯 Checking Station 1 specifically (where A11001259 should be):")
        monitor.check_orders_by_station(1)
        
        print("\n")
        
        # Run comprehensive check
        monitor.run_comprehensive_check(fix_issues=True)
        
    except Exception as e:
        logger.error(f"Error in monitoring system: {e}")
    finally:
        monitor.close()

if __name__ == "__main__":
    main()
#!/usr/bin/env python3
"""
Comprehensive Order Fallback and Tracking System
Ensures no orders get lost and provides support notifications for problematic orders
"""
import psycopg2
import json
from datetime import datetime, timedelta
import config
import logging

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

class OrderFallbackSystem:
    def __init__(self):
        self.conn = psycopg2.connect(config.DATABASE_URL)
    
    def check_stuck_orders(self, max_pending_minutes=15):
        """Find orders that have been pending too long"""
        try:
            cur = self.conn.cursor()
            
            # Find orders pending longer than threshold
            cur.execute("""
                SELECT id, order_number, phone, order_details, station_id, created_at
                FROM orders 
                WHERE status = 'pending' 
                AND created_at < NOW() - INTERVAL '%s minutes'
                ORDER BY created_at ASC
            """, (max_pending_minutes,))
            
            stuck_orders = cur.fetchall()
            
            if stuck_orders:
                print(f"⚠️  Found {len(stuck_orders)} orders stuck in pending status:")
                
                for order in stuck_orders:
                    order_id, order_number, phone, order_details, station_id, created_at = order
                    minutes_stuck = int((datetime.now() - created_at).total_seconds() / 60)
                    
                    try:
                        details = json.loads(order_details)
                        customer_name = details.get('name', 'Unknown')
                        drink_type = details.get('type', 'Unknown')
                    except:
                        customer_name = 'Unknown'
                        drink_type = 'Unknown'
                    
                    print(f"   📋 {order_number}: {customer_name} - {drink_type} (Station {station_id}) - {minutes_stuck}min ago")
                    
                    # Check if station is still valid
                    self.validate_and_fix_order_assignment(order_id, order_number, station_id, order_details)
            
            return stuck_orders
            
        except Exception as e:
            logger.error(f"Error checking stuck orders: {e}")
            return []
    
    def validate_and_fix_order_assignment(self, order_id, order_number, station_id, order_details):
        """Validate order assignment and fix if needed"""
        try:
            cur = self.conn.cursor()
            
            # Check if assigned station exists and is active
            cur.execute("""
                SELECT station_id, status, capabilities, barista_name
                FROM station_stats 
                WHERE station_id = %s
            """, (station_id,))
            
            station = cur.fetchone()
            
            if not station:
                print(f"   ❌ Station {station_id} doesn't exist - reassigning to fallback")
                self.reassign_to_fallback(order_id, order_number, "Station doesn't exist")
                return
            
            station_id_db, status, capabilities, barista_name = station
            
            if status != 'active':
                print(f"   ❌ Station {station_id} is {status} - reassigning to active station")
                new_station = self.find_suitable_station(order_details)
                if new_station:
                    self.reassign_order(order_id, order_number, new_station, f"Original station {station_id} inactive")
                else:
                    self.reassign_to_fallback(order_id, order_number, "No active stations available")
                return
            
            # Check if station can handle the order
            can_handle = self.check_station_compatibility(order_details, capabilities)
            
            if not can_handle:
                print(f"   ⚠️  Station {station_id} cannot handle this order - reassigning")
                new_station = self.find_suitable_station(order_details)
                if new_station:
                    self.reassign_order(order_id, order_number, new_station, f"Station {station_id} lacks required capabilities")
                else:
                    self.reassign_to_fallback(order_id, order_number, "No suitable station found")
                return
            
            # If we get here, the order is properly assigned but just stuck
            print(f"   ✅ Order properly assigned to Station {station_id} ({barista_name or 'No barista'})")
            
            # Check if there's a barista assigned
            if not barista_name or barista_name.strip() == '':
                print(f"   ⚠️  No barista assigned to Station {station_id}")
                
        except Exception as e:
            logger.error(f"Error validating order assignment: {e}")
    
    def check_station_compatibility(self, order_details, capabilities):
        """Check if station can handle the order requirements"""
        try:
            if isinstance(order_details, str):
                order_details = json.loads(order_details)
            
            if not capabilities:
                # If no capabilities defined, assume it can handle basic orders
                return True
                
            if isinstance(capabilities, str):
                capabilities = json.loads(capabilities)
            
            # Extract order requirements
            coffee_type = order_details.get('type', '').lower()
            milk_type = order_details.get('milk', '').lower()
            cup_size = order_details.get('size', '').lower()
            
            # Check coffee type
            coffee_types = [ct.lower() for ct in capabilities.get('coffee_types', [])]
            if coffee_types and coffee_type and coffee_type not in coffee_types:
                return False
            
            # Check milk type
            milk_options = [mt.lower() for mt in capabilities.get('milk_options', [])]
            if milk_options and milk_type and milk_type not in milk_options:
                return False
            
            # Check cup size
            cup_sizes = [cs.lower() for cs in capabilities.get('cup_sizes', [])]
            if cup_sizes and cup_size and cup_size not in cup_sizes:
                return False
            
            return True
            
        except Exception as e:
            logger.error(f"Error checking compatibility: {e}")
            return True  # Default to compatible if error
    
    def find_suitable_station(self, order_details):
        """Find a station that can handle this order"""
        try:
            cur = self.conn.cursor()
            
            # Get all active stations except fallback
            cur.execute("""
                SELECT station_id, capabilities, current_load
                FROM station_stats 
                WHERE status = 'active' AND station_id < 999
                ORDER BY current_load ASC
            """)
            
            stations = cur.fetchall()
            
            for station_id, capabilities, current_load in stations:
                if self.check_station_compatibility(order_details, capabilities):
                    return station_id
            
            return None
            
        except Exception as e:
            logger.error(f"Error finding suitable station: {e}")
            return None
    
    def reassign_order(self, order_id, order_number, new_station_id, reason):
        """Reassign order to a new station"""
        try:
            cur = self.conn.cursor()
            
            cur.execute("""
                UPDATE orders 
                SET station_id = %s, updated_at = %s
                WHERE id = %s
            """, (new_station_id, datetime.now(), order_id))
            
            # Log the reassignment
            cur.execute("""
                INSERT INTO order_messages (order_id, message_type, content, created_at)
                VALUES (%s, %s, %s, %s)
            """, (order_id, 'system', f"Order reassigned to Station {new_station_id}: {reason}", datetime.now()))
            
            self.conn.commit()
            print(f"   ✅ Reassigned {order_number} to Station {new_station_id}")
            
        except Exception as e:
            logger.error(f"Error reassigning order: {e}")
            self.conn.rollback()
    
    def reassign_to_fallback(self, order_id, order_number, reason):
        """Reassign order to fallback station and notify support"""
        try:
            cur = self.conn.cursor()
            
            # Move to fallback station
            cur.execute("""
                UPDATE orders 
                SET station_id = 999, updated_at = %s
                WHERE id = %s
            """, (datetime.now(), order_id))
            
            # Create support notification
            support_message = f"FALLBACK ALERT: Order {order_number} moved to support station. Reason: {reason}"
            
            cur.execute("""
                INSERT INTO order_messages (order_id, message_type, content, created_at)
                VALUES (%s, %s, %s, %s)
            """, (order_id, 'support_alert', support_message, datetime.now()))
            
            self.conn.commit()
            print(f"   🚨 FALLBACK: {order_number} moved to support station - {reason}")
            
        except Exception as e:
            logger.error(f"Error moving to fallback: {e}")
            self.conn.rollback()
    
    def check_missing_in_frontend(self):
        """Check if orders exist in DB but might not be visible in frontend"""
        try:
            cur = self.conn.cursor()
            
            # Get all pending orders
            cur.execute("""
                SELECT o.id, o.order_number, o.station_id, o.order_details, o.created_at,
                       s.barista_name, s.status as station_status
                FROM orders o
                LEFT JOIN station_stats s ON o.station_id = s.station_id
                WHERE o.status = 'pending'
                ORDER BY o.created_at ASC
            """)
            
            pending_orders = cur.fetchall()
            
            if pending_orders:
                print(f"\n📋 All pending orders in database ({len(pending_orders)} total):")
                
                for order in pending_orders:
                    order_id, order_number, station_id, order_details, created_at, barista_name, station_status = order
                    
                    try:
                        details = json.loads(order_details)
                        customer_name = details.get('name', 'Unknown')
                        drink_type = details.get('type', 'Unknown')
                    except:
                        customer_name = 'Unknown'  
                        drink_type = 'Unknown'
                    
                    age_minutes = int((datetime.now() - created_at).total_seconds() / 60)
                    station_info = f"Station {station_id} ({barista_name or 'No barista'}) - {station_status or 'Unknown status'}"
                    
                    print(f"   📋 {order_number}: {customer_name} - {drink_type} | {station_info} | {age_minutes}min ago")
                    
                    # Flag orders older than 10 minutes
                    if age_minutes > 10:
                        print(f"      ⚠️  ORDER AGED {age_minutes} MINUTES - NEEDS ATTENTION")
            
            return pending_orders
            
        except Exception as e:
            logger.error(f"Error checking frontend visibility: {e}")
            return []
    
    def create_support_dashboard_entry(self, order_number, issue_type, details):
        """Create an entry in support dashboard for problematic orders"""
        try:
            cur = self.conn.cursor()
            
            # Insert support ticket
            cur.execute("""
                INSERT INTO order_messages (order_id, message_type, content, created_at)
                SELECT id, %s, %s, %s
                FROM orders WHERE order_number = %s
            """, ('support_ticket', f"{issue_type}: {details}", datetime.now(), order_number))
            
            self.conn.commit()
            print(f"   📝 Created support ticket for {order_number}: {issue_type}")
            
        except Exception as e:
            logger.error(f"Error creating support entry: {e}")
    
    def run_full_check(self):
        """Run comprehensive order tracking check"""
        print("🔍 Running comprehensive order tracking check...")
        print("=" * 60)
        
        # Check for stuck orders
        stuck_orders = self.check_stuck_orders()
        
        # Check all pending orders 
        pending_orders = self.check_missing_in_frontend()
        
        print("\n" + "=" * 60)
        print("📊 SUMMARY:")
        print(f"   • {len(stuck_orders)} orders stuck longer than 15 minutes")
        print(f"   • {len(pending_orders)} total pending orders")
        
        if len(stuck_orders) > 0 or len(pending_orders) > 3:
            print("   ⚠️  ATTENTION NEEDED - Some orders may require manual intervention")
        else:
            print("   ✅ All orders appear to be properly tracked")
    
    def close(self):
        """Close database connection"""
        self.conn.close()

def main():
    """Main function"""
    fallback_system = OrderFallbackSystem()
    
    try:
        fallback_system.run_full_check()
    finally:
        fallback_system.close()

if __name__ == "__main__":
    main()
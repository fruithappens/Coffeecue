#!/usr/bin/env python3
"""
Debug script to check order station assignments in the database
"""
import os
import sys
from utils.database import get_db_connection
import json

def check_order_assignments():
    """Check current order assignments in the database"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        print("=== CHECKING ORDER STATION ASSIGNMENTS ===\n")
        
        # Get recent orders with their station assignments
        cursor.execute("""
            SELECT id, order_number, phone, status, station_id, 
                   order_details, created_at, updated_at
            FROM orders 
            WHERE created_at >= CURRENT_DATE - INTERVAL '1 day'
            ORDER BY created_at DESC
            LIMIT 20
        """)
        
        orders = cursor.fetchall()
        
        if not orders:
            print("❌ No recent orders found")
            return
            
        print(f"📋 Found {len(orders)} recent orders:\n")
        
        for order in orders:
            order_id, order_number, phone, status, station_id, order_details_json, created_at, updated_at = order
            
            # Parse order details
            try:
                order_details = json.loads(order_details_json) if order_details_json else {}
                customer_name = order_details.get('name', 'Unknown')
                coffee_type = order_details.get('type', 'Unknown')
                milk_type = order_details.get('milk', 'Unknown')
            except json.JSONDecodeError:
                customer_name = 'Parse Error'
                coffee_type = 'Unknown'
                milk_type = 'Unknown'
            
            # Format output
            station_display = f"Station {station_id}" if station_id else "❌ UNASSIGNED"
            status_emoji = {
                'pending': '⏳',
                'in_progress': '🔄', 
                'completed': '✅',
                'picked_up': '📦'
            }.get(status, '❓')
            
            print(f"{status_emoji} Order #{order_number}")
            print(f"   Customer: {customer_name} ({phone})")
            print(f"   Coffee: {coffee_type} with {milk_type}")
            print(f"   Station: {station_display}")
            print(f"   Status: {status}")
            print(f"   Created: {created_at}")
            print()
        
        # Check for orders without station assignments
        cursor.execute("""
            SELECT COUNT(*) FROM orders 
            WHERE station_id IS NULL 
            AND status IN ('pending', 'in_progress')
        """)
        
        unassigned_count = cursor.fetchone()[0]
        
        if unassigned_count > 0:
            print(f"⚠️  WARNING: {unassigned_count} orders without station assignment!\n")
            
            # Show the unassigned orders
            cursor.execute("""
                SELECT id, order_number, phone, status, created_at, order_details
                FROM orders 
                WHERE station_id IS NULL 
                AND status IN ('pending', 'in_progress')
                ORDER BY created_at DESC
            """)
            
            unassigned_orders = cursor.fetchall()
            print("🚨 UNASSIGNED ORDERS:")
            for order in unassigned_orders:
                order_id, order_number, phone, status, created_at, order_details_json = order
                try:
                    order_details = json.loads(order_details_json) if order_details_json else {}
                    customer_name = order_details.get('name', 'Unknown')
                except:
                    customer_name = 'Parse Error'
                    
                print(f"   📋 #{order_number} - {customer_name} ({phone}) - {status} - {created_at}")
        else:
            print("✅ All active orders have station assignments")
            
        # Check station capabilities
        print("\n=== STATION INFORMATION ===\n")
        cursor.execute("""
            SELECT station_id, status, current_load, equipment_notes
            FROM station_stats
            ORDER BY station_id
        """)
        
        stations = cursor.fetchall()
        for station in stations:
            station_id, status, current_load, equipment_notes = station
            print(f"🚉 Station {station_id}")
            print(f"   Status: {status}")
            print(f"   Load: {current_load or 0} orders")
            
            if equipment_notes:
                try:
                    capabilities = json.loads(equipment_notes) if isinstance(equipment_notes, str) else equipment_notes
                    coffee_types = capabilities.get('coffee_types', [])
                    milk_types = capabilities.get('milk_types', [])
                    print(f"   Coffee: {', '.join(coffee_types) if coffee_types else 'None configured'}")
                    print(f"   Milk: {', '.join(milk_types) if milk_types else 'None configured'}")
                except:
                    print(f"   Capabilities: Error parsing")
            else:
                print(f"   Capabilities: None configured")
            print()
            
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error checking orders: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_order_assignments()
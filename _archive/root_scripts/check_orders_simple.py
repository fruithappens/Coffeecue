#!/usr/bin/env python3
"""
Simple script to check all orders in the database
"""
import os
import sys
from utils.database import get_db_connection
import json

def check_all_orders():
    """Check all orders in the database"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        
        print("=== CHECKING ALL ORDERS ===\n")
        
        # Get all orders
        cursor.execute("""
            SELECT id, order_number, phone, status, station_id, 
                   order_details, created_at
            FROM orders 
            ORDER BY created_at DESC
            LIMIT 50
        """)
        
        orders = cursor.fetchall()
        
        if not orders:
            print("❌ No orders found in database")
            
            # Check if orders table exists
            cursor.execute("""
                SELECT table_name FROM information_schema.tables 
                WHERE table_name = 'orders'
            """)
            
            if cursor.fetchone():
                print("✅ Orders table exists but is empty")
            else:
                print("❌ Orders table does not exist")
                
            return
            
        print(f"📋 Found {len(orders)} total orders:\n")
        
        station_counts = {}
        status_counts = {}
        
        for order in orders:
            order_id, order_number, phone, status, station_id, order_details_json, created_at = order
            
            # Count by station
            station_key = f"Station {station_id}" if station_id else "Unassigned"
            station_counts[station_key] = station_counts.get(station_key, 0) + 1
            
            # Count by status  
            status_counts[status] = status_counts.get(status, 0) + 1
            
            # Parse order details
            try:
                order_details = json.loads(order_details_json) if order_details_json else {}
                customer_name = order_details.get('name', 'Unknown')
            except:
                customer_name = 'Parse Error'
            
            # Show recent orders
            if len([o for o in orders if o == order]) <= 10:  # Show first 10
                station_display = f"Station {station_id}" if station_id else "❌ UNASSIGNED"
                print(f"📋 #{order_number} - {customer_name} ({phone}) - {station_display} - {status} - {created_at}")
        
        print(f"\n=== SUMMARY ===")
        print(f"📊 Orders by Station:")
        for station, count in sorted(station_counts.items()):
            print(f"   {station}: {count} orders")
            
        print(f"\n📊 Orders by Status:")
        for status, count in sorted(status_counts.items()):
            print(f"   {status}: {count} orders")
            
        cursor.close()
        conn.close()
        
    except Exception as e:
        print(f"❌ Error checking orders: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    check_all_orders()
"""
Admin routes for Expresso Coffee Ordering System
"""
import os
import json
from datetime import datetime, timedelta
import logging
import calendar
import functools
from flask import Blueprint, render_template, request, jsonify, redirect, url_for, flash, session, current_app
import random
import psycopg2
from psycopg2.extras import RealDictCursor
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from models.users import AdminUser, Settings
from models.stations import Station, StationSchedule
from models.orders import CustomerPreference
from auth import admin_required, role_required

# Create blueprint
bp = Blueprint('admin', __name__, url_prefix='/admin')

# Set up logging
logger = logging.getLogger("expresso.routes.admin")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

def get_db_connection():
    """Get database connection using PostgreSQL"""
    try:
        # Get database URL from app config
        db_url = current_app.config.get('config', {}).get('DATABASE_URL', 'postgresql://expresso_user:expresso@localhost/expresso')
        
        # Parse connection parameters from URL
        if '://' in db_url:
            parts = db_url.split('://', 1)[1].split('@')
            credentials = parts[0].split(':')
            user = credentials[0]
            password = credentials[1] if len(credentials) > 1 else ''
            
            hostdb = parts[1].split('/')
            hostport = hostdb[0].split(':')
            host = hostport[0]
            port = int(hostport[1]) if len(hostport) > 1 else 5432
            
            dbname = hostdb[1]
        else:
            # Default connection parameters
            user = 'expresso_user'
            password = 'expresso'
            host = 'localhost'
            port = 5432
            dbname = 'expresso'
        
        # Create connection
        conn = psycopg2.connect(
            user=user,
            password=password,
            host=host,
            port=port,
            dbname=dbname
        )
        
        return conn
    except Exception as e:
        logger.error(f"Error connecting to PostgreSQL database: {str(e)}")
        return None

@bp.route('/', methods=['GET', 'POST'])
def login():
    """Admin login page"""
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        if not username or not password:
            flash("Please enter both username and password")
            return render_template('admin_login.html')
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Authenticate user
        user = AdminUser.authenticate(db, username, password)
        
        if user:
            # Set session variables
            session['admin_id'] = user['id']
            session['admin_role'] = user['role']
            session['admin_username'] = user['username']
            
            # Redirect to dashboard
            return redirect(url_for('admin.dashboard'))
        else:
            flash("Invalid username or password")
    
    return render_template('admin_login.html')

@bp.route('/logout')
def logout():
    """Admin logout"""
    session.pop('admin_id', None)
    session.pop('admin_role', None)
    session.pop('admin_username', None)
    flash("You have been logged out")
    return redirect(url_for('admin.login'))

@bp.route('/dashboard')
@admin_required
def dashboard():
    """Admin dashboard"""
    try:
        # Get PostgreSQL connection
        conn = get_db_connection()
        if not conn:
            flash("Database connection error", "error")
            return "Database connection error", 500
            
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Get overall statistics
        cursor.execute('SELECT COUNT(*) FROM orders')
        total_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) FROM orders WHERE status = %s', ('completed',))
        completed_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) FROM orders WHERE status IN (%s, %s)', ('pending', 'in-progress'))
        active_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT AVG(completion_time) FROM orders WHERE status = %s', ('completed',))
        avg_time_seconds = cursor.fetchone()['avg']
        avg_time = round(avg_time_seconds / 60, 1) if avg_time_seconds else 0  # minutes
        
        # Get today's statistics
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute('SELECT COUNT(*) FROM orders WHERE DATE(created_at) = %s', (today,))
        today_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) FROM orders WHERE status = %s AND DATE(created_at) = %s', 
                     ('completed', today))
        today_completed = cursor.fetchone()['count']
        
        # Get hourly breakdown for today
        cursor.execute('''
            SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count 
            FROM orders 
            WHERE DATE(created_at) = %s
            GROUP BY hour 
            ORDER BY hour
        ''', (today,))
        hourly_orders = cursor.fetchall()
        
        hourly_data = {str(i).zfill(2): 0 for i in range(24)}
        for row in hourly_orders:
            hour = str(int(row['hour'])).zfill(2)
            hourly_data[hour] = row['count']
        
        # Get station breakdown
        cursor.execute('''
            SELECT s.station_id, s.barista_name, s.current_load, s.avg_completion_time,
                   COUNT(o.id) as total_orders,
                   SUM(CASE WHEN o.status = 'completed' THEN 1 ELSE 0 END) as completed_orders
            FROM station_stats s
            LEFT JOIN orders o ON s.station_id = o.station_id AND DATE(o.created_at) = %s
            GROUP BY s.station_id, s.barista_name, s.current_load, s.avg_completion_time
            ORDER BY s.station_id
        ''', (today,))
        station_stats = cursor.fetchall()
        
        # Get popular drinks
        cursor.execute('''
            SELECT order_details FROM orders WHERE DATE(created_at) = %s
        ''', (today,))
        orders = cursor.fetchall()
        
        drink_counts = {}
        milk_counts = {}
        sugar_counts = {}
        
        for order in orders:
            try:
                order_details = order['order_details']
                if isinstance(order_details, str):
                    details = json.loads(order_details)
                else:
                    details = order_details
                
                # Count drinks
                drink_type = details.get('type', 'unknown')
                if drink_type in drink_counts:
                    drink_counts[drink_type] += 1
                else:
                    drink_counts[drink_type] = 1
                
                # Count milk types
                milk_type = details.get('milk', 'unknown')
                if milk_type in milk_counts:
                    milk_counts[milk_type] += 1
                else:
                    milk_counts[milk_type] = 1
                
                # Count sugar preferences
                sugar_pref = details.get('sugar', 'unknown')
                if sugar_pref in sugar_counts:
                    sugar_counts[sugar_pref] += 1
                else:
                    sugar_counts[sugar_pref] = 1
            except:
                continue
        
        popular_drinks = sorted(drink_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        popular_milks = sorted(milk_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        popular_sugars = sorted(sugar_counts.items(), key=lambda x: x[1], reverse=True)[:3]
        
        # Get vip statistics
        cursor.execute('SELECT COUNT(*) FROM orders WHERE queue_priority = 1')
        vip_count = cursor.fetchone()['count']
        vip_percentage = round((vip_count / total_orders * 100), 1) if total_orders > 0 else 0
        
        # Calculate average order wait time by hour
        cursor.execute('''
            SELECT 
                EXTRACT(HOUR FROM created_at) as hour, 
                AVG(completion_time) / 60.0 as avg_wait_minutes 
            FROM 
                orders 
            WHERE 
                status = 'completed' AND DATE(created_at) = %s
            GROUP BY 
                hour 
            ORDER BY 
                hour
        ''', (today,))
        wait_times = cursor.fetchall()
        
        wait_time_data = {str(i).zfill(2): 0 for i in range(24)}
        for row in wait_times:
            hour = str(int(row['hour'])).zfill(2)
            wait_time_data[hour] = round(row['avg_wait_minutes'], 1)
        
        # Get loyalty program statistics
        cursor.execute('SELECT COUNT(*) FROM loyalty_transactions WHERE transaction_type = %s', ('redemption',))
        redemptions = cursor.fetchone()['count']
        
        cursor.execute('SELECT SUM(points) FROM loyalty_transactions WHERE transaction_type = %s', ('earned',))
        total_points_earned = cursor.fetchone()['sum'] or 0
        
        cursor.execute('SELECT SUM(ABS(points)) FROM loyalty_transactions WHERE transaction_type = %s', ('redemption',))
        total_points_used = cursor.fetchone()['sum'] or 0
        
        loyalty_stats = {
            'redemptions': redemptions,
            'total_points_earned': total_points_earned,
            'total_points_used': total_points_used,
            'active_points': total_points_earned - total_points_used
        }
        
        # Payment statistics
        cursor.execute('SELECT COUNT(*) FROM orders WHERE payment_status = %s', ('free',))
        free_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) FROM orders WHERE payment_status = %s', ('paid',))
        paid_orders = cursor.fetchone()['count']
        
        cursor.execute('SELECT COUNT(*) FROM orders WHERE payment_status = %s', ('pending',))
        pending_payment = cursor.fetchone()['count']
        
        # Get sponsored orders count
        cursor.execute('SELECT COUNT(*) FROM orders WHERE payment_status = %s', ('sponsored',))
        sponsored_orders = cursor.fetchone()['count']
        
        payment_stats = {
            'free_orders': free_orders,
            'paid_orders': paid_orders,
            'pending_payment': pending_payment,
            'sponsored_orders': sponsored_orders
        }
        
        # Close the cursor and connection
        cursor.close()
        conn.close()
        
        return render_template(
            'dashboard.html', 
            total_orders=total_orders,
            completed_orders=completed_orders,
            active_orders=active_orders,
            avg_time=avg_time,
            today_orders=today_orders,
            today_completed=today_completed,
            hourly_data=hourly_data,
            station_stats=station_stats,
            popular_drinks=popular_drinks,
            popular_milks=popular_milks,
            popular_sugars=popular_sugars,
            vip_count=vip_count,
            vip_percentage=vip_percentage,
            wait_time_data=wait_time_data,
            loyalty_stats=loyalty_stats,
            payment_stats=payment_stats
        )
    except Exception as e:
        logger.error(f"Error generating dashboard: {str(e)}")
        return "An error occurred while generating the dashboard", 500

@bp.route('/station_management', methods=['GET', 'POST'])
@admin_required
def station_management():
    """Station management interface"""
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    if request.method == 'POST':
        action = request.form.get('action')
        station_id = int(request.form.get('station_id', 0))
        
        if action == 'update_status':
            status = request.form.get('status')
            Station.update_status(conn, station_id, status)
            flash(f"Station {station_id} status updated to {status}")
        
        elif action == 'assign_barista':
            barista_name = request.form.get('barista_name')
            Station.assign_barista(conn, station_id, barista_name)
            flash(f"Barista {barista_name} assigned to Station {station_id}")
        
        elif action == 'update_equipment':
            equipment_status = request.form.get('equipment_status')
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE station_stats 
                SET equipment_status = %s 
                WHERE station_id = %s
            ''', (equipment_status, station_id))
            conn.commit()
            cursor.close()
            flash(f"Equipment status for Station {station_id} updated to {equipment_status}")
        
        elif action == 'update_specialist':
            specialist_drinks = request.form.get('specialist_drinks')
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE station_stats 
                SET specialist_drinks = %s 
                WHERE station_id = %s
            ''', (specialist_drinks, station_id))
            conn.commit()
            cursor.close()
            flash(f"Specialist drinks for Station {station_id} updated")
        
        elif action == 'add_station':
            # Add a new station
            cursor = conn.cursor()
            cursor.execute('SELECT MAX(station_id) FROM station_stats')
            result = cursor.fetchone()
            new_station_id = (result[0] or 0) + 1
            
            cursor.execute('''
                INSERT INTO station_stats (station_id, status, last_updated)
                VALUES (%s, %s, %s)
            ''', (new_station_id, 'active', datetime.now()))
            
            conn.commit()
            cursor.close()
            flash(f"New station {new_station_id} added")
    
    # Get all stations
    stations = Station.get_all(conn)
    
    # Close connection
    conn.close()
    
    return render_template('station_management.html', stations=stations)

@bp.route('/stations')
@admin_required
def stations():
    """Redirect to station management page"""
    return redirect(url_for('admin.station_management'))

@bp.route('/station_schedule', methods=['GET', 'POST'])
@admin_required
def station_schedule():
    """Station schedule management interface"""
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    if request.method == 'POST':
        action = request.form.get('action')
        
        if action == 'add_schedule':
            station_id = int(request.form.get('station_id'))
            day_of_week = int(request.form.get('day_of_week'))
            start_time = request.form.get('start_time')
            end_time = request.form.get('end_time')
            break_start = request.form.get('break_start') or None
            break_end = request.form.get('break_end') or None
            notes = request.form.get('notes') or None
            
            # Create schedule data
            schedule_data = {
                'station_id': station_id,
                'day_of_week': day_of_week,
                'start_time': start_time,
                'end_time': end_time,
                'break_start': break_start,
                'break_end': break_end,
                'notes': notes,
                'created_by': session.get('admin_username')
            }
            
            # Add schedule
            schedule_id = StationSchedule.add_schedule(conn, schedule_data)
            
            if schedule_id:
                flash(f"Schedule added for Station {station_id} on {calendar.day_name[day_of_week]}")
            else:
                flash("Error adding schedule")
        
        elif action == 'edit_schedule':
            schedule_id = int(request.form.get('schedule_id'))
            start_time = request.form.get('start_time')
            end_time = request.form.get('end_time')
            break_start = request.form.get('break_start') or None
            break_end = request.form.get('break_end') or None
            notes = request.form.get('notes') or None
            
            # Create update data
            schedule_data = {
                'start_time': start_time,
                'end_time': end_time,
                'break_start': break_start,
                'break_end': break_end,
                'notes': notes
            }
            
            # Update schedule
            success = StationSchedule.update_schedule(conn, schedule_id, schedule_data)
            
            if success:
                flash("Schedule updated successfully")
            else:
                flash("Error updating schedule")
        
        elif action == 'delete_schedule':
            schedule_id = int(request.form.get('schedule_id'))
            
            # Delete schedule
            success = StationSchedule.delete_schedule(conn, schedule_id)
            
            if success:
                flash("Schedule deleted successfully")
            else:
                flash("Error deleting schedule")
    
    # Get all stations
    stations = Station.get_all(conn)
    
    # Get all schedules grouped by day
    schedules_by_day = StationSchedule.get_all_schedules(conn)
    
    # Get current day of week for active accordion panel
    now_day = datetime.now().weekday()
    
    # Close connection
    conn.close()
    
    return render_template(
        'station_schedule.html',
        stations=stations,
        schedules_by_day=schedules_by_day,
        days=list(calendar.day_name),
        now_day=now_day
    )

@bp.route('/user_management', methods=['GET', 'POST'])
@admin_required
def user_management():
    """Admin user management interface"""
    # Check if user has admin role
    if session.get('admin_role') != 'admin':
        flash("You don't have permission to access this page")
        return redirect(url_for('admin.dashboard'))
    
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    if request.method == 'POST':
        action = request.form.get('action')
        
        if action == 'create_user':
            username = request.form.get('username')
            password = request.form.get('password')
            confirm_password = request.form.get('confirm_password')
            role = request.form.get('role')
            email = request.form.get('email')
            
            # Validate input
            if not username or not password or not role:
                flash("All fields are required")
                return redirect(url_for('admin.user_management'))
            
            if password != confirm_password:
                flash("Passwords do not match")
                return redirect(url_for('admin.user_management'))
            
            # Create user
            user_data = {
                'username': username,
                'password': password,
                'role': role,
                'email': email
            }
            
            user_id = AdminUser.create(conn, username, email, password, role)
            
            if user_id:
                flash(f"User {username} created successfully")
            else:
                flash("Error creating user")
        
        elif action == 'reset_password':
            user_id = request.form.get('user_id')
            new_password = request.form.get('new_password')
            confirm_password = request.form.get('confirm_new_password')
            
            # Validate input
            if not user_id or not new_password:
                flash("All fields are required")
                return redirect(url_for('admin.user_management'))
            
            if new_password != confirm_password:
                flash("Passwords do not match")
                return redirect(url_for('admin.user_management'))
            
            # Reset password
            success = AdminUser.reset_password(conn, user_id, new_password)
            
            if success:
                flash("Password reset successfully")
            else:
                flash("Error resetting password")
        
        elif action == 'delete_user':
            user_id = request.form.get('user_id')
            
            # Prevent deleting your own account
            if int(user_id) == session.get('admin_id'):
                flash("You cannot delete your own account")
                return redirect(url_for('admin.user_management'))
            
            # Delete user
            success = AdminUser.delete_user(conn, user_id)
            
            if success:
                flash("User deleted successfully")
            else:
                flash("Error deleting user")
        
        elif action == 'unlock_account':
            user_id = request.form.get('user_id')
            
            # Unlock account
            success = AdminUser.unlock_account(conn, user_id)
            
            if success:
                flash("Account unlocked successfully")
            else:
                flash("Error unlocking account")
    
    # Get all users
    users = AdminUser.get_all(conn)
    
    # Close connection
    conn.close()
    
    return render_template(
        'user_management.html',
        users=users,
        current_user_id=session.get('admin_id')
    )

@bp.route('/settings', methods=['GET', 'POST'])
@admin_required
def settings():
    """System settings management interface"""
    # Check if user has admin role
    if session.get('admin_role') != 'admin':
        flash("You don't have permission to access this page")
        return redirect(url_for('admin.dashboard'))
    
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    if request.method == 'POST':
        action = request.form.get('action')
        
        if action == 'update_setting':
            key = request.form.get('key')
            value = request.form.get('value')
            
            # Update setting
            success = Settings.set(conn, key, value, updated_by=session.get('admin_username'))
            
            if success:
                flash(f"Setting '{key}' updated successfully")
            else:
                flash(f"Error updating setting '{key}'")
        
        elif action == 'regenerate_code':
            key = request.form.get('key')
            
            # Generate a new random code
            new_code = ''.join(random.choices('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', k=6))
            
            # Update setting
            success = Settings.set(conn, key, new_code, updated_by=session.get('admin_username'))
            
            if success:
                flash(f"New code generated for '{key}'")
            else:
                flash(f"Error generating new code for '{key}'")
    
    # Get all settings
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute('SELECT key, value, description, updated_at, updated_by FROM settings ORDER BY key')
    settings = cursor.fetchall()
    cursor.close()
    
    # Close connection
    conn.close()
    
    return render_template('settings.html', settings=settings)

@bp.route('/system_settings', methods=['GET', 'POST'])
@admin_required
def system_settings():
    """System settings management interface"""
    # Check if user has admin role
    if session.get('admin_role') != 'admin':
        flash("You don't have permission to access this page")
        return redirect(url_for('admin.dashboard'))
    
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    if request.method == 'POST':
        # Get form data
        system_name = request.form.get('system_name', 'Expresso Coffee System')
        event_name = request.form.get('event_name', 'ANZCA ASM 2025 Cairns')
        sponsor_name = request.form.get('sponsor_name', '')
        sponsor_message = request.form.get('sponsor_message', 'Coffee service proudly sponsored by {sponsor}')
        sponsor_display_enabled = 'true' if request.form.get('sponsor_display_enabled') else 'false'
        
        # Update settings
        Settings.set(conn, 'system_name', system_name, description="Name of the system", updated_by=session.get('admin_username'))
        Settings.set(conn, 'event_name', event_name, description="Name of the event", updated_by=session.get('admin_username'))
        Settings.set(conn, 'sponsor_name', sponsor_name, description="Name of the sponsor", updated_by=session.get('admin_username'))
        Settings.set(conn, 'sponsor_message', sponsor_message, description="Sponsor message template", updated_by=session.get('admin_username'))
        Settings.set(conn, 'sponsor_display_enabled', sponsor_display_enabled, description="Show sponsor information", updated_by=session.get('admin_username'))
        
        flash("System settings updated successfully")
        return redirect(url_for('admin.system_settings'))
    
    # Get current settings
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    
    cursor.execute("SELECT value FROM settings WHERE key = 'system_name'")
    system_name_result = cursor.fetchone()
    system_name = system_name_result['value'] if system_name_result else 'Expresso Coffee System'
    
    cursor.execute("SELECT value FROM settings WHERE key = 'event_name'")
    event_name_result = cursor.fetchone()
    event_name = event_name_result['value'] if event_name_result else 'ANZCA ASM 2025 Cairns'
    
    cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_name'")
    sponsor_name_result = cursor.fetchone()
    sponsor_name = sponsor_name_result['value'] if sponsor_name_result else ''
    
    cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_message'")
    sponsor_message_result = cursor.fetchone()
    sponsor_message = sponsor_message_result['value'] if sponsor_message_result else 'Coffee service proudly sponsored by {sponsor}'
    
    cursor.execute("SELECT value FROM settings WHERE key = 'sponsor_display_enabled'")
    sponsor_display_result = cursor.fetchone()
    sponsor_display_enabled = sponsor_display_result['value'].lower() in ('true', 'yes', '1', 't', 'y') if sponsor_display_result else True
    
    cursor.close()
    conn.close()
    
    return render_template(
        'system_settings.html',
        system_name=system_name,
        event_name=event_name,
        sponsor_name=sponsor_name,
        sponsor_message=sponsor_message,
        sponsor_display_enabled=sponsor_display_enabled
    )

@bp.route('/customer_management')
@admin_required
def customer_management():
    """Customer management interface"""
    # Get database connection
    conn = get_db_connection()
    if not conn:
        flash("Database connection error", "error")
        return "Database connection error", 500
        
    # Get customers with order counts
    cursor = conn.cursor(cursor_factory=RealDictCursor)
    cursor.execute('''
        SELECT 
            cp.phone, 
            cp.name, 
            cp.preferred_drink,
            cp.total_orders,
            cp.loyalty_points,
            cp.loyalty_free_drinks,
            cp.first_order_date,
            cp.last_order_date,
            cp.favorite_time_of_day,
            cp.account_status
        FROM 
            customer_preferences cp
        ORDER BY 
            cp.total_orders DESC, cp.name
        LIMIT 100
    ''')
    
    customers = cursor.fetchall()
    cursor.close()
    conn.close()
    
    return render_template('customer_management.html', customers=customers)

@bp.route('/adjust_loyalty_points', methods=['POST'])
@admin_required
def adjust_loyalty_points():
    """Manually adjust loyalty points for a customer"""
    # Get coffee system from app context
    coffee_system = current_app.config.get('coffee_system')
    db = coffee_system.db
    
    try:
        phone = request.form.get('phone')
        points = int(request.form.get('points', 0))
        reason = request.form.get('reason', 'Manual adjustment')
        
        if not phone or points == 0:
            return jsonify({'success': False, 'message': 'Phone and points are required'})
        
        # Adjust points
        success = CustomerPreference.add_loyalty_points(db, phone, points, transaction_type='manual', notes=reason)
        
        if success:
            # Get updated loyalty status
            loyalty_status = coffee_system.get_loyalty_status(phone)
            return jsonify({
                'success': True, 
                'new_points': loyalty_status['points']
            })
        else:
            return jsonify({'success': False, 'message': 'Error adjusting points'})
    
    except Exception as e:
        logger.error(f"Error adjusting loyalty points: {str(e)}")
        return jsonify({'success': False, 'message': str(e)})
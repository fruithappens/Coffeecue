"""
Station and scheduling models for Expresso Coffee Ordering System
Compatible with PostgreSQL database
"""
import json
import logging
from datetime import datetime, timedelta
import calendar
import random
import os
import psycopg2
from psycopg2.extras import RealDictCursor

from utils.database import execute_query

logger = logging.getLogger("expresso.models.stations")

# Ensure directory exists
os.makedirs(os.path.dirname(__file__), exist_ok=True)

class Station:
    """Class for managing coffee stations in the database"""
    
    @staticmethod
    def delete_station(conn, station_id):
        """
        Delete a station
        
        Args:
            conn: Database connection
            station_id: Station ID
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            
            # Check if there are any active orders for this station
            cursor.execute("""
                SELECT COUNT(*) FROM orders 
                WHERE station_id = %s AND status IN ('pending', 'in-progress')
            """, (station_id,))
            
            active_orders = cursor.fetchone()[0]
            if active_orders > 0:
                logger.warning(f"Cannot delete station {station_id} with {active_orders} active orders")
                return False
            
            # Begin transaction
            # Delete schedules associated with this station
            cursor.execute("DELETE FROM station_schedule WHERE station_id = %s", (station_id,))
            
            # Delete station
            cursor.execute("DELETE FROM station_stats WHERE station_id = %s", (station_id,))
            
            conn.commit()
            logger.info(f"Deleted station {station_id}")
            return True
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error deleting station {station_id}: {str(e)}")
            return False
    
    @staticmethod
    def create_tables(conn):
        """Create necessary tables if they don't exist"""
        try:
            cursor = conn.cursor()
            
            # Create rush_periods table if it doesn't exist
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_name = 'rush_periods'
                )
            """)
            if not cursor.fetchone()[0]:
                cursor.execute('''
                CREATE TABLE IF NOT EXISTS rush_periods (
                    id SERIAL PRIMARY KEY,
                    day_of_week INTEGER NOT NULL,
                    start_time VARCHAR(5) NOT NULL,
                    end_time VARCHAR(5) NOT NULL,
                    notes TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                ''')
                conn.commit()
                logger.info("Created rush_periods table")
            
            return True
        except Exception as e:
            conn.rollback()
            logger.error(f"Error creating station tables: {str(e)}")
            return False
    
    @staticmethod
    def initialize_stations(conn, num_stations):
        """
        Initialize station records for the given number of stations
        
        Args:
            conn: Database connection
            num_stations: Number of stations to initialize
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            
            # Get current stations to avoid duplicates
            cursor.execute("SELECT station_id FROM station_stats")
            existing_stations = [row[0] for row in cursor.fetchall()]
            
            # Initialize missing stations
            now = datetime.now()
            for station_id in range(1, num_stations + 1):
                if station_id not in existing_stations:
                    cursor.execute('''
                        INSERT INTO station_stats 
                        (station_id, status, last_updated)
                        VALUES (%s, %s, %s)
                    ''', (station_id, 'active', now))
            
            conn.commit()
            logger.info(f"Initialized {num_stations} stations")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error initializing stations: {str(e)}")
            return False
    
    @staticmethod
    def get_all(conn):
        """
        Get all stations
        
        Args:
            conn: Database connection
            
        Returns:
            List of station dictionaries
        """
        query = "SELECT * FROM station_stats ORDER BY station_id"
        return execute_query(conn, query, fetch_all=True)
    
    @staticmethod
    def get_by_id(conn, station_id):
        """
        Get station by ID
        
        Args:
            conn: Database connection
            station_id: Station ID
            
        Returns:
            Station dictionary if found, None otherwise
        """
        query = "SELECT * FROM station_stats WHERE station_id = %s"
        return execute_query(conn, query, (station_id,), fetch_one=True)
    
    @staticmethod
    def update_status(conn, station_id, status):
        """
        Update station status
        
        Args:
            conn: Database connection
            station_id: Station ID
            status: New status (active, inactive, maintenance)
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE station_stats 
                SET status = %s, last_updated = %s 
                WHERE station_id = %s
            ''', (status, datetime.now(), station_id))
            
            conn.commit()
            logger.info(f"Updated station {station_id} status to {status}")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error updating station status: {str(e)}")
            return False
    
    @staticmethod
    def assign_barista(conn, station_id, barista_name):
        """
        Assign a barista to a station
        
        Args:
            conn: Database connection
            station_id: Station ID
            barista_name: Barista name
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            cursor.execute('''
                UPDATE station_stats 
                SET barista_name = %s, last_updated = %s 
                WHERE station_id = %s
            ''', (barista_name, datetime.now(), station_id))
            
            conn.commit()
            logger.info(f"Assigned barista {barista_name} to station {station_id}")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error assigning barista: {str(e)}")
            return False
            
    @staticmethod
    def update_station(conn, station_id, updates):
        """
        Update station details (name, notes, equipment_notes)
        
        Args:
            conn: Database connection
            station_id: Station ID
            updates: Dictionary with fields to update
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            
            # Convert frontend field names to database field names if needed
            field_mapping = {
                'name': 'notes',
                'location': 'equipment_notes'
            }
            
            # Build SET clause for SQL query
            set_clauses = []
            params = []
            
            for key, value in updates.items():
                # Map frontend field names to database field names
                db_field = field_mapping.get(key, key)
                set_clauses.append(f"{db_field} = %s")
                params.append(value)
            
            # Always update last_updated timestamp
            set_clauses.append("last_updated = %s")
            params.append(datetime.now())
            
            # Add station_id to params
            params.append(station_id)
            
            # Execute update query
            query = f"UPDATE station_stats SET {', '.join(set_clauses)} WHERE station_id = %s"
            cursor.execute(query, params)
            
            conn.commit()
            logger.info(f"Updated station {station_id} with {updates}")
            return True
            
        except Exception as e:
            conn.rollback()
            logger.error(f"Error updating station: {str(e)}")
            return False
    
    @staticmethod
    def update_load(conn, station_id, increment=True):
        """
        Update station load (increment or decrement)
        
        Args:
            conn: Database connection
            station_id: Station ID
            increment: True to increment, False to decrement
            
        Returns:
            New load value if successful, None otherwise
        """
        try:
            cursor = conn.cursor()
            
            # Get current load
            cursor.execute("SELECT current_load FROM station_stats WHERE station_id = %s", (station_id,))
            result = cursor.fetchone()
            
            if not result:
                logger.warning(f"Station {station_id} not found")
                return None
            
            current_load = result[0]
            
            # Update load
            if increment:
                new_load = current_load + 1
            else:
                new_load = max(0, current_load - 1)  # Prevent negative values
            
            cursor.execute('''
                UPDATE station_stats 
                SET current_load = %s, last_updated = %s 
                WHERE station_id = %s
            ''', (new_load, datetime.now(), station_id))
            
            # If completing an order, also increment total_orders
            if not increment:
                cursor.execute('''
                    UPDATE station_stats 
                    SET total_orders = total_orders + 1 
                    WHERE station_id = %s
                ''', (station_id,))
            
            conn.commit()
            logger.debug(f"Updated station {station_id} load to {new_load}")
            return new_load
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error updating station load: {str(e)}")
            return None
    
    @staticmethod
    def assign_order_to_station(conn, is_vip=False):
        """
        Assign an order to the least busy station
        
        Args:
            conn: Database connection
            is_vip: Whether this is a VIP order
            
        Returns:
            Assigned station ID
        """
        try:
            cursor = conn.cursor()
            
            # Get active stations with current load
            cursor.execute('''
                SELECT station_id, current_load 
                FROM station_stats 
                WHERE status = 'active' 
                ORDER BY current_load ASC
            ''')
            
            stations = cursor.fetchall()
            
            if not stations:
                # If no active stations, use station 1 as fallback
                logger.warning("No active stations found, using station 1 as fallback")
                return 1
            
            # For VIP orders, always use the station with the shortest queue
            if is_vip:
                return stations[0][0]
            
            # For regular orders, use weighted random assignment to balance load
            total_stations = len(stations)
            if total_stations == 1:
                return stations[0][0]
            
            # Calculate weights inversely proportional to current load
            weights = []
            total_load = sum(station[1] for station in stations) + 0.1  # Add 0.1 to avoid division by zero
            
            for station in stations:
                # Calculate weight as inverse of proportional load
                # Stations with less load get higher weight
                station_load = station[1] + 0.1  # Add 0.1 to avoid division by zero
                weight = 1 - (station_load / total_load)
                weights.append(weight)
            
            # Normalize weights to sum up to 1
            total_weight = sum(weights) or 1  # Avoid division by zero
            norm_weights = [w/total_weight for w in weights]
            
            # Choose station based on weighted random choice
            r = random.random()
            upto = 0
            for i, w in enumerate(norm_weights):
                if upto + w >= r:
                    return stations[i][0]
                upto += w
            
            # Fallback to first station if something goes wrong
            return stations[0][0]
        
        except Exception as e:
            logger.error(f"Error assigning station: {str(e)}")
            return 1  # Fallback to station 1
    
    @staticmethod
    def update_completion_time(conn, station_id, order_id, completion_time):
        """
        Update station average completion time based on a completed order
        
        Args:
            conn: Database connection
            station_id: Station ID
            order_id: Order ID
            completion_time: Completion time in seconds
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            
            # Calculate new average
            cursor.execute('''
                SELECT avg_completion_time, total_orders 
                FROM station_stats 
                WHERE station_id = %s
            ''', (station_id,))
            
            result = cursor.fetchone()
            if not result:
                return False
            
            current_avg, total_orders = result
            
            # Calculate new weighted average
            if total_orders <= 1:
                new_avg = completion_time
            else:
                # Weight existing average more heavily for stability
                new_avg = (current_avg * 0.7) + (completion_time * 0.3)
            
            # Update station stats
            cursor.execute('''
                UPDATE station_stats 
                SET avg_completion_time = %s, last_updated = %s 
                WHERE station_id = %s
            ''', (int(new_avg), datetime.now(), station_id))
            
            conn.commit()
            logger.info(f"Updated station {station_id} avg completion time to {int(new_avg)} seconds")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error updating completion time: {str(e)}")
            return False


class StationSchedule:
    """Class for managing station schedules in the database"""
    
    @staticmethod
    def add_schedule(conn, schedule_data):
        """
        Add a new station schedule
        
        Args:
            conn: Database connection
            schedule_data: Dictionary with schedule details
                Required keys: station_id, day_of_week, start_time, end_time
                
        Returns:
            Schedule ID if successful, None otherwise
        """
        try:
            # Ensure required fields
            required_fields = ['station_id', 'day_of_week', 'start_time', 'end_time']
            for field in required_fields:
                if field not in schedule_data:
                    logger.error(f"Missing required field: {field}")
                    return None
            
            # Validate times
            for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                if time_field in schedule_data and schedule_data[time_field]:
                    try:
                        datetime.strptime(schedule_data[time_field], "%H:%M")
                    except ValueError:
                        logger.error(f"Invalid time format for {time_field}: {schedule_data[time_field]}")
                        return None
            
            # Validate relationships
            if schedule_data['start_time'] >= schedule_data['end_time']:
                logger.error("End time must be after start time")
                return None
            
            if 'break_start' in schedule_data and 'break_end' in schedule_data:
                if schedule_data['break_start'] and schedule_data['break_end']:
                    if (schedule_data['break_start'] < schedule_data['start_time'] or
                        schedule_data['break_end'] > schedule_data['end_time'] or
                        schedule_data['break_start'] >= schedule_data['break_end']):
                        logger.error("Break times must be within operating hours and end after start")
                        return None
            
            # Add created_at timestamp
            if 'created_at' not in schedule_data:
                schedule_data['created_at'] = datetime.now()
            
            # Build query
            fields = list(schedule_data.keys())
            placeholders = ['%s'] * len(fields)
            values = [schedule_data[field] for field in fields]
            
            query = f'''
                INSERT INTO station_schedule ({', '.join(fields)})
                VALUES ({', '.join(placeholders)})
                RETURNING id
            '''
            
            cursor = conn.cursor()
            cursor.execute(query, values)
            result = cursor.fetchone()
            schedule_id = result[0]
            conn.commit()
            
            logger.info(f"Added schedule for station {schedule_data['station_id']} on {calendar.day_name[schedule_data['day_of_week']]}")
            return schedule_id
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error adding schedule: {str(e)}")
            return None
    
    @staticmethod
    def update_schedule(conn, schedule_id, schedule_data):
        """
        Update an existing station schedule
        
        Args:
            conn: Database connection
            schedule_id: Schedule ID
            schedule_data: Dictionary with schedule details to update
                
        Returns:
            True if successful, False otherwise
        """
        try:
            # Build SET clause
            set_clauses = []
            values = []
            
            for key, value in schedule_data.items():
                set_clauses.append(f"{key} = %s")
                values.append(value)
            
            if not set_clauses:
                logger.error("No fields to update")
                return False
            
            # Add schedule_id for WHERE clause
            values.append(schedule_id)
            
            query = f"UPDATE station_schedule SET {', '.join(set_clauses)} WHERE id = %s"
            
            cursor = conn.cursor()
            cursor.execute(query, values)
            conn.commit()
            
            logger.info(f"Updated schedule {schedule_id}")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error updating schedule: {str(e)}")
            return False
    
    @staticmethod
    def delete_schedule(conn, schedule_id):
        """
        Delete a station schedule
        
        Args:
            conn: Database connection
            schedule_id: Schedule ID
                
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM station_schedule WHERE id = %s", (schedule_id,))
            conn.commit()
            
            logger.info(f"Deleted schedule {schedule_id}")
            return True
        
        except Exception as e:
            conn.rollback()
            logger.error(f"Error deleting schedule: {str(e)}")
            return False
    
    @staticmethod
    def get_schedules_by_day(conn, day_of_week):
        """
        Get all schedules for a specific day
        
        Args:
            conn: Database connection
            day_of_week: Day of week (0=Monday, 6=Sunday)
                
        Returns:
            List of schedule dictionaries
        """
        query = """
            SELECT s.id, s.station_id, s.day_of_week, s.start_time, s.end_time, 
                   s.break_start, s.break_end, s.notes, st.barista_name
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.day_of_week = %s
            ORDER BY s.start_time, s.station_id
        """
        
        return execute_query(conn, query, (day_of_week,), fetch_all=True)
    
    @staticmethod
    def get_all_schedules(conn):
        """
        Get all station schedules grouped by day
        
        Args:
            conn: Database connection
                
        Returns:
            Dictionary with days as keys and lists of schedules as values
        """
        query = """
            SELECT s.id, s.station_id, s.day_of_week, s.start_time, s.end_time, 
                   s.break_start, s.break_end, s.notes, st.barista_name
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            ORDER BY s.day_of_week, s.start_time, s.station_id
        """
        
        results = execute_query(conn, query, fetch_all=True)
        
        # Group by day
        schedules_by_day = {}
        for day in range(7):  # 0=Monday to 6=Sunday
            schedules_by_day[day] = []
        
        for schedule in results:
            day = schedule['day_of_week']
            schedules_by_day[day].append(schedule)
        
        return schedules_by_day
    
    @staticmethod
    def is_station_available(conn, station_id=None, check_time=None):
        """
        Check if any station (or a specific station) is available at the given time
        
        Args:
            conn: Database connection
            station_id: Specific station to check, or None to check any station
            check_time: Time to check availability for, defaults to current time
            
        Returns:
            Tuple of (available, message, next_open_time)
        """
        if check_time is None:
            check_time = datetime.now()
        
        # Get day of week (0=Monday, 6=Sunday)
        day_of_week = check_time.weekday()
        
        # Format time as HH:MM for comparison
        current_time_str = check_time.strftime("%H:%M")
        
        cursor = conn.cursor(cursor_factory=RealDictCursor)
        
        # Build query based on whether we're checking a specific station
        if station_id:
            query = '''
                SELECT station_id, start_time, end_time, break_start, break_end, notes
                FROM station_schedule
                WHERE station_id = %s AND day_of_week = %s
                ORDER BY start_time
            '''
            params = (station_id, day_of_week)
        else:
            query = '''
                SELECT station_id, start_time, end_time, break_start, break_end, notes
                FROM station_schedule
                WHERE day_of_week = %s
                ORDER BY start_time
            '''
            params = (day_of_week,)
        
        cursor.execute(query, params)
        schedules = cursor.fetchall()
        
        # If no schedules found for today
        if not schedules:
            # Check if there are schedules for any day
            cursor.execute("SELECT COUNT(*) FROM station_schedule")
            result = cursor.fetchone()
            if result['count'] == 0:
                # No schedules at all, assume always available
                return True, "Stations are available", None
            else:
                # No schedule for today specifically
                return False, "No stations are scheduled for today", StationSchedule.find_next_available_time(conn, check_time)
        
        # Check each schedule
        next_open_time = None
        
        for schedule in schedules:
            s_station_id, start_time, end_time = schedule['station_id'], schedule['start_time'], schedule['end_time']
            break_start, break_end, notes = schedule['break_start'], schedule['break_end'], schedule['notes']
            
            # Check if current time is within operating hours
            if start_time <= current_time_str <= end_time:
                # Check if during a break
                if break_start and break_end and break_start <= current_time_str <= break_end:
                    # On break - update next open time
                    break_end_time = datetime.combine(check_time.date(), datetime.strptime(break_end, "%H:%M").time())
                    if next_open_time is None or break_end_time < next_open_time:
                        next_open_time = break_end_time
                else:
                    # Not on break - station is available!
                    return True, f"Station {s_station_id} is available", None
            elif current_time_str < start_time:
                # Station opens later today
                start_time_dt = datetime.combine(check_time.date(), datetime.strptime(start_time, "%H:%M").time())
                if next_open_time is None or start_time_dt < next_open_time:
                    next_open_time = start_time_dt
        
        # If we got here, no stations are currently available
        message = "Stations are currently closed"
        if next_open_time:
            formatted_time = next_open_time.strftime("%I:%M %p")
            message = f"Stations are currently closed. Next opening time: {formatted_time}"
        
        return False, message, next_open_time
    
    @staticmethod
    def find_next_available_time(conn, from_time=None):
        """
        Find the next time when any station will be available
        
        Args:
            conn: Database connection
            from_time: Starting time to check from, defaults to now
            
        Returns:
            Datetime of next available time, or None if no schedule found
        """
        if from_time is None:
            from_time = datetime.now()
        
        # Check for the next 7 days
        for days_ahead in range(7):
            check_date = from_time.date() + timedelta(days=days_ahead)
            day_of_week = check_date.weekday()
            
            cursor = conn.cursor()
            cursor.execute('''
                SELECT station_id, start_time, end_time 
                FROM station_schedule
                WHERE day_of_week = %s
                ORDER BY start_time
            ''', (day_of_week,))
            
            schedules = cursor.fetchall()
            if not schedules:
                continue
            
            # If checking today, only consider times after current time
            if days_ahead == 0:
                current_time_str = from_time.strftime("%H:%M")
                
                for _, start_time, end_time in schedules:
                    if start_time > current_time_str:
                        # Station opens later today
                        return datetime.combine(check_date, datetime.strptime(start_time, "%H:%M").time())
            else:
                # For future days, return the first opening time
                return datetime.combine(check_date, datetime.strptime(schedules[0][1], "%H:%M").time())
        
        # No available times found in the next 7 days
        return None
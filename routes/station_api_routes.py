"""
API routes for station management
"""
from flask import Blueprint, jsonify, request, current_app, g
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
import logging
import json
from datetime import datetime, timedelta, date
import psycopg2
from psycopg2.extras import RealDictCursor

from models.stations import Station, StationSchedule
from utils.helpers import role_required
from auth import jwt_required_with_demo, role_required_with_demo

# Set up logging
logger = logging.getLogger("expresso.routes.station_api")

# Create blueprint
bp = Blueprint('station_api', __name__)

# Get current user ID helper
def get_current_user_id():
    """Get current user ID from JWT"""
    try:
        # Get JWT identity
        user_id = get_jwt_identity()
        return user_id
    except Exception:
        # Fall back to g.user if available
        if hasattr(g, 'user') and g.user and 'id' in g.user:
            return g.user['id']
        return None

# Get all stations
@bp.route('/api/stations', methods=['GET'])
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_stations():
    """Get all coffee stations"""
    db = None
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Rollback any existing failed transaction
        try:
            db.rollback()
        except Exception:
            pass
        
        # Get all stations
        stations = Station.get_all(db)

        # Live queue length per station = count of orders still waiting or
        # being made. Counting actual orders is authoritative (the stored
        # current_load counter can drift); the barista header uses this to
        # show other stations' queues so walk-ups can be redirected.
        # Must be fully fetched before any other cursor runs on this conn.
        queue_by_station = {}
        try:
            lc = db.cursor()
            lc.execute("""
                SELECT station_id, COUNT(*) FROM orders
                WHERE status IN ('pending', 'in-progress', 'in_progress')
                  AND created_at > NOW() - INTERVAL '8 hours'
                GROUP BY station_id
            """)
            for _row in lc.fetchall():
                if _row and _row[0] is not None:
                    queue_by_station[int(_row[0])] = int(_row[1])
            lc.close()
        except Exception as _le:
            logger.warning(f"per-station queue count failed: {_le}")
            try:
                db.rollback()
            except Exception:
                pass

        # Format station data for API response
        station_data = []
        for station in stations:
            formatted_station = dict(station)

            # Map database fields to frontend expected fields
            # Database uses 'notes' for station name and 'equipment_notes' for location
            formatted_station['id'] = formatted_station.get('station_id', formatted_station.get('id'))
            formatted_station['name'] = formatted_station.get('notes', f"Station {formatted_station.get('station_id', formatted_station.get('id'))}")
            formatted_station['location'] = formatted_station.get('equipment_notes', '')
            formatted_station['baristaName'] = formatted_station.get('barista_name', '')
            formatted_station['status'] = formatted_station.get('status', 'active')

            # Live count of orders pending/in-progress at this station.
            try:
                _sid = int(formatted_station['id'])
                formatted_station['queue_count'] = queue_by_station.get(_sid, 0)
            except (TypeError, ValueError):
                _sid = None
                formatted_station['queue_count'] = 0

            # Smart estimated wait (per-drink make-time × queue ÷ capacity) —
            # the SAME calc the SMS estimate uses, so the barista header and
            # what customers are told finally agree. Defensive: never breaks
            # the stations list if the estimate errors.
            try:
                formatted_station['estimated_wait'] = (
                    coffee_system._get_station_wait_time(_sid) if _sid is not None else None
                )
            except Exception:
                formatted_station['estimated_wait'] = None

            # Format datetime objects
            if 'last_updated' in formatted_station and formatted_station['last_updated']:
                formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')

            station_data.append(formatted_station)
        
        return jsonify({
            'success': True,
            'count': len(station_data),
            'stations': station_data
        })
    except Exception as e:
        logger.error(f"Error getting stations: {str(e)}")
        if db:
            try:
                db.rollback()
            except Exception:
                pass
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get station by ID
@bp.route('/api/stations/<int:station_id>', methods=['GET'])
@jwt_required()
@role_required(['admin', 'staff', 'barista'])
def get_station(station_id):
    """Get details for a specific coffee station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station by ID
        station = Station.get_by_id(db, station_id)
        
        if not station:
            return jsonify({
                'success': False,
                'error': f'Station not found with ID {station_id}'
            }), 404
        
        # Format datetime objects
        formatted_station = dict(station)
        
        # Map database fields to frontend expected fields
        formatted_station['id'] = formatted_station.get('station_id', formatted_station.get('id'))
        formatted_station['name'] = formatted_station.get('notes', f"Station {formatted_station.get('station_id', formatted_station.get('id'))}")
        formatted_station['location'] = formatted_station.get('equipment_notes', '')
        formatted_station['baristaName'] = formatted_station.get('barista_name', '')
        formatted_station['status'] = formatted_station.get('status', 'active')
        
        if 'last_updated' in formatted_station and formatted_station['last_updated']:
            formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')
        
        # Get today's schedule for this station
        today = datetime.now().weekday()  # 0=Monday, 6=Sunday
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT * FROM station_schedule 
            WHERE station_id = %s AND day_of_week = %s
            ORDER BY start_time
        """, (station_id, today))
        
        schedule = cursor.fetchall()
        for item in schedule:
            # Clean up time formats for API response
            for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                if time_field in item and item[time_field]:
                    try:
                        # Format as 12-hour time for display
                        time_obj = datetime.strptime(item[time_field], "%H:%M").time()
                        item[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    except Exception:
                        pass
        
        # Add schedule to the response
        formatted_station['todays_schedule'] = schedule
        
        return jsonify({
            'success': True,
            'station': formatted_station
        })
    except Exception as e:
        logger.error(f"Error getting station {station_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Create new station
@bp.route('/api/stations', methods=['POST'])
@jwt_required()
@role_required(['admin', 'staff'])
def create_station():
    """Create a new coffee station.

    If the caller didn't supply a station_id we auto-assign the next
    available integer — that's almost always what an organiser wants
    when they click "Add Station" in the UI. The old behaviour
    rejected the request with "Missing required field: station_id",
    which made the Add Station button silently broken for anyone who
    didn't know to type a number first.
    """
    try:
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400

        data = request.json or {}

        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        cursor = db.cursor()

        station_id = data.get('station_id')
        if station_id is None:
            # Auto-pick next available id. Use the max + 1 to keep
            # the numbers reasonable rather than chasing a sequence.
            cursor.execute("SELECT COALESCE(MAX(station_id), 0) + 1 FROM station_stats")
            row = cursor.fetchone()
            station_id = row[0] if not isinstance(row, dict) else list(row.values())[0]
            logger.info(f"Auto-assigned new station id: {station_id}")
        else:
            cursor.execute(
                "SELECT COUNT(*) FROM station_stats WHERE station_id = %s",
                (station_id,),
            )
            count = cursor.fetchone()[0]
            if count > 0:
                return jsonify({
                    'success': False,
                    'error': f'Station with ID {station_id} already exists',
                }), 400

        # Defaults — capabilities are an empty JSONB which the
        # conversation-flow handlers treat as "no specialties
        # configured yet" and fall back to the standard menu.
        #
        # Historical bug: the Organiser "Add Station" form sends a
        # `name`, `location` and `description` along with the
        # station_id, but this endpoint silently ignored them — so
        # newly-created stations appeared with no name on the next
        # page load. Frontend's StationSettings.js maps name → notes
        # and location → equipment_notes, so accept either key.
        status = data.get('status', 'active')
        current_load = data.get('current_load', 0)
        total_orders = data.get('total_orders', 0)
        avg_completion_time = data.get('avg_completion_time', 180)
        barista_name = data.get('barista_name', None)
        notes = data.get('notes') or data.get('name')
        equipment_notes = data.get('equipment_notes') or data.get('location')
        now = datetime.now()

        # notes/equipment_notes are what this API reads back as name and
        # location; name/location are the twin columns other readers use.
        # Write both at birth so they never disagree.
        cursor.execute("""
            INSERT INTO station_stats
            (station_id, status, current_load, total_orders,
             avg_completion_time, barista_name, last_updated,
             notes, equipment_notes, name, location)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            RETURNING *
        """, (
            station_id, status, current_load, total_orders,
            avg_completion_time, barista_name, now,
            notes, equipment_notes, notes, equipment_notes,
        ))

        db.commit()

        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM station_stats WHERE station_id = %s", (station_id,))
        new_station = cursor.fetchone()

        logger.info(f"Created new station with ID {station_id}")

        return jsonify({
            'success': True,
            'message': 'Station created successfully',
            'station': new_station,
        }), 201
    except Exception as e:
        logger.error(f"Error creating station: {str(e)}")
        if 'db' in locals():
            try:
                db.rollback()
            except Exception:
                pass
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update station status
@bp.route('/api/stations/<int:station_id>/status', methods=['PATCH'])
@jwt_required()
@role_required(['admin', 'staff', 'barista'])
def update_station_status(station_id):
    """Update a station's status"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        if 'status' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required field: status'
            }), 400
        
        # Validate status
        valid_statuses = ['active', 'inactive', 'maintenance']
        if data['status'] not in valid_statuses:
            return jsonify({
                'success': False,
                'error': f'Invalid status. Must be one of: {", ".join(valid_statuses)}'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Update station status
        status_updated = Station.update_status(db, station_id, data['status'])
        
        if not status_updated:
            return jsonify({
                'success': False,
                'error': f'Failed to update status for station {station_id}'
            }), 400
        
        # Get updated station
        station = Station.get_by_id(db, station_id)
        
        # Format datetime objects
        formatted_station = dict(station)
        if 'last_updated' in formatted_station and formatted_station['last_updated']:
            formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'message': f'Station status updated to {data["status"]}',
            'station': formatted_station
        })
    except Exception as e:
        logger.error(f"Error updating station status: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Assign barista to station
@bp.route('/api/stations/<int:station_id>/barista', methods=['PATCH'])
@jwt_required()
@role_required(['admin', 'staff'])
def assign_barista(station_id):
    """Assign a barista to a station"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        if 'barista_name' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required field: barista_name'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Assign barista to station
        barista_assigned = Station.assign_barista(db, station_id, data['barista_name'])
        
        if not barista_assigned:
            return jsonify({
                'success': False,
                'error': f'Failed to assign barista to station {station_id}'
            }), 400
        
        # Get updated station
        station = Station.get_by_id(db, station_id)
        
        # Format datetime objects
        formatted_station = dict(station)
        if 'last_updated' in formatted_station and formatted_station['last_updated']:
            formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'message': f'Barista {data["barista_name"]} assigned to station {station_id}',
            'station': formatted_station
        })
    except Exception as e:
        logger.error(f"Error assigning barista: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update station capabilities
@bp.route('/api/stations/<int:station_id>/capabilities', methods=['POST'])
@jwt_required()
@role_required(['admin', 'staff'])
def update_station_capabilities(station_id):
    """Update station capabilities"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if station exists
        station = Station.get_by_id(db, station_id)
        if not station:
            return jsonify({
                'success': False,
                'error': f'Station not found with ID {station_id}'
            }), 404
        
        # Log the capabilities update request
        logger.info(f"Updating capabilities for station {station_id} with data: {data}")
        
        # Extract capabilities data - handle both direct and nested formats
        if 'capabilities' in data:
            # Nested format: { capabilities: { ... } }
            cap_data = data['capabilities']
        else:
            # Direct format
            cap_data = data

        # Accept both camelCase (legacy frontend) AND snake_case (new
        # StationCapabilitiesEditor). Whichever set the caller sends
        # wins; the other is taken from the value already in the DB
        # so partial saves don't wipe siblings.
        def _pick(*keys):
            for k in keys:
                if k in cap_data:
                    return cap_data[k]
            return None

        new_caps_partial = {}
        for snake, camel in [
            ('coffee_types', 'coffeeTypes'),
            ('milk_types',   'milkTypes'),
            ('extra_options', 'extraOptions'),
            ('capacity',     'capacity'),
            ('skill_level',  'skillLevel'),
            ('specializations', 'specializations'),
            ('alt_milk',     'altMilk'),
            ('high_volume',  'highVolume'),
            ('vip_service',  'vipService'),
            ('sizes',        'sizes'),
        ]:
            val = _pick(snake, camel)
            if val is not None:
                new_caps_partial[snake] = val

        # Merge with the existing JSONB row so partial saves are safe.
        # Previously this endpoint wrote to `equipment_notes` (a TEXT
        # column meant for hardware notes) and wiped all fields on
        # every save — meaning a save of just `vip_service: true`
        # blew away milk_types, coffee_types, etc. _assign_station
        # reads `capabilities` (JSONB), so the old data flow was
        # silently broken: edits never reached the SMS-routing
        # decision. Fixed May 2026.
        cursor = db.cursor()
        cursor.execute(
            "SELECT COALESCE(capabilities, '{}'::jsonb) FROM station_stats WHERE station_id = %s",
            (station_id,),
        )
        row = cursor.fetchone()
        existing = {}
        if row and row[0]:
            raw = row[0]
            if isinstance(raw, str):
                try:
                    existing = json.loads(raw)
                except Exception:
                    existing = {}
            elif isinstance(raw, dict):
                existing = raw
        capabilities = {**existing, **new_caps_partial}

        cursor.execute(
            "UPDATE station_stats SET capabilities = %s::jsonb, last_updated = %s "
            "WHERE station_id = %s",
            (json.dumps(capabilities), datetime.now(), station_id),
        )
        
        db.commit()
        
        # Get updated station
        updated_station = Station.get_by_id(db, station_id)

        # Format response
        formatted_station = dict(updated_station)

        # Surface the merged capabilities we just wrote so the
        # frontend doesn't have to re-GET.
        formatted_station['capabilities'] = capabilities
        
        # Map database fields to frontend fields
        formatted_station['id'] = formatted_station.get('station_id', formatted_station.get('id'))
        formatted_station['name'] = formatted_station.get('notes', f"Station {station_id}")
        
        if 'last_updated' in formatted_station and formatted_station['last_updated']:
            formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')
        
        return jsonify({
            'success': True,
            'message': f'Station {station_id} capabilities updated successfully',
            'station': formatted_station
        })
    except Exception as e:
        logger.error(f"Error updating station capabilities {station_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update station details
@bp.route('/api/stations/<int:station_id>', methods=['PATCH'])
@jwt_required()
@role_required(['admin', 'staff'])
def update_station(station_id):
    """Update station details"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if station exists
        station = Station.get_by_id(db, station_id)
        if not station:
            return jsonify({
                'success': False,
                'error': f'Station not found with ID {station_id}'
            }), 404
        
        # Log the update request
        logger.info(f"Updating station {station_id} with data: {data}")
        
        # Update station
        updated = Station.update_station(db, station_id, data)
        
        if not updated:
            return jsonify({
                'success': False,
                'error': f'Failed to update station {station_id}'
            }), 400
        
        # Get updated station
        updated_station = Station.get_by_id(db, station_id)
        
        # Format datetime objects
        formatted_station = dict(updated_station)
        if 'last_updated' in formatted_station and formatted_station['last_updated']:
            formatted_station['last_updated_formatted'] = formatted_station['last_updated'].strftime('%Y-%m-%d %H:%M:%S')
        
        # Map database fields to frontend fields
        if 'notes' in formatted_station:
            formatted_station['name'] = formatted_station['notes']
        
        if 'equipment_notes' in formatted_station:
            formatted_station['location'] = formatted_station['equipment_notes']
        
        return jsonify({
            'success': True,
            'message': f'Station {station_id} updated successfully',
            'station': formatted_station
        })
    except Exception as e:
        logger.error(f"Error updating station {station_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get station statistics
# Delete station
@bp.route('/api/stations/<int:station_id>', methods=['DELETE'])
@jwt_required()
@role_required(['admin', 'staff'])
def delete_station(station_id):
    """Delete a station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if station exists
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM station_stats WHERE station_id = %s", (station_id,))
        if cursor.fetchone()[0] == 0:
            return jsonify({
                'success': False,
                'error': f'Station with ID {station_id} does not exist'
            }), 404
        
        # Use the model method to delete the station
        deleted = Station.delete_station(db, station_id)
        
        if not deleted:
            return jsonify({
                'success': False,
                'error': f'Failed to delete station {station_id}. It may have active orders.'
            }), 400
        
        # Clear any cached station data
        try:
            # Try to clear station caches if any exist
            if hasattr(g, 'station_cache'):
                g.station_cache.pop(station_id, None)
        except Exception as e:
            logger.warning(f"Error clearing station cache: {str(e)}")
        
        return jsonify({
            'success': True,
            'message': f'Station {station_id} deleted successfully'
        })
    except Exception as e:
        logger.error(f"Error deleting station {station_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

@bp.route('/api/stations/<int:station_id>/stats', methods=['GET'])
@jwt_required()
@role_required(['admin', 'staff', 'barista'])
def get_station_stats(station_id):
    """Get statistics for a station"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get station by ID
        station = Station.get_by_id(db, station_id)
        
        if not station:
            return jsonify({
                'success': False,
                'error': f'Station not found with ID {station_id}'
            }), 404
        
        # Get order statistics for this station
        cursor = db.cursor(cursor_factory=RealDictCursor)
        
        # Get order counts by status
        cursor.execute("""
            SELECT status, COUNT(*) as count
            FROM orders
            WHERE station_id = %s
            GROUP BY status
        """, (station_id,))
        
        orders_by_status = cursor.fetchall()
        
        # Get order counts by hour for today
        today = datetime.now().strftime('%Y-%m-%d')
        cursor.execute("""
            SELECT EXTRACT(HOUR FROM created_at) as hour, COUNT(*) as count
            FROM orders
            WHERE station_id = %s AND DATE(created_at) = %s
            GROUP BY hour
            ORDER BY hour
        """, (station_id, today))
        
        orders_by_hour = cursor.fetchall()
        
        # Get daily statistics for the past week
        one_week_ago = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
        cursor.execute("""
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM orders
            WHERE station_id = %s AND created_at >= %s
            GROUP BY date
            ORDER BY date
        """, (station_id, one_week_ago))
        
        orders_by_day = cursor.fetchall()
        
        # Format datetime objects for API response
        formatted_orders_by_day = []
        for day in orders_by_day:
            formatted_day = dict(day)
            formatted_day['date_formatted'] = formatted_day['date'].strftime('%Y-%m-%d')
            formatted_orders_by_day.append(formatted_day)
        
        # Calculate average completion time
        cursor.execute("""
            SELECT AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) as avg_completion_time
            FROM orders
            WHERE station_id = %s AND status = 'completed' AND completed_at IS NOT NULL
            AND DATE(created_at) >= %s
        """, (station_id, one_week_ago))
        
        avg_completion_result = cursor.fetchone()
        avg_completion_time = avg_completion_result['avg_completion_time'] if avg_completion_result and avg_completion_result['avg_completion_time'] else 0
        
        # Format statistics
        stats = {
            'station_id': station_id,
            'barista_name': station['barista_name'],
            'status': station['status'],
            'current_load': station['current_load'],
            'total_orders': station['total_orders'],
            'avg_completion_time': int(avg_completion_time),  # In seconds
            'avg_completion_time_formatted': f"{int(avg_completion_time // 60)}:{int(avg_completion_time % 60):02d}",  # MM:SS format
            'orders_by_status': orders_by_status,
            'orders_by_hour': orders_by_hour,
            'orders_by_day': formatted_orders_by_day
        }
        
        return jsonify({
            'success': True,
            'stats': stats
        })
    except Exception as e:
        logger.error(f"Error getting station stats for {station_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get today's schedule
@bp.route('/api/schedule/today', methods=['GET'])
@role_required_with_demo(['admin', 'staff', 'barista'])
def get_todays_schedule():
    """Get today's schedule for all stations"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get today's day of week (0=Monday, 6=Sunday)
        today = datetime.now().weekday()
        
        # Get schedules for today
        schedules = StationSchedule.get_schedules_by_day(db, today)
        
        # Format time values
        for schedule in schedules:
            for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                if time_field in schedule and schedule[time_field]:
                    try:
                        # Format as 12-hour time for display
                        time_obj = datetime.strptime(schedule[time_field], "%H:%M").time()
                        schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    except Exception:
                        pass
        
        # DISABLED: this used to fabricate sample shifts ("Barista 1A
        # 08:00-12:00", etc.) AND INSERT them into station_schedule when no
        # real schedule existed — which then showed as fake data on every
        # barista Schedule tab, on every station, forever (found in HB
        # Lobethal live testing). Now an empty schedule stays empty and the
        # UI shows its honest "no shifts scheduled" state. The block below
        # is left under `if False:` and should be deleted in a cleanup pass.
        if False:  # was: if len(schedules) == 0
            # Create some sample data for testing
            # This would normally come from the database
            now = datetime.now()
            shifts = []
            breaks = []
            rush_periods = []
            
            # Generate sample shifts for stations 1, 2, and 3
            for station_id in range(1, 4):
                # Morning shift from 8:00 AM to 12:00 PM
                morning_shift = {
                    'id': len(shifts) + 1,
                    'station_id': station_id,
                    'day_of_week': today,
                    'start_time': '08:00',
                    'end_time': '12:00',
                    'start_time_formatted': '8:00 AM',
                    'end_time_formatted': '12:00 PM',
                    'barista_name': f'Barista {station_id}A'
                }
                shifts.append(morning_shift)
                
                # Afternoon shift from 12:00 PM to 4:00 PM
                afternoon_shift = {
                    'id': len(shifts) + 1,
                    'station_id': station_id,
                    'day_of_week': today,
                    'start_time': '12:00',
                    'end_time': '16:00',
                    'start_time_formatted': '12:00 PM',
                    'end_time_formatted': '4:00 PM',
                    'barista_name': f'Barista {station_id}B'
                }
                shifts.append(afternoon_shift)
                
                # Breaks for the morning and afternoon shifts
                morning_break = {
                    'id': len(breaks) + 1,
                    'station_id': station_id,
                    'day_of_week': today,
                    'start_time': '10:00',
                    'end_time': '10:15',
                    'start_time_formatted': '10:00 AM',
                    'end_time_formatted': '10:15 AM',
                    'notes': 'Morning break'
                }
                breaks.append(morning_break)
                
                afternoon_break = {
                    'id': len(breaks) + 1,
                    'station_id': station_id,
                    'day_of_week': today,
                    'start_time': '14:00',
                    'end_time': '14:15',
                    'start_time_formatted': '2:00 PM',
                    'end_time_formatted': '2:15 PM',
                    'notes': 'Afternoon break'
                }
                breaks.append(afternoon_break)
            
            # Add some rush periods
            rush_periods.append({
                'id': 1,
                'day_of_week': today,
                'start_time': '08:30',
                'end_time': '09:30',
                'start_time_formatted': '8:30 AM',
                'end_time_formatted': '9:30 AM',
                'notes': 'Morning rush'
            })
            
            rush_periods.append({
                'id': 2,
                'day_of_week': today,
                'start_time': '12:00',
                'end_time': '13:00',
                'start_time_formatted': '12:00 PM',
                'end_time_formatted': '1:00 PM',
                'notes': 'Lunch rush'
            })
            
            # Create sample shifts and breaks in the database
            cursor = db.cursor()
            
            # Insert sample shifts
            for shift in shifts:
                cursor.execute("""
                    INSERT INTO station_schedule 
                    (station_id, day_of_week, start_time, end_time, notes, created_at)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    shift['station_id'], 
                    shift['day_of_week'], 
                    shift['start_time'], 
                    shift['end_time'], 
                    f"Shift for {shift['barista_name']}", 
                    now
                ))
            
            # Insert sample breaks
            for break_item in breaks:
                # Find the associated shift
                matching_shifts = [s for s in shifts 
                                 if s['station_id'] == break_item['station_id'] 
                                 and s['start_time'] <= break_item['start_time'] 
                                 and s['end_time'] >= break_item['end_time']]
                
                if matching_shifts:
                    shift = matching_shifts[0]
                    cursor.execute("""
                        UPDATE station_schedule 
                        SET break_start = %s, break_end = %s
                        WHERE station_id = %s AND day_of_week = %s AND start_time = %s AND end_time = %s
                    """, (
                        break_item['start_time'], 
                        break_item['end_time'],
                        shift['station_id'],
                        shift['day_of_week'],
                        shift['start_time'],
                        shift['end_time']
                    ))
            
            db.commit()
            
            # Get updated schedules
            schedules = StationSchedule.get_schedules_by_day(db, today)
            
            # Format time values again
            for schedule in schedules:
                for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                    if time_field in schedule and schedule[time_field]:
                        try:
                            # Format as 12-hour time for display
                            time_obj = datetime.strptime(schedule[time_field], "%H:%M").time()
                            schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                        except Exception:
                            pass
        
        # Get stations for additional info
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM station_stats ORDER BY station_id")
        stations = cursor.fetchall()
        
        # Get current time for display
        now = datetime.now()
        current_time = now.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
        
        return jsonify({
            'success': True,
            'day_of_week': today,
            'day_name': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][today],
            'current_time': current_time,
            'schedules': schedules,
            'stations': stations
        })
    except Exception as e:
        logger.error(f"Error getting today's schedule: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get schedule for specific date
@bp.route('/api/schedule/date/<date_str>', methods=['GET'])
@jwt_required()
@role_required(['admin', 'staff', 'barista'])
def get_schedule_by_date(date_str):
    """Get schedule for a specific date"""
    try:
        # Parse date string (YYYY-MM-DD)
        try:
            date_obj = datetime.strptime(date_str, '%Y-%m-%d').date()
            day_of_week = date_obj.weekday()  # 0=Monday, 6=Sunday
        except ValueError:
            return jsonify({
                'success': False,
                'error': 'Invalid date format. Use YYYY-MM-DD'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get schedules for the day
        schedules = StationSchedule.get_schedules_by_day(db, day_of_week)
        
        # Format time values
        for schedule in schedules:
            for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                if time_field in schedule and schedule[time_field]:
                    try:
                        # Format as 12-hour time for display
                        time_obj = datetime.strptime(schedule[time_field], "%H:%M").time()
                        schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    except Exception:
                        pass
        
        # Get stations for additional info
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM station_stats ORDER BY station_id")
        stations = cursor.fetchall()
        
        return jsonify({
            'success': True,
            'date': date_str,
            'day_of_week': day_of_week,
            'day_name': ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day_of_week],
            'schedules': schedules,
            'stations': stations
        })
    except Exception as e:
        logger.error(f"Error getting schedule for date {date_str}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Get barista's schedule
@bp.route('/api/schedule/barista/<barista_name>', methods=['GET'])
@jwt_required()
@role_required(['admin', 'staff', 'barista'])
def get_barista_schedule(barista_name):
    """Get a specific barista's schedule"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Get schedules for this barista
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE st.barista_name = %s
            ORDER BY s.day_of_week, s.start_time
        """, (barista_name,))
        
        schedules = cursor.fetchall()
        
        # Format time values and group by day
        schedules_by_day = {day: [] for day in range(7)}  # 0=Monday to 6=Sunday
        
        for schedule in schedules:
            day = schedule['day_of_week']
            
            # Format times
            for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
                if time_field in schedule and schedule[time_field]:
                    try:
                        # Format as 12-hour time for display
                        time_obj = datetime.strptime(schedule[time_field], "%H:%M").time()
                        schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                    except Exception:
                        pass
            
            schedules_by_day[day].append(schedule)
        
        # Format for display
        formatted_schedule = []
        for day in range(7):
            day_name = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'][day]
            formatted_schedule.append({
                'day_of_week': day,
                'day_name': day_name,
                'schedules': schedules_by_day[day]
            })
        
        return jsonify({
            'success': True,
            'barista_name': barista_name,
            'schedule': formatted_schedule
        })
    except Exception as e:
        logger.error(f"Error getting schedule for barista {barista_name}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add new shift
@bp.route('/api/schedule/shifts', methods=['POST'])
@jwt_required()
@role_required(['admin', 'staff'])
def add_shift():
    """Add a new shift to the schedule"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        required_fields = ['station_id', 'day_of_week', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Validate day of week
        try:
            day_of_week = int(data['day_of_week'])
            if day_of_week < 0 or day_of_week > 6:
                return jsonify({
                    'success': False,
                    'error': 'Day of week must be between 0 (Monday) and 6 (Sunday)'
                }), 400
        except ValueError:
            return jsonify({
                'success': False,
                'error': 'Day of week must be a number between 0 (Monday) and 6 (Sunday)'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if station exists
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM station_stats WHERE station_id = %s", (data['station_id'],))
        if cursor.fetchone()[0] == 0:
            return jsonify({
                'success': False,
                'error': f'Station with ID {data["station_id"]} does not exist'
            }), 400
        
        # Per-shift roster name. The column didn't exist (barista_name in
        # the today-response came from a JOIN to the STATION's current
        # assignee), so a name sent on create was silently dropped — the
        # roster couldn't say who works which shift (Test Bench sched_crud).
        # ADD COLUMN takes ACCESS EXCLUSIVE on station_schedule BEFORE it
        # checks whether the column is there, so even this no-op queues
        # every later reader of the table behind it. Rare and admin-only,
        # which is why it outlived the #356 sweep -- but it is the same
        # mechanism that took the site down, and "rare" is not a promise
        # about WHEN. ensure_column reads the catalogue first and only
        # reaches for DDL on a database that genuinely lacks the column.
        from utils.schema_guard import ensure_column
        ensure_column(
            db, "station_schedule", "barista_name",
            "ALTER TABLE station_schedule ADD COLUMN IF NOT EXISTS "
            "barista_name VARCHAR(100)")

        # Prepare schedule data
        schedule_data = {
            'station_id': data['station_id'],
            'day_of_week': day_of_week,
            'start_time': data['start_time'],
            'end_time': data['end_time'],
            'notes': data.get('notes', '')
        }
        if (data.get('barista_name') or '').strip():
            schedule_data['barista_name'] = data['barista_name'].strip()
        
        # Add break times if provided
        if 'break_start' in data and 'break_end' in data and data['break_start'] and data['break_end']:
            schedule_data['break_start'] = data['break_start']
            schedule_data['break_end'] = data['break_end']
        
        # Add the schedule
        schedule_id = StationSchedule.add_schedule(db, schedule_data)
        
        if not schedule_id:
            return jsonify({
                'success': False,
                'error': 'Failed to add shift to schedule'
            }), 400
        
        # Get the new schedule
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.id = %s
        """, (schedule_id,))
        
        new_schedule = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
            if time_field in new_schedule and new_schedule[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(new_schedule[time_field], "%H:%M").time()
                    new_schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Shift added to schedule successfully',
            'schedule': new_schedule
        }), 201
    except Exception as e:
        logger.error(f"Error adding shift: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update shift
@bp.route('/api/schedule/shifts/<int:shift_id>', methods=['PUT'])
@jwt_required()
@role_required(['admin', 'staff'])
def update_shift(shift_id):
    """Update an existing shift"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if shift exists
        cursor = db.cursor()
        cursor.execute("SELECT COUNT(*) FROM station_schedule WHERE id = %s", (shift_id,))
        if cursor.fetchone()[0] == 0:
            return jsonify({
                'success': False,
                'error': f'Shift with ID {shift_id} does not exist'
            }), 404
        
        # Validate day of week if provided
        if 'day_of_week' in data:
            try:
                day_of_week = int(data['day_of_week'])
                if day_of_week < 0 or day_of_week > 6:
                    return jsonify({
                        'success': False,
                        'error': 'Day of week must be between 0 (Monday) and 6 (Sunday)'
                    }), 400
                data['day_of_week'] = day_of_week
            except ValueError:
                return jsonify({
                    'success': False,
                    'error': 'Day of week must be a number between 0 (Monday) and 6 (Sunday)'
                }), 400
        
        # Update the shift
        updated = StationSchedule.update_schedule(db, shift_id, data)
        
        if not updated:
            return jsonify({
                'success': False,
                'error': f'Failed to update shift {shift_id}'
            }), 400
        
        # Get the updated schedule
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.id = %s
        """, (shift_id,))
        
        updated_schedule = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
            if time_field in updated_schedule and updated_schedule[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(updated_schedule[time_field], "%H:%M").time()
                    updated_schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Shift updated successfully',
            'schedule': updated_schedule
        })
    except Exception as e:
        logger.error(f"Error updating shift {shift_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Delete shift
@bp.route('/api/schedule/shifts/<int:shift_id>', methods=['DELETE'])
@jwt_required()
@role_required(['admin', 'staff'])
def delete_shift(shift_id):
    """Delete a shift from the schedule"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if shift exists
        cursor = db.cursor()
        cursor.execute("SELECT * FROM station_schedule WHERE id = %s", (shift_id,))
        shift = cursor.fetchone()
        
        if not shift:
            return jsonify({
                'success': False,
                'error': f'Shift with ID {shift_id} does not exist'
            }), 404
        
        # Delete the shift
        deleted = StationSchedule.delete_schedule(db, shift_id)
        
        if not deleted:
            return jsonify({
                'success': False,
                'error': f'Failed to delete shift {shift_id}'
            }), 400
        
        return jsonify({
            'success': True,
            'message': f'Shift {shift_id} deleted successfully'
        })
    except Exception as e:
        logger.error(f"Error deleting shift {shift_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add break to shift
@bp.route('/api/schedule/breaks', methods=['POST'])
@jwt_required()
@role_required(['admin', 'staff'])
def add_break():
    """Add a break to an existing shift"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        required_fields = ['shift_id', 'break_start', 'break_end']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if shift exists
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM station_schedule WHERE id = %s", (data['shift_id'],))
        shift = cursor.fetchone()
        
        if not shift:
            return jsonify({
                'success': False,
                'error': f'Shift with ID {data["shift_id"]} does not exist'
            }), 404
        
        # Validate that break is within shift times
        if (data['break_start'] < shift['start_time'] or 
            data['break_end'] > shift['end_time'] or
            data['break_start'] >= data['break_end']):
            return jsonify({
                'success': False,
                'error': 'Break times must be within shift hours and end after start'
            }), 400
        
        # Update the shift with break times
        schedule_data = {
            'break_start': data['break_start'],
            'break_end': data['break_end']
        }
        
        # Add notes if provided
        if 'notes' in data:
            schedule_data['notes'] = data['notes']
        
        updated = StationSchedule.update_schedule(db, data['shift_id'], schedule_data)
        
        if not updated:
            return jsonify({
                'success': False,
                'error': f'Failed to add break to shift {data["shift_id"]}'
            }), 400
        
        # Get the updated schedule
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.id = %s
        """, (data['shift_id'],))
        
        updated_schedule = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
            if time_field in updated_schedule and updated_schedule[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(updated_schedule[time_field], "%H:%M").time()
                    updated_schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Break added to shift successfully',
            'schedule': updated_schedule
        })
    except Exception as e:
        logger.error(f"Error adding break: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Update break
@bp.route('/api/schedule/breaks/<int:shift_id>', methods=['PUT'])
@jwt_required()
@role_required(['admin', 'staff'])
def update_break(shift_id):
    """Update a break for an existing shift"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        if 'break_start' not in data or 'break_end' not in data:
            return jsonify({
                'success': False,
                'error': 'Missing required fields: break_start and break_end'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if shift exists
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM station_schedule WHERE id = %s", (shift_id,))
        shift = cursor.fetchone()
        
        if not shift:
            return jsonify({
                'success': False,
                'error': f'Shift with ID {shift_id} does not exist'
            }), 404
        
        # Validate that break is within shift times
        if (data['break_start'] < shift['start_time'] or 
            data['break_end'] > shift['end_time'] or
            data['break_start'] >= data['break_end']):
            return jsonify({
                'success': False,
                'error': 'Break times must be within shift hours and end after start'
            }), 400
        
        # Update the shift with new break times
        schedule_data = {
            'break_start': data['break_start'],
            'break_end': data['break_end']
        }
        
        # Add notes if provided
        if 'notes' in data:
            schedule_data['notes'] = data['notes']
        
        updated = StationSchedule.update_schedule(db, shift_id, schedule_data)
        
        if not updated:
            return jsonify({
                'success': False,
                'error': f'Failed to update break for shift {shift_id}'
            }), 400
        
        # Get the updated schedule
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.id = %s
        """, (shift_id,))
        
        updated_schedule = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time', 'break_start', 'break_end']:
            if time_field in updated_schedule and updated_schedule[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(updated_schedule[time_field], "%H:%M").time()
                    updated_schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Break updated successfully',
            'schedule': updated_schedule
        })
    except Exception as e:
        logger.error(f"Error updating break for shift {shift_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Delete break
@bp.route('/api/schedule/breaks/<int:shift_id>', methods=['DELETE'])
@jwt_required()
@role_required(['admin', 'staff'])
def delete_break(shift_id):
    """Remove a break from an existing shift"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if shift exists
        cursor = db.cursor()
        cursor.execute("SELECT * FROM station_schedule WHERE id = %s", (shift_id,))
        shift = cursor.fetchone()
        
        if not shift:
            return jsonify({
                'success': False,
                'error': f'Shift with ID {shift_id} does not exist'
            }), 404
        
        # Update the shift to remove break times
        schedule_data = {
            'break_start': None,
            'break_end': None
        }
        
        updated = StationSchedule.update_schedule(db, shift_id, schedule_data)
        
        if not updated:
            return jsonify({
                'success': False,
                'error': f'Failed to delete break for shift {shift_id}'
            }), 400
        
        # Get the updated schedule
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("""
            SELECT s.*, st.barista_name 
            FROM station_schedule s
            JOIN station_stats st ON s.station_id = st.station_id
            WHERE s.id = %s
        """, (shift_id,))
        
        updated_schedule = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time']:
            if time_field in updated_schedule and updated_schedule[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(updated_schedule[time_field], "%H:%M").time()
                    updated_schedule[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Break removed successfully',
            'schedule': updated_schedule
        })
    except Exception as e:
        logger.error(f"Error deleting break for shift {shift_id}: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500

# Add rush period
@bp.route('/api/schedule/rush-periods', methods=['POST'])
@jwt_required()
@role_required(['admin', 'staff'])
def add_rush_period():
    """Add a new rush period"""
    try:
        # Get request data
        if not request.is_json:
            return jsonify({
                'success': False,
                'error': 'Request must be JSON'
            }), 400
        
        data = request.json
        
        # Validate required fields
        required_fields = ['day_of_week', 'start_time', 'end_time']
        for field in required_fields:
            if field not in data:
                return jsonify({
                    'success': False,
                    'error': f'Missing required field: {field}'
                }), 400
        
        # Validate day of week
        try:
            day_of_week = int(data['day_of_week'])
            if day_of_week < 0 or day_of_week > 6:
                return jsonify({
                    'success': False,
                    'error': 'Day of week must be between 0 (Monday) and 6 (Sunday)'
                }), 400
        except ValueError:
            return jsonify({
                'success': False,
                'error': 'Day of week must be a number between 0 (Monday) and 6 (Sunday)'
            }), 400
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Create rush period in database
        cursor = db.cursor()
        cursor.execute("""
            INSERT INTO rush_periods
            (day_of_week, start_time, end_time, notes, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id
        """, (
            day_of_week, 
            data['start_time'], 
            data['end_time'], 
            data.get('notes', ''), 
            datetime.now()
        ))
        
        rush_period_id = cursor.fetchone()[0]
        db.commit()
        
        # Get the new rush period
        cursor = db.cursor(cursor_factory=RealDictCursor)
        cursor.execute("SELECT * FROM rush_periods WHERE id = %s", (rush_period_id,))
        rush_period = cursor.fetchone()
        
        # Format time values
        for time_field in ['start_time', 'end_time']:
            if time_field in rush_period and rush_period[time_field]:
                try:
                    # Format as 12-hour time for display
                    time_obj = datetime.strptime(rush_period[time_field], "%H:%M").time()
                    rush_period[f"{time_field}_formatted"] = time_obj.strftime("%I:%M %p").lstrip("0").replace(" 0", " ")
                except Exception:
                    pass
        
        return jsonify({
            'success': True,
            'message': 'Rush period added successfully',
            'rush_period': rush_period
        }), 201
    except Exception as e:
        logger.error(f"Error adding rush period: {str(e)}")
        if 'db' in locals():
            db.rollback()
        return jsonify({
            'success': False,
            'error': str(e)
        }), 500
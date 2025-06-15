"""
Schedule API Routes
Handles barista schedules and shift management
"""
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime, date, timedelta
import logging

from models.stations import StationSchedule
from models.users import User
from utils.database import db

logger = logging.getLogger(__name__)

schedule_api_bp = Blueprint('schedule_api', __name__, url_prefix='/api/schedules')

@schedule_api_bp.route('/', methods=['POST'])
@jwt_required()
def create_schedule():
    """Create a new schedule/shift"""
    try:
        data = request.get_json()
        
        # Validate required fields
        required_fields = ['staff_id', 'station_id', 'start_time', 'end_time', 'date']
        for field in required_fields:
            if field not in data:
                return jsonify({'status': 'error', 'message': f'Missing required field: {field}'}), 400
        
        # Parse date and times
        schedule_date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        start_time = datetime.strptime(data['start_time'], '%H:%M').time()
        end_time = datetime.strptime(data['end_time'], '%H:%M').time()
        
        # Create schedule
        schedule = StationSchedule(
            station_id=data['station_id'],
            staff_id=data['staff_id'],
            staff_name=data.get('staff_name', ''),
            date=schedule_date,
            start_time=start_time,
            end_time=end_time,
            status='scheduled'
        )
        
        db.session.add(schedule)
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('schedule_created', {
            'schedule_id': schedule.id,
            'station_id': data['station_id'],
            'staff_name': schedule.staff_name,
            'date': schedule_date.isoformat(),
            'start_time': start_time.isoformat(),
            'end_time': end_time.isoformat()
        }, room='schedule_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'Schedule created successfully',
            'data': {
                'schedule_id': schedule.id,
                'station_id': schedule.station_id,
                'staff_name': schedule.staff_name,
                'date': schedule_date.isoformat(),
                'start_time': start_time.isoformat(),
                'end_time': end_time.isoformat()
            }
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating schedule: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to create schedule'}), 500

@schedule_api_bp.route('/today', methods=['GET'])
@jwt_required()
def get_today_schedules():
    """Get all schedules for today"""
    try:
        today = date.today()
        
        # Get station filter if provided
        station_id = request.args.get('station_id', type=int)
        
        # Query schedules
        query = StationSchedule.query.filter_by(date=today)
        if station_id:
            query = query.filter_by(station_id=station_id)
        
        schedules = query.all()
        
        # Format response
        schedule_data = []
        for schedule in schedules:
            schedule_data.append({
                'id': schedule.id,
                'station_id': schedule.station_id,
                'staff_id': schedule.staff_id,
                'staff_name': schedule.staff_name,
                'date': schedule.date.isoformat(),
                'start_time': schedule.start_time.isoformat(),
                'end_time': schedule.end_time.isoformat(),
                'status': schedule.status,
                'created_at': schedule.created_at.isoformat() if schedule.created_at else None
            })
        
        return jsonify({
            'status': 'success',
            'data': {
                'date': today.isoformat(),
                'schedules': schedule_data,
                'total': len(schedule_data)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting today's schedules: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get schedules'}), 500

@schedule_api_bp.route('/week', methods=['GET'])
@jwt_required()
def get_week_schedules():
    """Get schedules for the current week"""
    try:
        # Calculate week range
        today = date.today()
        start_of_week = today - timedelta(days=today.weekday())
        end_of_week = start_of_week + timedelta(days=6)
        
        # Query schedules
        schedules = StationSchedule.query.filter(
            StationSchedule.date >= start_of_week,
            StationSchedule.date <= end_of_week
        ).all()
        
        # Group by date
        schedules_by_date = {}
        for schedule in schedules:
            date_key = schedule.date.isoformat()
            if date_key not in schedules_by_date:
                schedules_by_date[date_key] = []
            
            schedules_by_date[date_key].append({
                'id': schedule.id,
                'station_id': schedule.station_id,
                'staff_id': schedule.staff_id,
                'staff_name': schedule.staff_name,
                'start_time': schedule.start_time.isoformat(),
                'end_time': schedule.end_time.isoformat(),
                'status': schedule.status
            })
        
        return jsonify({
            'status': 'success',
            'data': {
                'week_start': start_of_week.isoformat(),
                'week_end': end_of_week.isoformat(),
                'schedules': schedules_by_date,
                'total_shifts': len(schedules)
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting week schedules: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get schedules'}), 500

@schedule_api_bp.route('/<int:schedule_id>', methods=['PUT'])
@jwt_required()
def update_schedule(schedule_id):
    """Update an existing schedule"""
    try:
        schedule = StationSchedule.query.get(schedule_id)
        if not schedule:
            return jsonify({'status': 'error', 'message': 'Schedule not found'}), 404
        
        data = request.get_json()
        
        # Update fields if provided
        if 'station_id' in data:
            schedule.station_id = data['station_id']
        if 'staff_id' in data:
            schedule.staff_id = data['staff_id']
        if 'staff_name' in data:
            schedule.staff_name = data['staff_name']
        if 'date' in data:
            schedule.date = datetime.strptime(data['date'], '%Y-%m-%d').date()
        if 'start_time' in data:
            schedule.start_time = datetime.strptime(data['start_time'], '%H:%M').time()
        if 'end_time' in data:
            schedule.end_time = datetime.strptime(data['end_time'], '%H:%M').time()
        if 'status' in data:
            schedule.status = data['status']
        
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('schedule_updated', {
            'schedule_id': schedule.id,
            'changes': data,
            'timestamp': datetime.utcnow().isoformat()
        }, room='schedule_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'Schedule updated successfully',
            'data': {
                'schedule_id': schedule.id,
                'updated_fields': list(data.keys())
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating schedule: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update schedule'}), 500

@schedule_api_bp.route('/<int:schedule_id>', methods=['DELETE'])
@jwt_required()
def delete_schedule(schedule_id):
    """Delete a schedule"""
    try:
        schedule = StationSchedule.query.get(schedule_id)
        if not schedule:
            return jsonify({'status': 'error', 'message': 'Schedule not found'}), 404
        
        # Store data for WebSocket event
        schedule_data = {
            'schedule_id': schedule.id,
            'station_id': schedule.station_id,
            'staff_name': schedule.staff_name,
            'date': schedule.date.isoformat()
        }
        
        db.session.delete(schedule)
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('schedule_deleted', {
            **schedule_data,
            'timestamp': datetime.utcnow().isoformat()
        }, room='schedule_updates')
        
        return jsonify({
            'status': 'success',
            'message': 'Schedule deleted successfully'
        }), 200
        
    except Exception as e:
        logger.error(f"Error deleting schedule: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to delete schedule'}), 500

@schedule_api_bp.route('/check-in/<int:schedule_id>', methods=['POST'])
@jwt_required()
def check_in_schedule(schedule_id):
    """Check in for a scheduled shift"""
    try:
        schedule = StationSchedule.query.get(schedule_id)
        if not schedule:
            return jsonify({'status': 'error', 'message': 'Schedule not found'}), 404
        
        # Update status
        schedule.status = 'active'
        schedule.actual_start_time = datetime.utcnow()
        
        db.session.commit()
        
        # Emit WebSocket event
        from app import socketio
        socketio.emit('barista_checked_in', {
            'schedule_id': schedule.id,
            'station_id': schedule.station_id,
            'staff_name': schedule.staff_name,
            'check_in_time': schedule.actual_start_time.isoformat()
        }, room=f'station_{schedule.station_id}')
        
        return jsonify({
            'status': 'success',
            'message': 'Checked in successfully',
            'data': {
                'schedule_id': schedule.id,
                'check_in_time': schedule.actual_start_time.isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error checking in: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to check in'}), 500
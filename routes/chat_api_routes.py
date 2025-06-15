"""
Chat API routes for station communication
This module provides API endpoints for the barista station chat system
"""

import logging
from flask import Blueprint, jsonify, request, current_app
from datetime import datetime
import json

# Create blueprint
bp = Blueprint('chat_api', __name__, url_prefix='/api/chat')

# Set up logging
logger = logging.getLogger("expresso.routes.chat_api")

@bp.route('/messages', methods=['GET'])
def get_chat_messages():
    """Get recent chat messages between stations"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Check if chat_messages table exists
        cursor = db.cursor()
        cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'chat_messages')")
        table_exists = cursor.fetchone()[0]
        
        if not table_exists:
            # Create the table if it doesn't exist
            cursor.execute('''
                CREATE TABLE IF NOT EXISTS chat_messages (
                    id SERIAL PRIMARY KEY,
                    sender VARCHAR(100) NOT NULL,
                    content TEXT NOT NULL,
                    is_urgent BOOLEAN DEFAULT FALSE,
                    station_id INTEGER,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            ''')
            db.commit()
            logger.info("Created chat_messages table")
        else:
            # Check if station_id column exists, add it if needed
            cursor.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name='chat_messages' AND column_name='station_id'
            """)
            has_station_id = cursor.fetchone() is not None
            
            if not has_station_id:
                cursor.execute("""
                    ALTER TABLE chat_messages 
                    ADD COLUMN station_id INTEGER
                """)
                db.commit()
                logger.info("Added station_id column to chat_messages table")
        
        # Get limit from query params (default to 50)
        limit = request.args.get('limit', 50, type=int)
        
        # Query database for chat messages
        cursor.execute('''
            SELECT id, sender, content, is_urgent, station_id, created_at
            FROM chat_messages
            ORDER BY created_at DESC
            LIMIT %s
        ''', (limit,))
        
        messages = []
        for msg in cursor.fetchall():
            msg_id, sender, content, is_urgent, station_id, created_at = msg
            messages.append({
                'id': msg_id,
                'sender': sender,
                'content': content,
                'created_at': created_at.isoformat() if hasattr(created_at, 'isoformat') else created_at,
                'station_id': station_id,
                'is_urgent': bool(is_urgent)
            })
        
        # Return the messages with most recent first
        return jsonify({
            'success': True,
            'messages': messages
        })
    
    except Exception as e:
        logger.error(f"Error fetching chat messages: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

@bp.route('/messages', methods=['POST'])
def send_chat_message():
    """Send a new chat message"""
    try:
        # Get request data
        data = request.json
        if not data:
            return jsonify({'success': False, 'error': 'No message data provided'})
        
        # Extract message details
        sender = data.get('sender')
        content = data.get('content')
        is_urgent = data.get('is_urgent', False)
        station_id = data.get('station_id')
        
        # Validate required fields
        if not sender or not content:
            return jsonify({'success': False, 'error': 'Sender and content are required'})
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Insert message into database
        cursor = db.cursor()
        cursor.execute('''
            INSERT INTO chat_messages (sender, content, is_urgent, station_id, created_at)
            VALUES (%s, %s, %s, %s, %s)
            RETURNING id, created_at
        ''', (sender, content, is_urgent, station_id, datetime.now()))
        
        result = cursor.fetchone()
        message_id, created_at = result if result else (None, datetime.now())
        
        db.commit()
        
        # Return success response
        return jsonify({
            'success': True,
            'message': {
                'id': message_id,
                'sender': sender,
                'content': content,
                'is_urgent': is_urgent,
                'station_id': station_id,
                'created_at': created_at.isoformat() if hasattr(created_at, 'isoformat') else str(created_at)
            }
        })
    
    except Exception as e:
        logger.error(f"Error sending chat message: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

@bp.route('/messages/<int:message_id>', methods=['DELETE'])
def delete_chat_message(message_id):
    """Delete a chat message by ID"""
    try:
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        db = coffee_system.db
        
        # Delete message from database
        cursor = db.cursor()
        cursor.execute('DELETE FROM chat_messages WHERE id = %s', (message_id,))
        
        deleted = cursor.rowcount > 0
        db.commit()
        
        if deleted:
            return jsonify({
                'success': True,
                'message': f'Message {message_id} deleted successfully'
            })
        else:
            return jsonify({
                'success': False,
                'error': f'Message {message_id} not found'
            })
    
    except Exception as e:
        logger.error(f"Error deleting chat message {message_id}: {str(e)}")
        return jsonify({
            'success': False,
            'error': str(e)
        })

@bp.route('/stations', methods=['GET'])
def get_stations():
    """Get list of active stations for the chat"""
    try:
        # Default stations to return if we can't query the database
        default_stations = [
            {'id': 1, 'name': 'Station #1', 'status': 'active', 'barista': 'Julia'},
            {'id': 2, 'name': 'Station #2', 'status': 'active', 'barista': 'Alex'},
            {'id': 3, 'name': 'Station #3', 'status': 'active', 'barista': 'Barista'}
        ]
        
        # Get coffee system from app context
        coffee_system = current_app.config.get('coffee_system')
        if not coffee_system or not hasattr(coffee_system, 'db'):
            return jsonify({
                'success': True,
                'stations': default_stations
            })
            
        db = coffee_system.db
        
        # First check if the table exists
        cursor = db.cursor()
        try:
            cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'station_stats')")
            table_exists = cursor.fetchone()[0]
            
            if not table_exists:
                db.rollback()  # Reset transaction
                return jsonify({
                    'success': True,
                    'stations': default_stations
                })
            
            # Try to get the column names
            cursor.execute("""
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'station_stats'
            """)
            columns = [col[0] for col in cursor.fetchall()]
            
            # Build a query based on available columns
            if 'name' in columns and 'barista_name' in columns:
                # All columns available
                cursor.execute('''
                    SELECT station_id, name, status, barista_name
                    FROM station_stats
                    WHERE status = 'active'
                    ORDER BY station_id
                ''')
            elif 'station_id' in columns:
                # Only station_id available
                cursor.execute('''
                    SELECT station_id
                    FROM station_stats
                    ORDER BY station_id
                ''')
            else:
                # No usable columns, return default
                db.rollback()  # Reset transaction
                return jsonify({
                    'success': True,
                    'stations': default_stations
                })
            
            # Process results
            stations = []
            station_rows = cursor.fetchall()
            
            if not station_rows:
                # No stations found, return default
                db.rollback()  # Reset transaction
                return jsonify({
                    'success': True,
                    'stations': default_stations
                })
            
            # Process based on the columns we selected
            if 'name' in columns and 'barista_name' in columns:
                # All columns available
                for row in station_rows:
                    station_id, name, status, barista_name = row
                    stations.append({
                        'id': station_id,
                        'name': name or f"Station #{station_id}",
                        'status': status,
                        'barista': barista_name or "Unassigned"
                    })
            else:
                # Just station_id available
                for row in station_rows:
                    station_id = row[0]
                    stations.append({
                        'id': station_id,
                        'name': f"Station #{station_id}",
                        'status': 'active',
                        'barista': "Unassigned"
                    })
                    
            db.commit()  # Commit transaction
            
            return jsonify({
                'success': True,
                'stations': stations
            })
            
        except Exception as e:
            # Any error, rollback and return default stations
            if db:
                db.rollback()
            logger.warning(f"Error querying stations, returning defaults: {str(e)}")
            return jsonify({
                'success': True,
                'stations': default_stations
            })
    
    except Exception as e:
        logger.error(f"Error fetching station list: {str(e)}")
        return jsonify({
            'success': True,  # Still return success so UI doesn't break
            'stations': [
                {'id': 1, 'name': 'Station #1', 'status': 'active', 'barista': 'Julia'},
                {'id': 2, 'name': 'Station #2', 'status': 'active', 'barista': 'Alex'},
                {'id': 3, 'name': 'Station #3', 'status': 'active', 'barista': 'Barista'}
            ],
            'error': str(e)
        })
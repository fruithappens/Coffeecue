"""
Inventory API Routes
Handles inventory management for stations including stock levels and depletion
"""
from flask import Blueprint, request, jsonify, g
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime
import logging

from models.inventory import Inventory, InventoryItem, StationInventory
from models.stations import Station
from utils.database import db

logger = logging.getLogger(__name__)

inventory_api_bp = Blueprint('inventory_api', __name__, url_prefix='/api/inventory')

@inventory_api_bp.route('/', methods=['GET'])
@inventory_api_bp.route('', methods=['GET'])
@jwt_required()
def get_inventory():
    """Get inventory, optionally filtered by station_id"""
    try:
        station_id = request.args.get('station_id')
        
        if station_id:
            # Convert to int and return station-specific inventory
            try:
                station_id = int(station_id)
                
                # Get station
                station = Station.query.get(station_id)
                if not station:
                    return jsonify({'status': 'error', 'message': 'Station not found'}), 404
                
                # Get station inventory
                station_inventory = StationInventory.query.filter_by(station_id=station_id).all()
                
                inventory_data = {
                    'coffee': [],
                    'milk': [],
                    'cups': [],
                    'other': []
                }
                
                for item in station_inventory:
                    inventory_item = InventoryItem.query.get(item.inventory_item_id)
                    if inventory_item:
                        item_data = {
                            'id': inventory_item.item_id,
                            'name': inventory_item.name,
                            'amount': item.current_amount,
                            'capacity': item.capacity,
                            'unit': inventory_item.unit,
                            'status': 'good' if item.current_amount > item.capacity * 0.4 else ('warning' if item.current_amount > item.capacity * 0.2 else 'danger')
                        }
                        
                        if inventory_item.category in inventory_data:
                            inventory_data[inventory_item.category].append(item_data)
                
                # Return inventory data directly for compatibility with frontend
                return jsonify(inventory_data), 200
                
            except ValueError:
                return jsonify({'status': 'error', 'message': 'Invalid station_id'}), 400
        else:
            # Return all inventory across all stations
            stations = Station.query.all()
            all_inventory = []
            
            for station in stations:
                station_inventory = StationInventory.query.filter_by(station_id=station.id).all()
                
                inventory_data = {
                    'coffee': [],
                    'milk': [],
                    'cups': [],
                    'other': []
                }
                
                for item in station_inventory:
                    inventory_item = InventoryItem.query.get(item.inventory_item_id)
                    if inventory_item:
                        item_data = {
                            'id': inventory_item.item_id,
                            'name': inventory_item.name,
                            'amount': item.current_amount,
                            'capacity': item.capacity,
                            'unit': inventory_item.unit,
                            'category': inventory_item.category,
                            'status': 'good' if item.current_amount > item.capacity * 0.4 else ('warning' if item.current_amount > item.capacity * 0.2 else 'danger')
                        }
                        
                        if inventory_item.category in inventory_data:
                            inventory_data[inventory_item.category].append(item_data)
                
                all_inventory.append({
                    'station_id': station.id,
                    'station_name': station.name,
                    'inventory': inventory_data
                })
            
            return jsonify({
                'status': 'success',
                'data': all_inventory
            }), 200
            
    except Exception as e:
        logger.error(f"Error getting inventory: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get inventory'}), 500

@inventory_api_bp.route('/station/<int:station_id>', methods=['GET'])
@jwt_required()
def get_station_inventory(station_id):
    """Get inventory for a specific station"""
    try:
        # Get station
        station = Station.query.get(station_id)
        if not station:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        # Get station inventory
        station_inventory = StationInventory.query.filter_by(station_id=station_id).all()
        
        # Format response
        inventory_data = {
            'coffee': [],
            'milk': [],
            'cups': [],
            'other': []
        }
        
        for item in station_inventory:
            inventory_item = InventoryItem.query.get(item.inventory_item_id)
            if inventory_item:
                item_data = {
                    'id': inventory_item.item_id,
                    'name': inventory_item.name,
                    'amount': item.current_amount,
                    'capacity': item.capacity,
                    'unit': inventory_item.unit,
                    'category': inventory_item.category
                }
                
                if inventory_item.category in inventory_data:
                    inventory_data[inventory_item.category].append(item_data)
        
        return jsonify({
            'status': 'success',
            'data': {
                'station_id': station_id,
                'station_name': station.name,
                'inventory': inventory_data,
                'last_updated': datetime.utcnow().isoformat()
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting station inventory: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get inventory'}), 500

@inventory_api_bp.route('/station/<int:station_id>', methods=['POST'])
@jwt_required()
def update_station_inventory(station_id):
    """Update inventory for a specific station"""
    try:
        # Check if user has permission (admin or organizer)
        current_user = get_jwt_identity()
        
        # Get request data
        data = request.get_json()
        if not data or 'inventory' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'}), 400
        
        # Get station
        station = Station.query.get(station_id)
        if not station:
            return jsonify({'status': 'error', 'message': 'Station not found'}), 404
        
        # Update inventory
        inventory_updates = data['inventory']
        updated_items = []
        
        for category, items in inventory_updates.items():
            for item in items:
                # Find or create inventory item
                inventory_item = InventoryItem.query.filter_by(
                    item_id=item['id'],
                    category=category
                ).first()
                
                if not inventory_item:
                    inventory_item = InventoryItem(
                        item_id=item['id'],
                        name=item['name'],
                        category=category,
                        unit=item.get('unit', 'units')
                    )
                    db.session.add(inventory_item)
                    db.session.flush()
                
                # Update station inventory
                station_inv = StationInventory.query.filter_by(
                    station_id=station_id,
                    inventory_item_id=inventory_item.id
                ).first()
                
                if not station_inv:
                    station_inv = StationInventory(
                        station_id=station_id,
                        inventory_item_id=inventory_item.id,
                        current_amount=item['amount'],
                        capacity=item.get('capacity', 100)
                    )
                    db.session.add(station_inv)
                else:
                    station_inv.current_amount = item['amount']
                    station_inv.capacity = item.get('capacity', station_inv.capacity)
                    station_inv.last_updated = datetime.utcnow()
                
                updated_items.append({
                    'id': item['id'],
                    'name': item['name'],
                    'amount': item['amount']
                })
        
        db.session.commit()
        
        # Emit WebSocket event for real-time updates
        from app import socketio
        socketio.emit('inventory_updated', {
            'station_id': station_id,
            'updated_items': updated_items,
            'timestamp': datetime.utcnow().isoformat()
        }, room=f'station_{station_id}')
        
        return jsonify({
            'status': 'success',
            'message': 'Inventory updated successfully',
            'data': {
                'station_id': station_id,
                'updated_items': updated_items
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error updating station inventory: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to update inventory'}), 500

@inventory_api_bp.route('/deplete', methods=['POST'])
@jwt_required()
def deplete_inventory():
    """Deplete inventory when an order is completed"""
    try:
        data = request.get_json()
        if not data or 'station_id' not in data or 'items' not in data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'}), 400
        
        station_id = data['station_id']
        items_to_deplete = data['items']
        order_id = data.get('order_id')
        
        depleted_items = []
        
        for item in items_to_deplete:
            # Find inventory item
            inventory_item = InventoryItem.query.filter_by(
                item_id=item['id'],
                category=item['category']
            ).first()
            
            if inventory_item:
                # Update station inventory
                station_inv = StationInventory.query.filter_by(
                    station_id=station_id,
                    inventory_item_id=inventory_item.id
                ).first()
                
                if station_inv:
                    # Deplete amount
                    new_amount = max(0, station_inv.current_amount - item['amount'])
                    station_inv.current_amount = new_amount
                    station_inv.last_updated = datetime.utcnow()
                    
                    depleted_items.append({
                        'id': item['id'],
                        'name': inventory_item.name,
                        'depleted': item['amount'],
                        'remaining': new_amount
                    })
                    
                    # Log depletion
                    logger.info(f"Depleted {item['amount']} {inventory_item.unit} of {inventory_item.name} "
                              f"for order {order_id} at station {station_id}")
        
        db.session.commit()
        
        # Emit WebSocket event for real-time updates
        from app import socketio
        socketio.emit('inventory_depleted', {
            'station_id': station_id,
            'order_id': order_id,
            'depleted_items': depleted_items,
            'timestamp': datetime.utcnow().isoformat()
        }, room=f'station_{station_id}')
        
        # Check for low stock and emit alerts
        low_stock_items = []
        for item in depleted_items:
            if item['remaining'] < 10:  # Threshold for low stock
                low_stock_items.append(item)
        
        if low_stock_items:
            socketio.emit('low_stock_alert', {
                'station_id': station_id,
                'items': low_stock_items,
                'timestamp': datetime.utcnow().isoformat()
            }, room='organizers')
        
        return jsonify({
            'status': 'success',
            'message': 'Inventory depleted successfully',
            'data': {
                'station_id': station_id,
                'order_id': order_id,
                'depleted_items': depleted_items
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error depleting inventory: {e}")
        db.session.rollback()
        return jsonify({'status': 'error', 'message': 'Failed to deplete inventory'}), 500

@inventory_api_bp.route('/event', methods=['GET'])
@jwt_required()
def get_event_inventory():
    """Get aggregated event-level inventory across all stations"""
    try:
        # Get all stations
        stations = Station.query.all()
        
        # Aggregate inventory across all stations
        event_inventory = {
            'coffee': {},
            'milk': {},
            'cups': {},
            'other': {}
        }
        
        total_coffee = 0
        total_milk = 0
        total_cups = 0
        
        for station in stations:
            # Get station inventory
            station_inventory = StationInventory.query.filter_by(station_id=station.id).all()
            
            for item in station_inventory:
                inventory_item = InventoryItem.query.get(item.inventory_item_id)
                if inventory_item:
                    category = inventory_item.category
                    item_name = inventory_item.name
                    
                    # Initialize item in event inventory if not exists
                    if category in event_inventory:
                        if item_name not in event_inventory[category]:
                            event_inventory[category][item_name] = {
                                'total_amount': 0,
                                'total_capacity': 0,
                                'unit': inventory_item.unit,
                                'stations_count': 0,
                                'status': 'good'  # Will be calculated
                            }
                        
                        # Add to totals
                        event_inventory[category][item_name]['total_amount'] += item.current_amount
                        event_inventory[category][item_name]['total_capacity'] += item.capacity
                        event_inventory[category][item_name]['stations_count'] += 1
                        
                        # Track overall totals
                        if category == 'coffee':
                            total_coffee += item.current_amount
                        elif category == 'milk':
                            total_milk += item.current_amount
                        elif category == 'cups':
                            total_cups += item.current_amount
        
        # Calculate status for each item
        for category in event_inventory:
            for item_name in event_inventory[category]:
                item = event_inventory[category][item_name]
                percentage = (item['total_amount'] / item['total_capacity'] * 100) if item['total_capacity'] > 0 else 0
                
                if percentage < 20:
                    item['status'] = 'danger'
                elif percentage < 40:
                    item['status'] = 'warning'
                else:
                    item['status'] = 'good'
                
                item['percentage'] = round(percentage, 1)
        
        # Convert to list format expected by frontend
        formatted_inventory = {}
        for category, items in event_inventory.items():
            formatted_inventory[category] = [
                {
                    'name': name,
                    'amount': data['total_amount'],
                    'capacity': data['total_capacity'],
                    'unit': data['unit'],
                    'status': data['status'],
                    'percentage': data['percentage'],
                    'stations_count': data['stations_count']
                }
                for name, data in items.items()
            ]
        
        # Return the data in the format expected by the frontend
        return jsonify({
            'inventory': formatted_inventory,
            'totals': {
                'coffee': total_coffee,
                'milk': total_milk,
                'cups': total_cups
            },
            'stations_count': len(stations),
            'last_updated': datetime.utcnow().isoformat()
        }), 200
        
    except Exception as e:
        logger.error(f"Error getting event inventory: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to get event inventory'}), 500

@inventory_api_bp.route('/sync', methods=['POST'])
@jwt_required()
def sync_inventory():
    """Sync inventory across all stations"""
    try:
        current_user = get_jwt_identity()
        
        # Get all stations
        stations = Station.query.all()
        synced_stations = []
        
        for station in stations:
            # Get station inventory
            station_inventory = StationInventory.query.filter_by(station_id=station.id).all()
            
            inventory_data = {}
            for item in station_inventory:
                inventory_item = InventoryItem.query.get(item.inventory_item_id)
                if inventory_item:
                    category = inventory_item.category
                    if category not in inventory_data:
                        inventory_data[category] = []
                    
                    inventory_data[category].append({
                        'id': inventory_item.item_id,
                        'name': inventory_item.name,
                        'amount': item.current_amount,
                        'capacity': item.capacity,
                        'unit': inventory_item.unit
                    })
            
            synced_stations.append({
                'station_id': station.id,
                'station_name': station.name,
                'inventory': inventory_data
            })
        
        # Emit WebSocket event for all stations
        from app import socketio
        socketio.emit('inventory_sync', {
            'stations': synced_stations,
            'timestamp': datetime.utcnow().isoformat()
        }, room='all_stations')
        
        return jsonify({
            'status': 'success',
            'message': 'Inventory synced successfully',
            'data': {
                'synced_stations': len(synced_stations),
                'stations': synced_stations
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error syncing inventory: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to sync inventory'}), 500

@inventory_api_bp.route('/emergency-restock', methods=['POST'])
@jwt_required()
def emergency_restock():
    """Handle emergency restock requests"""
    try:
        # Check if user has permission (admin or organizer)
        current_user = get_jwt_identity()
        
        # Get request data
        data = request.get_json()
        if not data:
            return jsonify({'status': 'error', 'message': 'Invalid request data'}), 400
        
        # Validate required fields
        required_fields = ['item', 'type', 'amount']
        for field in required_fields:
            if field not in data:
                return jsonify({'status': 'error', 'message': f'Missing required field: {field}'}), 400
        
        item_name = data['item']
        item_type = data['type']
        amount = data['amount']
        priority = data.get('priority', 'normal')
        
        # Log the emergency restock request
        logger.info(f"Emergency restock requested: {amount} units of {item_name} ({item_type}) with {priority} priority")
        
        # In a real implementation, this would:
        # 1. Create a restock order in the system
        # 2. Send notifications to relevant staff
        # 3. Update inventory projections
        # 4. Possibly integrate with supplier systems
        
        # For now, we'll just log it and return success
        # You can expand this to integrate with your inventory management system
        
        # Emit WebSocket event for real-time notification
        from app import socketio
        socketio.emit('emergency_restock_requested', {
            'item': item_name,
            'type': item_type,
            'amount': amount,
            'priority': priority,
            'requested_by': current_user,
            'timestamp': datetime.utcnow().isoformat()
        }, room='organizers')
        
        return jsonify({
            'status': 'success',
            'message': f'Emergency restock request submitted for {amount} units of {item_name}',
            'data': {
                'item': item_name,
                'type': item_type,
                'amount': amount,
                'priority': priority,
                'request_id': f'ER-{datetime.utcnow().strftime("%Y%m%d%H%M%S")}'
            }
        }), 200
        
    except Exception as e:
        logger.error(f"Error processing emergency restock: {e}")
        return jsonify({'status': 'error', 'message': 'Failed to process emergency restock'}), 500
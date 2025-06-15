# services/stock_management.py

from datetime import datetime, timedelta
from utils.database import db
from models.stations import BaristaStation, MilkInventory, CoffeeInventory, CupInventory
from models.orders import Order, OrderStatus
from services.websocket import socketio
import logging

class StockManagementService:
    """Manages stock levels for barista stations"""
    
    # Thresholds for alerting
    CRITICAL_THRESHOLD = 10  # Percentage below which stock is critical
    LOW_THRESHOLD = 25       # Percentage below which stock is low
    
    # Standard consumption amounts
    MILK_PER_COFFEE = {
        "Small": {
            "Espresso": 0,
            "Long Black": 0,
            "Flat White": 0.1,  # liters
            "Cappuccino": 0.1,
            "Latte": 0.15,
            "Mocha": 0.15
        },
        "Regular": {
            "Espresso": 0,
            "Long Black": 0,
            "Flat White": 0.15,
            "Cappuccino": 0.15,
            "Latte": 0.2,
            "Mocha": 0.2
        },
        "Large": {
            "Espresso": 0,
            "Long Black": 0,
            "Flat White": 0.2,
            "Cappuccino": 0.2,
            "Latte": 0.25,
            "Mocha": 0.25
        }
    }
    
    COFFEE_BEANS_PER_SHOT = 0.018  # kg (18g per shot)
    SHOTS_PER_COFFEE = {
        "Espresso": 1,
        "Long Black": 1,
        "Flat White": 2,
        "Cappuccino": 2,
        "Latte": 2,
        "Mocha": 2
    }
    
    @classmethod
    def update_milk_inventory(cls, station_id, milk_type, new_amount):
        """Update milk inventory for a station
        
        Args:
            station_id: Station ID
            milk_type: Milk type (e.g. 'Full Cream', 'Skim', etc.)
            new_amount: New milk amount in liters
            
        Returns:
            dict: Updated inventory data
        """
        # Find existing inventory
        milk = MilkInventory.query.filter_by(
            station_id=station_id, 
            milk_type=milk_type
        ).first()
        
        if not milk:
            # Create new record if not exists
            milk = MilkInventory(
                station_id=station_id,
                milk_type=milk_type,
                current_amount=new_amount,
                capacity=5.0  # Default 5L capacity
            )
            db.session.add(milk)
        else:
            # Update existing
            milk.current_amount = new_amount
        
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(milk, 'milk', milk_type)
        
        # Notify about update
        cls._notify_stock_update(station_id, 'milk', {
            'id': milk.id,
            'milk_type': milk.milk_type,
            'current_amount': milk.current_amount,
            'capacity': milk.capacity,
            'percentage': milk.percentage,
            'status': milk.status
        })
        
        return {
            'id': milk.id,
            'milk_type': milk.milk_type,
            'current_amount': milk.current_amount,
            'capacity': milk.capacity,
            'percentage': milk.percentage,
            'status': milk.status
        }
    
    @classmethod
    def update_coffee_inventory(cls, station_id, new_amount):
        """Update coffee bean inventory for a station
        
        Args:
            station_id: Station ID
            new_amount: New coffee amount in kg
            
        Returns:
            dict: Updated inventory data
        """
        # Find existing inventory
        coffee = CoffeeInventory.query.filter_by(station_id=station_id).first()
        
        if not coffee:
            # Create new record if not exists
            coffee = CoffeeInventory(
                station_id=station_id,
                current_amount=new_amount,
                capacity=5.0  # Default 5kg capacity
            )
            db.session.add(coffee)
        else:
            # Update existing
            coffee.current_amount = new_amount
        
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(coffee, 'coffee', 'beans')
        
        # Notify about update
        cls._notify_stock_update(station_id, 'coffee', {
            'id': coffee.id,
            'current_amount': coffee.current_amount,
            'capacity': coffee.capacity,
            'percentage': coffee.percentage,
            'status': coffee.status
        })
        
        return {
            'id': coffee.id,
            'current_amount': coffee.current_amount,
            'capacity': coffee.capacity,
            'percentage': coffee.percentage,
            'status': coffee.status
        }
    
    @classmethod
    def update_cup_inventory(cls, station_id, size, new_count):
        """Update cup inventory for a station
        
        Args:
            station_id: Station ID
            size: Cup size (e.g. 'Small', 'Regular', 'Large')
            new_count: New cup count
            
        Returns:
            dict: Updated inventory data
        """
        # Find existing inventory
        cup = CupInventory.query.filter_by(
            station_id=station_id, 
            size=size
        ).first()
        
        if not cup:
            # Create new record if not exists
            cup = CupInventory(
                station_id=station_id,
                size=size,
                current_count=new_count,
                capacity=100  # Default 100 cups capacity
            )
            db.session.add(cup)
        else:
            # Update existing
            cup.current_count = new_count
        
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(cup, 'cup', size)
        
        # Notify about update
        cls._notify_stock_update(station_id, 'cup', {
            'id': cup.id,
            'size': cup.size,
            'current_count': cup.current_count,
            'capacity': cup.capacity,
            'percentage': cup.percentage,
            'status': cup.status
        })
        
        return {
            'id': cup.id,
            'size': cup.size,
            'current_count': cup.current_count,
            'capacity': cup.capacity,
            'percentage': cup.percentage,
            'status': cup.status
        }
    
    @classmethod
    def _check_stock_level(cls, item, item_type, item_name):
        """Check if stock level is low/critical and issue alerts if needed
        
        Args:
            item: Inventory item
            item_type: Type of item (milk, coffee, cup)
            item_name: Specific name/type of the item
        """
        if item.percentage <= cls.CRITICAL_THRESHOLD:
            cls._issue_stock_alert(item.station_id, item_type, item_name, 'critical')
        elif item.percentage <= cls.LOW_THRESHOLD:
            cls._issue_stock_alert(item.station_id, item_type, item_name, 'low')
    
    @classmethod
    def _issue_stock_alert(cls, station_id, item_type, item_name, level):
        """Issue stock alert for low/critical levels
        
        Args:
            station_id: Station ID
            item_type: Type of item (milk, coffee, cup)
            item_name: Specific name/type of the item
            level: Alert level (low, critical)
        """
        station = BaristaStation.query.get(station_id)
        
        if not station:
            return
            
        # Log the alert
        logging.warning(f"Stock alert: {level} {item_type} ({item_name}) at station {station.name}")
        
        # Notify baristas at station
        alert_data = {
            'station_id': station_id,
            'station_name': station.name,
            'item_type': item_type,
            'item_name': item_name,
            'level': level,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Send via websocket
        cls._notify_stock_alert(station_id, alert_data)
        
        # If critical, also notify organizers
        if level == 'critical':
            cls._notify_organizers_stock_alert(alert_data)
    
    @classmethod
    def _notify_stock_update(cls, station_id, item_type, data):
        """Notify about stock update
        
        Args:
            station_id: Station ID
            item_type: Type of item (milk, coffee, cup)
            data: Updated stock data
        """
        station_room = f"station_{station_id}"
        
        update_data = {
            'station_id': station_id,
            'item_type': item_type,
            'data': data,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        socketio.emit('stock_update', update_data, room=station_room)
    
    @classmethod
    def _notify_stock_alert(cls, station_id, alert_data):
        """Notify station about stock alert
        
        Args:
            station_id: Station ID
            alert_data: Alert data
        """
        station_room = f"station_{station_id}"
        
        socketio.emit('stock_alert', alert_data, room=station_room)
    
    @classmethod
    def _notify_organizers_stock_alert(cls, alert_data):
        """Notify organizers about critical stock alert
        
        Args:
            alert_data: Alert data
        """
        organizer_room = "organizers"
        
        socketio.emit('stock_alert', alert_data, room=organizer_room)
    
    @classmethod
    def consume_stock_for_order(cls, order_id):
        """Consume stock for a completed order
        
        Args:
            order_id: Order ID
            
        Returns:
            bool: True if successful, False otherwise
        """
        order = Order.query.get(order_id)
        
        if not order or order.status != OrderStatus.COMPLETED:
            return False
            
        try:
            # Consume milk
            if order.milk_type and order.milk_type != 'None':
                cls._consume_milk(order)
                
            # Consume coffee beans
            cls._consume_coffee_beans(order)
                
            # Consume cup
            cls._consume_cup(order)
                
            return True
            
        except Exception as e:
            logging.error(f"Error consuming stock for order {order_id}: {str(e)}")
            return False
    
    @classmethod
    def _consume_milk(cls, order):
        """Consume milk for an order
        
        Args:
            order: Order object
        """
        if not order.station_id or not order.milk_type or order.milk_type == 'None':
            return
            
        # Determine amount to consume
        size = order.size or 'Regular'
        coffee_type = order.coffee_type or 'Flat White'
        
        # Default to Regular size values if specific mapping not found
        milk_amount = cls.MILK_PER_COFFEE.get(size, {}).get(coffee_type, 0.15)
        
        # Find milk inventory
        milk = MilkInventory.query.filter_by(
            station_id=order.station_id,
            milk_type=order.milk_type
        ).first()
        
        if not milk:
            logging.warning(f"Milk inventory not found for {order.milk_type} at station {order.station_id}")
            return
            
        # Update inventory
        milk.current_amount = max(0, milk.current_amount - milk_amount)
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(milk, 'milk', milk.milk_type)
        
        # Notify about update
        cls._notify_stock_update(order.station_id, 'milk', {
            'id': milk.id,
            'milk_type': milk.milk_type,
            'current_amount': milk.current_amount,
            'capacity': milk.capacity,
            'percentage': milk.percentage,
            'status': milk.status
        })
    
    @classmethod
    def _consume_coffee_beans(cls, order):
        """Consume coffee beans for an order
        
        Args:
            order: Order object
        """
        if not order.station_id:
            return
            
        # Determine amount to consume
        coffee_type = order.coffee_type or 'Flat White'
        
        # Get number of shots
        shots = cls.SHOTS_PER_COFFEE.get(coffee_type, 2)
        
        # Calculate beans used
        beans_amount = shots * cls.COFFEE_BEANS_PER_SHOT
        
        # Find coffee inventory
        coffee = CoffeeInventory.query.filter_by(station_id=order.station_id).first()
        
        if not coffee:
            logging.warning(f"Coffee inventory not found at station {order.station_id}")
            return
            
        # Update inventory
        coffee.current_amount = max(0, coffee.current_amount - beans_amount)
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(coffee, 'coffee', 'beans')
        
        # Notify about update
        cls._notify_stock_update(order.station_id, 'coffee', {
            'id': coffee.id,
            'current_amount': coffee.current_amount,
            'capacity': coffee.capacity,
            'percentage': coffee.percentage,
            'status': coffee.status
        })
    
    @classmethod
    def _consume_cup(cls, order):
        """Consume cup for an order
        
        Args:
            order: Order object
        """
        if not order.station_id:
            return
            
        # Get cup size
        size = order.size or 'Regular'
        
        # Find cup inventory
        cup = CupInventory.query.filter_by(
            station_id=order.station_id,
            size=size
        ).first()
        
        if not cup:
            logging.warning(f"Cup inventory not found for {size} at station {order.station_id}")
            return
            
        # Update inventory
        cup.current_count = max(0, cup.current_count - 1)
        db.session.commit()
        
        # Check if level is low/critical
        cls._check_stock_level(cup, 'cup', cup.size)
        
        # Notify about update
        cls._notify_stock_update(order.station_id, 'cup', {
            'id': cup.id,
            'size': cup.size,
            'current_count': cup.current_count,
            'capacity': cup.capacity,
            'percentage': cup.percentage,
            'status': cup.status
        })
    
    @classmethod
    def get_station_stock_status(cls, station_id):
        """Get stock status for a station
        
        Args:
            station_id: Station ID
            
        Returns:
            dict: Stock status data
        """
        # Get milk inventories
        milk_inventories = MilkInventory.query.filter_by(station_id=station_id).all()
        milk_data = []
        
        for milk in milk_inventories:
            milk_data.append({
                'id': milk.id,
                'milk_type': milk.milk_type,
                'current_amount': milk.current_amount,
                'capacity': milk.capacity,
                'percentage': milk.percentage,
                'status': milk.status
            })
        
        # Get coffee inventory
        coffee = CoffeeInventory.query.filter_by(station_id=station_id).first()
        coffee_data = None
        
        if coffee:
            coffee_data = {
                'id': coffee.id,
                'current_amount': coffee.current_amount,
                'capacity': coffee.capacity,
                'percentage': coffee.percentage,
                'status': coffee.status
            }
        
        # Get cup inventories
        cup_inventories = CupInventory.query.filter_by(station_id=station_id).all()
        cup_data = []
        
        for cup in cup_inventories:
            cup_data.append({
                'id': cup.id,
                'size': cup.size,
                'current_count': cup.current_count,
                'capacity': cup.capacity,
                'percentage': cup.percentage,
                'status': cup.status
            })
        
        return {
            'station_id': station_id,
            'milk': milk_data,
            'coffee': coffee_data,
            'cups': cup_data,
            'timestamp': datetime.utcnow().isoformat()
        }
    
    @classmethod
    def predict_stock_needs(cls, station_id, hours_ahead=4):
        """Predict stock needs based on historical usage
        
        Args:
            station_id: Station ID
            hours_ahead: Hours to predict ahead
            
        Returns:
            dict: Predicted stock needs
        """
        # Get historical orders for this station
        now = datetime.utcnow()
        start_time = now - timedelta(days=1)  # 24h history
        
        orders = Order.query.filter(
            Order.station_id == station_id,
            Order.created_at >= start_time,
            Order.status.in_([OrderStatus.COMPLETED, OrderStatus.PICKED_UP])
        ).all()
        
        if not orders:
            return {
                'station_id': station_id,
                'milk_predictions': {},
                'coffee_prediction': 0,
                'cup_predictions': {},
                'confidence': 'low',
                'timestamp': now.isoformat()
            }
        
        # Calculate hourly rates
        hours_elapsed = max(1, (now - start_time).total_seconds() / 3600)
        orders_per_hour = len(orders) / hours_elapsed
        
        # Count milk usage by type
        milk_usage = {}
        for order in orders:
            if order.milk_type and order.milk_type != 'None':
                milk_usage[order.milk_type] = milk_usage.get(order.milk_type, 0) + 1
        
        # Calculate milk consumption rates
        milk_predictions = {}
        for milk_type, count in milk_usage.items():
            # Average milk per order of this type
            avg_milk_per_order = 0.15  # Default estimate
            
            # Predict future usage
            predicted_usage = (count / hours_elapsed) * hours_ahead * avg_milk_per_order
            milk_predictions[milk_type] = round(predicted_usage, 2)
        
        # Calculate coffee consumption rate
        total_shots = sum(cls.SHOTS_PER_COFFEE.get(order.coffee_type, 2) for order in orders)
        coffee_per_hour = (total_shots * cls.COFFEE_BEANS_PER_SHOT) / hours_elapsed
        coffee_prediction = round(coffee_per_hour * hours_ahead, 2)
        
        # Count cup usage by size
        cup_usage = {}
        for order in orders:
            size = order.size or 'Regular'
            cup_usage[size] = cup_usage.get(size, 0) + 1
        
        # Calculate cup consumption rates
        cup_predictions = {}
        for size, count in cup_usage.items():
            predicted_usage = (count / hours_elapsed) * hours_ahead
            cup_predictions[size] = round(predicted_usage)
        
        # Determine confidence level
        confidence = 'medium'
        if len(orders) < 10:
            confidence = 'low'
        elif len(orders) > 50:
            confidence = 'high'
        
        return {
            'station_id': station_id,
            'milk_predictions': milk_predictions,
            'coffee_prediction': coffee_prediction,
            'cup_predictions': cup_predictions,
            'confidence': confidence,
            'timestamp': now.isoformat()
        }
    
    @classmethod
    def request_restock(cls, station_id, items):
        """Request restock for low inventory items
        
        Args:
            station_id: Station ID
            items: List of items to restock, each with type and name
            
        Returns:
            dict: Restock request data
        """
        from models.stations import RestockRequest, RestockRequestStatus
        
        station = BaristaStation.query.get(station_id)
        
        if not station:
            return {'success': False, 'error': 'Station not found'}
        
        # Create restock request
        restock = RestockRequest(
            station_id=station_id,
            items=items,
            status=RestockRequestStatus.PENDING,
            requested_at=datetime.utcnow()
        )
        
        db.session.add(restock)
        db.session.commit()
        
        # Notify organizers
        restock_data = {
            'id': restock.id,
            'station_id': station_id,
            'station_name': station.name,
            'items': items,
            'status': restock.status.name,
            'requested_at': restock.requested_at.isoformat()
        }
        
        socketio.emit('restock_request', restock_data, room='organizers')
        
        return {
            'success': True,
            'request_id': restock.id,
            'timestamp': restock.requested_at.isoformat()
        }


# models/stations.py - Add these models

class CoffeeInventory(db.Model):
    """Tracks coffee bean inventory for stations"""
    __tablename__ = 'coffee_inventories'
    
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey('barista_stations.id'))
    current_amount = db.Column(db.Float, default=0.0)  # in kg
    capacity = db.Column(db.Float, default=5.0)  # max capacity in kg
    last_updated = db.Column(db.DateTime, default=datetime.utcnow)
    
    @property
    def percentage(self):
        """Return percentage of coffee remaining"""
        return (self.current_amount / self.capacity) * 100 if self.capacity > 0 else 0
    
    @property
    def status(self):
        """Return status based on remaining percentage"""
        if self.percentage < 10:
            return "critical"
        elif self.percentage < 25:
            return "low"
        elif self.percentage < 50:
            return "medium"
        else:
            return "good"
    
    @property
    def status_color(self):
        """Return bootstrap color class based on status"""
        status_colors = {
            "critical": "danger",
            "low": "warning",
            "medium": "info",
            "good": "success"
        }
        return status_colors.get(self.status, "secondary")


import enum

class RestockRequestStatus(enum.Enum):
    """Status for restock requests"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class RestockRequest(db.Model):
    """Tracks restock requests for stations"""
    __tablename__ = 'restock_requests'
    
    id = db.Column(db.Integer, primary_key=True)
    station_id = db.Column(db.Integer, db.ForeignKey('barista_stations.id'))
    items = db.Column(db.JSON)  # List of items to restock
    status = db.Column(db.Enum(RestockRequestStatus), default=RestockRequestStatus.PENDING)
    requested_at = db.Column(db.DateTime, default=datetime.utcnow)
    completed_at = db.Column(db.DateTime, nullable=True)
    notes = db.Column(db.Text, nullable=True)
    
    station = db.relationship('BaristaStation')

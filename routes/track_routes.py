from flask import Blueprint, render_template, request, jsonify, abort
from models.orders import Order, OrderStatus
from datetime import datetime

track_bp = Blueprint('track', __name__)

@track_bp.route('/<string:tracking_code>')
def order(tracking_code):
    """Order tracking page for customers"""
    # Find order by tracking code
    order = Order.query.filter_by(tracking_code=tracking_code).first_or_404()
    
    # Get station info
    station = order.station
    
    # Calculate wait time and status
    now = datetime.utcnow()
    
    # Calculate various timestamps
    time_since_created = (now - order.created_at).total_seconds() / 60 if order.created_at else 0
    time_in_progress = (now - order.started_at).total_seconds() / 60 if order.started_at and order.status in [OrderStatus.IN_PROGRESS, OrderStatus.COMPLETED, OrderStatus.PICKED_UP] else None
    time_since_completed = (now - order.completed_at).total_seconds() / 60 if order.completed_at and order.status in [OrderStatus.COMPLETED, OrderStatus.PICKED_UP] else None
    
    # Calculate estimated wait time
    if order.status == OrderStatus.PENDING:
        # Get number of orders ahead
        orders_ahead = Order.query.filter(
            Order.station_id == order.station_id,
            Order.status == OrderStatus.PENDING,
            Order.created_at < order.created_at
        ).count()
        
        # Estimate 3 minutes per order ahead
        estimated_wait = orders_ahead * 3
        
        # Add station's base wait time
        if station:
            estimated_wait += station.base_wait_time
    else:
        estimated_wait = None
    
    # Format status for display
    if order.status == OrderStatus.PENDING:
        status_text = "Waiting to be prepared"
        status_class = "waiting"
        progress = 10
    elif order.status == OrderStatus.IN_PROGRESS:
        status_text = "Being prepared"
        status_class = "preparing"
        # Calculate progress (assume 5 minutes to complete)
        progress = min(time_in_progress / 5 * 100, 90) if time_in_progress else 50
    elif order.status == OrderStatus.COMPLETED:
        status_text = "Ready for pickup"
        status_class = "ready"
        progress = 100
    elif order.status == OrderStatus.PICKED_UP:
        status_text = "Picked up"
        status_class = "complete"
        progress = 100
    else:
        status_text = "Unknown"
        status_class = ""
        progress = 0
    
    # Prepare data for template
    order_data = {
        'id': order.id,
        'display_code': order.pickup_code,
        'status': status_text,
        'status_class': status_class,
        'progress': int(progress),
        'coffee_type': order.coffee_type,
        'milk_type': order.milk_type,
        'size': order.size,
        'sugar': order.sugar,
        'extra_hot': order.extra_hot,
        'special_instructions': order.special_instructions,
        'customer_name': order.customer_name,
        'created_at': order.created_at.strftime('%H:%M') if order.created_at else None,
        'estimated_wait': estimated_wait,
        'station_name': station.name if station else 'Unknown',
        'station_location': station.location if station else 'Unknown'
    }
    
    # Get loyalty data for customer
    customer_loyalty = {
        'stamps': 3,  # Placeholder, replace with actual data
        'free_coffees': 0
    }
    
    return render_template(
        'track/order.html',
        order=order_data,
        station=station,
        customer_loyalty=customer_loyalty,
        tracking_code=tracking_code
    )

@track_bp.route('/map/<string:code>')
def map(code):
    """Show map for finding coffee station"""
    # Find order by tracking code
    order = Order.query.filter_by(tracking_code=code).first_or_404()
    
    # Get station
    station = order.station
    if not station:
        abort(404)
    
    # Get all active stations for reference
    stations = [station] + [s for s in station.query.filter_by(is_active=True).all() if s.id != station.id]
    
    # Add map coordinates to stations
    for s in stations:
        # These would come from your database
        # For demo, using placeholder values
        s.map_x = 50  # % from left
        s.map_y = 50  # % from top
        s.wait_time = 5  # minutes
    
    # Generate simple directions
    # In a real app, these would be generated based on venue mapping
    directions = [
        {'instruction': 'Enter the main conference hall', 'landmark': 'Near the registration desk'},
        {'instruction': 'Proceed straight ahead past the exhibition area', 'landmark': None},
        {'instruction': f'Turn right at the end of the hall to find {station.name}', 'landmark': 'Near the poster area'}
    ]
    
    # Estimated walking time
    estimated_time = 2  # minutes
    
    return render_template(
        'track/map.html',
        station=station,
        stations=stations,
        directions=directions,
        estimated_time=estimated_time,
        tracking_code=code
    )

@track_bp.route('/feedback', methods=['POST'])
def submit_feedback():
    """Submit feedback for an order"""
    data = request.json
    
    if not data:
        return jsonify({'success': False, 'error': 'No data provided'}), 400
        
    order_id = data.get('order_id')
    rating = data.get('rating')
    feedback = data.get('feedback')
    
    if not order_id or not rating:
        return jsonify({'success': False, 'error': 'Missing required fields'}), 400
        
    # Submit feedback
    from services.feedback import FeedbackService
    success = FeedbackService.submit_feedback(order_id, rating, feedback)
    
    if success:
        return jsonify({'success': True})
    else:
        return jsonify({'success': False, 'error': 'Failed to submit feedback'}), 500
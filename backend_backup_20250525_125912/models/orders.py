"""
Order and Customer Models for Expresso Coffee Ordering System
Compatible with PostgreSQL database
"""
import json
import logging
from datetime import datetime
import psycopg2
from psycopg2.extras import RealDictCursor

logger = logging.getLogger("expresso.models.orders")

class Order:
    """Model for coffee orders"""
    
    @classmethod
    def create_tables(cls, db):
        """Create necessary tables if they don't exist - handled by database.py now"""
        # Tables are created in database.py create_tables function
        # This is kept for backwards compatibility
        pass
    
    @classmethod
    def create(cls, db, order_data):
        """
        Create a new order
        
        Args:
            db: Database connection
            order_data: Dictionary with order details
            
        Returns:
            Order ID if successful, None otherwise
        """
        try:
            # Generate QR code if not already present
            if 'qr_code_url' not in order_data and 'order_number' in order_data:
                try:
                    from utils.helpers import generate_order_qr_code
                    order_data['qr_code_url'] = generate_order_qr_code(order_data['order_number'])
                except Exception as e:
                    logger.error(f"QR code generation failed: {str(e)}")
                    order_data['qr_code_url'] = None
            
            # Ensure order_details is JSON for PostgreSQL
            if 'order_details' in order_data and not isinstance(order_data['order_details'], str):
                order_data['order_details'] = json.dumps(order_data['order_details'])
            
            # Ensure edit_history is JSON for PostgreSQL
            if 'edit_history' in order_data and order_data['edit_history'] and not isinstance(order_data['edit_history'], str):
                order_data['edit_history'] = json.dumps(order_data['edit_history'])
            
            # Convert boolean to proper boolean type for PostgreSQL
            if 'group_order' in order_data:
                if isinstance(order_data['group_order'], int):
                    order_data['group_order'] = bool(order_data['group_order'])
            
            # Generate columns and placeholders for SQL
            columns = []
            placeholders = []
            values = []
            
            for key, value in order_data.items():
                if key != 'id':  # Skip ID for insert
                    columns.append(key)
                    placeholders.append('%s')
                    values.append(value)
            
            # Create SQL query
            sql = f"INSERT INTO orders ({', '.join(columns)}) VALUES ({', '.join(placeholders)}) RETURNING id"
            
            # Execute query
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute(sql, values)
            result = cursor.fetchone()
            order_id = result['id']
            db.commit()
            
            logger.info(f"Created order {order_data.get('order_number')} with ID {order_id}")
            return order_id
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error creating order: {str(e)}")
            return None
    
    @classmethod
    def get_by_id(cls, db, order_id):
        """
        Get order by ID
        
        Args:
            db: Database connection
            order_id: Order ID
            
        Returns:
            Order dictionary if found, None otherwise
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute('SELECT * FROM orders WHERE id = %s', (order_id,))
            order = cursor.fetchone()
            
            if not order:
                return None
            
            # Convert to dictionary
            order_dict = dict(order)
            
            # Parse JSON fields
            if 'order_details' in order_dict and order_dict['order_details']:
                try:
                    order_dict['order_details'] = json.loads(order_dict['order_details'])
                except:
                    pass
            
            if 'edit_history' in order_dict and order_dict['edit_history']:
                try:
                    order_dict['edit_history'] = json.loads(order_dict['edit_history'])
                except:
                    pass
            
            return order_dict
            
        except Exception as e:
            logger.error(f"Error retrieving order: {str(e)}")
            return None
    
    @classmethod
    def get_by_number(cls, db, order_number):
        """
        Get order by order number
        
        Args:
            db: Database connection
            order_number: Order number string
            
        Returns:
            Order dictionary if found, None otherwise
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute('SELECT * FROM orders WHERE order_number = %s', (order_number,))
            order = cursor.fetchone()
            
            if not order:
                return None
            
            # Convert to dictionary
            order_dict = dict(order)
            
            # Parse JSON fields
            if 'order_details' in order_dict and order_dict['order_details']:
                try:
                    order_dict['order_details'] = json.loads(order_dict['order_details'])
                except:
                    pass
            
            if 'edit_history' in order_dict and order_dict['edit_history']:
                try:
                    order_dict['edit_history'] = json.loads(order_dict['edit_history'])
                except:
                    pass
            
            return order_dict
            
        except Exception as e:
            logger.error(f"Error retrieving order: {str(e)}")
            return None
    
    @classmethod
    def update_status(cls, db, order_id, status, editor=None):
        """
        Update order status
        
        Args:
            db: Database connection
            order_id: Order ID
            status: New status
            editor: Who made the change
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Calculate completion time if completed
            completion_time = None
            if status == 'completed':
                cursor = db.cursor(cursor_factory=RealDictCursor)
                cursor.execute('SELECT created_at FROM orders WHERE id = %s', (order_id,))
                result = cursor.fetchone()
                
                if result and result['created_at']:
                    created_at = result['created_at']
                    completion_time = int((datetime.now() - created_at).total_seconds())
            
            # Update order status
            cursor = db.cursor()
            if completion_time is not None:
                cursor.execute('''
                    UPDATE orders 
                    SET status = %s, 
                        last_modified_by = %s,
                        completion_time = %s,
                        updated_at = %s
                    WHERE id = %s
                ''', (status, editor or 'system', completion_time, datetime.now(), order_id))
            else:
                cursor.execute('''
                    UPDATE orders 
                    SET status = %s, 
                        last_modified_by = %s,
                        updated_at = %s
                    WHERE id = %s
                ''', (status, editor or 'system', datetime.now(), order_id))
            
            db.commit()
            
            logger.info(f"Updated order {order_id} status to {status}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating order status: {str(e)}")
            return False
    
    @classmethod
    def update_payment_status(cls, db, order_id, payment_status, payment_method=None):
        """
        Update order payment status
        
        Args:
            db: Database connection
            order_id: Order ID
            payment_status: New payment status
            payment_method: Optional payment method
            
        Returns:
            True if successful, False otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('''
                UPDATE orders 
                SET payment_status = %s, 
                    updated_at = %s
                WHERE id = %s
            ''', (payment_status, datetime.now(), order_id))
            
            # If payment method is provided, record payment transaction
            if payment_method and payment_status == 'paid':
                # Get price from order
                cursor.execute('SELECT price FROM orders WHERE id = %s', (order_id,))
                result = cursor.fetchone()
                price = result[0] if result else 0
                
                # Insert payment transaction
                cursor.execute('''
                    INSERT INTO payment_transactions
                    (order_id, amount, payment_method, status, created_at)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (order_id, price, payment_method, 'completed', datetime.now()))
            
            db.commit()
            logger.info(f"Updated order {order_id} payment status to {payment_status}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error updating payment status: {str(e)}")
            return False
    
    @classmethod
    def get_active_by_station(cls, db, station_id):
        """
        Get active orders for a station
        
        Args:
            db: Database connection
            station_id: Station ID
            
        Returns:
            List of active orders
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute('''
                SELECT * FROM orders 
                WHERE station_id = %s AND status IN ('pending', 'in-progress')
                ORDER BY queue_priority, created_at
            ''', (station_id,))
            
            orders = cursor.fetchall()
            result = []
            
            for order in orders:
                order_dict = dict(order)
                
                # Parse JSON fields
                if 'order_details' in order_dict and order_dict['order_details']:
                    try:
                        order_dict['order_details'] = json.loads(order_dict['order_details'])
                    except:
                        pass
                
                result.append(order_dict)
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting active orders: {str(e)}")
            return []
    
    @classmethod
    def get_price_by_number(cls, db, order_number):
        """
        Get price for an order by order number
        
        Args:
            db: Database connection
            order_number: Order number
            
        Returns:
            Price if found, None otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('SELECT price FROM orders WHERE order_number = %s', (order_number,))
            result = cursor.fetchone()
            
            return result[0] if result else None
            
        except Exception as e:
            logger.error(f"Error getting order price: {str(e)}")
            return None
    
    @classmethod
    def get_payment_link_by_number(cls, db, order_number):
        """
        Get payment link for an order by order number
        
        Args:
            db: Database connection
            order_number: Order number
            
        Returns:
            Payment link if found, None otherwise
        """
        try:
            cursor = db.cursor()
            cursor.execute('SELECT payment_link FROM orders WHERE order_number = %s', (order_number,))
            result = cursor.fetchone()
            
            return result[0] if result else None
            
        except Exception as e:
            logger.error(f"Error getting payment link: {str(e)}")
            return None


class CustomerPreference:
    """Model for customer preferences"""
    
    @classmethod
    def create_tables(cls, db):
        """Create necessary tables if they don't exist - handled by database.py now"""
        # Tables are created in database.py create_tables function
        # This is kept for backwards compatibility
        pass
    
    @classmethod
    def get(cls, db, phone):
        """
        Get customer preferences by phone number
        
        Args:
            db: Database connection
            phone: Phone number
            
        Returns:
            Customer dictionary if found, None otherwise
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute('SELECT * FROM customer_preferences WHERE phone = %s', (phone,))
            customer = cursor.fetchone()
            
            if not customer:
                return None
            
            # Convert to dictionary
            customer_dict = dict(customer)
            
            return customer_dict
            
        except Exception as e:
            logger.error(f"Error retrieving customer: {str(e)}")
            return None
    
    @classmethod
    def save(cls, db, customer_data):
        """
        Save or update customer preferences
        
        Args:
            db: Database connection
            customer_data: Dictionary with customer preferences
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Ensure phone is provided
            if 'phone' not in customer_data:
                logger.error("Missing required field: phone")
                return False
            
            # Check if customer exists
            cursor = db.cursor()
            cursor.execute('SELECT phone FROM customer_preferences WHERE phone = %s', (customer_data['phone'],))
            existing = cursor.fetchone()
            
            if existing:
                # Update existing customer
                set_clause = []
                values = []
                
                for key, value in customer_data.items():
                    if key != 'phone':  # Skip phone for update
                        set_clause.append(f"{key} = %s")
                        values.append(value)
                
                # Add phone at the end for WHERE clause
                values.append(customer_data['phone'])
                
                # Create SQL query
                sql = f"UPDATE customer_preferences SET {', '.join(set_clause)} WHERE phone = %s"
                
                # Execute query
                cursor.execute(sql, values)
                
            else:
                # Insert new customer
                columns = []
                placeholders = []
                values = []
                
                for key, value in customer_data.items():
                    columns.append(key)
                    placeholders.append('%s')
                    values.append(value)
                
                # Create SQL query
                sql = f"INSERT INTO customer_preferences ({', '.join(columns)}) VALUES ({', '.join(placeholders)})"
                
                # Execute query
                cursor.execute(sql, values)
            
            db.commit()
            logger.info(f"Saved preferences for customer {customer_data['phone']}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error saving customer preferences: {str(e)}")
            return False
    
    @classmethod
    def add_loyalty_points(cls, db, phone, points, order_id=None, transaction_type='earned', notes=None):
        """
        Add loyalty points to a customer account
        
        Args:
            db: Database connection
            phone: Phone number
            points: Number of points to add
            order_id: Optional order ID
            transaction_type: Transaction type
            notes: Optional notes
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # Check if customer exists
            cursor = db.cursor()
            cursor.execute('SELECT loyalty_points, loyalty_free_drinks FROM customer_preferences WHERE phone = %s', (phone,))
            existing = cursor.fetchone()
            
            if existing:
                # Update existing customer
                current_points = existing[0] or 0
                current_free_drinks = existing[1] or 0
                
                # Calculate new values
                new_points = current_points + points
                new_free_drinks = current_free_drinks
                
                # If this is a redemption, increment free drinks count
                if transaction_type == 'redemption' and points < 0:
                    new_free_drinks += 1
                
                cursor.execute('''
                    UPDATE customer_preferences 
                    SET loyalty_points = %s, 
                        loyalty_free_drinks = %s,
                        last_order_date = %s
                    WHERE phone = %s
                ''', (new_points, new_free_drinks, datetime.now(), phone))
                
            else:
                # Create new customer
                cursor.execute('''
                    INSERT INTO customer_preferences 
                    (phone, loyalty_points, total_orders, first_order_date, last_order_date)
                    VALUES (%s, %s, %s, %s, %s)
                ''', (phone, points, 1, datetime.now(), datetime.now()))
            
            # Record transaction
            cursor.execute('''
                INSERT INTO loyalty_transactions
                (phone, points, transaction_type, order_id, created_at, notes)
                VALUES (%s, %s, %s, %s, %s, %s)
            ''', (phone, points, transaction_type, order_id, datetime.now(), notes))
            
            db.commit()
            logger.info(f"Added {points} loyalty points to {phone}")
            return True
            
        except Exception as e:
            db.rollback()
            logger.error(f"Error adding loyalty points: {str(e)}")
            return False
    
    @classmethod
    def get_loyalty_status(cls, db, phone):
        """
        Get loyalty status for a customer
        
        Args:
            db: Database connection
            phone: Phone number
            
        Returns:
            Loyalty status dictionary
        """
        try:
            cursor = db.cursor()
            
            # Get customer points
            cursor.execute('SELECT loyalty_points, loyalty_free_drinks FROM customer_preferences WHERE phone = %s', (phone,))
            customer = cursor.fetchone()
            
            # Get points per free coffee from config
            try:
                from config import LOYALTY_POINTS_FOR_FREE_COFFEE
                points_needed = LOYALTY_POINTS_FOR_FREE_COFFEE
            except:
                points_needed = 100  # Default if config not available
            
            if not customer:
                return {
                    'points': 0,
                    'free_coffees': 0,
                    'progress': 0,
                    'total_earned': 0,
                    'total_redeemed': 0
                }
            
            # Calculate values
            points = customer[0] or 0
            already_redeemed = customer[1] or 0
            free_coffees = points // points_needed
            progress = (points % points_needed) / points_needed * 100
            
            # Get total points earned and redeemed
            cursor.execute('''
                SELECT 
                    SUM(CASE WHEN transaction_type = 'earned' THEN points ELSE 0 END) as earned,
                    SUM(CASE WHEN transaction_type = 'redemption' THEN ABS(points) ELSE 0 END) as redeemed
                FROM loyalty_transactions
                WHERE phone = %s
            ''', (phone,))
            
            totals = cursor.fetchone()
            total_earned = totals[0] or 0
            total_redeemed = totals[1] or 0
            
            return {
                'points': points,
                'free_coffees': free_coffees,
                'progress': progress,
                'total_earned': total_earned,
                'total_redeemed': total_redeemed
            }
            
        except Exception as e:
            logger.error(f"Error getting loyalty status: {str(e)}")
            return {
                'points': 0,
                'free_coffees': 0,
                'progress': 0,
                'total_earned': 0,
                'total_redeemed': 0,
                'error': str(e)
            }
    
    @classmethod
    def get_loyalty_transactions(cls, db, phone, limit=10):
        """
        Get loyalty transactions for a customer
        
        Args:
            db: Database connection
            phone: Phone number
            limit: Maximum number of transactions to return
            
        Returns:
            List of loyalty transactions
        """
        try:
            cursor = db.cursor(cursor_factory=RealDictCursor)
            cursor.execute('''
                SELECT id, points, transaction_type, order_id, created_at, notes
                FROM loyalty_transactions
                WHERE phone = %s
                ORDER BY created_at DESC
                LIMIT %s
            ''', (phone, limit))
            
            transactions = cursor.fetchall()
            
            # Convert to list of dictionaries
            result = []
            for transaction in transactions:
                result.append(dict(transaction))
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting loyalty transactions: {str(e)}")
            return []
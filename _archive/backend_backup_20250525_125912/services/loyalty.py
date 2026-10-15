# services/loyalty.py

from utils.database import db
from models.users import Customer
from datetime import datetime
import logging

class LoyaltyProgram:
    """Represents a customer loyalty level"""
    REGULAR = "Regular"
    BRONZE = "Bronze"
    SILVER = "Silver"
    GOLD = "Gold"
    
    # Points thresholds for each tier
    TIER_THRESHOLDS = {
        BRONZE: 10,
        SILVER: 30,
        GOLD: 60
    }
    
    # Rewards for each tier (applied as multipliers to base points)
    TIER_MULTIPLIERS = {
        REGULAR: 1.0,
        BRONZE: 1.2,
        SILVER: 1.5, 
        GOLD: 2.0
    }


class LoyaltyService:
    """Manages customer loyalty program"""
    
    @classmethod
    def get_customer_loyalty(cls, customer_id):
        """Get loyalty information for a customer
        
        Args:
            customer_id: Customer ID
            
        Returns:
            dict: Loyalty information
        """
        customer = Customer.query.get(customer_id)
        
        if not customer:
            return {
                'points': 0,
                'free_coffees': 0,
                'tier': LoyaltyProgram.REGULAR,
                'next_tier': LoyaltyProgram.BRONZE,
                'points_to_next_tier': LoyaltyProgram.TIER_THRESHOLDS[LoyaltyProgram.BRONZE],
                'points_to_free_coffee': cls._get_points_for_free_coffee()
            }
            
        # Calculate tier
        tier = cls._calculate_tier(customer.loyalty_points)
        
        # Calculate next tier and points needed
        next_tier = None
        points_to_next_tier = 0
        
        if tier != LoyaltyProgram.GOLD:
            tiers = [LoyaltyProgram.BRONZE, LoyaltyProgram.SILVER, LoyaltyProgram.GOLD]
            current_index = tiers.index(tier) if tier in tiers else -1
            next_tier = tiers[current_index + 1] if current_index < len(tiers) - 1 else None
            
            if next_tier:
                points_to_next_tier = LoyaltyProgram.TIER_THRESHOLDS[next_tier] - customer.loyalty_points
        
        # Calculate free coffees
        points_per_coffee = cls._get_points_for_free_coffee()
        free_coffees = customer.loyalty_points // points_per_coffee
        points_to_free_coffee = points_per_coffee - (customer.loyalty_points % points_per_coffee)
        
        return {
            'points': customer.loyalty_points,
            'free_coffees': free_coffees,
            'tier': tier,
            'next_tier': next_tier,
            'points_to_next_tier': points_to_next_tier,
            'points_to_free_coffee': points_to_free_coffee if points_to_free_coffee < points_per_coffee else 0
        }
    
    @classmethod
    def add_points(cls, customer_id, base_points=1):
        """Add loyalty points for a customer
        
        Args:
            customer_id: Customer ID
            base_points: Base points to add (usually 1 per order)
            
        Returns:
            dict: Updated loyalty information
        """
        customer = Customer.query.get(customer_id)
        
        if not customer:
            return {'success': False, 'error': 'Customer not found'}
            
        # Get current tier and multiplier
        current_tier = cls._calculate_tier(customer.loyalty_points)
        multiplier = LoyaltyProgram.TIER_MULTIPLIERS.get(current_tier, 1.0)
        
        # Calculate points to add (with tier multiplier)
        points_to_add = int(base_points * multiplier)
        
        # Update customer points
        customer.loyalty_points += points_to_add
        customer.updated_at = datetime.utcnow()
        
        # Log loyalty activity
        if not hasattr(customer, 'loyalty_history'):
            customer.loyalty_history = []
            
        loyalty_activity = {
            'timestamp': datetime.utcnow().isoformat(),
            'action': 'add_points',
            'base_points': base_points,
            'multiplier': multiplier,
            'points_added': points_to_add,
            'new_total': customer.loyalty_points
        }
        
        customer.loyalty_history.append(loyalty_activity)
        
        try:
            db.session.commit()
            
            # Return updated loyalty info
            return {
                'success': True,
                'points_added': points_to_add,
                'new_total': customer.loyalty_points,
                'tier': cls._calculate_tier(customer.loyalty_points)
            }
        except Exception as e:
            db.session.rollback()
            logging.error(f"Error adding loyalty points: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def redeem_free_coffee(cls, customer_id):
        """Redeem points for a free coffee
        
        Args:
            customer_id: Customer ID
            
        Returns:
            dict: Result of redemption
        """
        customer = Customer.query.get(customer_id)
        
        if not customer:
            return {'success': False, 'error': 'Customer not found'}
            
        # Check if customer has enough points
        points_needed = cls._get_points_for_free_coffee()
        
        if customer.loyalty_points < points_needed:
            return {
                'success': False,
                'error': 'Not enough points',
                'points': customer.loyalty_points,
                'points_needed': points_needed
            }
            
        # Deduct points
        customer.loyalty_points -= points_needed
        customer.updated_at = datetime.utcnow()
        
        # Log loyalty activity
        if not hasattr(customer, 'loyalty_history'):
            customer.loyalty_history = []
            
        loyalty_activity = {
            'timestamp': datetime.utcnow().isoformat(),
            'action': 'redeem_coffee',
            'points_redeemed': points_needed,
            'new_total': customer.loyalty_points
        }
        
        customer.loyalty_history.append(loyalty_activity)
        
        try:
            db.session.commit()
            
            # Return updated loyalty info
            return {
                'success': True,
                'points_redeemed': points_needed,
                'new_total': customer.loyalty_points,
                'tier': cls._calculate_tier(customer.loyalty_points)
            }
        except Exception as e:
            db.session.rollback()
            logging.error(f"Error redeeming free coffee: {str(e)}")
            return {'success': False, 'error': str(e)}
    
    @classmethod
    def _calculate_tier(cls, points):
        """Calculate loyalty tier based on points
        
        Args:
            points: Loyalty points
            
        Returns:
            str: Loyalty tier
        """
        if points >= LoyaltyProgram.TIER_THRESHOLDS[LoyaltyProgram.GOLD]:
            return LoyaltyProgram.GOLD
        elif points >= LoyaltyProgram.TIER_THRESHOLDS[LoyaltyProgram.SILVER]:
            return LoyaltyProgram.SILVER
        elif points >= LoyaltyProgram.TIER_THRESHOLDS[LoyaltyProgram.BRONZE]:
            return LoyaltyProgram.BRONZE
        else:
            return LoyaltyProgram.REGULAR
    
    @classmethod
    def _get_points_for_free_coffee(cls):
        """Get points needed for a free coffee from settings
        
        Returns:
            int: Points needed for a free coffee
        """
        from models.settings import SystemSettings
        return SystemSettings.get_value('points_for_free_coffee', 10)
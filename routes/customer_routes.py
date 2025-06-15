"""Route definitions for customer_routes.py"""

from flask import Blueprint, render_template, request, redirect, url_for, flash, session, jsonify

bp = Blueprint("customer_routes", __name__)

@bp.route('/customer')
def customer_index():
    """Display the customer dashboard page"""
    return render_template('customer/index.html')

@bp.route('/customer/orders')
def customer_orders():
    """Display the customer's order history"""
    return render_template('customer/orders.html')

@bp.route('/customer/profile')
def customer_profile():
    """Display and edit customer preferences"""
    return render_template('customer/profile.html')

@bp.route('/customer/points')
def customer_points():
    """Display the customer's loyalty points"""
    return render_template('customer/points.html')
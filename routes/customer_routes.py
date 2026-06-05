"""Legacy customer routes.

These routes pre-date the React SPA. They used to render Flask/Jinja
templates from `templates/customer/`, but those templates were removed
when the customer experience moved to SMS + the React frontend. The
routes were still registered, so hitting /customer (or any sub-path)
caused a TemplateNotFound → 500.

Fresh-eyes audit (Jun 2026) flagged /customer as a 500 that real
customers might guess. Replacing the renders with redirects to the
React SPA at /. The SPA's router decides what to show.
"""

from flask import Blueprint, redirect

bp = Blueprint("customer_routes", __name__)


@bp.route('/customer')
@bp.route('/customer/')
@bp.route('/customer/orders')
@bp.route('/customer/profile')
@bp.route('/customer/points')
def customer_any():
    """Send legacy /customer* URLs to the SPA root.

    A 302 (not 301) so anyone who's bookmarked these can still
    follow the redirect cleanly without their browser caching a
    permanent move that we might want to revisit later.
    """
    return redirect('/', code=302)

# Expresso Coffee Ordering System

A coffee ordering and management system for events and conferences.

## Features

- Barista interface for order management
- Display screens for order status
- Customer mobile ordering
- SMS notifications
- Reporting and analytics
- Multi-station support
- Role-based access control
- Standardized API structure

## System Components

The Expresso system consists of several components:

1. **Flask Backend**:
   - RESTful API for all operations
   - Database integration
   - SMS integration via Twilio
   - Authentication and role-based access

2. **React Frontend**:
   - Barista interface for order processing
   - Organizer interface for event management
   - Display screens for order status
   - Admin interface for system configuration

3. **Mobile Interface**:
   - QR code scanning for order status
   - SMS notifications

## API Structure

The system uses a standardized API structure with the following key aspects:

- All API endpoints are prefixed with `/api`
- JWT authentication for protected endpoints
- Role-based access control
- Consistent response format
- Comprehensive error handling

For detailed API documentation, see:
- [API-REFERENCE.md](API-REFERENCE.md) - Full API specifications
- [API-IMPLEMENTATION-STATUS.md](API-IMPLEMENTATION-STATUS.md) - Current implementation status
- [FRONTEND-BACKEND-INTEGRATION.md](FRONTEND-BACKEND-INTEGRATION.md) - How frontend and backend work together

## User Roles

The system supports the following user roles:

1. **Admin**:
   - Full access to all system features
   - User management
   - System configuration

2. **Staff** (Event Organizers):
   - Order management across all stations
   - Reporting and analytics
   - Station configuration

3. **Barista**:
   - Order processing
   - Customer messaging
   - Station management

4. **Customer**:
   - Order placement
   - Order status tracking

## Setup and Installation

### Dependencies

- Python 3.9+
- PostgreSQL 12+
- Node.js 14+
- Twilio account for SMS integration

### Backend Setup

1. Create a Python virtual environment:
   ```
   python -m venv venv
   source venv/bin/activate
   ```

2. Install dependencies:
   ```
   pip install -r requirements.txt
   ```

3. Set up environment variables in `.env` file:
   ```
   # Database configuration
   DATABASE_URL=postgresql://username:password@localhost:5432/expresso

   # Twilio configuration
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_phone

   # Application settings
   TESTING_MODE=False  # Set to True for development
   ```

4. Create admin user:
   ```
   python create_admin.py
   ```

5. Initialize database with test data:
   ```
   python load_test_data.py
   ```

6. Run the application:
   ```
   python run_server.py
   ```

7. Test API connectivity:
   ```
   python test_frontend_apis.py
   ```

### Frontend Setup

1. Navigate to Barista Front End directory:
   ```
   cd "Barista Front End"
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Run development server:
   ```
   npm start
   ```

4. Build for production:
   ```
   npm run build
   ```

### Troubleshooting

If you encounter issues with the frontend showing "API Not Implemented" messages:

1. Run the authentication fix scripts:
   ```
   python fix_database_connection.py    # Fix database URL
   python create_admin.py --force       # Create admin user
   python load_test_data.py --force     # Load test data
   python test_login.py                 # Test authentication
   ```

2. See [AUTHENTICATION-FIX.md](AUTHENTICATION-FIX.md) for a comprehensive guide to fixing authentication issues

3. Additional troubleshooting resources:
   - Ensure the backend server is running on port 5001
   - Verify authentication is working with valid admin credentials
   - Check JWT token handling in both backend and frontend 
   - Run the API test script to diagnose specific API issues
   - See [FRONTEND-BACKEND-INTEGRATION.md](FRONTEND-BACKEND-INTEGRATION.md) for detailed troubleshooting tips

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -am 'Add new feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Create a new Pull Request

## License

This project is licensed under the MIT License - see the LICENSE file for details.
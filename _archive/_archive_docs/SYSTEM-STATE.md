# SYSTEM-STATE.md - Expresso System Architecture Documentation

Generated: January 6, 2025

## Overview

This document describes the actual running state of the Expresso Coffee Ordering System, including how services interact, routing architecture, and the relationship between Flask backend and React frontend.

## System Architecture

### Service Ports and URLs

1. **Flask Backend**: Port 5001
   - Changed from default 5000 to avoid macOS AirPlay conflict
   - Serves API endpoints under `/api/*`
   - Also serves the production React build from its `/static` directory
   - Configured in `config.py`: `PORT = int(os.getenv('PORT', 5001))`

2. **React Development Server**: Port 3000 (development only)
   - Only runs during development via `npm start`
   - Proxies API calls to Flask backend via `setupProxy.js`
   - Configured in `Barista Front End/package.json`: `"proxy": "http://localhost:5001"`

3. **ngrok**: Dynamic public URL
   - Provides public access to local Flask server
   - Started automatically by `start_expresso.sh`

## Routing Architecture

### API Request Flow

```
Browser → React App → API Request → Proxy/Direct → Flask Backend
                         ↓                             ↓
                    /api/orders                   Handle Request
                         ↓                             ↓
                 (Dev: Port 3000)                 Port 5001
                 (Prod: Port 5001)                     ↓
                         ↓                        PostgreSQL
                    Response ← ← ← ← ← ← ← ← ← Response
```

### Development Mode Routing

1. **React Dev Server (Port 3000)**:
   - Serves React app with hot reloading
   - `setupProxy.js` proxies `/api/*` requests to Flask backend on port 5001
   - Allows separate development of frontend and backend

2. **API Proxy Configuration** (`Barista Front End/src/setupProxy.js`):
   ```javascript
   app.use('/api', createProxyMiddleware({
     target: 'http://localhost:5001',
     changeOrigin: true,
     logLevel: 'debug'
   }));
   ```

### Production Mode Routing

1. **Flask Backend (Port 5001)**:
   - Serves the built React app from `/static` directory
   - Built files copied after `npm run build`
   - Direct API access without proxy
   - Single server handles both frontend and API

2. **Static File Serving**:
   - Flask serves React build files from `static/` directory
   - Includes nested structure: `static/static/js/` and `static/static/css/`
   - Special routes for favicon, manifest, logos

## Flask Backend Static Files vs React Dev Server

### The Dual Nature

1. **Flask Static Directory** (`/static`):
   - Contains production build of React app
   - Served directly by Flask in production
   - Updated via `npm run build` in `Barista Front End/`
   - Includes all HTML, CSS, JS, and assets

2. **React Development Server**:
   - Runs separately for development
   - Provides hot module replacement
   - Webpack dev server with live reloading
   - Never used in production

### Why This Architecture Exists

1. **Development Flexibility**:
   - Frontend developers can work independently
   - Hot reloading for instant feedback
   - Better debugging with React DevTools

2. **Production Simplicity**:
   - Single Flask server handles everything
   - No need for separate frontend server
   - Easier deployment and maintenance

## API Endpoint Structure

### Current API Routes (All under `/api/*`)

1. **Authentication** (`/api/auth/*`):
   - `/api/auth/login` - JWT token generation
   - `/api/auth/refresh` - Token refresh
   - `/api/auth/logout` - Token invalidation

2. **Orders** (`/api/orders/*`):
   - `/api/orders/pending` - Get pending orders
   - `/api/orders/in-progress` - Get in-progress orders
   - `/api/orders/completed` - Get completed orders
   - `/api/orders/<id>/start` - Start an order
   - `/api/orders/<id>/complete` - Complete an order

3. **Other APIs**:
   - `/api/stations` - Station management
   - `/api/inventory` - Inventory management
   - `/api/chat/messages` - Inter-station messaging
   - `/api/settings` - System settings
   - `/api/test` - API connectivity test

### Legacy Route Handling

Flask includes redirects for old endpoints:
```python
@app.route('/orders/pending')
def orders_pending():
    return redirect('/api/orders/pending')
```

## TESTING_MODE Configuration

### What TESTING_MODE Controls

From `config.py`:
```python
TESTING_MODE = os.getenv('TESTING_MODE', 'False').lower() == 'true'
```

1. **SMS Behavior**:
   - `True`: Messages logged to console/database, not sent via Twilio
   - `False`: Messages sent via Twilio SMS

2. **Frontend Routing** (in `app.py`):
   ```python
   if config.TESTING_MODE:
       return redirect(f'http://localhost:3000/{path}')
   return app.send_static_file('index.html')
   ```
   - `True`: Redirects to React dev server for SPA routes
   - `False`: Serves static React build

3. **Not Related To**:
   - Demo mode (separate configuration)
   - API fallback behavior
   - Authentication requirements

## Modifications by Previous Claudes

### Authentication System
- Implemented JWT with refresh tokens
- 15-minute access token expiry (was 24 hours)
- 7-day refresh token expiry (was 30 days)
- Added automatic token refresh in `ApiService.js`

### CORS Configuration
- Comprehensive CORS setup in `app.py`
- Handles preflight requests explicitly
- Allows credentials for JWT tokens
- Configured origins in `.env`

### API Standardization
- All endpoints moved under `/api/*` prefix
- Consistent response format:
  ```json
  {
    "success": true/false,
    "status": "success|error",
    "data": {},
    "message": "Optional message"
  }
  ```

### Frontend Services
- Centralized API configuration in `apiConfig.js`
- Service layer architecture with singletons
- Offline support with fallback data
- WebSocket integration for real-time updates

## Common Confusion Points

### 1. "Why are there two static directories?"
- `/static/` - Flask's static file directory
- `/static/static/` - React build's nested structure
- This is normal for Create React App builds

### 2. "Why does the frontend sometimes not connect?"
- Check if both servers are running (dev mode)
- Verify proxy configuration
- Ensure CORS origins include frontend URL
- Check JWT token expiry

### 3. "What's the difference between demo mode and testing mode?"
- **TESTING_MODE**: Controls SMS sending and dev routing
- **Demo Mode**: Frontend-only feature for sample data
- They are independent configurations

### 4. "Why do some API calls work and others don't?"
- Blueprint registration order matters
- Some routes are defined directly in `app.py`
- Check if route is properly prefixed with `/api`

## Debugging Tips

### Check Running Services
```bash
# Check if Flask is running
curl http://localhost:5001/api/test

# Check if React dev server is running (dev only)
curl http://localhost:3000

# Check database connection
curl http://localhost:5001/api/debug/database-info
```

### Common Issues and Solutions

1. **"API not found" errors**:
   - Ensure route has `/api` prefix
   - Check blueprint registration in `app.py`
   - Verify CORS configuration

2. **Authentication failures**:
   - Check token expiry (15 minutes)
   - Verify refresh token logic
   - Clear localStorage and re-login

3. **Frontend not updating**:
   - In dev: Check React dev server
   - In prod: Rebuild and copy to static
   - Clear browser cache

## Deployment Considerations

### Development to Production Transition

1. Build React app: `cd "Barista Front End" && npm run build`
2. Copy build to Flask static: `cp -r build/* ../static/`
3. Set `TESTING_MODE=False` in environment
4. Run Flask server only (no React dev server)
5. All requests go through Flask on port 5001

### Environment Variables
Key variables that affect routing and behavior:
- `TESTING_MODE`: Controls SMS and frontend routing
- `CORS_ALLOWED_ORIGINS`: Must include frontend URLs
- `JWT_SECRET_KEY`: For token signing
- `DATABASE_URL`: PostgreSQL connection string

## Summary

The Expresso system uses a dual-mode architecture:
- **Development**: Separate React (3000) and Flask (5001) servers with proxy
- **Production**: Single Flask server (5001) serving both API and static React build

This provides the best of both worlds: rapid development with hot reloading and simple production deployment with a single server. Understanding this architecture is crucial for troubleshooting and extending the system.
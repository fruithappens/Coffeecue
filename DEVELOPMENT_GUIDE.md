# Coffee Cue Development Guide

## Quick Start

### Option 1: Automated Development Setup
```bash
./start_development_mode.sh
```
This script will:
- Try to start React dev server on available ports (3010, 3020, 3030, 4000, 4001, 4002)
- Start Flask backend on port 5001
- Fall back to production mode if dev server can't start

### Option 2: Manual Development Setup

1. **Start Backend (Terminal 1)**
   ```bash
   python3 run_server.py
   ```
   Backend will run on http://localhost:5001

2. **Start Frontend (Terminal 2)**
   ```bash
   cd "Barista Front End"
   PORT=3010 npm start  # Try 3010, 3020, 3030, 4000, etc.
   ```

### Option 3: Production Mode (Single Port)
```bash
cd "Barista Front End"
npm run build
cp -r build/* ../static/
python3 run_server.py
```
Everything accessible at http://localhost:5001

## Port Strategy

Due to networking restrictions on your system, we use these ports:
- **Port 5001**: Flask backend (always works)
- **Port 3010-4002**: React dev server (try different ports)
- **Fallback**: Production build served via Flask

## Why This Approach?

### Development Benefits:
- ✅ Hot reloading for React changes
- ✅ Separate debugging of frontend/backend
- ✅ Proper middleware testing
- ✅ Real-world deployment simulation

### Production Benefits:
- ✅ Single port for deployment
- ✅ No CORS issues
- ✅ Simplified hosting

## Network Issue Troubleshooting

If React dev server won't start:
1. **Check what's using port 3000**: `lsof -i :3000`
2. **Try different ports**: 3010, 3020, 3030, 4000, 4001, 4002
3. **Check macOS firewall**: System Preferences > Security & Privacy > Firewall
4. **Check Little Snitch**: If installed, allow Node.js connections
5. **Corporate networks**: May block development ports

## Available Services

When running in development mode:
- **React Frontend**: http://localhost:[PORT] (hot reload)
- **Flask Backend**: http://localhost:5001/api/*
- **Migration Tool**: http://localhost:5001/static/localStorage-to-database-migration.html
- **Diagnostic Tool**: http://localhost:5001/static/diagnostic.html

## API Testing

Backend API endpoints:
- Health check: `curl http://localhost:5001/api/health`
- Orders: `curl http://localhost:5001/api/orders/pending`
- Stations: `curl http://localhost:5001/api/stations`

## Common Commands

```bash
# Build React for production
cd "Barista Front End" && npm run build

# Update Flask static files
cp -r "Barista Front End/build"/* static/

# Start just backend
python3 run_server.py

# Start just frontend (try different ports)
cd "Barista Front End" && PORT=3010 npm start

# Full system via launcher
./start_expresso_enhanced.sh
```
# How to Run Expresso Coffee System

## ✅ CORRECT WAY TO RUN THE SYSTEM

**The system runs on port 5001 with a React SPA (Single Page Application)**

```bash
# From the expresso directory
cd /Users/stevewf/expresso

# Activate virtual environment and start
source venv/bin/activate
python run_server.py
```

## 📱 ACCESS THE INTERFACES

Open your browser to **http://localhost:5001**

From there, you can navigate to:
- **http://localhost:5001/login** - Login page
- **http://localhost:5001/barista** - Barista interface 
- **http://localhost:5001/organiser** - Organiser interface
- **http://localhost:5001/display** - Display screens
- **http://localhost:5001/support** - Support interface

**Default login credentials:**
- Username: `coffeecue`
- Password: `adminpassword`

## 🎯 What's Actually Happening

1. Flask serves a React app from `/static/index.html`
2. The React app handles client-side routing
3. All routes (`/barista`, `/organiser`, etc.) are handled by React Router
4. API calls go to `/api/*` endpoints on the same port

## ⚠️ IMPORTANT: This is NOT the old template-based system!

Previously, Flask served HTML templates directly. Now it serves a React SPA that handles all the routing on the client side.

## 🚀 Using Launcher Scripts

For automated startup:
```bash
./start_expresso.sh       # Full setup with ngrok
./start_expresso_fast.sh  # Quick start without ngrok
```

## 🛑 Troubleshooting

1. **Blank page** - Clear browser cache and refresh
2. **"Cannot GET /barista"** - Make sure you're on port 5001, not 3000
3. **Authentication errors** - Clear localStorage and login again
4. **API errors** - Check that backend is running on port 5001

## 📝 System Architecture

```
Port 5001 (Flask Backend)
├── /api/* - Backend API endpoints
├── /static/* - React build files  
├── / - Serves React SPA (index.html)
└── /* - All routes handled by React Router
```

**Port 3000 is NOT used in production mode!**
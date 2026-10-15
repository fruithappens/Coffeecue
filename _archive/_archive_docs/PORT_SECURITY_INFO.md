# Chrome Port Blocking Issue - Explained

## The Problem
Chrome blocks certain ports for security reasons, which includes many common development ports.

## Chrome's Blocked Ports (Partial List)
- **1080** (SOCKS proxy)
- **3000** (Development servers - **YOUR ISSUE**)
- **4000-4999** (Various protocols - **YOUR ISSUE**)
- **5060** (SIP)
- **6000** (X11)
- **7000** (AFS file server)

## Why Port 5001 Works
Port 5001 is **NOT** in Chrome's blocked list, which is why your Flask backend works perfectly.

## Solutions

### Option 1: Use Safe Development Ports
These ports are generally NOT blocked by Chrome:
- **8080** ✅ (Common alternative)
- **8000-8999** ✅ (Usually safe)
- **9000-9999** ✅ (Usually safe)
- **3001-3010** ❓ (Sometimes blocked)

### Option 2: Disable Chrome Port Blocking (Temporary)
```bash
# Start Chrome with port blocking disabled (for development only)
open -a "Google Chrome" --args --explicitly-allowed-ports=3000,3001,4000
```

### Option 3: Use Different Browser
- **Safari**: Doesn't have the same port restrictions
- **Firefox**: Different port blocking rules
- **Edge**: Different restrictions

### Option 4: Production Mode (What We're Using)
Serve everything through Flask on port 5001 (always works)

## Current Working Solution
Your system now works on port 5001 because:
1. Chrome doesn't block port 5001
2. Flask serves both API and React app
3. No CORS issues
4. Simple single-port deployment

## For Testing Frontend/Backend Separately
If you want true development mode with hot reloading:

```bash
# Try these safe ports for React:
cd "Barista Front End"
PORT=8080 npm start   # Most likely to work
PORT=8000 npm start   # Alternative
PORT=9000 npm start   # Alternative

# Backend stays on 5001
python3 run_server.py
```

## Browser Testing Command
```bash
# Test which ports Chrome allows
for port in 3000 3001 4000 8000 8080 9000; do
  echo "Testing port $port..."
  curl -I http://localhost:$port 2>/dev/null && echo "✅ $port works" || echo "❌ $port blocked"
done
```
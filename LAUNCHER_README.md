# Coffee Cue Launcher - Getting Started Guide

## Quick Start

1. **Double-click the CoffeeCueLauncher app** in the expresso folder
2. Choose **"Complete Setup"** on first run (or if you're having issues)
3. Wait for all terminal windows to open
4. The app will open in your browser automatically

## What the Launcher Does

The Coffee Cue Launcher automatically:
- ✅ Checks all system requirements (Python, Node.js, PostgreSQL, ngrok)
- ✅ Starts PostgreSQL database if needed
- ✅ Creates the database and tables
- ✅ Installs all Python and Node.js dependencies
- ✅ Creates test users and sample data
- ✅ Starts the backend server on port **5001**
- ✅ Starts the frontend on port **3000**
- ✅ Starts ngrok for public access
- ✅ Opens the app in your browser

## Login Credentials

- **Admin**: `coffeecue` / `adminpassword`
- **Barista**: `barista` / `barista123`
- **Organizer**: `organizer` / `organizer123`

## URLs

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5001
- **ngrok Status**: http://localhost:4040
- **Public URL**: Check the ngrok terminal window

## Startup Modes

### Complete Setup (Recommended for first run)
- Checks all dependencies
- Installs missing packages
- Creates database and tables
- Loads test data
- Takes 1-2 minutes

### Quick Start
- Assumes everything is already installed
- Skips dependency checks
- Faster startup (10-15 seconds)
- Use this for daily development

## Troubleshooting

### "Could not find Coffee Cue directory"
- Make sure the launcher is in the `/Users/stevewf/expresso` folder
- Don't move the launcher app outside the project

### "PostgreSQL is not installed"
```bash
brew install postgresql@15
brew services start postgresql@15
```

### "Node.js is not installed"
```bash
brew install node
```

### "ngrok is not installed"
```bash
brew install ngrok/ngrok/ngrok
```

### Backend won't start
- Check if port 5001 is already in use:
  ```bash
  lsof -i :5001
  ```
- Kill any existing process:
  ```bash
  kill -9 <PID>
  ```

### Frontend won't start
- Check if port 3000 is already in use
- Try running Complete Setup mode

### Database errors
- Run Complete Setup mode to recreate database
- Or manually reset:
  ```bash
  dropdb expresso
  createdb expresso
  python3 pg_init.py
  ```

## Manual Start (if launcher fails)

```bash
cd /Users/stevewf/expresso
./start_expresso_complete.sh
```

## Stopping the System

Close all Terminal windows that were opened by the launcher.

## Development Tips

- Use **Quick Start** mode for daily development
- Use **Complete Setup** after pulling new code or if you encounter errors
- The backend automatically reloads when you change Python files
- The frontend automatically reloads when you change React files
- JWT tokens are valid for 24 hours (after next restart)

## System Requirements

- macOS 10.13 or later
- Python 3.8+
- Node.js 14+
- PostgreSQL 13+
- 4GB RAM minimum
- 1GB free disk space
# 🚀 RAILWAY DEPLOYMENT GUIDE FOR EXPRESSO

## 🎯 **Deployment Files Created**

### ✅ **Files Ready for Railway:**
- `Procfile` - Tells Railway how to start your app
- `railway.json` - Railway configuration
- `runtime.txt` - Python version specification
- `run_server.py` - Updated for production with PORT handling
- `.env.production` - Template for environment variables

## 📋 **Step-by-Step Deployment**

### **1. Sign Up for Railway (2 minutes)**
1. Go to [railway.app](https://railway.app)
2. Click "Start a New Project"
3. Connect your GitHub account
4. Choose "Deploy from GitHub repo"

### **2. Connect Your Repository (1 minute)**
1. Select your Expresso repository
2. Railway will automatically detect it's a Python app
3. It will read your `Procfile` and `requirements.txt`

### **3. Add PostgreSQL Database (1 minute)**
1. In your Railway project dashboard
2. Click "New" → "Database" → "PostgreSQL"
3. Railway automatically sets `DATABASE_URL` environment variable
4. No manual configuration needed!

### **4. Configure Environment Variables (3 minutes)**

**CRITICAL: Set these in Railway's Environment Variables section:**

#### **Security & App Settings:**
```
SECRET_KEY=<paste freshly-generated 64-char hex string>
JWT_SECRET_KEY=<paste freshly-generated 64-char hex string>
DEBUG=False
TESTING_MODE=False
JWT_COOKIE_SECURE=True
LOG_LEVEL=INFO
```

To generate the two keys, run locally:
```bash
python3 -c "import secrets; print('SECRET_KEY=' + secrets.token_hex(32)); print('JWT_SECRET_KEY=' + secrets.token_hex(32))"
```

⚠ The two values that were previously committed in this file
(`bd3b…1b7c` / `c016…d019c`) are now in git history publicly and must
be regarded as compromised. Do not reuse them.

#### **Twilio Configuration (REPLACE WITH YOUR ACTUAL VALUES):**
```
TWILIO_ACCOUNT_SID=<from console.twilio.com → Account Info>
TWILIO_AUTH_TOKEN=<from console.twilio.com → Account Info>
TWILIO_PHONE_NUMBER=+61489263333
```

⚠ The old Account SID + Auth Token that were committed here
(`AC02d0…f3f2a` / `2d6f…2e69`) are likewise in git history publicly.
Rotate the auth token in the Twilio console before redeploying.

#### **CORS - UPDATE AFTER DEPLOYMENT:**
```
CORS_ALLOWED_ORIGINS=https://your-actual-app-name.railway.app
```

### **5. Deploy (2 minutes)**
1. Click "Deploy"
2. Railway will:
   - Install Python dependencies
   - Create PostgreSQL database
   - Set up environment variables
   - Start your app with `python run_server.py`

### **6. Get Your App URL**
1. Go to "Settings" → "Domains"
2. Your app will be available at: `https://your-app-name.railway.app`
3. Update the CORS_ALLOWED_ORIGINS environment variable with this URL

### **7. Test Your Deployment**
1. Visit: `https://your-app-name.railway.app/api/health`
2. Should return: `{"message": "API is healthy", "service": "expresso-api"}`
3. Visit: `https://your-app-name.railway.app` for the main app

## 🔧 **Post-Deployment Configuration**

### **Update Twilio Webhook URL:**
1. Go to Twilio Console → Phone Numbers
2. Update webhook URL to: `https://your-app-name.railway.app/sms`

### **Test SMS Integration:**
1. Send SMS to your Twilio number
2. Check Railway logs for webhook reception
3. Verify security audit logs are working

## 💰 **Railway Pricing**
- **Starter Plan**: $5/month
- **Includes**: PostgreSQL database, SSL, custom domain
- **No hidden costs**: Everything included

## 🛡️ **Security Features Active**
- ✅ All enterprise security features will work
- ✅ HTTPS automatically enabled
- ✅ Environment variables secure
- ✅ Database encrypted in transit
- ✅ Audit logging active
- ✅ Rate limiting working

## 📊 **Monitoring Your App**

### **Railway Dashboard:**
- View logs in real-time
- Monitor resource usage
- See deployment history

### **Application Logs:**
- Security audit: Available in Railway logs
- API access: Available in Railway logs
- Error tracking: Automatic

### **Health Check:**
- Railway automatically monitors `/api/health`
- App will restart if unhealthy

## 🚨 **Important Security Notes**

1. **Never commit real credentials** to your repository
2. **Always use Railway's environment variables** for sensitive data
3. **Update CORS_ALLOWED_ORIGINS** with your actual domain
4. **Change admin password** after first login
5. **Monitor security logs** regularly

## 🔄 **Continuous Deployment**
- Push to GitHub → Railway automatically deploys
- Zero-downtime deployments
- Rollback available if needed

## 🆘 **Troubleshooting**

### **Common Issues:**
1. **Build fails**: Check Python version in `runtime.txt`
2. **App won't start**: Check `Procfile` and `run_server.py`
3. **Database errors**: Verify `DATABASE_URL` is set by Railway
4. **CORS errors**: Update `CORS_ALLOWED_ORIGINS` with correct domain

### **Railway Logs:**
- Click "View Logs" in Railway dashboard
- Look for startup errors or security warnings

## 🎉 **You're Ready to Deploy!**

**Estimated total time: 10 minutes**
**Monthly cost: $5**
**Security level: Enterprise-grade A+**

Your Expresso Coffee Ordering System will be live and secure! ☕🛡️🚀
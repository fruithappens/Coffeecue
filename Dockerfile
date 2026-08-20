# Multi-stage Dockerfile to build React frontend and Python backend
FROM node:20-alpine as frontend-builder

# Set working directory for frontend
WORKDIR /app/frontend

# Copy package files
COPY ["Barista Front End/package*.json", "./"]

# Install dependencies. We DON'T pass --omit=dev because autoprefixer +
# postcss are in devDependencies but ARE needed at build time for Tailwind
# CSS processing. The final image only copies the compiled output (static/),
# so dev deps don't bloat the runtime image.
# Using `npm install` instead of `npm ci` to tolerate package-lock churn.
RUN npm install

# Copy frontend source
COPY ["Barista Front End/", "./"]

# Set environment to production
ENV NODE_ENV=production

# Disable CRA's eslint plugin during prod build.
# Why: our .eslintrc.json extends @typescript-eslint/recommended and applies
# TS rules (e.g. explicit-function-return-type) to .js files. With CI=true
# (which Railway often sets), those warnings become errors and brick the
# build. We rely on local lint during dev; prod build doesn't need it.
ENV DISABLE_ESLINT_PLUGIN=true
# Belt-and-braces: ensure CI is unset so even if the platform exports it,
# CRA doesn't treat warnings as errors.
ENV CI=false

# Build React app
RUN npm run build

# Backend stage
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY . .

# Copy built frontend from the previous stage
COPY --from=frontend-builder /app/frontend/build ./static

# Create logs directory
RUN mkdir -p logs

# Expose port
EXPOSE 5001

# Set environment variables
ENV PYTHONPATH=/app
ENV PORT=5001
ENV NODE_ENV=production

# Start command
# Serve with gunicorn, NOT run_server.py. run_server.py drives Werkzeug's
# DEVELOPMENT server, which froze production whenever one request blocked
# on an outbound call, and silently truncated large uploads. See wsgi.py.
# Shell form (not exec form) so ${PORT} is expanded by the shell.
CMD ["python", "run_server.py"]
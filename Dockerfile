# Multi-stage Dockerfile to build React frontend and Python backend
FROM node:18-alpine as frontend-builder

# Set working directory for frontend
WORKDIR /app/frontend

# Copy package files
COPY "Barista Front End/package*.json" ./

# Install dependencies
RUN npm ci --only=production

# Copy frontend source
COPY "Barista Front End/" ./

# Set environment to production
ENV NODE_ENV=production

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
CMD ["python", "run_server.py"]
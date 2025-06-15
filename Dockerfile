# Multi-stage build for React frontend and Python backend
FROM node:18-alpine AS frontend-builder

# Set working directory for frontend build
WORKDIR /frontend

# Copy frontend package files
COPY ["Barista Front End/package*.json", "./"]

# Install frontend dependencies
RUN npm ci --only=production

# Copy frontend source code
COPY ["Barista Front End/", "./"]

# Build React app for production
ENV NODE_ENV=production
RUN npm run build

# Python backend stage
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY . .

# Copy built frontend from the first stage
COPY --from=frontend-builder /frontend/build ./static

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
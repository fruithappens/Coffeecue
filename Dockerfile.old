# Backend-only deployment for now (skip frontend build to avoid complexity)
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies with optimizations
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

# Create static directory for frontend (can be added later)
RUN mkdir -p static

# Static files (React build) are copied from local static/ directory

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
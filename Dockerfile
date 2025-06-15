# Simplified single-stage build to avoid timeout
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies with optimizations
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Install Node.js for building frontend
RUN curl -fsSL https://deb.nodesource.com/setup_18.x | bash - && \
    apt-get install -y nodejs && \
    apt-get clean

# Copy backend application code
COPY . .

# Build React frontend
WORKDIR /app/Barista\ Front\ End
RUN npm ci --only=production && \
    NODE_ENV=production npm run build && \
    cp -r build/* /app/static/ && \
    cd /app && \
    rm -rf /app/Barista\ Front\ End/node_modules

# Return to app directory
WORKDIR /app

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
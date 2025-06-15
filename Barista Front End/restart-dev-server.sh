#!/bin/bash
# Script to restart the development server with cache cleared

echo "Clearing webpack cache..."
rm -rf node_modules/.cache

echo "Starting development server..."
npm start
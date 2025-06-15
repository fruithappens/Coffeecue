#!/bin/bash

# Project Setup and Initialization Script for Coffee Cue System

# Exit on any error
set -e

# Color codes
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if running in a virtual environment
if [[ -z "${VIRTUAL_ENV}" ]]; then
    echo -e "${YELLOW}Warning: Not running in a virtual environment. Consider activating venv first.${NC}"
fi

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# Check required dependencies
check_dependencies() {
    echo -e "${YELLOW}Checking system dependencies...${NC}"
    
    # Check Python
    if ! command_exists python3; then
        echo -e "${RED}Python 3 is not installed.${NC}"
        exit 1
    fi
    
    # Check pip
    if ! command_exists pip; then
        echo -e "${RED}pip is not installed.${NC}"
        exit 1
    fi
    
    # Check PostgreSQL
    if ! command_exists psql; then
        echo -e "${YELLOW}Warning: PostgreSQL is not installed.${NC}"
        echo -e "${YELLOW}You'll need to install and configure PostgreSQL manually.${NC}"
    fi
}

# Install Python dependencies
install_dependencies() {
    echo -e "${YELLOW}Installing Python dependencies...${NC}"
    pip install -r requirements.txt
}

# Initialize virtual environment
create_venv() {
    if [ ! -d "venv" ]; then
        echo -e "${YELLOW}Creating virtual environment...${NC}"
        python3 -m venv venv
    fi
}

# Create PostgreSQL database
create_database() {
    echo -e "${YELLOW}Creating PostgreSQL database...${NC}"
    
    # Prompt for database details
    read -p "Enter PostgreSQL username (default: $USER): " pg_user
    pg_user=${pg_user:-$USER}
    
    read -p "Enter database name (default: expresso): " db_name
    db_name=${db_name:-expresso}
    
    # Try to create database
    if psql -U "$pg_user" -lqt | cut -d \| -f 1 | grep -qw "$db_name"; then
        echo -e "${GREEN}Database '$db_name' already exists.${NC}"
    else
        createdb -U "$pg_user" "$db_name"
        echo -e "${GREEN}Database '$db_name' created successfully.${NC}"
    fi
}

# Initialize database with default settings
initialize_database() {
    echo -e "${YELLOW}Initializing database...${NC}"
    
    # Prompt for admin credentials
    read -p "Enter admin username (default: coffeecue): " admin_username
    admin_username=${admin_username:-coffeecue}
    
    read -p "Enter admin email (default: admin@example.com): " admin_email
    admin_email=${admin_email:-admin@example.com}
    
    read -sp "Enter admin password (min 8 characters): " admin_password
    echo  # Move to next line
    
    # Validate password
    while [ ${#admin_password} -lt 8 ]; do
        echo -e "${RED}Password must be at least 8 characters long.${NC}"
        read -sp "Enter admin password (min 8 characters): " admin_password
        echo  # Move to next line
    done
    
    # Run database initialization script
    python pg_init.py \
        --admin-username "$admin_username" \
        --admin-email "$admin_email" \
        --admin-password "$admin_password"
}

# Main setup function
main() {
    echo -e "${GREEN}Starting Coffee Cue System Setup${NC}"
    
    check_dependencies
    create_venv
    
    # Activate virtual environment
    source venv/bin/activate
    
    install_dependencies
    
    # Optional database setup
    read -p "Would you like to set up the PostgreSQL database? (y/n): " setup_db
    if [[ "$setup_db" =~ ^[Yy]$ ]]; then
        create_database
        initialize_database
    fi
    
    echo -e "${GREEN}Setup complete! 🎉${NC}"
    echo -e "To start the application:"
    echo -e "1. Activate the virtual environment: source venv/bin/activate"
    echo -e "2. Start the server: python app.py"
}

# Run the main function
main
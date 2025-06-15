#!/bin/bash
# Master test script for Expresso/Coffee Cue System
# Runs all test scripts and consolidates results

# Set colors for output
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Initialize results array
declare -A test_results

# Function to print a header
print_header() {
    echo
    echo -e "${BLUE}=============================================${NC}"
    echo -e "${BLUE} $1 ${NC}"
    echo -e "${BLUE}=============================================${NC}"
    echo
}

# Function to run and record test result
run_test() {
    local test_name="$1"
    local test_command="$2"
    
    echo -e "${YELLOW}Running ${test_name}...${NC}"
    
    # Run the command and capture its exit status
    eval "$test_command"
    local status=$?
    
    # Record the result
    if [ $status -eq 0 ]; then
        test_results["$test_name"]="PASSED"
        echo -e "${GREEN}${test_name} PASSED${NC}"
    else
        test_results["$test_name"]="FAILED"
        echo -e "${RED}${test_name} FAILED${NC}"
    fi
    
    echo
    return $status
}

# Check if the backend server is running
check_server() {
    print_header "CHECKING BACKEND SERVER"
    
    curl -s http://localhost:5001/api/status > /dev/null
    if [ $? -ne 0 ]; then
        echo -e "${RED}Backend server is not running at http://localhost:5001${NC}"
        echo -e "${YELLOW}Please start the server with: python run_server.py${NC}"
        exit 1
    else
        echo -e "${GREEN}Backend server is running at http://localhost:5001${NC}"
    fi
}

# Run API tests
run_api_tests() {
    print_header "RUNNING API TESTS"
    
    run_test "API Endpoints Test" "python test_api.py --all"
    run_test "Frontend-Backend Integration Test" "python test_frontend_backend_integration.py"
    run_test "Authentication Flow Test" "python test_auth_flow.py"
    run_test "JWT Configuration Test" "python test_jwt_config.py"
    run_test "CORS Configuration Test" "python test_cors.py"
    run_test "Inventory Endpoints Test" "python test_inventory_endpoints.py"
}

# Run frontend tests (using npm)
run_frontend_tests() {
    print_header "RUNNING FRONTEND TESTS"
    
    # Only run if we're in the directory containing package.json
    if [ -f "./Barista Front End/package.json" ]; then
        cd "Barista Front End"
        
        # Check if Jest is installed
        if grep -q "jest" package.json; then
            run_test "React Component Tests" "npm test -- --watchAll=false"
        else
            echo -e "${YELLOW}Jest not found in package.json, skipping frontend tests${NC}"
            test_results["React Component Tests"]="SKIPPED"
        fi
        
        # Check if Cypress is installed
        if [ -d "./cypress" ]; then
            run_test "End-to-End Tests" "npx cypress run"
        else
            echo -e "${YELLOW}Cypress not found, skipping end-to-end tests${NC}"
            test_results["End-to-End Tests"]="SKIPPED"
        fi
        
        cd ..
    else
        echo -e "${YELLOW}Frontend directory not found or incomplete, skipping frontend tests${NC}"
        test_results["React Component Tests"]="SKIPPED"
        test_results["End-to-End Tests"]="SKIPPED"
    fi
}

# Run database tests
run_database_tests() {
    print_header "RUNNING DATABASE TESTS"
    
    # These would be database-specific tests
    echo -e "${YELLOW}No specific database tests implemented yet${NC}"
    test_results["Database Tests"]="SKIPPED"
}

# Display test summary
show_summary() {
    print_header "TEST RESULTS SUMMARY"
    
    local passed=0
    local failed=0
    local skipped=0
    
    for test_name in "${!test_results[@]}"; do
        result=${test_results["$test_name"]}
        
        if [ "$result" == "PASSED" ]; then
            echo -e "${GREEN}✓ $test_name: $result${NC}"
            ((passed++))
        elif [ "$result" == "FAILED" ]; then
            echo -e "${RED}✗ $test_name: $result${NC}"
            ((failed++))
        else
            echo -e "${YELLOW}○ $test_name: $result${NC}"
            ((skipped++))
        fi
    done
    
    echo
    echo -e "Tests Run: $((passed + failed + skipped))"
    echo -e "${GREEN}Passed: $passed${NC}"
    echo -e "${RED}Failed: $failed${NC}"
    echo -e "${YELLOW}Skipped: $skipped${NC}"
    
    if [ $failed -gt 0 ]; then
        echo
        echo -e "${RED}Some tests failed!${NC}"
        exit 1
    else
        echo
        echo -e "${GREEN}All tests passed successfully!${NC}"
    fi
}

# Main execution
main() {
    print_header "EXPRESSO/COFFEE CUE SYSTEM TEST SUITE"
    
    # Check for command line arguments
    if [ "$1" == "--api-only" ]; then
        check_server
        run_api_tests
    elif [ "$1" == "--frontend-only" ]; then
        run_frontend_tests
    elif [ "$1" == "--db-only" ]; then
        check_server
        run_database_tests
    else
        # Run all tests
        check_server
        run_api_tests
        run_frontend_tests
        run_database_tests
    fi
    
    show_summary
}

# Run the main function with all arguments
main "$@"
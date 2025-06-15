#!/usr/bin/env python3

import os
import sys
import json
import sqlite3
import datetime
import re

# Configure paths
DB_PATH = None  # Will be detected automatically
OUTPUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "logs", "live_test")
OUTPUT_FILE = os.path.join(OUTPUT_DIR, "database-analysis.md")

def find_database_file():
    """Find SQLite database files in the current directory and subdirectories"""
    db_files = []
    
    # Start with the current directory
    base_dir = os.path.dirname(os.path.abspath(__file__))
    
    for root, dirs, files in os.walk(base_dir):
        for file in files:
            if file.endswith('.db') or file.endswith('.sqlite') or file.endswith('.sqlite3'):
                full_path = os.path.join(root, file)
                db_files.append(full_path)
    
    return db_files

def is_valid_sqlite_db(db_path):
    """Check if the file is a valid SQLite database"""
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT sqlite_version();")
        conn.close()
        return True
    except sqlite3.Error:
        return False

def get_table_names(conn):
    """Get all table names from the database"""
    cursor = conn.cursor()
    cursor.execute("SELECT name FROM sqlite_master WHERE type='table';")
    return [row[0] for row in cursor.fetchall()]

def get_table_structure(conn, table_name):
    """Get the column structure for a table"""
    cursor = conn.cursor()
    cursor.execute(f"PRAGMA table_info({table_name});")
    return cursor.fetchall()

def get_table_data(conn, table_name, limit=100):
    """Get sample data from a table"""
    cursor = conn.cursor()
    try:
        cursor.execute(f"SELECT * FROM {table_name} LIMIT {limit};")
        return cursor.fetchall()
    except sqlite3.Error as e:
        return [f"Error retrieving data: {e}"]

def analyze_data_for_patterns(rows, column_names):
    """Analyze table data for patterns indicating real vs. demo data"""
    analysis = {
        "total_rows": len(rows),
        "columns_with_names": [],
        "columns_with_emails": [],
        "columns_with_phones": [],
        "patterns": {}
    }
    
    # Regular expressions for common data types
    email_pattern = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    phone_pattern = re.compile(r'\d{3}[-.\s]?\d{3}[-.\s]?\d{4}')
    name_pattern = re.compile(r'\b[A-Z][a-z]+ [A-Z][a-z]+\b')
    
    # Demo data indicators
    demo_indicators = ['test', 'demo', 'sample', 'example', 'fake', 'dummy']
    
    for col_idx, col_name in enumerate(column_names):
        # Skip id columns and timestamps for pattern analysis
        if col_name.lower() == 'id' or 'id' in col_name.lower() or 'time' in col_name.lower() or 'date' in col_name.lower():
            continue
        
        col_values = [str(row[col_idx]) if col_idx < len(row) else "" for row in rows]
        
        # Check for emails
        emails = [val for val in col_values if email_pattern.search(str(val))]
        if emails:
            analysis["columns_with_emails"].append({
                "column": col_name,
                "examples": emails[:5]
            })
        
        # Check for phone numbers
        phones = [val for val in col_values if phone_pattern.search(str(val))]
        if phones:
            analysis["columns_with_phones"].append({
                "column": col_name,
                "examples": phones[:5]
            })
        
        # Check for names
        names = [val for val in col_values if name_pattern.search(str(val))]
        if names:
            analysis["columns_with_names"].append({
                "column": col_name,
                "examples": names[:5]
            })
        
        # Check for demo data indicators
        for indicator in demo_indicators:
            indicator_matches = [val for val in col_values if indicator.lower() in str(val).lower()]
            if indicator_matches:
                if indicator not in analysis["patterns"]:
                    analysis["patterns"][indicator] = []
                
                analysis["patterns"][indicator].append({
                    "column": col_name,
                    "examples": indicator_matches[:5]
                })
    
    return analysis

def analyze_database(db_path):
    """Analyze the database for potential real vs. demo data"""
    results = {
        "database_path": db_path,
        "analysis_time": datetime.datetime.now().isoformat(),
        "tables": {}
    }
    
    try:
        conn = sqlite3.connect(db_path)
        table_names = get_table_names(conn)
        
        for table_name in table_names:
            # Skip SQLite internal tables
            if table_name.startswith('sqlite_'):
                continue
                
            table_structure = get_table_structure(conn, table_name)
            column_names = [col[1] for col in table_structure]
            table_data = get_table_data(conn, table_name)
            
            data_analysis = analyze_data_for_patterns(table_data, column_names)
            
            results["tables"][table_name] = {
                "column_count": len(column_names),
                "columns": column_names,
                "row_count": data_analysis["total_rows"],
                "data_analysis": data_analysis
            }
        
        conn.close()
        return results
    
    except sqlite3.Error as e:
        return {
            "database_path": db_path,
            "error": str(e)
        }

def format_report_as_markdown(analysis_results):
    """Format the analysis results as a Markdown report"""
    report = f"# Database Analysis Report\n\n"
    report += f"**Analysis Time:** {analysis_results['analysis_time']}\n"
    report += f"**Database Path:** {analysis_results['database_path']}\n\n"
    
    report += "## Summary of Findings\n\n"
    
    potential_real_data = []
    demo_data_indicators = []
    
    # Collect findings across all tables
    for table_name, table_info in analysis_results["tables"].items():
        analysis = table_info["data_analysis"]
        
        # Check for potential real data
        if analysis["columns_with_names"] or analysis["columns_with_emails"] or analysis["columns_with_phones"]:
            potential_real_data.append(table_name)
        
        # Check for demo data indicators
        if analysis["patterns"]:
            demo_data_indicators.append(table_name)
    
    # Report summary findings
    if potential_real_data:
        report += "### Potential Real Data Detected\n\n"
        report += "The following tables contain patterns that might indicate real personal data:\n\n"
        for table in potential_real_data:
            report += f"- {table}\n"
        report += "\n"
    
    if demo_data_indicators:
        report += "### Demo Data Indicators\n\n"
        report += "The following tables contain indicators of demo/test data:\n\n"
        for table in demo_data_indicators:
            report += f"- {table}\n"
        report += "\n"
    
    # Detailed analysis per table
    report += "## Detailed Table Analysis\n\n"
    
    for table_name, table_info in analysis_results["tables"].items():
        report += f"### Table: {table_name}\n\n"
        report += f"**Columns:** {', '.join(table_info['columns'])}\n"
        report += f"**Row Count:** {table_info['row_count']}\n\n"
        
        analysis = table_info["data_analysis"]
        
        if analysis["columns_with_names"]:
            report += "#### Columns With Name Patterns\n\n"
            for col_info in analysis["columns_with_names"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["columns_with_emails"]:
            report += "#### Columns With Email Patterns\n\n"
            for col_info in analysis["columns_with_emails"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["columns_with_phones"]:
            report += "#### Columns With Phone Number Patterns\n\n"
            for col_info in analysis["columns_with_phones"]:
                report += f"- **{col_info['column']}**: Examples: {', '.join(col_info['examples'])}\n"
            report += "\n"
        
        if analysis["patterns"]:
            report += "#### Demo/Test Data Indicators\n\n"
            for pattern, pattern_infos in analysis["patterns"].items():
                report += f"**Pattern '{pattern}'**:\n\n"
                for info in pattern_infos:
                    report += f"- **{info['column']}**: Examples: {', '.join(info['examples'])}\n"
                report += "\n"
        
        report += "\n"
    
    return report

def main():
    print("Starting database analysis...")
    
    # Create output directory if it doesn't exist
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    # Find database files
    db_files = find_database_file()
    
    if not db_files:
        print("No database files found.")
        with open(OUTPUT_FILE, 'w') as f:
            f.write("# Database Analysis Report\n\nNo SQLite database files were found in the project directory.\n")
        return
    
    print(f"Found {len(db_files)} potential database files.")
    
    # Analyze each valid database
    valid_dbs = []
    for db_path in db_files:
        if is_valid_sqlite_db(db_path):
            valid_dbs.append(db_path)
            print(f"Valid SQLite database found: {db_path}")
    
    if not valid_dbs:
        print("No valid SQLite databases found.")
        with open(OUTPUT_FILE, 'w') as f:
            f.write("# Database Analysis Report\n\nNo valid SQLite database files were found in the project directory.\n")
        return
    
    # Analyze each database and generate a combined report
    combined_report = "# Combined Database Analysis Report\n\n"
    
    for db_path in valid_dbs:
        print(f"Analyzing database: {db_path}")
        analysis_results = analyze_database(db_path)
        report = format_report_as_markdown(analysis_results)
        
        # Save individual report
        db_name = os.path.basename(db_path)
        individual_report_path = os.path.join(OUTPUT_DIR, f"db-analysis-{db_name}.md")
        with open(individual_report_path, 'w') as f:
            f.write(report)
        print(f"Saved analysis for {db_name} to {individual_report_path}")
        
        # Add to combined report
        combined_report += f"# Analysis for {db_name}\n\n"
        combined_report += report
        combined_report += "\n---\n\n"
    
    # Save combined report
    with open(OUTPUT_FILE, 'w') as f:
        f.write(combined_report)
    
    print(f"Database analysis complete. Combined report saved to {OUTPUT_FILE}")

if __name__ == "__main__":
    main()

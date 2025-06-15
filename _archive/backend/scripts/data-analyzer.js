const fs = require('fs');
const path = require('path');

// Configuration
const sourceDirs = [
  path.join(__dirname, 'Barista Front End/src'),
  path.join(__dirname, 'services'),
  path.join(__dirname, 'routes')
];
const outputFile = path.join(__dirname, 'logs/live_test/hardcoded-data-analysis.md');

// Common name patterns to check for
const namePatterns = [
  /\b[A-Z][a-z]+ [A-Z][a-z]+\b/g,  // Basic First Last name pattern
  /\b[A-Z][a-z]+\b/g,              // First names
  /['"]name['"]\s*:\s*['"][A-Z][a-z]+['"]/g, // name: "Name" in JSON/objects
  /customerName\s*[:=]\s*['"][A-Z][a-z]+['"]/g, // customerName: "Name"
  /userName\s*[:=]\s*['"][A-Z][a-z]+['"]/g, // userName: "Name"
  /\bemail\s*[:=]\s*['"][^@]+@[^@]+\.[^@]+['"]/g, // email matches
  /\bphone\s*[:=]\s*['"][\d\s\-\(\)]+['"]/g, // phone number matches
];

// Ignore patterns (common false positives or legitimate uses)
const ignorePatterns = [
  /import/,  // Ignore import statements
  /from ['"]react['"]/,  // Ignore react imports
  /PropTypes\./,  // Ignore PropType definitions
  /\.defaultProps/,  // Ignore default props
  /\bif\s*\(/,  // Ignore if statements
  /\/\//,  // Ignore comments
  /\* /,  // Ignore JSDoc or multi-line comments
  /README/i,  // Ignore README files
  /CHANGELOG/i,  // Ignore CHANGELOG files
  /LICENSE/i,  // Ignore LICENSE files
  /console\.log\(/,  // Ignore console logs
  /Demo/,  // Ignore Demo data that's explicitly marked
  /Sample/,  // Ignore Sample data that's explicitly marked
  /Test/i,  // Ignore test-related content
  /Mock/i,  // Ignore mock data
  /placeholder/i,  // Ignore placeholders
  /example/i,  // Ignore examples
];

// Function to check if a line should be ignored
function shouldIgnore(line) {
  return ignorePatterns.some(pattern => pattern.test(line));
}

// Function to analyze a file for potential hardcoded data
function analyzeFile(filePath) {
  const fileContent = fs.readFileSync(filePath, 'utf8');
  const lines = fileContent.split('\n');
  const findings = [];

  lines.forEach((line, index) => {
    // Skip if line matches ignore patterns
    if (shouldIgnore(line)) return;

    // Check for potential names or personal data
    namePatterns.forEach(pattern => {
      const matches = line.match(pattern);
      if (matches) {
        matches.forEach(match => {
          findings.push({
            file: filePath,
            line: index + 1,
            content: line.trim(),
            match: match,
            pattern: pattern.toString()
          });
        });
      }
    });
  });

  return findings;
}

// Function to recursively scan directory
function scanDirectory(dir) {
  let findings = [];
  const files = fs.readdirSync(dir);

  files.forEach(file => {
    const filePath = path.join(dir, file);
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      // Skip node_modules and build directories
      if (file !== 'node_modules' && file !== 'build' && file !== 'dist' && !file.startsWith('.')) {
        findings = findings.concat(scanDirectory(filePath));
      }
    } else if (stats.isFile()) {
      // Only analyze JavaScript, JSX, TS, TSX, and Python files
      if (/\.(js|jsx|ts|tsx|py)$/.test(file)) {
        findings = findings.concat(analyzeFile(filePath));
      }
    }
  });

  return findings;
}

// Main function
function main() {
  console.log('Starting scan for potentially hardcoded data...');
  
  let allFindings = [];
  
  // Scan each source directory
  sourceDirs.forEach(dir => {
    if (fs.existsSync(dir)) {
      console.log(`Scanning ${dir}...`);
      const findings = scanDirectory(dir);
      allFindings = allFindings.concat(findings);
      console.log(`Found ${findings.length} potential issues in ${dir}`);
    } else {
      console.log(`Directory ${dir} does not exist, skipping`);
    }
  });
  
  // Create output directory if it doesn't exist
  const outputDir = path.dirname(outputFile);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  
  // Generate report
  let report = `# Hardcoded Data Analysis Report

## Summary
Total potential issues found: ${allFindings.length}

## Findings

`;

  // Group findings by file
  const fileGroups = {};
  allFindings.forEach(finding => {
    if (!fileGroups[finding.file]) {
      fileGroups[finding.file] = [];
    }
    fileGroups[finding.file].push(finding);
  });

  // Add findings to report
  Object.keys(fileGroups).forEach(file => {
    const relativePath = path.relative(__dirname, file);
    report += `### ${relativePath}\n\n`;
    
    fileGroups[file].forEach(finding => {
      report += `- Line ${finding.line}: \`${finding.match}\` in \`${finding.content}\`\n`;
    });
    
    report += '\n';
  });

  // Write report to file
  fs.writeFileSync(outputFile, report);
  console.log(`Analysis complete. Report written to ${outputFile}`);
}

// Run the analysis
main();

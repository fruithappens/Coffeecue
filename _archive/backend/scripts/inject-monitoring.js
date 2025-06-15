const fs = require('fs');
const path = require('path');

// Path to index.html
const indexHtmlPath = path.join(__dirname, 'Barista Front End/public/index.html');

// Check if index.html exists
if (!fs.existsSync(indexHtmlPath)) {
  console.error(`File not found: ${indexHtmlPath}`);
  process.exit(1);
}

// Read the file
console.log(`Reading ${indexHtmlPath}...`);
let indexHtmlContent = fs.readFileSync(indexHtmlPath, 'utf8');

// Check if monitoring script is already injected
if (indexHtmlContent.includes('console-capture.js')) {
  console.log('Monitoring script is already injected.');
  process.exit(0);
}

// Inject the monitoring script reference right before the closing </head> tag
const injectedScript = `  <script src="/console-capture.js"></script>
</head>`;
indexHtmlContent = indexHtmlContent.replace('</head>', injectedScript);

// Write the modified file
console.log(`Writing modified ${indexHtmlPath}...`);
fs.writeFileSync(indexHtmlPath, indexHtmlContent);

console.log('Successfully injected monitoring script into index.html');

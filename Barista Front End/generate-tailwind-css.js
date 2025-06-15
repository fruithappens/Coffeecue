// Run these commands to force regenerate your Tailwind CSS
// You can save this as a script and run it with node

const { execSync } = require('child_process');

console.log('Generating Tailwind CSS...');

try {
  // Generate a full Tailwind CSS file directly
  execSync('npx tailwindcss -i src/index.css -o src/tailwind.css');
  console.log('Successfully generated tailwind.css');
  
  // Copy over the generated file to index.css
  execSync('cp src/tailwind.css src/index.css');
  console.log('Copied to index.css');
  
  console.log('Done! Your Tailwind CSS has been regenerated.');
} catch (error) {
  console.error('Error generating Tailwind CSS:', error.message);
}

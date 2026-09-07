/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      // Design-system font, available as `font-cq`. NOT the default
      // `font-sans` yet: that flips every live screen, which waits for
      // Steve's approval of the component sheet (roadmap phase 3).
      fontFamily: {
        cq: ['Manrope', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { 'cq-sm': '6px', 'cq-md': '10px', 'cq-lg': '14px', 'cq-xl': '20px' },
      boxShadow: {
        'cq-card': '0 1px 2px rgba(59,35,20,0.06), 0 4px 14px rgba(59,35,20,0.08)',
        'cq-raised': '0 2px 4px rgba(59,35,20,0.08), 0 12px 32px rgba(59,35,20,0.14)',
      },
      colors: {
        // The caramel family + warm neutrals + the two attention colours.
        // Same values as src/design/tokens.css; utilities like bg-cq-caramel.
        cq: {
          roast: '#3B2314', 'roast-deep': '#2A1810',
          caramel: '#B8764A', 'caramel-deep': '#955A33', 'caramel-wash': '#F1E3D6',
          tan: '#C9A67A', cream: '#F6F1EA', milk: '#FFFFFF',
          ink: '#2A1F17', 'ink-2': '#5C4A3D', 'ink-3': '#8C7B6E', line: '#E6DCD0', wash: '#EFE7DC',
          ready: '#1F8A4C', 'ready-wash': '#DDF3E4', alert: '#C8372D', 'alert-wash': '#FBE3E0',
        },
        amber: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
      },
    },
  },
  plugins: [],
};
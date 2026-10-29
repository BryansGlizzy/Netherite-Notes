/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        obsidian: {
          bg: '#121317',
          sidebar: '#1c172d',
          border: '#2a2440',
          accent: '#7c3bed',
          text: '#e2e8f0',
          muted: '#94a3b8'
        }
      }
    }
  },
  plugins: [require('@tailwindcss/typography')]
};

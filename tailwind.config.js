/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', '"Microsoft YaHei UI"', '"Microsoft YaHei"', 'system-ui', 'sans-serif']
      },
      colors: {
        accent: {
          DEFAULT: '#6366f1',
          hover: '#4f46e5',
          soft: '#eef2ff',
          'soft-dark': '#312e8166'
        }
      },
      borderRadius: {
        card: '0.75rem'
      },
      boxShadow: {
        soft: '0 1px 3px rgba(0,0,0,.05), 0 4px 16px rgba(0,0,0,.06)',
        pop: '0 10px 44px rgba(0,0,0,.30)'
      },
      keyframes: {
        fadeIn: { from: { opacity: '0' }, to: { opacity: '1' } },
        slideUp: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        slideInRight: {
          from: { opacity: '0', transform: 'translateX(24px)' },
          to: { opacity: '1', transform: 'translateX(0)' }
        },
        pop: {
          '0%': { transform: 'scale(.6)' },
          '70%': { transform: 'scale(1.15)' },
          '100%': { transform: 'scale(1)' }
        }
      },
      animation: {
        fadeIn: 'fadeIn .18s ease-out',
        slideUp: 'slideUp .22s ease-out',
        slideInRight: 'slideInRight .22s ease-out',
        pop: 'pop .25s ease-out'
      }
    }
  },
  plugins: []
}

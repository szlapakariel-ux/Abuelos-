import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: { center: true, padding: '1rem' },
    extend: {
      colors: {
        brand: {
          DEFAULT: '#0F766E', // teal-700, color principal cálido y profesional
          50: '#F0FDFA',
          100: '#CCFBF1',
          500: '#14B8A6',
          600: '#0D9488',
          700: '#0F766E',
        },
        warn: '#F59E0B',
        danger: '#DC2626',
        ok: '#16A34A',
      },
      fontSize: {
        // tamaños grandes para UX de cuidadora
        'base': ['1.0625rem', '1.6'],
        'lg': ['1.25rem', '1.6'],
        'xl': ['1.5rem', '1.4'],
      },
      borderRadius: {
        lg: '0.75rem',
        xl: '1rem',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;

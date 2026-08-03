/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Sistema propio
        primary: '#4b84d0',
        'background-light': '#f5f7f8',
        'background-dark': '#040b1a',
        'surface-dark': '#132a52',
        'surface-darker': '#132a52',
        'border-dark': '#2a4d78',
        'text-primary': '#f0f4f8',
        'text-secondary': '#9fb1cd',
        'accent-success': '#3f9a75',
        'accent-warning': '#f59e0b',
        'accent-danger': '#cf5f6c',
        // shadcn/ui tokens (mapean al tema oscuro del sistema)
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      fontFamily: {
        display: ['Lexend', 'sans-serif'],
        sans: ['Lexend', 'sans-serif'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
        DEFAULT: '0.25rem',
        xl: '0.75rem',
        full: '9999px',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
        'fade-in': {
          from: { opacity: '0', transform: 'translateY(4px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'fade-out': {
          from: { opacity: '1', transform: 'translateY(0)' },
          to: { opacity: '0', transform: 'translateY(4px)' },
        },
        'slide-in-from-left': {
          from: { transform: 'translateX(-100%)' },
          to: { transform: 'translateX(0)' },
        },
        'slide-out-to-left': {
          from: { transform: 'translateX(0)' },
          to: { transform: 'translateX(-100%)' },
        },
        'import-shimmer': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(200%)' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
        'fade-in': 'fade-in 0.15s ease-out',
        'fade-out': 'fade-out 0.15s ease-in',
        'slide-in-from-left': 'slide-in-from-left 0.2s ease-out',
        'slide-out-to-left': 'slide-out-to-left 0.2s ease-in',
        'import-shimmer': 'import-shimmer 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [require('@tailwindcss/forms'), require('tailwindcss-animate')],
};


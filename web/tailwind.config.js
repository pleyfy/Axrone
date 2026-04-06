/** @type {import('tailwindcss').Config} */
export default {
    content: [
        './examples/**/*.{html,ts,tsx}',
    ],
    theme: {
        extend: {
            colors: {
                bg: {
                    primary: '#0d1117',
                    secondary: '#161b22',
                    tertiary: '#21262d',
                    elevated: '#30363d',
                },
                border: {
                    primary: '#30363d',
                    secondary: '#21262d',
                    accent: '#1f6feb',
                },
                text: {
                    primary: '#f0f6fc',
                    secondary: '#8b949e',
                    muted: '#6e7681',
                },
                accent: {
                    primary: '#1f6feb',
                    secondary: '#388bfd',
                    success: '#238636',
                    warning: '#d29922',
                    error: '#da3633',
                    purple: '#a371f7',
                },
            },
            fontFamily: {
                mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
                sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
            },
            boxShadow: {
                glow: '0 0 20px rgba(31, 111, 235, 0.3)',
            },
            animation: {
                pulse: 'pulse 1s infinite',
                spin: 'spin 0.8s linear infinite',
            },
            keyframes: {
                pulse: {
                    '0%, 100%': { opacity: '1' },
                    '50%': { opacity: '0.5' },
                },
                spin: {
                    to: { transform: 'rotate(360deg)' },
                },
            },
        },
    },
    plugins: [],
};

import { defineConfig } from 'vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';

export default defineConfig({
  root: '.',
  publicDir: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: { input: 'index.html' }
  },
  css: {
    postcss: {
      plugins: [
        tailwindcss({
          content: [
            './index.html',
            './ui.js',
            './online.js',
            './script.js',
            './server.js'
          ],
          theme: {
            extend: {
              fontFamily: {
                sans: ['"Noto Sans Armenian"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
                display: ['"Noto Serif Armenian"', 'serif']
              },
              colors: {
                neon: {
                  gold: '#ffd166', goldDeep: '#d4a017', green: '#22ff9c',
                  red: '#ff4d6d', blue: '#4cc9f0', purple: '#b794f6'
                },
                dark: {
                  950: '#050609', 900: '#0a0c12', 800: '#10131a',
                  700: '#161a24', 600: '#1e2432'
                },
                felt: {
                  950: '#041a10', 900: '#082e1c', 800: '#0d4429',
                  700: '#145a37', 600: '#1e7a4a', 500: '#2a9d63'
                }
              },
              boxShadow: {
                'neon-gold': '0 0 15px rgba(255,209,102,0.7), 0 0 40px rgba(255,209,102,0.3)',
                'neon-green': '0 0 15px rgba(34,255,156,0.7), 0 0 40px rgba(34,255,156,0.3)',
                'neon-red': '0 0 15px rgba(255,77,109,0.7), 0 0 40px rgba(255,77,109,0.3)',
                'glass': '0 8px 32px rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)',
                'premium': '0 20px 50px rgba(0,0,0,0.85), 0 8px 20px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)'
              },
              keyframes: {
                float: { '0%,100%': { transform: 'translateY(0) rotate(0deg)' }, '50%': { transform: 'translateY(-12px) rotate(3deg)' } },
                floatSlow: { '0%,100%': { transform: 'translateY(0) rotate(0deg)' }, '50%': { transform: 'translateY(-22px) rotate(-4deg)' } },
                pulseGlow: { '0%,100%': { boxShadow: '0 0 15px rgba(255,209,102,0.5), 0 0 40px rgba(255,209,102,0.2)' }, '50%': { boxShadow: '0 0 30px rgba(255,209,102,1), 0 0 80px rgba(255,209,102,0.6)' } },
                popIn: { '0%': { opacity: '0', transform: 'scale(0.85)' }, '60%': { opacity: '1', transform: 'scale(1.03)' }, '100%': { opacity: '1', transform: 'scale(1)' } },
                slideUp: { '0%': { opacity: '0', transform: 'translateY(30px)' }, '100%': { opacity: '1', transform: 'translateY(0)' } },
                bubbleIn: { '0%': { opacity: '0', transform: 'scale(0.3) translateY(20px)' }, '60%': { opacity: '1', transform: 'scale(1.1) translateY(0)' }, '100%': { opacity: '1', transform: 'scale(1) translateY(0)' } },
                cardDeal: { '0%': { opacity: '0', transform: 'translate(-200px,-200px) rotate(-40deg) scale(0.5)' }, '60%': { opacity: '1' }, '100%': { opacity: '1', transform: 'translate(0,0) rotate(0) scale(1)' } },
                cardPlay: { '0%': { opacity: '0', transform: 'translateY(80px) scale(0.7)' }, '60%': { opacity: '1', transform: 'translateY(-6px) scale(1.05)' }, '100%': { opacity: '1', transform: 'translateY(0) scale(1)' } },
                winGlow: { '0%,100%': { boxShadow: '0 0 20px rgba(255,209,102,0.7), 0 0 60px rgba(255,209,102,0.4)' }, '50%': { boxShadow: '0 0 40px rgba(255,209,102,1), 0 0 120px rgba(255,209,102,0.6)' } },
                gridMove: { '0%': { backgroundPosition: '0 0' }, '100%': { backgroundPosition: '60px 60px' } },
                auroraShift: { '0%,100%': { transform: 'translate(0,0) scale(1)' }, '50%': { transform: 'translate(-30px,20px) scale(1.1)' } },
                textShine: { '0%': { backgroundPosition: '-200% center' }, '100%': { backgroundPosition: '200% center' } },
                particleBurst: { '0%': { opacity: '1', transform: 'translate(-50%,-50%) translate(0,0) scale(1)' }, '100%': { opacity: '0', transform: 'translate(-50%,-50%) translate(var(--dx), var(--dy)) scale(0.2)' } }
              },
              animation: {
                'float': 'float 5s ease-in-out infinite',
                'float-slow': 'floatSlow 8s ease-in-out infinite',
                'pulse-glow': 'pulseGlow 2.5s ease-in-out infinite',
                'pop-in': 'popIn 0.35s cubic-bezier(0.34,1.56,0.64,1)',
                'slide-up': 'slideUp 0.5s cubic-bezier(0.22,1,0.36,1)',
                'bubble-in': 'bubbleIn 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                'card-deal': 'cardDeal 0.55s cubic-bezier(0.22,1,0.36,1)',
                'card-play': 'cardPlay 0.4s cubic-bezier(0.34,1.56,0.64,1)',
                'win-glow': 'winGlow 1.5s ease-in-out infinite',
                'grid-move': 'gridMove 20s linear infinite',
                'aurora': 'auroraShift 15s ease-in-out infinite',
                'text-shine': 'textShine 4s linear infinite'
              }
            }
          },
          plugins: []
        }),
        autoprefixer()
      ]
    }
  },
  server: {
    port: 3000,
    strictPort: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3001', ws: true, changeOrigin: true }
    }
  }
});
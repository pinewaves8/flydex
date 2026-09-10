/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      keyframes: {
        // 步骤从非完成→完成时,checkbox 缩放弹出
        checkPop: {
          '0%': { transform: 'scale(0.4)', opacity: '0' },
          '60%': { transform: 'scale(1.25)' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        // 进行中步骤的背景脉冲(蓝色 ring 慢呼吸)
        inProgressPulse: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(96 165 250 / 0.4)' },
          '50%': { boxShadow: '0 0 0 4px rgb(96 165 250 / 0)' },
        },
        // 整个 PlanCard 完成时的庆祝高亮
        completeGlow: {
          '0%': { boxShadow: '0 0 0 0 rgb(34 197 94 / 0.6)' },
          '100%': { boxShadow: '0 0 0 8px rgb(34 197 94 / 0)' },
        },
        // 进度条过渡(slide-in)
        progressFill: {
          from: { transform: 'scaleX(0)' },
          to: { transform: 'scaleX(1)' },
        },
      },
      animation: {
        'check-pop': 'checkPop 280ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        'progress-pulse': 'inProgressPulse 1.6s ease-in-out infinite',
        'complete-glow': 'completeGlow 800ms ease-out 1',
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        overlay: "hsl(var(--overlay))",
      },
      boxShadow: {
        card: "var(--shadow-card)",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: ["system-ui", "-apple-system", "sans-serif"],
        mono: ["JetBrains Mono", "Fira Code", "Consolas", "monospace"],
      },
    },
  },
  plugins: [],
};

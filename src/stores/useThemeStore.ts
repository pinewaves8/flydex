import { create } from 'zustand'

export type ThemeStyle = 'geek' | 'clean'
export type ThemeMode = 'dark' | 'light'

const STYLE_KEY = 'flydex.theme.style'
const MODE_KEY = 'flydex.theme.mode'

function loadStyle(): ThemeStyle {
  try {
    const s = localStorage.getItem(STYLE_KEY)
    if (s === 'geek' || s === 'clean') return s
  } catch {
    // ignore
  }
  return 'geek'
}

function loadMode(): ThemeMode {
  try {
    const m = localStorage.getItem(MODE_KEY)
    if (m === 'dark' || m === 'light') return m
  } catch {
    // ignore
  }
  return 'dark'
}

/** 把主题应用到 document（data-theme + .dark class） */
export function applyTheme(style: ThemeStyle, mode: ThemeMode) {
  const root = document.documentElement
  root.dataset.theme = style
  root.classList.toggle('dark', mode === 'dark')
}

interface ThemeState {
  style: ThemeStyle
  mode: ThemeMode
  setStyle: (style: ThemeStyle) => void
  setMode: (mode: ThemeMode) => void
  toggleStyle: () => void
  toggleMode: () => void
}

export const useThemeStore = create<ThemeState>((set, get) => ({
  style: loadStyle(),
  mode: loadMode(),

  setStyle: (style) => {
    try {
      localStorage.setItem(STYLE_KEY, style)
    } catch {
      // ignore
    }
    set({ style })
    applyTheme(style, get().mode)
  },

  setMode: (mode) => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // ignore
    }
    set({ mode })
    applyTheme(get().style, mode)
  },

  toggleStyle: () => {
    get().setStyle(get().style === 'geek' ? 'clean' : 'geek')
  },

  toggleMode: () => {
    get().setMode(get().mode === 'dark' ? 'light' : 'dark')
  },
}))

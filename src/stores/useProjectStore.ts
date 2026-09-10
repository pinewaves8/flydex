import { create } from 'zustand'

import { projectService } from '@/services/projectService'
import { sessionService } from '@/services/sessionService'
import { useCodexStore } from '@/stores/useCodexStore'
import type { ExportFormat, Project, SessionMeta, SessionSearchHit } from '@/types/project'

/** 持久化当前项目的 localStorage key */
const CURRENT_PROJECT_KEY = 'flydex.currentProjectId'

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  sessions: SessionMeta[]
  trashedSessions: SessionMeta[]
  searchHits: SessionSearchHit[]
  currentSessionId: string | null
  loading: boolean

  loadProjects: (baseDir?: string) => Promise<void>
  createProject: (name: string, path: string) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (id: string | null) => Promise<void>

  loadSessions: (projectId?: string) => Promise<void>
  createSession: (title: string, workdir: string, model?: string | null) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  setCurrentSession: (id: string | null) => void
  setSessionModel: (id: string, model: string | null) => Promise<void>

  trashSession: (id: string) => Promise<void>
  restoreSession: (id: string) => Promise<void>
  purgeSession: (id: string) => Promise<void>
  loadTrashed: () => Promise<void>
  forkSession: (id: string, messageIndex: number) => Promise<string>
  searchSessions: (query: string) => Promise<void>
  clearSearch: () => void
  exportSession: (id: string, format: ExportFormat) => Promise<string>
}

function loadPersistedProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY)
  } catch {
    return null
  }
}

function persistProjectId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(CURRENT_PROJECT_KEY, id)
    } else {
      localStorage.removeItem(CURRENT_PROJECT_KEY)
    }
  } catch {
    // localStorage 不可用时静默忽略
  }
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: loadPersistedProjectId(),
  sessions: [],
  trashedSessions: [],
  searchHits: [],
  currentSessionId: null,
  loading: false,

  loadProjects: async (baseDir?: string) => {
    set({ loading: true })
    try {
      const projects = await projectService.list()
      set({ projects })

      // 统一路径比较(忽略大小写 + 路径分隔符)
      const norm = (p: string) => p.toLowerCase().replace(/\\/g, '/').replace(/\/+$/, '')
      const normBase = baseDir ? norm(baseDir) : null

      // 优先级 1:baseDir(workspace cwd)对应的项目 —— 保证 cwd / project / session 三者一致
      if (normBase) {
        const matched = projects.find((p) => norm(p.path) === normBase)
        if (matched) {
          if (get().currentProjectId !== matched.id) {
            await get().setCurrentProject(matched.id)
          } else {
            await get().loadSessions(matched.id)
          }
          return
        }
      }

      // 优先级 2:持久化的项目(localStorage 中的 currentProjectId)
      const persistedId = loadPersistedProjectId()
      const currentId = get().currentProjectId

      if (persistedId && projects.some((p) => p.id === persistedId)) {
        if (currentId !== persistedId) {
          await get().setCurrentProject(persistedId)
        } else {
          await get().loadSessions(persistedId)
        }
        return
      }

      // 优先级 3:已加载的 currentProjectId 还在列表里
      if (currentId && projects.some((p) => p.id === currentId)) {
        await get().loadSessions(currentId)
        return
      }

      // 优先级 4:第一个项目
      if (projects.length > 0) {
        await get().setCurrentProject(projects[0].id)
      }
    } finally {
      set({ loading: false })
    }
  },

  createProject: async (name, path) => {
    const project = await projectService.create(name, path)
    set((state) => ({ projects: [...state.projects, project] }))
    return project
  },

  renameProject: async (id, name) => {
    const project = get().projects.find((p) => p.id === id)
    if (!project) return
    const updated = { ...project, name, updatedAt: Date.now() }
    await projectService.update(updated)
    set((state) => ({
      projects: state.projects.map((p) => (p.id === id ? updated : p)),
    }))
  },

  deleteProject: async (id) => {
    await projectService.delete(id)
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProjectId: state.currentProjectId === id ? null : state.currentProjectId,
      sessions: state.currentProjectId === id ? [] : state.sessions,
    }))
    if (get().currentProjectId === id) {
      persistProjectId(null)
    }
  },

  setCurrentProject: async (id) => {
    set({ currentProjectId: id })
    persistProjectId(id)

    if (id) {
      await get().loadSessions(id)
      const sessions = get().sessions
      const current = get().currentSessionId
      if (!current || !sessions.some((s) => s.id === current)) {
        const target = sessions[0]?.id ?? null
        set({ currentSessionId: target })
        void get().setCurrentSession(target)
      }
    } else {
      set({ sessions: [], currentSessionId: null })
      useCodexStore.getState().setCurrentSessionId(null)
    }
  },

  loadSessions: async (projectId) => {
    const pid = projectId ?? get().currentProjectId ?? undefined
    const sessions = await sessionService.list(pid)
    set({ sessions })
  },

  createSession: async (title, workdir, model) => {
    const projectId = get().currentProjectId ?? 'default'
    const session = await sessionService.create(projectId, title, workdir, model)
    set((state) => ({
      sessions: [session, ...state.sessions],
      currentSessionId: session.id,
    }))
    useCodexStore.getState().setCurrentSessionId(session.id)
    useCodexStore.getState().loadSession({ messages: [], threadId: null })
    return session.id
  },

  deleteSession: async (id) => {
    await sessionService.delete(id)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
      currentSessionId: state.currentSessionId === id ? null : state.currentSessionId,
    }))
  },

  renameSession: async (id, title) => {
    await sessionService.rename(id, title)
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
    }))
  },

  setCurrentSession: (id) => {
    set({ currentSessionId: id })
    if (id) {
      useCodexStore.getState().loadSession({ messages: [], threadId: null })
      void sessionService.load(id).then((session) => {
        if (session) {
          useCodexStore.getState().loadSession({
            messages: session.messages,
            threadId: session.threadId,
          })
        }
        useCodexStore.getState().setCurrentSessionId(id)
      })
    } else {
      useCodexStore.getState().setCurrentSessionId(null)
    }
  },

  setSessionModel: async (id, model) => {
    const loaded = await sessionService.load(id)
    if (!loaded) return
    const updated = { ...loaded, model, updatedAt: Date.now() }
    await sessionService.save(updated)
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, model } : s)),
    }))
  },

  trashSession: async (id) => {
    if (get().currentSessionId === id) {
      useCodexStore.getState().setCurrentSessionId(null)
      useCodexStore.getState().reset()
      set({ currentSessionId: null })
    }
    await sessionService.trash(id)
    set((state) => ({
      sessions: state.sessions.filter((s) => s.id !== id),
    }))
  },

  restoreSession: async (id) => {
    await sessionService.restore(id)
    await get().loadSessions()
    await get().loadTrashed()
  },

  purgeSession: async (id) => {
    await sessionService.delete(id)
    set((state) => ({
      trashedSessions: state.trashedSessions.filter((s) => s.id !== id),
    }))
  },

  loadTrashed: async () => {
    const trashed = await sessionService.listTrashed()
    set({ trashedSessions: trashed })
  },

  forkSession: async (id, messageIndex) => {
    const newSession = await sessionService.fork(id, messageIndex)
    await get().loadSessions()
    get().setCurrentSession(newSession.id)
    return newSession.id
  },

  searchSessions: async (query) => {
    if (!query.trim()) {
      set({ searchHits: [] })
      return
    }
    const hits = await sessionService.search(query)
    set({ searchHits: hits })
  },

  clearSearch: () => set({ searchHits: [] }),

  exportSession: async (id, format) => {
    return sessionService.export(id, format)
  },
}))

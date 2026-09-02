import { create } from 'zustand'

import { projectService } from '@/services/projectService'
import { sessionService } from '@/services/sessionService'
import { useCodexStore } from '@/stores/useCodexStore'
import type { ExportFormat, Project, SessionMeta, SessionSearchHit } from '@/types/project'

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  sessions: SessionMeta[]
  /** 回收站会话（软删除） */
  trashedSessions: SessionMeta[]
  /** 搜索结果 */
  searchHits: SessionSearchHit[]
  currentSessionId: string | null
  loading: boolean

  // 项目
  loadProjects: () => Promise<void>
  createProject: (name: string, path: string) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (id: string | null) => Promise<void>

  // 会话基础 CRUD
  loadSessions: (projectId?: string) => Promise<void>
  createSession: (title: string, workdir: string, model?: string | null) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  setCurrentSession: (id: string | null) => void
  /** 更新会话的模型覆盖并持久化 */
  setSessionModel: (id: string, model: string | null) => Promise<void>

  // 3.7 新增
  trashSession: (id: string) => Promise<void>
  restoreSession: (id: string) => Promise<void>
  /** 永久删除会话（从回收站） */
  purgeSession: (id: string) => Promise<void>
  loadTrashed: () => Promise<void>
  forkSession: (id: string, messageIndex: number) => Promise<string>
  searchSessions: (query: string) => Promise<void>
  clearSearch: () => void
  exportSession: (id: string, format: ExportFormat) => Promise<string>
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  sessions: [],
  trashedSessions: [],
  searchHits: [],
  currentSessionId: null,
  loading: false,

  // ── 项目 ──

  loadProjects: async () => {
    set({ loading: true })
    try {
      const projects = await projectService.list()
      set({ projects })
      // 如果没有当前项目，自动选第一个
      if (!get().currentProjectId && projects.length > 0) {
        await get().setCurrentProject(projects[0].id)
      } else if (get().currentProjectId) {
        await get().loadSessions(get().currentProjectId!)
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
  },

  setCurrentProject: async (id) => {
    set({ currentProjectId: id })
    if (id) {
      await get().loadSessions(id)
      // 确保当前会话指向该项目下有效的会话：
      // 切回原项目时保留其对话（指向第一个会话），无会话则清空
      const sessions = get().sessions
      const current = get().currentSessionId
      if (!current || !sessions.some((s) => s.id === current)) {
        set({ currentSessionId: sessions[0]?.id ?? null })
      }
    } else {
      set({ sessions: [], currentSessionId: null })
    }
  },

  // ── 会话 ──

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
    // 同步到 codex store（启用 autosave + 加载历史消息）
    if (id) {
      // 先清空当前 codex 状态，避免新会话加载前显示旧数据
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
    // 从完整会话加载后更新 model 字段再保存
    const loaded = await sessionService.load(id)
    if (!loaded) return
    const updated = { ...loaded, model, updatedAt: Date.now() }
    await sessionService.save(updated)
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, model } : s)),
    }))
  },

  // ── 3.7 新增 actions ──

  trashSession: async (id) => {
    // 如果是当前会话，先清空 codex store
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
    // 跳转到新会话
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

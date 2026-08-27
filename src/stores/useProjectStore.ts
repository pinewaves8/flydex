import { create } from 'zustand'

import { projectService } from '@/services/projectService'
import { sessionService } from '@/services/sessionService'
import type { Project, SessionMeta } from '@/types/project'

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  sessions: SessionMeta[]
  currentSessionId: string | null
  loading: boolean

  // 项目
  loadProjects: () => Promise<void>
  createProject: (name: string, path: string) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (id: string | null) => Promise<void>

  // 会话
  loadSessions: (projectId?: string) => Promise<void>
  createSession: (title: string, workdir: string) => Promise<string>
  deleteSession: (id: string) => Promise<void>
  renameSession: (id: string, title: string) => Promise<void>
  setCurrentSession: (id: string | null) => void
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  projects: [],
  currentProjectId: null,
  sessions: [],
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

  createSession: async (title, workdir) => {
    const projectId = get().currentProjectId ?? 'default'
    const session = await sessionService.create(projectId, title, workdir)
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
  },
}))

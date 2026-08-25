import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import type { Project, Session } from '@/types/project'

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  sessions: Session[]
  currentSessionId: string | null
  setCurrentProject: (id: string | null) => void
  setCurrentSession: (id: string | null) => void
  addProject: (project: Project) => void
  removeProject: (id: string) => void
  addSession: (session: Session) => void
}

export const useProjectStore = create<ProjectState>()(
  persist(
    (set) => ({
      projects: [],
      currentProjectId: null,
      sessions: [],
      currentSessionId: null,
      setCurrentProject: (id) => set({ currentProjectId: id }),
      setCurrentSession: (id) => set({ currentSessionId: id }),
      addProject: (project) => set((state) => ({ projects: [...state.projects, project] })),
      removeProject: (id) =>
        set((state) => ({ projects: state.projects.filter((p) => p.id !== id) })),
      addSession: (session) => set((state) => ({ sessions: [...state.sessions, session] })),
    }),
    { name: 'flydex-projects' },
  ),
)

import { create } from 'zustand'

import { turnsToMessages } from '@/features/codex/threadItems'
import { projectService } from '@/services/projectService'
import { sessionService } from '@/services/sessionService'
import { threadService } from '@/services/threadService'
import { useCodexStore } from '@/stores/useCodexStore'
import type { ExportFormat, Project, SessionMeta, SessionSearchHit } from '@/types/project'
import type { ThreadRow, ThreadTurn } from '@/types/thread'

/** 持久化当前项目的 localStorage key */
const CURRENT_PROJECT_KEY = 'flydex.currentProjectId'
/** 持久化当前会话(localStorage)。失效时回退到列表首项 */
const CURRENT_THREAD_KEY = 'flydex.currentThreadId'

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
  sessions: SessionMeta[]
  trashedSessions: SessionMeta[]
  searchHits: SessionSearchHit[]
  currentSessionId: string | null
  loading: boolean
  /** flydex project id → codex project id(由 sync_projects 回填) */
  projectMappings: Record<string, string>
  /** 项目归属同步中的非致命问题,由 UI 展示(codex 不可用等) */
  projectSyncWarnings: string[]

  /** 当前项目的会话(权威数据源是 codex `thread/list`) */
  threads: ThreadRow[]
  /** 回收站(archived=true 的线程) */
  archivedThreads: ThreadRow[]
  /** 当前打开的线程 id(就是 codex threadId) */
  currentThreadId: string | null
  /** 当前会话的模型覆盖(null = 跟随全局);持久化在 ~/.flydex/thread_settings.json */
  currentThreadModel: string | null
  /** 列表/打开过程中的非致命问题(第三原则:可见) */
  threadWarnings: string[]

  loadThreads: () => Promise<void>
  /** 新建会话:不落盘,只清空 —— 首次发消息时由 codex 建 thread(见 P4) */
  newThread: () => void
  /** 认领刚由 codex 建出的 thread(新会话首次发消息后) */
  adoptThread: (id: string) => Promise<void>
  loadArchivedThreads: () => Promise<void>
  setCurrentThread: (id: string | null) => Promise<void>
  /** 再往前翻一页(打开会话时首屏之外的更早历史) */
  loadEarlierTurns: () => Promise<void>
  renameThread: (id: string, name: string) => Promise<void>
  archiveThread: (id: string) => Promise<void>
  unarchiveThread: (id: string) => Promise<void>
  deleteThread: (id: string) => Promise<void>
  dismissThreadWarnings: () => void
  /** 切换会话级模型覆盖并持久化 */
  setThreadModel: (model: string | null) => Promise<void>
  /** 当前项目对应的 codex project id；未同步上时为 null */
  codexProjectId: () => string | null

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

function loadPersistedThreadId(): string | null {
  try {
    return localStorage.getItem(CURRENT_THREAD_KEY)
  } catch {
    return null
  }
}

function persistThreadId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(CURRENT_THREAD_KEY, id)
    } else {
      localStorage.removeItem(CURRENT_THREAD_KEY)
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
  projectMappings: {},
  projectSyncWarnings: [],
  threads: [],
  archivedThreads: [],
  currentThreadId: null,
  currentThreadModel: null,
  threadWarnings: [],

  loadProjects: async (baseDir?: string) => {
    set({ loading: true })
    try {
      const projects = await projectService.list()
      set({ projects })

      // 把 Flydex 项目同步到 codex `project/*`(三路匹配 + 已有线程归属回填)。
      // 幂等、可重复调用;失败不阻塞启动 —— 但问题**必须可见**(第三原则),
      // 所以收集进 projectSyncWarnings 由 UI 展示,而不是 console 里静默。
      try {
        const outcome = await threadService.syncProjects()
        set({
          projectMappings: outcome.mappings,
          projectSyncWarnings: outcome.warnings,
        })
      } catch (e) {
        set({ projectSyncWarnings: [`项目归属同步失败: ${String(e)}`] })
      }

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
            await get().loadThreads()
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
          await get().loadThreads()
        }
        return
      }

      // 优先级 3:已加载的 currentProjectId 还在列表里
      if (currentId && projects.some((p) => p.id === currentId)) {
        await get().loadThreads()
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
      await get().loadThreads()
      const threads = get().threads
      // 恢复上次打开的线程;它已不在本项目里(被删/改项目)则回退到列表首项 ——
      // 保证「项目 / 目录 / 会话」三者始终一致
      const persisted = loadPersistedThreadId()
      const current = get().currentThreadId
      const pick = (c: string | null) =>
        c && threads.some((t) => t.id === c) ? c : (threads[0]?.id ?? null)
      const target = pick(current) ?? pick(persisted)
      await get().setCurrentThread(target)
    } else {
      set({ threads: [], archivedThreads: [], currentSessionId: null })
      await get().setCurrentThread(null)
    }
  },

  // ── 会话(thread):权威数据源是 codex ──────────────────────────

  /** 当前项目对应的 codex project id(没同步上时为 null → 列出全部) */
  codexProjectId: () => {
    const { projectMappings, currentProjectId } = get()
    return currentProjectId ? (projectMappings[currentProjectId] ?? null) : null
  },

  loadThreads: async () => {
    const codexProjectId = get().codexProjectId()
    try {
      const threads = await threadService.list(false, codexProjectId)
      set({ threads })
    } catch (e) {
      set({ threadWarnings: [`读取会话列表失败: ${String(e)}`] })
      return
    }
    // 列表刷新后保证「当前会话」有效:没打开、或原先打开的已不在列表里(被删/改归档),
    // 就回退到上次打开的、再回退到首项 —— 项目 / 目录 / 会话三者始终一致
    const { threads } = get()
    const current = get().currentThreadId
    if (current && threads.some((t) => t.id === current)) return
    const persisted = loadPersistedThreadId()
    const pick =
      persisted && threads.some((t) => t.id === persisted) ? persisted : (threads[0]?.id ?? null)
    if (pick) await get().setCurrentThread(pick)
    else if (current) await get().setCurrentThread(null)
  },

  /**
   * 新建会话 = 清空当前状态
   *
   * **刻意不立刻建 thread**:codex 的 `thread/list` 会隐藏 `preview == ''` 的线程,
   * 提前建会留下一条点不开的空会话。等用户真发第一条消息时 `run()` 走 exec 分支
   * 自然建出来,那时才有 preview。
   */
  newThread: () => {
    set({ currentThreadId: null, currentThreadModel: null })
    persistThreadId(null)
    const codex = useCodexStore.getState()
    codex.reset()
    codex.setThreadId(null)
  },

  /**
   * 认领刚建出的 thread,并把它归入当前项目
   *
   * 归属放在这里(本轮结束)而不是 `thread/start` 之后:刚建出的线程还没落盘,
   * 那时写 `thread/metadata/update` 会被随后开始的 turn 覆盖(已实测)。
   */
  adoptThread: async (id) => {
    set({ currentThreadId: id })
    persistThreadId(id)
    const codexProjectId = get().codexProjectId()
    if (!codexProjectId) return
    try {
      await threadService.setProject(id, codexProjectId)
    } catch (e) {
      set({ threadWarnings: [`新会话未能归入当前项目: ${String(e)}`] })
    }
  },

  /**
   * 切模型只改偏好,不新建 thread —— 每轮 resume 都会把新 config 下发给 codex,
   * 不需要靠"换模型=换会话"来绕开跨模型 resume 的警告。
   */
  setThreadModel: async (model) => {
    const id = get().currentThreadId
    set({ currentThreadModel: model })
    if (!id) return
    try {
      await threadService.setModel(id, model)
    } catch (e) {
      set({ threadWarnings: [`保存模型选择失败: ${String(e)}`] })
    }
  },

  loadArchivedThreads: async () => {
    try {
      const archivedThreads = await threadService.list(true, get().codexProjectId())
      set({ archivedThreads })
    } catch (e) {
      set({ threadWarnings: [`读取回收站失败: ${String(e)}`] })
    }
  },

  /**
   * 打开线程:从 codex 的 turns 重建消息
   *
   * 这是「打开会话」的主路径 —— 消息不再来自 Flydex 自己的 session 文件,
   * 而是每次从 codex 拉取,所以重启/换机器后内容一致。
   */
  setCurrentThread: async (id) => {
    set({ currentThreadId: id })
    persistThreadId(id)
    const codex = useCodexStore.getState()
    if (!id) {
      codex.reset()
      set({ currentThreadModel: null })
      return
    }
    // 先清空,避免上一个会话的消息残留(标题/滚动都会串)
    codex.reset()
    // 恢复该会话的模型覆盖(与消息并行拉取,失败不影响打开会话)
    void threadService
      .getSettings(id)
      .then((s) => {
        // 竞态保护:期间用户可能又切了会话
        if (get().currentThreadId === id) set({ currentThreadModel: s.model })
      })
      .catch((e) => {
        set({ threadWarnings: [`读取会话偏好失败: ${String(e)}`] })
      })
    try {
      const [turns, cursor] = await threadService.loadTurns(id)
      const { messages, turns: metas } = turnsToMessages(turns as ThreadTurn[])
      useCodexStore.getState().loadThread({
        threadId: id,
        messages,
        turns: metas,
        cursor,
      })
    } catch (e) {
      set({ threadWarnings: [`打开会话失败: ${String(e)}`] })
    }
  },

  loadEarlierTurns: async () => {
    const id = get().currentThreadId
    const cursor = useCodexStore.getState().turnsCursor
    if (!id || !cursor) return
    try {
      const [turns, next] = await threadService.loadEarlierTurns(id, cursor)
      const { messages, turns: metas } = turnsToMessages(turns as ThreadTurn[])
      useCodexStore.getState().prependTurns({ messages, turns: metas, cursor: next })
    } catch (e) {
      set({ threadWarnings: [`加载更早的对话失败: ${String(e)}`] })
    }
  },

  renameThread: async (id, name) => {
    try {
      await threadService.rename(id, name)
      set((state) => ({
        threads: state.threads.map((t) => (t.id === id ? { ...t, name } : t)),
      }))
    } catch (e) {
      set({ threadWarnings: [`重命名失败: ${String(e)}`] })
    }
  },

  archiveThread: async (id) => {
    if (get().currentThreadId === id) {
      await get().setCurrentThread(null)
    }
    try {
      await threadService.archive(id)
      set((state) => ({ threads: state.threads.filter((t) => t.id !== id) }))
      await get().loadArchivedThreads()
    } catch (e) {
      set({ threadWarnings: [`移入回收站失败: ${String(e)}`] })
    }
  },

  unarchiveThread: async (id) => {
    try {
      await threadService.unarchive(id)
      set((state) => ({ archivedThreads: state.archivedThreads.filter((t) => t.id !== id) }))
      await get().loadThreads()
    } catch (e) {
      set({ threadWarnings: [`恢复失败: ${String(e)}`] })
    }
  },

  /**
   * 永久删除(codex `thread/delete`,不可逆)
   *
   * 被分支引用时 codex 会拒绝 —— 错误**必须让用户看到**(第三原则),不能静默失败。
   */
  deleteThread: async (id) => {
    try {
      await threadService.delete(id)
      set((state) => ({ archivedThreads: state.archivedThreads.filter((t) => t.id !== id) }))
    } catch (e) {
      set({ threadWarnings: [`永久删除失败: ${String(e)}`] })
    }
  },

  dismissThreadWarnings: () => set({ threadWarnings: [] }),

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

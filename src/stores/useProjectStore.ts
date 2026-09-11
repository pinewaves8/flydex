import { create } from 'zustand'

import { renderExport } from '@/features/codex/threadExport'
import { isCompactedTurns, turnsToMessages } from '@/features/codex/threadItems'
import { projectService } from '@/services/projectService'
import { sessionService } from '@/services/sessionService'
import { threadService } from '@/services/threadService'
import { useCodexStore } from '@/stores/useCodexStore'
import type { ExportFormat, Project, SessionMeta } from '@/types/project'
import { isInsidePath } from '@/types/thread'
import type { ThreadRow, ThreadTurn } from '@/types/thread'

/** 持久化当前项目的 localStorage key */
const CURRENT_PROJECT_KEY = 'flydex.currentProjectId'
/** 持久化当前会话(localStorage)。失效时回退到列表首项 */
const CURRENT_THREAD_KEY = 'flydex.currentThreadId'
/** 跳转到搜索命中时,最多往前翻多少页 turns(每页 20 轮) */
const MAX_REVEAL_PAGES = 10
/** 压缩的轮询间隔与上限(压缩是一次模型调用,以分钟计) */
const COMPACT_POLL_MS = 3000
const COMPACT_MAX_POLLS = 100

interface ProjectState {
  projects: Project[]
  currentProjectId: string | null
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
  /**
   * 迁移前的老会话(没有 threadId,内容无法从 codex 侧读到)
   *
   * 只读归档:能看、能导出,但不参与对话 —— 它们的消息没有用户侧内容
   * (早年 Flydex 只落 AI 侧日志),注入回 codex 会产生畸形上下文。
   */
  legacySessions: SessionMeta[]
  /** 当前打开的线程 id(就是 codex threadId) */
  currentThreadId: string | null
  /** 当前会话的模型覆盖(null = 跟随全局);持久化在 ~/.flydex/thread_settings.json */
  currentThreadModel: string | null
  /** 正在压缩上下文(压缩是完整模型调用,以分钟计) */
  compacting: boolean
  /** 列表/打开过程中的非致命问题(第三原则:可见) */
  threadWarnings: string[]

  loadThreads: () => Promise<void>
  /** 新建会话:不落盘,只清空 —— 首次发消息时由 codex 建 thread(见 P4) */
  newThread: () => void
  /** 认领刚由 codex 建出的 thread(新会话首次发消息后) */
  adoptThread: (id: string) => Promise<void>
  loadArchivedThreads: () => Promise<void>
  /** 载入迁移前的老会话(只读归档) */
  loadLegacySessions: () => Promise<void>
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
  /** 从某一轮之后分叉出新会话,并切换过去 */
  forkThreadAtTurn: (turnId: string) => Promise<void>
  /** 压缩当前会话的上下文(codex 原生;会重写历史) */
  compactCurrentThread: () => Promise<void>
  /** 回退到某一轮之前(丢弃其后的所有轮次;**不会撤销文件改动**) */
  revertToTurn: (turnId: string) => Promise<void>
  /** 打开命中的会话并滚动定位到具体那一条(搜索结果跳转用) */
  revealSearchHit: (threadId: string, query: string) => Promise<void>
  /** 导出某个会话(自行拉全量历史后渲染) */
  exportThread: (threadId: string, format: ExportFormat) => Promise<string>
  /** 当前项目对应的 codex project id；未同步上时为 null */
  codexProjectId: () => string | null

  loadProjects: (baseDir?: string) => Promise<void>
  createProject: (name: string, path: string) => Promise<Project>
  renameProject: (id: string, name: string) => Promise<void>
  deleteProject: (id: string) => Promise<void>
  setCurrentProject: (id: string | null) => Promise<void>

  setCurrentSession: (id: string | null) => void

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
  compacting: false,
  legacySessions: [],
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
        // 归属是**写 codex 数据**的操作(只对未归属的线程做一次),所以要让它可见,
        // 而不是悄悄改完。之后每次启动都是 0,不会再打扰。
        const notices = [...outcome.warnings]
        if (outcome.attributedByCwd > 0) {
          notices.unshift(
            `已把 ${outcome.attributedByCwd} 条历史会话按工作目录归入对应项目(仅此一次)。`,
          )
        }
        set({
          projectMappings: outcome.mappings,
          projectSyncWarnings: notices,
        })
      } catch (e) {
        set({ projectSyncWarnings: [`项目归属同步失败: ${String(e)}`] })
      }

      // 旧会话(只读归档)与线程并行加载 —— 很小,且失败不影响启动
      void get().loadLegacySessions()

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

  /**
   * 删除项目(**连带删除该项目下的全部会话**)
   *
   * 会话有删不掉时后端会保留 project 与本地条目,这里据实提示、不做乐观删除 ——
   * 否则用户会以为删干净了,实际留下无归属孤儿。
   */
  deleteProject: async (id) => {
    const outcome = await projectService.delete(id)
    if (!outcome.projectDeleted) {
      set({
        threadWarnings: [
          `项目未删除:有 ${outcome.failures.length} 个会话删不掉 —— ${outcome.failures.join(';')}`,
        ],
      })
      // 刷新一次,把已删掉的会话从列表里去掉
      await get().loadThreads()
      return
    }
    const wasCurrent = get().currentProjectId === id
    set((state) => ({
      projects: state.projects.filter((p) => p.id !== id),
      currentProjectId: wasCurrent ? null : state.currentProjectId,
      // 本地映射也失效了(后端已清),从缓存里去掉 —— 否则它会被当成"已同步"
      projectMappings: Object.fromEntries(
        Object.entries(state.projectMappings).filter(([k]) => k !== id),
      ),
    }))
    if (wasCurrent) {
      persistProjectId(null)
      await get().setCurrentThread(null)
      set({ threads: [], archivedThreads: [] })
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
    const projectPath = get().projects.find((p) => p.id === get().currentProjectId)?.path
    try {
      // **不加 projectId 过滤**:大量历史会话(exec 时代)没有归属,只按 projectId
      // 过滤会让它们彻底消失(实测飞书目录下 100+ 条只剩 1 条可见)。
      // 改为拉全量后在前端按「归属该项目 或 cwd 落在项目目录树内」收录。
      const all = await threadService.list(false, null)
      const threads = all.filter(
        (t) =>
          (codexProjectId && t.projectId === codexProjectId) ||
          (projectPath && isInsidePath(t.cwd, projectPath)),
      )
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
   * 导出会话内容
   *
   * codex 没有导出接口,所以这里自己把**全部**轮次拉下来(不是只导当前这一页),
   * 再用与界面同一份映射渲染 —— 见 features/codex/threadExport.ts。
   */
  exportThread: async (threadId, format) => {
    const thread = get().threads.find((t) => t.id === threadId)
    if (!thread) throw new Error('找不到该会话')
    const turns = await threadService.loadAllTurns(threadId)
    const { messages } = turnsToMessages(turns as ThreadTurn[])
    return renderExport(format, thread, messages)
  },

  /**
   * 打开某个会话,并滚动定位到查询命中的那一条
   *
   * 定位分两层,但**第二层在当前 codex 上不可用**:
   * `thread/searchOccurrences` 在 0.149.1 里直接返回
   * `thread/searchOccurrences is not supported yet`(协议里有、服务端没实现,
   * 实测)。所以这里以「本地匹配已加载消息」为准,codex 的接口只当作可选增强 ——
   * 哪天它实现了,不用改这里的调用方。
   *
   * 命中可能落在还没加载的更早分页里,故一页页往前翻直到出现或翻完;翻不动时
   * **明说**(第三原则),否则用户只会看到"打开了会话却停在别处"。
   */
  revealSearchHit: async (threadId, query) => {
    await get().setCurrentThread(threadId)
    const needle = query.trim().toLowerCase()
    if (!needle) return

    const locate = () =>
      useCodexStore.getState().messages.find((m) => m.content.toLowerCase().includes(needle))?.id ??
      null

    let itemId = locate()
    if (!itemId) {
      // codex 的二级接口(有则用;实测未实现,失败即忽略,不影响下面的本地匹配)
      try {
        const occurrences = await threadService.searchOccurrences(threadId, query, 50)
        itemId = occurrences[0]?.itemId ?? null
      } catch {
        itemId = null
      }
    }
    if (!itemId) {
      for (let i = 0; i < MAX_REVEAL_PAGES; i++) {
        if (!useCodexStore.getState().turnsCursor) break
        await get().loadEarlierTurns()
        itemId = locate()
        if (itemId) break
      }
    }

    if (itemId) {
      useCodexStore.getState().setPendingScrollToMessageId(itemId)
      return
    }
    const exhausted = !useCodexStore.getState().turnsCursor
    set({
      threadWarnings: [
        exhausted
          ? `已打开会话,但没有找到包含「${query}」的内容(可能已被压缩或删除)。`
          : `「${query}」在更早的历史里,已往前翻 ${MAX_REVEAL_PAGES} 页仍未到 —— 可在会话里继续往上翻。`,
      ],
    })
  },

  /**
   * 回退到某一轮之前(codex `thread/revert`)
   *
   * **只回退对话历史,不撤销工作区文件改动** —— 与 Claude Code 的 rewind 不同,
   * 所以调用方(UI)必须先把这点讲清楚再让用户点。
   * 同步接口,返回后重新拉一次即可。
   */
  revertToTurn: async (turnId) => {
    const id = get().currentThreadId
    if (!id) return
    try {
      await threadService.revert(id, turnId)
      await get().setCurrentThread(id)
    } catch (e) {
      set({ threadWarnings: [`回退失败: ${String(e)}`] })
    }
  },

  /**
   * 压缩当前会话的上下文(codex `thread/compact/start`)
   *
   * 两点必须知道:
   * 1. **压缩会重写历史** —— 旧轮次全部消失,只剩一条摘要消息(这是 codex 的语义)
   * 2. **没有完成通知** —— `thread/compacted` 对 v2 客户端不发(源码标注 deprecated),
   *    只能轮询「历史是否已被重写成摘要」来判断结束。压缩是一次完整模型调用,
   *    耗时以分钟计,所以轮询窗口给得比较宽。
   */
  compactCurrentThread: async () => {
    const id = get().currentThreadId
    if (!id) return
    set({ compacting: true })
    try {
      await threadService.compact(id)
      let finished = false
      for (let i = 0; i < COMPACT_MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, COMPACT_POLL_MS))
        const [turns] = await threadService.loadTurns(id)
        if (isCompactedTurns(turns as ThreadTurn[])) {
          finished = true
          break
        }
      }
      if (!finished) {
        // 超时不等于失败:压缩在服务端继续跑。但要明说,否则用户会以为没生效
        set({
          threadWarnings: ['压缩比预期慢,仍在后台继续。过一会儿重开会话即可看到摘要(不必重试)。'],
        })
      }
      await get().setCurrentThread(id)
    } catch (e) {
      set({ threadWarnings: [`压缩失败: ${String(e)}`] })
    } finally {
      set({ compacting: false })
    }
  },

  /**
   * 在某一轮之后分叉出新会话
   *
   * 与以前的「按消息序号切片」不同:分叉点是**轮**,turnId 直接从渲染数据里就有,
   * 不需要额外推算。codex 侧会复制该轮之前的完整上下文。
   */
  forkThreadAtTurn: async (turnId) => {
    const id = get().currentThreadId
    if (!id) return
    const thread = get().threads.find((t) => t.id === id)
    try {
      const outcome = await threadService.fork(id, turnId, {
        cwd: thread?.cwd,
        projectId: get().codexProjectId(),
        model: get().currentThreadModel,
      })
      if (outcome.warning) set({ threadWarnings: [outcome.warning] })
      await get().loadThreads()
      await get().setCurrentThread(outcome.threadId)
    } catch (e) {
      set({ threadWarnings: [`分叉失败: ${String(e)}`] })
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

  /**
   * 载入迁移前的老会话
   *
   * 只用 `~/.flydex/sessions/*.json`(**只读**,它们是这些内容的唯一副本)。
   * 有 threadId 的那些已经在主线列表里了,这里只留没有的,避免同一段对话出现两次。
   */
  loadLegacySessions: async () => {
    try {
      const all = await sessionService.list()
      set({ legacySessions: all.filter((s) => !s.threadId) })
    } catch (e) {
      set({ threadWarnings: [`读取旧会话失败: ${String(e)}`] })
    }
  },

  loadArchivedThreads: async () => {
    const codexProjectId = get().codexProjectId()
    const projectPath = get().projects.find((p) => p.id === get().currentProjectId)?.path
    try {
      const all = await threadService.list(true, null)
      const archivedThreads = all.filter(
        (t) =>
          (codexProjectId && t.projectId === codexProjectId) ||
          (projectPath && isInsidePath(t.cwd, projectPath)),
      )
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
   * 连同 fork 出的后代一起删(codex 不级联,只删父会留下孤儿分支)。
   * **部分失败也要逐条报出来**(第三原则):静默吞掉会让人以为清理干净了。
   */
  deleteThread: async (id) => {
    try {
      const outcome = await threadService.delete(id)
      const gone = new Set(outcome.deleted)
      set((state) => {
        const warnings = [...state.threadWarnings]
        if (outcome.failures.length > 0) {
          warnings.push(
            `有 ${outcome.failures.length} 个会话未能删除:${outcome.failures.join(';')}`,
          )
        }
        return {
          archivedThreads: state.archivedThreads.filter((t) => !gone.has(t.id)),
          threads: state.threads.filter((t) => !gone.has(t.id)),
          currentThreadId:
            state.currentThreadId && gone.has(state.currentThreadId) ? null : state.currentThreadId,
          threadWarnings: warnings,
        }
      })
    } catch (e) {
      set({ threadWarnings: [`永久删除失败: ${String(e)}`] })
    }
  },

  dismissThreadWarnings: () => set({ threadWarnings: [] }),

  setCurrentSession: (id) => {
    // 旧会话没有 threadId:把当前线程清掉,否则侧边栏会高亮着另一个会话
    set({ currentSessionId: id, currentThreadId: null })
    if (id) persistThreadId(null)
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

  exportSession: async (id, format) => {
    return sessionService.export(id, format)
  },
}))

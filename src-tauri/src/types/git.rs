use serde::{Deserialize, Serialize};

/// 文件变更状态
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChangeState {
    /// 未跟踪
    Untracked,
    /// 新增（已暂存）
    Added,
    /// 修改（未暂存）
    Modified,
    /// 已暂存修改
    Staged,
    /// 已暂存后又有未暂存修改
    StagedModified,
    /// 删除
    Deleted,
    /// 重命名
    Renamed,
}

/// diff hunk（统一 diff 中的一个 @@ 块）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffHunk {
    /// hunk 头，如 "@@ -1,3 +1,4 @@"
    pub header: String,
    /// hunk 的完整内容（含 header 行）
    pub content: String,
    /// hunk 在 diff 中的起始行号（用于定位）
    pub start_line: usize,
}

/// 单个文件的变更信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChange {
    /// 文件路径（相对仓库根）
    pub path: String,
    /// 变更状态
    pub state: ChangeState,
    /// 是否已暂存
    pub staged: bool,
    /// 该文件是否还有未暂存的修改
    pub unstaged: bool,
    /// 新增行数（仅显示用）
    pub insertions: usize,
    /// 删除行数（仅显示用）
    pub deletions: usize,
    /// 文件对应的 hunk 列表（未暂存部分）
    pub hunks: Vec<DiffHunk>,
}

/// Git 状态快照
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitStatus {
    /// 当前分支名（detached HEAD 时为 "HEAD (detached)"）
    pub branch: String,
    /// 当前分支是否为 detached
    pub detached: bool,
    /// 变更文件列表
    pub changes: Vec<FileChange>,
    /// 是否有未推送的提交（ahead 数）
    pub ahead: i32,
    /// 是否有未拉取的提交（behind 数）
    pub behind: i32,
}

/// 分支信息
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitBranch {
    /// 分支名
    pub name: String,
    /// 是否为当前分支
    pub current: bool,
    /// 该分支相对 HEAD 的提交描述（如 "ahead 2"）
    pub description: String,
}

/// 提交结果
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CommitResult {
    /// 提交的短哈希
    pub hash: String,
    /// 提交信息
    pub message: String,
}

/// Git 远端
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitRemote {
    /// 远端名（如 origin）
    pub name: String,
    /// fetch URL
    pub url: String,
}

/// 提交记录（历史列表项）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitCommit {
    /// 完整 hash
    pub hash: String,
    /// 短 hash（7 位）
    pub short_hash: String,
    /// 作者名
    pub author: String,
    /// 提交时间（unix 秒）
    pub timestamp: i64,
    /// 提交信息首行
    pub summary: String,
}

/// 文件变更摘要（对话流"文件变更卡片"兜底用，来自 git status）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileChangeBrief {
    /// 文件路径（相对仓库根）
    pub path: String,
    /// 变更类型：add（新增/未跟踪）| update（修改）| delete（删除）
    pub kind: String,
}

/// 同步操作结果（push/pull/fetch）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitSyncResult {
    /// 是否成功
    pub ok: bool,
    /// 操作输出（git 的 stdout/stderr 合并，用于展示）
    pub message: String,
}

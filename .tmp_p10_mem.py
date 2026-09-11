"""按行定位删掉 compact_summary(正则版本没匹配对,不改正则了)。"""
import io

P = r'C:\llm\flydex\src-tauri\src\commands\memory.rs'
lines = io.open(P, encoding='utf-8').read().split('\n')

# 起点:该函数上方的文档注释
start = next(
    i for i, l in enumerate(lines)
    if l.startswith('/// 把会话文本压缩成上下文快照摘要')
)
# 终点:其后第一个顶格 '}' 行
end = next(i for i in range(start, len(lines)) if lines[i] == '}')

# 连同后面的空行一起删
while end + 1 < len(lines) and lines[end + 1].strip() == '':
    end += 1

del lines[start:end + 1]
s = '\n'.join(lines)

if 'compact_summary' in s or 'COMPACT_SYSTEM' in s:
    raise SystemExit('仍有残留')

# 提示词常量(藏在文件开头)
import re
s2, n = re.subn(r'\n/// 上下文压缩系统提示词[^\n]*\nconst COMPACT_SYSTEM: &str = r#".*?"#;\n', '\n', s, flags=re.S)
if n == 0:
    raise SystemExit('MISS COMPACT_SYSTEM')
s = s2
s = re.sub(r'\n{3,}', '\n\n', s)

io.open(P, 'w', encoding='utf-8').write(s)
print('ok, 剩余行数=%d' % len(s.split('\n')))

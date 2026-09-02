---
name: review
description: 对当前代码变更进行审查，输出结构化审查报告（支持未提交/commit/base 三种模式）
short-description: 代码审查
triggers:
  - 审查
  - review
  - code review
  - cr
  - rv
interface:
  display-name: 代码审查
  icon: FileSearch
  brand-color: "#f59e0b"
---

# 代码审查技能

对代码变更进行审查，输出结构化审查报告。

## 审查模式

- **未提交**: 审查工作区未提交的变更
- **commit \<hash\>**: 审查指定 commit 的变更
- **base \<branch\>**: 审查当前分支与基线分支的差异

## 输出格式

每个问题一行：`级别|文件:行号|问题概述|修改建议`

级别只能取：严重、警告、建议、好评
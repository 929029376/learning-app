# Local Learning Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Local Learning Studio 是一个面向结构化 C++ 学习的本地桌面工作台。它把课程进度、章节笔记和 C++ 练习编辑器放在同一个应用里，学习者可以在本地完成阅读、编辑、编译、运行和章节完成标记。

项目基于 Electron、React、Vite、TypeScript、CodeMirror 和 sql.js 构建。它采用本地优先的设计：课程文件、学习进度、资料索引和运行记录都保存在你的电脑上。

## 功能特性

- 从本地学习资料目录自动发现课程路线。
- 跟踪学习阶段状态，包括未开始、学习中和已完成。
- 渲染 Markdown 章节笔记，并对 C++ 示例代码做语法高亮。
- 内置代码工作区，支持文件树、标签页、C++/头文件/Makefile/Markdown/文本编辑、字号调节和面板拖拽缩放。
- 通过 `g++ -fsyntax-only` 提供实时 C++ 诊断。
- 支持保存并运行单文件或多文件练习项目。
- 练习目录中存在 `Makefile` 时自动使用 Makefile 构建。
- 支持索引 Markdown、文本、PDF、DOCX、PPTX、C++ 源文件和头文件。
- 支持将进度、笔记和代码工作区拆分为独立窗口或聚焦窗口。

## 技术栈

- Electron：桌面应用外壳和本地文件访问。
- React 19 与 Vite：渲染进程 UI。
- TypeScript：覆盖 main、preload 和 renderer 进程。
- CodeMirror 6：内置代码编辑器。
- sql.js：本地学习索引和运行历史。
- `pdf-parse`、`mammoth`、`officeparser`：文档解析。

## 环境要求

- Node.js 20 或更高版本。
- npm。
- C++ 工具链：
  - Windows：需要 WSL，发行版名称为 `Ubuntu`，并安装 `g++` 和 `make`。
  - macOS/Linux：需要本机 `g++` 和 `make`。

在 Ubuntu 或 WSL 中安装构建工具：

```bash
sudo apt update
sudo apt install build-essential
```

## 快速开始

安装依赖：

```bash
npm install
```

启动开发版应用：

```bash
npm run dev
```

构建 Electron main/preload 代码和前端渲染资源：

```bash
npm run build
```

运行已构建的应用：

```bash
npm start
```

执行类型检查和前端生产构建：

```bash
npm run check
```

## 学习资料目录

应用源码目录和学习资料目录是分开的。本仓库保存的是应用代码；学习资料目录保存课程笔记、练习代码和本地生成的学习数据。

推荐目录结构：

```text
study-root/
  phase-notes/
    phase-2-cpp-foundation.md
  practice/
    phase1/
      makefile-lab-01/
        Makefile
        main.cpp
    phase2/
      stage-2-11-struct-basics/
        main.cpp
      stage-2-12-pointer-basics/
        main.cpp
```

应用会识别类似下面的阶段目录名称：

- `stage-2-11-struct-basics`
- `stage-2-12-pointer-basics`
- `makefile-lab-01`

应用会在所选学习资料根目录中创建 `.learning-data` 文件夹：

```text
study-root/
  .learning-data/
    course.json
    index.sqlite
    runs/
```

这个文件夹用于保存学习进度、资料解析元数据、运行历史和临时构建输出。如果你的学习资料目录也放在 Git 仓库里，通常应该忽略 `.learning-data`。

## 开发说明

- 渲染进程代码位于 `src/renderer`。
- Electron 主进程代码位于 `src/main`。
- preload 桥接代码位于 `src/preload`。
- 共享 IPC 和数据类型位于 `src/shared/types.ts`。
- Windows 默认学习资料目录定义在 `src/main/fileUtils.ts`，用户仍然可以在应用内选择其它目录。
- Windows 下 C++ 命令会通过 `wsl.exe -d Ubuntu -- ...` 执行。

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 构建 Electron 代码，启动 Vite，并打开 Electron。 |
| `npm run build:electron` | 编译 Electron main 和 preload 代码。 |
| `npm run build` | 编译 Electron 代码并构建渲染进程。 |
| `npm run check` | 执行 TypeScript 检查并构建渲染进程。 |
| `npm start` | 从构建产物启动 Electron。 |

## 隐私说明

Local Learning Studio 不需要后端服务。它读取用户选择的学习资料目录，并把生成的数据保存在该目录下的 `.learning-data` 文件夹中。练习代码的编译和运行也都在本地完成。

## 开源协议

ISC。

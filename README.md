# Local Learning Studio

[English](README.md) | [简体中文](README.zh-CN.md)

Local Learning Studio is a desktop learning workspace for structured C++ study. It combines a course progress view, lesson notes, and a built-in C++ practice editor so learners can read, edit, compile, run, and mark lessons complete in one local app.

The app is built with Electron, React, Vite, TypeScript, CodeMirror, and sql.js. It is local-first: course files, progress data, source indexes, and run history stay on your machine.

## Features

- Course route discovery from a local study directory.
- Progress tracking for learning stages, including completed, learning, and not-started states.
- Markdown lesson rendering with syntax-highlighted C++ examples.
- Built-in code workspace with file tree, tabs, editable C++/header/Makefile/Markdown/text files, adjustable font size, and resizable panels.
- Live C++ diagnostics through `g++ -fsyntax-only`.
- Save and run exercises from single-file or multi-file practice folders.
- Makefile support when a practice folder contains `Makefile`.
- Local indexing for Markdown, text, PDF, DOCX, PPTX, C++, and header files.
- Detached/focused panel windows for progress, lesson notes, and code studio.

## Tech Stack

- Electron for the desktop shell and native file access.
- React 19 and Vite for the renderer UI.
- TypeScript across main, preload, and renderer processes.
- CodeMirror 6 for the in-app editor.
- sql.js for the local study index and run history.
- `pdf-parse`, `mammoth`, and `officeparser` for document parsing.

## Requirements

- Node.js 20 or newer.
- npm.
- A C++ toolchain:
  - Windows: WSL with an `Ubuntu` distribution, plus `g++` and `make`.
  - macOS/Linux: native `g++` and `make`.

On Ubuntu or WSL:

```bash
sudo apt update
sudo apt install build-essential
```

## Getting Started

Install dependencies:

```bash
npm install
```

Run the development app:

```bash
npm run dev
```

Build the Electron main/preload code and renderer:

```bash
npm run build
```

Run the built app:

```bash
npm start
```

Run type checks and production renderer build:

```bash
npm run check
```

## Study Directory

The application source code directory and the study content directory are separate. The project repository contains the app. The study directory contains course notes, practice code, and the generated local learning data.

Recommended structure:

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

Stage folders are discovered from names such as:

- `stage-2-11-struct-basics`
- `stage-2-12-pointer-basics`
- `makefile-lab-01`

The app creates a `.learning-data` folder inside the selected study root:

```text
study-root/
  .learning-data/
    course.json
    index.sqlite
    runs/
```

This folder stores progress, parsed source metadata, run history, and temporary build output. If your study materials are also in Git, you usually want to ignore `.learning-data`.

## Development Notes

- Renderer code lives in `src/renderer`.
- Electron main-process code lives in `src/main`.
- Preload bridge code lives in `src/preload`.
- Shared IPC and data types live in `src/shared/types.ts`.
- The default Windows study root is defined in `src/main/fileUtils.ts`; users can still choose another directory in the app.
- On Windows, C++ commands are executed through `wsl.exe -d Ubuntu -- ...`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Build Electron code, start Vite, and launch Electron. |
| `npm run build:electron` | Compile Electron main and preload code. |
| `npm run build` | Compile Electron code and build the renderer. |
| `npm run check` | Run TypeScript checks and build the renderer. |
| `npm start` | Launch Electron from the built output. |

## Privacy

Local Learning Studio does not require a backend service. It reads the study directory selected by the user and stores generated data under that directory's `.learning-data` folder. Exercise compilation and execution happen locally.

## License

ISC.

# GoNavi - A Modern Lightweight Database Client

[![Go Version](https://img.shields.io/github/go-mod/go-version/Syngnat/GoNavi)](https://go.dev/)
[![Wails Version](https://img.shields.io/badge/Wails-v2-red)](https://wails.io)
[![React Version](https://img.shields.io/badge/React-v18-blue)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-Apache%202.0-green.svg)](LICENSE)
[![Build Status](https://img.shields.io/github/actions/workflow/status/Syngnat/GoNavi/release.yml?label=Build)](https://github.com/Syngnat/GoNavi/actions)

**Language**: English | [简体中文](README.zh-CN.md)

GoNavi is a modern, high-performance, cross-platform database client built with **Wails (Go)** and **React**.
It delivers native-like responsiveness with low resource usage.

Compared with many Electron-based clients, GoNavi is typically smaller in binary size (around 10MB class), starts faster, and uses less memory.

---

## Project Overview

GoNavi is designed for developers and DBAs who need a unified desktop experience across multiple databases.

- **Native-performance architecture**: Wails (Go + WebView) with lightweight runtime overhead.
- **Large dataset usability**: virtualized rendering and optimized DataGrid workflows for high-volume tables.
- **Unified connectivity**: URI build/parse, SSH tunnel, proxy support, and on-demand driver activation.
- **Production-oriented workflow**: SQL editor, object management, batch export/backup, sync tools, execution logs, and update checks.

## Supported Data Sources

> `Built-in`: available out of the box.  
> `Optional driver agent`: install/enable via Driver Manager first.

| Category | Data Source | Driver Mode | Typical Capabilities |
|---|---|---|---|
| Relational | MySQL | Built-in | Schema browsing, SQL query, data editing, export/backup |
| Relational | PostgreSQL | Built-in | Schema browsing, SQL query, data editing, object management |
| Relational | Oracle | Built-in | Query execution, object browsing, data editing |
| Cache | Redis | Built-in | Key browsing, command execution, encoding/view switch |
| Relational | MariaDB | Optional driver agent | Querying, object management, data editing |
| Relational | Doris | Optional driver agent | Querying, object browsing, SQL execution |
| Search | Sphinx | Optional driver agent | SphinxQL querying and object browsing |
| Relational | SQL Server | Optional driver agent | Schema browsing, SQL query, object management |
| File-based | SQLite | Optional driver agent | Local DB browsing, editing, export |
| File-based | DuckDB | Optional driver agent | Large-table query, pagination, file-DB workflow |
| Domestic DB | Dameng | Optional driver agent | Querying, object browsing, data editing |
| Domestic DB | Kingbase | Optional driver agent | Querying, object browsing, data editing |
| Domestic DB | HighGo | Optional driver agent | Querying, object browsing, data editing |
| Domestic DB | Vastbase | Optional driver agent | Querying, object browsing, data editing |
| Document | MongoDB | Optional driver agent | Document query, collection browsing, connection management |
| Time-series | TDengine | Optional driver agent | Time-series schema browsing and querying |
| Columnar Analytics | ClickHouse | Optional driver agent | Analytical query, object browsing, SQL execution |
| Extensibility | Custom Driver/DSN | Custom | Extend to more data sources via Driver + DSN |

<h2 align="center">📸 Screenshots</h2>

<div align="center">
    <img width="25%" alt="image" src="https://github.com/user-attachments/assets/0eefe07f-2836-44fa-9ddf-a0d2124b90e2" />
    <img width="25%" alt="image" src="https://github.com/user-attachments/assets/6765e539-83ea-4cd6-9c9e-f42790fa05b5" />
    <img width="25%" alt="image" src="https://github.com/user-attachments/assets/60e3d187-171a-4248-94e0-c6b08736e235" />
    <br />
    <img width="25%" alt="image" src="https://github.com/user-attachments/assets/7a478602-0f08-4b30-8f6a-879f4a60ae32" />
    <img width="14%" alt="image" src="https://github.com/user-attachments/assets/6442ca7d-ce9e-46d9-aecd-405ba88f5a5e" />
    <img width="25%" alt="image" src="https://github.com/user-attachments/assets/bc17895e-02a4-4cc5-b471-c3803cf25a2b" />
</div>

---

## Key Features

### AI Assistant (New)
- **Multi-provider Support**: OpenAI, Google Gemini, Anthropic Claude, and custom API support.
- **Context-Aware Chat**: Attach table schemas to the AI context for accurate SQL generation and assistance.
- **Slash Commands**: Quick commands for generating SQL, explaining queries, optimizing performance, and reviewing schema designs.

### Performance
- **Smooth interaction under load**: optimized table interaction (including column resize workflow on large datasets).
- **Virtualized rendering**: keeps large result sets responsive.

### Data Management (DataGrid)
- In-place cell editing.
- Batch insert/update/delete with transaction-oriented submit/rollback.
- Large-field popup editor.
- Context actions (set NULL, copy/export, etc.).
- Smart read/write mode switching based on query context.
- Export formats: CSV, Excel (XLSX), JSON, Markdown.

### SQL Editor
- Monaco Editor core.
- Context-aware completion for databases/tables/columns.
- Multi-tab query workflow.

### Batch Export / Backup
- Database-level and table-level batch export/backup.
- Scope-aware operation flow to reduce mistakes.

### Connectivity
- URI generation/parsing.
- SSH tunnel support.
- Proxy support.
- Config import/export (JSON).
- Optional driver management and activation.

### Redis Tools
- Multi-view value rendering (auto/raw text/UTF-8/hex).
- Built-in command execution panel.

### Observability and Update
- SQL execution logs with timing information.
- Startup/scheduled/manual update checks.

### UI/UX
- Ant Design 5 based interface.
- Light/Dark themes.
- Flexible sidebar and layout behavior.

---

## Tech Stack

- **Backend**: Go 1.24 + Wails v2
- **Frontend**: React 18 + TypeScript + Vite
- **UI**: Ant Design 5
- **State Management**: Zustand
- **Editor**: Monaco Editor

---

## Installation and Run

### Prerequisites
- [Go](https://go.dev/dl/) 1.21+
- [Node.js](https://nodejs.org/) 18+
- [Wails CLI](https://wails.io/docs/gettingstarted/installation):
  `go install github.com/wailsapp/wails/v2/cmd/wails@latest`

### Development Mode

```bash
# Clone
git clone https://github.com/Syngnat/GoNavi.git
cd GoNavi

# Start development with hot reload
wails dev
```

### Build

```bash
# Build for current platform
wails build

# Clean build (recommended before release)
wails build -clean
```

Artifacts are generated in `build/bin`.

### Cross-Platform Release (GitHub Actions)

The repository includes a release workflow.
Push a `v*` tag to trigger automated build and release.
Release notes are generated automatically from merged pull requests and categorized by `.github/release.yaml`.

Target artifacts include:
- macOS (AMD64 / ARM64)
- Windows (AMD64)
- Linux (AMD64, WebKitGTK 4.0 and 4.1 variants)

---

## Troubleshooting

### macOS: "App is damaged and can’t be opened"

Without Apple notarization, Gatekeeper may block startup.

1. Move `GoNavi.app` to **Applications**.
2. Open **Terminal**.
3. Run:

```bash
sudo xattr -rd com.apple.quarantine /Applications/GoNavi.app
```

Or right-click the app in Finder and choose **Open** with Control key flow.

### Linux: missing `libwebkit2gtk` / `libjavascriptcoregtk`

GoNavi depends on WebKitGTK runtime libraries.

```bash
# Debian 13 / Ubuntu 24.04+
sudo apt-get update
sudo apt-get install -y libgtk-3-0 libwebkit2gtk-4.1-0 libjavascriptcoregtk-4.1-0

# Ubuntu 22.04 / Debian 12
sudo apt-get update
sudo apt-get install -y libgtk-3-0 libwebkit2gtk-4.0-37 libjavascriptcoregtk-4.0-18
```

If you use Linux artifacts with the `-WebKit41` suffix, prefer Debian 13 / Ubuntu 24.04+.

---

## Contributing

Issues and pull requests are welcome.

For the full workflow, branch model, and maintainer sync rules, see:

- [CONTRIBUTING.md](CONTRIBUTING.md)

External contributors should open pull requests directly against `main`.

## Links

- [linux.do](https://linux.do/)
- [AIBook](https://aibook.ren/)

## License

Licensed under [Apache-2.0](LICENSE).

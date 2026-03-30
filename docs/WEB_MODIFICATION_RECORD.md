# GoNavi Web & Containerization Modification Record

This document records the architectural changes and implementation details of converting GoNavi from a Wails desktop application to a web-capable, containerized application.

## 1. Overview
The core objective was to decouple the backend business logic from the Wails runtime and expose it via a standard HTTP/WebSocket server, while providing a bridge for the frontend to call these APIs as if it were still running in a Wails environment.

## 2. Backend Changes (Go)

### 2.1 Web Server & RPC Bridge (`internal/web`)
- **Server Implementation**: Created a new `web.Server` using the `echo` framework.
- **RPC Mechanism**: Implemented a generic POST endpoint `/api/rpc` that uses Go reflection to call methods on the `App` and `AIService` structs. It automatically handles `context.Context` injection and JSON argument unmarshaling.
- **WebSocket Events**: Implemented a `/ws` endpoint using `gorilla/websocket` to broadcast backend events (like query progress, AI stream chunks) to the frontend.

### 2.2 Runtime Abstraction (`internal/web/runtime.go`)
- **Runtime Interface**: Defined a `web.Runtime` interface mimicking the `wails.runtime` API (`EventsEmit`, `MessageDialog`, `OpenFileDialog`, etc.).
- **Global Bridge**: Introduced `web.GlobalRuntime`. In Wails mode, it points to the native Wails runtime; in Web mode, it points to `web.WebRuntime` which handles events via WebSocket.

### 2.3 File & Update Adaptations
- **Web-based Uploads**: Created `/api/upload` to handle file uploads into the container's `data/uploads` directory.
- **Web-based Downloads**: Created `/api/download` to allow the frontend to trigger file downloads (used for exports).
- **Modified Core Files**: Replaced direct `github.com/wailsapp/wails/v2/pkg/runtime` calls with `web.GlobalRuntime` in the following files:
    - `internal/app/methods_file.go`
    - `internal/app/methods_driver.go`
    - `internal/app/methods_sync.go`
    - `internal/app/methods_update.go`
    - `internal/ai/service/service.go`

### 2.4 Entry Point (`main.go`)
- Added `--web` and `--port` flags.
- Added support for `GONAVI_WEB=true` environment variable for Docker environments.
- Updated `main()` to toggle between `runWailsMode` and `runWebMode`.

## 3. Frontend Changes (React)

### 3.1 Web Bridge (`frontend/public/web-bridge.js`)
- **Proxy Injection**: Injects a Proxy into `window.go` that intercepts method calls and redirects them to the `/api/rpc` endpoint via `fetch`.
- **Runtime Mock**: Mocks `window.runtime` (e.g., `EventsOn`, `BrowserOpenURL`).
- **File Dialog Interception**:
    - `OpenFileDialog`: Automatically creates a hidden `<input type="file">`, uploads the selected file, and returns the server-side path to the caller.
    - `SaveFileDialog`: Returns a temporary path; the bridge later detects `Export` RPC calls and triggers a browser download.

### 3.2 Integration
- **`frontend/index.html`**: Updated to load `web-bridge.js` if the native Wails environment is not detected.

## 4. Containerization

### 4.1 Dockerfile
- **Multi-stage Build**:
    - **Stage 1**: Builds the React frontend using Node 20.
    - **Stage 2**: Compiles the Go backend and embeds the frontend assets.
    - **Stage 3**: Final minimal Alpine image (~20MB + drivers).

## 5. Usage Commands
- **Local Web Run**: `go run main.go --web --port 8080`
- **Docker Build**: `docker build -t gonavi .`
- **Docker Run**: `docker run -p 8080:8080 gonavi`

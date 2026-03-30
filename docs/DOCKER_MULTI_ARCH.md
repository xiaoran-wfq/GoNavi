# Docker 多架构部署指南 (Multi-Arch Deployment)

为了支持在不同架构的服务器（如 x86_64 和 ARM64/Apple Silicon）上部署 GoNavi，我们提供了两种专为 Web 模式设计的多架构构建方案。

## 方案概览

根据您的部署环境（是否能连接外网、对镜像体积的要求），您可以选择以下两种 Dockerfile 之一：

### 1. 极简在线版 (`Dockerfile.online`)
*   **适用场景**：服务器可以访问外网、追求最小的镜像体积、快速分发。
*   **特性**：镜像极小（约 30MB），仅内置核心驱动（MySQL, Postgres, Redis 等）。达梦、人大金仓等可选国产驱动在运行时，由用户在驱动管理界面点击下载，系统会自动匹配并下载当前架构的驱动。
*   **原理**：禁用了 CGO，依赖纯 Go 交叉编译主程序。驱动目录挂载在宿主机或 Volume 中按需更新。

### 2. 全能离线版 (`Dockerfile.offline`)
*   **适用场景**：内网无外网环境、高安全性要求的企业私有部署、要求“开箱即用”。
*   **特性**：镜像较大（约 150MB+），构建时**自动预编译所有国产可选驱动**。
*   **原理**：在构建阶段调用 `build-driver-agents.sh`，利用 Docker Buildx 传入的 `TARGETARCH` 环境变量，自动为 amd64 编译 amd64 的驱动，为 arm64 编译 arm64 的驱动，并打包进镜像的 `/app/data/drivers` 目录中。

---

## 构建步骤

**前置条件**：请确保您的 Docker 环境已启用 `buildx` 插件，并且创建了一个支持多平台的构建器实例。

```bash
# 检查或创建 buildx 实例
docker buildx create --use --name multi-builder
docker buildx inspect --bootstrap
```

### 构建并推送在线版 (Online)
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.online \
  -t gonavi:web-online-latest \
  --push .
```

### 构建并推送离线版 (Offline)
```bash
docker buildx build --platform linux/amd64,linux/arm64 \
  -f Dockerfile.offline \
  -t gonavi:web-offline-full \
  --push .
```

---

## 运行指南与数据持久化

为了防止容器销毁后丢失用户配置、已下载的驱动或导出的文件，强烈建议使用 **Docker Volume** 来持久化 `/app/data` 目录。

### 推荐的运行命令：
```bash
docker run -d \
  -p 8080:8080 \
  --name gonavi-web \
  -v gonavi-data:/app/data \
  gonavi:web-online-latest
```

> **⚠️ 驱动跨架构警告**：
> 请尽量使用 Docker Volume (`gonavi-data`) 而不是绝对路径挂载（如 `-v $(pwd)/data:/app/data`）。
> 如果您将同一个本地包含 AMD64 驱动的目录挂载到了运行 ARM64 容器的宿主机上，驱动代理将无法启动（提示 `exec format error`）。使用 Volume 可以让不同架构的容器独立管理属于自己的底层驱动环境。

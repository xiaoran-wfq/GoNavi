# Stage 1: Frontend Build
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

# Stage 2: Backend Build
FROM golang:1.24-alpine AS backend-builder
RUN apk add --no-cache gcc musl-dev
WORKDIR /app
ENV GOPROXY=https://mirrors.aliyun.com/goproxy/,direct
COPY go.mod go.sum ./
COPY third_party/ ./third_party/
RUN go mod download
COPY . .
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
# 使用 -tags web 来支持某些可能需要的条件编译，虽然目前我们主要是通过代码逻辑判断
RUN go build -o gonavi .

# Stage 3: Final Image
FROM alpine:latest
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend-builder /app/gonavi .
# 如果有驱动代理，可能也需要拷贝
# COPY --from=backend-builder /app/build-bin ./build-bin

ENV GONAVI_WEB=true
EXPOSE 8080

ENTRYPOINT ["./gonavi"]
CMD ["--port", "8080"]

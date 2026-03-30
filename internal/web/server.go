package web

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"reflect"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/labstack/echo/v4"
)

type RPCRequest struct {
	Service string        `json:"service"`
	Method  string        `json:"method"`
	Args    []interface{} `json:"args"`
}

type RPCResponse struct {
	Success bool        `json:"success"`
	Data    interface{} `json:"data"`
	Message string      `json:"message"`
}

type EventMessage struct {
	Name string        `json:"name"`
	Args []interface{} `json:"args"`
}

type Server struct {
	echo       *echo.Echo
	services   map[string]interface{}
	clients    map[*websocket.Conn]bool
	clientsMu  sync.Mutex
	upgrader   websocket.Upgrader
	assetsFS   http.FileSystem
}

func NewServer(assetsFS http.FileSystem) *Server {
	e := echo.New()
	s := &Server{
		echo:     e,
		services: make(map[string]interface{}),
		clients:  make(map[*websocket.Conn]bool),
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool { return true },
		},
		assetsFS: assetsFS,
	}
	return s
}

func (s *Server) RegisterService(name string, service interface{}) {
	s.services[name] = service
}

func (s *Server) Start(addr string) error {
	s.echo.POST("/api/rpc", s.handleRPC)
	s.echo.GET("/ws", s.handleWS)
	s.registerUploadRoutes()

	// 静态资源托管
	if s.assetsFS != nil {
		fileServer := http.FileServer(s.assetsFS)
		s.echo.GET("/*", echo.WrapHandler(fileServer))
	}

	return s.echo.Start(addr)
}

func (s *Server) handleWS(c echo.Context) error {
	conn, err := s.upgrader.Upgrade(c.Response(), c.Request(), nil)
	if err != nil {
		return err
	}
	s.clientsMu.Lock()
	s.clients[conn] = true
	s.clientsMu.Unlock()

	defer func() {
		s.clientsMu.Lock()
		delete(s.clients, conn)
		s.clientsMu.Unlock()
		conn.Close()
	}()

	// 保持连接，处理心跳或客户端消息
	for {
		if _, _, err := conn.ReadMessage(); err != nil {
			break
		}
	}
	return nil
}

func (s *Server) handleRPC(c echo.Context) error {
	var req RPCRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, RPCResponse{Success: false, Message: "Invalid request"})
	}

	service, ok := s.services[req.Service]
	if !ok {
		return c.JSON(http.StatusNotFound, RPCResponse{Success: false, Message: "Service not found"})
	}

	svcVal := reflect.ValueOf(service)
	method := svcVal.MethodByName(req.Method)
	if !method.IsValid() {
		return c.JSON(http.StatusNotFound, RPCResponse{Success: false, Message: fmt.Sprintf("Method %s not found in service %s", req.Method, req.Service)})
	}

	methodType := method.Type()
	numArgs := methodType.NumIn()

	callArgs := make([]reflect.Value, numArgs)
	argOffset := 0
	for i := 0; i < numArgs; i++ {
		argType := methodType.In(i)

		if argType.Implements(reflect.TypeOf((*context.Context)(nil)).Elem()) {
			callArgs[i] = reflect.ValueOf(c.Request().Context())
			continue
		}

		if argOffset >= len(req.Args) {
			callArgs[i] = reflect.Zero(argType)
			continue
		}

		rawArg := req.Args[argOffset]
		argOffset++
		
		argJSON, _ := json.Marshal(rawArg)
		argPtr := reflect.New(argType)
		if err := json.Unmarshal(argJSON, argPtr.Interface()); err != nil {
			return c.JSON(http.StatusBadRequest, RPCResponse{Success: false, Message: fmt.Sprintf("Invalid argument type for arg %d", i)})
		}
		callArgs[i] = argPtr.Elem()
	}

	results := method.Call(callArgs)

	var responseData interface{}
	if len(results) > 0 {
		responseData = results[0].Interface()
	}

	if len(results) > 1 {
		errVal := results[len(results)-1]
		if !errVal.IsNil() && errVal.Type().Implements(reflect.TypeOf((*error)(nil)).Elem()) {
			return c.JSON(http.StatusInternalServerError, RPCResponse{
				Success: false,
				Message: errVal.Interface().(error).Error(),
				Data:    responseData,
			})
		}
	}

	return c.JSON(http.StatusOK, RPCResponse{
		Success: true,
		Data:    responseData,
	})
}

func (s *Server) BroadcastEvent(name string, args ...interface{}) {
	msg := EventMessage{Name: name, Args: args}
	msgJSON, _ := json.Marshal(msg)

	s.clientsMu.Lock()
	defer s.clientsMu.Unlock()
	for conn := range s.clients {
		_ = conn.WriteMessage(websocket.TextMessage, msgJSON)
	}
}

// WebRuntime 实现了 Runtime 接口，专门用于 Web 模式
type WebRuntime struct {
	server *Server
}

func NewWebRuntime(s *Server) *WebRuntime {
	return &WebRuntime{server: s}
}

func (w *WebRuntime) EventsEmit(ctx context.Context, eventName string, optionalData ...interface{}) {
	w.server.BroadcastEvent(eventName, optionalData...)
}

func (w *WebRuntime) MessageDialog(ctx context.Context, dialogOptions MessageDialogOptions) (string, error) {
	// Web 端可以简单的返回 OK，或者通过 WebSocket 异步处理
	return "ok", nil
}

func (w *WebRuntime) OpenFileDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error) {
	// Web 端限制，这里可以返回一个预设的路径，或者后续实现文件上传
	return "", fmt.Errorf("file dialog not supported in web mode")
}

func (w *WebRuntime) OpenDirectoryDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error) {
	return "", fmt.Errorf("directory dialog not supported in web mode")
}

func (w *WebRuntime) SaveFileDialog(ctx context.Context, dialogOptions SaveDialogOptions) (string, error) {
	return "", fmt.Errorf("save dialog not supported in web mode")
}

func (w *WebRuntime) Quit(ctx context.Context) {
	// Web 服务端不退出
}

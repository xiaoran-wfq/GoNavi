package main

import (
	"context"
	"flag"
	"net/http"
	"os"

	aiservice "GoNavi-Wails/internal/ai/service"
	"GoNavi-Wails/internal/app"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/web"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/mac"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

func main() {
	webMode := flag.Bool("web", false, "Run in web mode")
	port := flag.String("port", "8080", "Web server port")
	flag.Parse()

	// 容器环境下自动开启 web 模式
	if os.Getenv("GONAVI_WEB") == "true" {
		*webMode = true
	}

	application := app.NewApp()
	aiService := aiservice.NewService()

	if *webMode {
		runWebMode(application, aiService, *port)
		return
	}

	runWailsMode(application, aiService)
}

func runWebMode(application *app.App, aiService *aiservice.Service, port string) {
	logger.Infof("Starting GoNavi in Web Mode on port %s", port)
	
	server := web.NewServer(http.FS(assets))
	web.GlobalRuntime = web.NewWebRuntime(server)

	server.RegisterService("App", application)
	server.RegisterService("Service", aiService)

	// 初始化业务逻辑
	ctx := context.Background()
	app.InitializeLifecycle(application, ctx)
	aiservice.InitializeLifecycle(aiService, ctx)

	if err := server.Start(":" + port); err != nil {
		logger.Error(err, "Web Server 启动失败")
	}
}

func runWailsMode(application *app.App, aiService *aiservice.Service) {
	err := wails.Run(&options.App{
		Title:     "GoNavi",
		Width:     1024,
		Height:    768,
		Frameless: true,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		BackgroundColour: &options.RGBA{R: 0, G: 0, B: 0, A: 0},
		OnStartup: func(ctx context.Context) {
			app.InitializeLifecycle(application, ctx)
			aiservice.InitializeLifecycle(aiService, ctx)
		},
		OnShutdown: application.Shutdown,
		Bind: []interface{}{
			application,
			aiService,
		},
		Windows: &windows.Options{
			WebviewIsTransparent:              true,
			WindowIsTranslucent:               true,
			BackdropType:                      windows.Acrylic,
			DisableWindowIcon:                 false,
			DisableFramelessWindowDecorations: false,
			WebviewUserDataPath:               resolveWindowsWebviewUserDataPath(),
		},
		Mac: &mac.Options{
			WebviewIsTransparent: true,
			WindowIsTranslucent:  true,
		},
	})

	if err != nil {
		logger.Error(err, "应用启动失败")
	}
}

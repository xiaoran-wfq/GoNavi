package web

import (
	"context"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

type FileFilter = runtime.FileFilter
type OpenDialogOptions = runtime.OpenDialogOptions
type SaveDialogOptions = runtime.SaveDialogOptions
type MessageDialogOptions = runtime.MessageDialogOptions

// Runtime 接口定义了我们需要模拟的 Wails Runtime 方法
type Runtime interface {
	EventsEmit(ctx context.Context, eventName string, optionalData ...interface{})
	MessageDialog(ctx context.Context, dialogOptions MessageDialogOptions) (string, error)
	OpenFileDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error)
	OpenDirectoryDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error)
	SaveFileDialog(ctx context.Context, dialogOptions SaveDialogOptions) (string, error)
	Quit(ctx context.Context)
}

// GlobalRuntime 允许我们在 Wails 模式下使用原生的，在 Web 模式下使用自定义的
var GlobalRuntime Runtime

type WailsRuntime struct{}

func (w *WailsRuntime) Quit(ctx context.Context) {
	runtime.Quit(ctx)
}

func (w *WailsRuntime) EventsEmit(ctx context.Context, eventName string, optionalData ...interface{}) {
	runtime.EventsEmit(ctx, eventName, optionalData...)
}

func (w *WailsRuntime) MessageDialog(ctx context.Context, dialogOptions MessageDialogOptions) (string, error) {
	return runtime.MessageDialog(ctx, dialogOptions)
}

func (w *WailsRuntime) OpenFileDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error) {
	return runtime.OpenFileDialog(ctx, dialogOptions)
}

func (w *WailsRuntime) OpenDirectoryDialog(ctx context.Context, dialogOptions OpenDialogOptions) (string, error) {
	return runtime.OpenDirectoryDialog(ctx, dialogOptions)
}

func (w *WailsRuntime) SaveFileDialog(ctx context.Context, dialogOptions SaveDialogOptions) (string, error) {
	return runtime.SaveFileDialog(ctx, dialogOptions)
}

func init() {
	GlobalRuntime = &WailsRuntime{}
}

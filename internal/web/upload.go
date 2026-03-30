package web

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"
	"github.com/labstack/echo/v4"
)

// UploadResponse 统一的文件上传响应
type UploadResponse struct {
	Success  bool   `json:"success"`
	Message  string `json:"message"`
	FilePath string `json:"file_path"` // 容器内的绝对路径
}

func (s *Server) registerUploadRoutes() {
	s.echo.POST("/api/upload", s.handleUpload)
	s.echo.GET("/api/download", s.handleDownload)
}

func (s *Server) handleUpload(c echo.Context) error {
	file, err := c.FormFile("file")
	if err != nil {
		return c.JSON(http.StatusBadRequest, UploadResponse{Success: false, Message: "No file uploaded"})
	}

	src, err := file.Open()
	if err != nil {
		return err
	}
	defer src.Close()

	// 确保上传目录存在
	uploadDir := "data/uploads"
	if err := os.MkdirAll(uploadDir, 0755); err != nil {
		return c.JSON(http.StatusInternalServerError, UploadResponse{Success: false, Message: "Failed to create upload directory"})
	}

	// 生成唯一文件名，保留原始扩展名
	ext := filepath.Ext(file.Filename)
	uniqueName := fmt.Sprintf("%s_%s%s", time.Now().Format("20060102150405"), uuid.New().String()[:8], ext)
	dstPath := filepath.Join(uploadDir, uniqueName)

	dst, err := os.Create(dstPath)
	if err != nil {
		return err
	}
	defer dst.Close()

	if _, err = io.Copy(dst, src); err != nil {
		return err
	}

	absPath, _ := filepath.Abs(dstPath)
	return c.JSON(http.StatusOK, UploadResponse{
		Success:  true,
		FilePath: absPath,
		Message:  "File uploaded successfully",
	})
}

func (s *Server) handleDownload(c echo.Context) error {
	filePath := c.QueryParam("path")
	if filePath == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Path is required"})
	}

	// 安全检查：防止目录遍历漏洞 (Path Traversal)
	// 这里简单实现：只允许下载特定目录下的文件，或者确保路径不含 ..
	cleanPath := filepath.Clean(filePath)
	
	// 如果文件不存在
	if _, err := os.Stat(cleanPath); os.IsNotExist(err) {
		return c.JSON(http.StatusNotFound, map[string]string{"error": "File not found"})
	}

	return c.Attachment(cleanPath, filepath.Base(cleanPath))
}

package aiservice

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"GoNavi-Wails/internal/ai"
	aicontext "GoNavi-Wails/internal/ai/context"
	"GoNavi-Wails/internal/ai/provider"
	"GoNavi-Wails/internal/ai/safety"
	"GoNavi-Wails/internal/logger"
	"GoNavi-Wails/internal/web"

	"github.com/google/uuid"
)

// Service AI 服务，作为 Wails Binding 暴露给前端
type Service struct {
	ctx            context.Context
	mu             sync.RWMutex
	providers      []ai.ProviderConfig
	activeProvider string // active provider ID
	safetyLevel    ai.SQLPermissionLevel
	contextLevel   ai.ContextLevel
	guard          *safety.Guard
	configDir      string                        // 配置存储目录
	cancelFuncs    map[string]context.CancelFunc // 记录每个 session 的 context 取消函数
}

var miniMaxAnthropicModels = []string{
	"MiniMax-M2.7",
	"MiniMax-M2.7-highspeed",
	"MiniMax-M2.5",
	"MiniMax-M2.5-highspeed",
	"MiniMax-M2.1",
	"MiniMax-M2.1-highspeed",
	"MiniMax-M2",
}

var dashScopeCodingPlanModels = []string{
	"qwen3.5-plus",
	"kimi-k2.5",
	"glm-5",
	"MiniMax-M2.5",
	"qwen3-max-2026-01-23",
	"qwen3-coder-next",
	"qwen3-coder-plus",
	"glm-4.7",
}

const dashScopeCodingPlanAnthropicBaseURL = "https://coding.dashscope.aliyuncs.com/apps/anthropic"

var volcengineCodingPlanAllowedExactModels = []string{
	"auto",
}

var volcengineCodingPlanAllowedModelFamilies = []string{
	"doubao-seed-2.0-code",
	"doubao-seed-2.0-pro",
	"doubao-seed-2.0-lite",
	"doubao-seed-code",
	"minimax-m2.5",
	"glm-4.7",
	"deepseek-v3.2",
	"kimi-k2",
}

const volcengineCodingPlanEmptyModelsError = `当前接口未返回可用的火山 Coding Plan 模型，请检查账号权限或切换到"火山方舟"供应商`

var claudeCLIHealthCheckFunc = func(config ai.ProviderConfig) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cliProvider, err := provider.NewProvider(config)
	if err != nil {
		return err
	}

	_, err = cliProvider.Chat(ctx, ai.ChatRequest{
		Messages: []ai.Message{
			{Role: "user", Content: "ping"},
		},
		MaxTokens:   1,
		Temperature: 0,
	})
	return err
}

// NewService 创建 AI Service 实例
func NewService() *Service {
	return &Service{
		providers:    make([]ai.ProviderConfig, 0),
		safetyLevel:  ai.PermissionReadOnly,
		contextLevel: ai.ContextSchemaOnly,
		guard:        safety.NewGuard(ai.PermissionReadOnly),
		cancelFuncs:  make(map[string]context.CancelFunc),
	}
}

// InitializeLifecycle attaches runtime context without exposing lifecycle internals to Wails bindings.
func InitializeLifecycle(s *Service, ctx context.Context) {
	s.startup(ctx)
}

// startup Wails 生命周期回调
func (s *Service) startup(ctx context.Context) {
	s.ctx = ctx
	s.configDir = resolveConfigDir()
	s.loadConfig()
	logger.Infof("AI Service 启动完成，已加载 %d 个 Provider", len(s.providers))
}

// --- Provider 管理 ---

// AIGetProviders 获取所有 Provider 配置
func (s *Service) AIGetProviders() []ai.ProviderConfig {
	s.mu.RLock()
	defer s.mu.RUnlock()

	result := make([]ai.ProviderConfig, len(s.providers))
	copy(result, s.providers)
	for i := range result {
		result[i] = normalizeProviderConfig(result[i])
	}
	return result
}

// AISaveProvider 保存/更新 Provider 配置
func (s *Service) AISaveProvider(config ai.ProviderConfig) error {
	fmt.Printf("[AISaveProvider DEBUG] ID: %s, Model: %s\n", config.ID, config.Model)
	s.mu.Lock()
	defer s.mu.Unlock()

	config = normalizeProviderConfig(config)

	if strings.TrimSpace(config.ID) == "" {
		config.ID = "provider-" + uuid.New().String()[:8]
	}

	found := false
	for i, p := range s.providers {
		if p.ID == config.ID {
			s.providers[i] = config
			found = true
			break
		}
	}
	if !found {
		s.providers = append(s.providers, config)
	}

	return s.saveConfig()
}

// AIDeleteProvider 删除 Provider
func (s *Service) AIDeleteProvider(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()

	newProviders := make([]ai.ProviderConfig, 0, len(s.providers))
	for _, p := range s.providers {
		if p.ID != id {
			newProviders = append(newProviders, p)
		}
	}
	s.providers = newProviders

	if s.activeProvider == id {
		s.activeProvider = ""
		if len(s.providers) > 0 {
			s.activeProvider = s.providers[0].ID
		}
	}

	return s.saveConfig()
}

// AITestProvider 测试 Provider 配置是否可用，仅测试端点连通性与密钥，不实际调用对话
func (s *Service) AITestProvider(config ai.ProviderConfig) map[string]interface{} {
	// 如果传入脱敏的 key，使用已保存的 key
	s.mu.RLock()
	if isMaskedAPIKey(config.APIKey) {
		for _, p := range s.providers {
			if p.ID == config.ID {
				config.APIKey = p.APIKey
				break
			}
		}
	}
	s.mu.RUnlock()

	config = normalizeProviderConfig(config)
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	providerType := normalizedProviderType(config)

	client := &http.Client{Timeout: 10 * time.Second}
	var err error

	switch providerType {
	case "openai", "anthropic", "gemini":
		req, reqErr := newProviderHealthCheckRequest(config)
		if reqErr != nil {
			err = reqErr
			break
		}
		resp, reqErr := client.Do(req)
		if reqErr != nil {
			err = reqErr
		} else {
			defer resp.Body.Close()
			if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
				err = fmt.Errorf("API Key 无效或请求错误 (HTTP %d)", resp.StatusCode)
			} else if providerType == "gemini" && resp.StatusCode == http.StatusBadRequest {
				err = fmt.Errorf("API Key 无效或请求错误 (HTTP %d)", resp.StatusCode)
			} else if resp.StatusCode >= 400 {
				body, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
				err = fmt.Errorf("接口返回异常 (HTTP %d): %s", resp.StatusCode, string(body))
			} else if resp.StatusCode >= 500 {
				err = fmt.Errorf("上游服务器内部错误 (HTTP %d)", resp.StatusCode)
			}
		}
	case "claude-cli":
		testConfig := config
		if strings.TrimSpace(testConfig.Model) == "" && isDashScopeCodingPlanProvider(testConfig) && len(dashScopeCodingPlanModels) > 0 {
			testConfig.Model = dashScopeCodingPlanModels[0]
		}
		err = claudeCLIHealthCheckFunc(testConfig)
	default:
		if baseURL != "" {
			req, _ := http.NewRequest("GET", baseURL, nil)
			resp, reqErr := client.Do(req)
			if reqErr != nil {
				err = reqErr
			} else {
				resp.Body.Close()
			}
		}
	}

	if err != nil {
		return map[string]interface{}{"success": false, "message": fmt.Sprintf("连接测试失败: %s", err.Error())}
	}

	return map[string]interface{}{
		"success": true,
		"message": "端点连通性测试成功！",
	}
}

func normalizedProviderType(config ai.ProviderConfig) string {
	providerType := strings.ToLower(strings.TrimSpace(config.Type))
	if providerType == "custom" && strings.TrimSpace(config.APIFormat) != "" {
		return strings.ToLower(strings.TrimSpace(config.APIFormat))
	}
	return providerType
}

func isMiniMaxAnthropicProvider(config ai.ProviderConfig) bool {
	if normalizedProviderType(config) != "anthropic" {
		return false
	}
	baseURL := strings.ToLower(strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"))
	return strings.Contains(baseURL, "api.minimax.io") || strings.Contains(baseURL, "api.minimaxi.com")
}

func isMoonshotAnthropicProvider(config ai.ProviderConfig) bool {
	if normalizedProviderType(config) != "anthropic" {
		return false
	}
	baseURL := strings.ToLower(strings.TrimRight(strings.TrimSpace(config.BaseURL), "/"))
	return strings.Contains(baseURL, "api.moonshot.cn")
}

func parseProviderBaseURL(raw string) (string, string) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", ""
	}
	return strings.ToLower(parsed.Hostname()), strings.TrimRight(strings.ToLower(parsed.Path), "/")
}

func isDashScopeBailianAnthropicProvider(config ai.ProviderConfig) bool {
	if normalizedProviderType(config) != "anthropic" {
		return false
	}
	host, path := parseProviderBaseURL(config.BaseURL)
	return host == "dashscope.aliyuncs.com" && strings.HasPrefix(path, "/apps/anthropic")
}

func isDashScopeCodingPlanAnthropicProvider(config ai.ProviderConfig) bool {
	if normalizedProviderType(config) != "anthropic" {
		return false
	}
	return isDashScopeCodingPlanProvider(config)
}

func isDashScopeCodingPlanProvider(config ai.ProviderConfig) bool {
	host, path := parseProviderBaseURL(config.BaseURL)
	return host == "coding.dashscope.aliyuncs.com" && (strings.HasPrefix(path, "/apps/anthropic") || strings.HasPrefix(path, "/v1"))
}

func isVolcengineCodingPlanProvider(config ai.ProviderConfig) bool {
	if normalizedProviderType(config) != "openai" {
		return false
	}
	host, path := parseProviderBaseURL(provider.NormalizeOpenAICompatibleBaseURL(config.BaseURL))
	return host == "ark.cn-beijing.volces.com" && path == "/api/coding/v3"
}

func filterVolcengineCodingPlanModels(models []string) []string {
	filtered := make([]string, 0, len(models))
	for _, model := range models {
		lowerModel := strings.ToLower(strings.TrimSpace(model))
		matched := false
		for _, exactModel := range volcengineCodingPlanAllowedExactModels {
			if lowerModel == exactModel {
				filtered = append(filtered, model)
				matched = true
				break
			}
		}
		if matched {
			continue
		}
		for _, family := range volcengineCodingPlanAllowedModelFamilies {
			if strings.Contains(lowerModel, family) {
				filtered = append(filtered, model)
				break
			}
		}
	}
	return filtered
}

func filterFetchedModelsForProvider(config ai.ProviderConfig, models []string) ([]string, error) {
	if !isVolcengineCodingPlanProvider(config) {
		return models, nil
	}
	filtered := filterVolcengineCodingPlanModels(models)
	if len(filtered) == 0 {
		return nil, fmt.Errorf(volcengineCodingPlanEmptyModelsError)
	}
	return filtered, nil
}

func defaultStaticModelsForProvider(config ai.ProviderConfig) []string {
	if isMiniMaxAnthropicProvider(config) {
		return append([]string(nil), miniMaxAnthropicModels...)
	}
	if isDashScopeCodingPlanProvider(config) {
		return append([]string(nil), dashScopeCodingPlanModels...)
	}
	return nil
}

func normalizeProviderConfig(config ai.ProviderConfig) ai.ProviderConfig {
	switch {
	case isDashScopeBailianAnthropicProvider(config):
		config.Models = nil
	case isDashScopeCodingPlanProvider(config):
		config.Type = "custom"
		config.APIFormat = "claude-cli"
		config.BaseURL = dashScopeCodingPlanAnthropicBaseURL
		config.Models = append([]string(nil), dashScopeCodingPlanModels...)
	default:
		staticModels := defaultStaticModelsForProvider(config)
		if len(staticModels) > 0 && len(config.Models) == 0 {
			config.Models = staticModels
		}
	}

	model := strings.TrimSpace(config.Model)
	if isMiniMaxAnthropicProvider(config) && (model == "" || strings.HasPrefix(strings.ToLower(model), "minimax-text-")) {
		config.Model = miniMaxAnthropicModels[0]
	}
	return config
}

func resolveModelsURL(config ai.ProviderConfig) string {
	config = normalizeProviderConfig(config)
	providerType := normalizedProviderType(config)
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")

	switch providerType {
	case "anthropic":
		if isMoonshotAnthropicProvider(config) {
			return "https://api.moonshot.cn/v1/models"
		}
		if isDashScopeBailianAnthropicProvider(config) {
			return "https://dashscope.aliyuncs.com/compatible-mode/v1/models"
		}
		if baseURL == "" {
			baseURL = "https://api.anthropic.com"
		}
		if !strings.HasSuffix(baseURL, "/v1") && !strings.Contains(baseURL, "/v1/") {
			baseURL = baseURL + "/v1"
		}
		return baseURL + "/models"
	case "gemini":
		if baseURL == "" {
			baseURL = "https://generativelanguage.googleapis.com"
		}
		return baseURL + "/v1beta/models?key=" + config.APIKey
	case "openai":
		fallthrough
	default:
		return provider.ResolveOpenAICompatibleEndpoint(baseURL, "models")
	}
}

func newModelsRequest(config ai.ProviderConfig) (*http.Request, error) {
	config = normalizeProviderConfig(config)
	url := resolveModelsURL(config)
	req, err := http.NewRequest("GET", url, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	switch normalizedProviderType(config) {
	case "anthropic":
		if isDashScopeBailianAnthropicProvider(config) {
			req.Header.Set("Authorization", "Bearer "+config.APIKey)
		} else {
			provider.ApplyAnthropicAuthHeaders(req.Header, config.BaseURL, config.APIKey)
		}
	case "gemini":
		// Gemini 使用 query string 传递 key，无需额外鉴权头
	default:
		req.Header.Set("Authorization", "Bearer "+config.APIKey)
	}

	for k, v := range config.Headers {
		req.Header.Set(k, v)
	}

	return req, nil
}

func resolveAnthropicMessagesURL(baseURL string) string {
	url := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if url == "" {
		url = "https://api.anthropic.com"
	}
	if strings.HasSuffix(url, "/messages") {
		return url
	}
	if strings.HasSuffix(url, "/v1") {
		return url + "/messages"
	}
	return url + "/v1/messages"
}

func newProviderHealthCheckRequest(config ai.ProviderConfig) (*http.Request, error) {
	config = normalizeProviderConfig(config)
	if isMiniMaxAnthropicProvider(config) || isDashScopeBailianAnthropicProvider(config) || isDashScopeCodingPlanAnthropicProvider(config) {
		return newAnthropicMessagesHealthCheckRequest(config)
	}
	return newModelsRequest(config)
}

func newAnthropicMessagesHealthCheckRequest(config ai.ProviderConfig) (*http.Request, error) {
	body := map[string]interface{}{
		"model":      config.Model,
		"max_tokens": 1,
		"messages": []map[string]string{
			{"role": "user", "content": "ping"},
		},
	}
	bodyBytes, err := json.Marshal(body)
	if err != nil {
		return nil, fmt.Errorf("序列化请求失败: %w", err)
	}
	req, err := http.NewRequest("POST", resolveAnthropicMessagesURL(config.BaseURL), strings.NewReader(string(bodyBytes)))
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	provider.ApplyAnthropicAuthHeaders(req.Header, config.BaseURL, config.APIKey)
	for k, v := range config.Headers {
		req.Header.Set(k, v)
	}
	return req, nil
}

// AISetActiveProvider 设置活动 Provider
func (s *Service) AISetActiveProvider(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.activeProvider = id
	_ = s.saveConfig()
}

// AIGetActiveProvider 获取活动 Provider ID
func (s *Service) AIGetActiveProvider() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.activeProvider
}

// AIGetBuiltinPrompts 返回内部置的各类系统提示词，用于前端展示或查询
func (s *Service) AIGetBuiltinPrompts() map[string]string {
	return aicontext.GetBuiltinPrompts()
}

// AIListModels 获取当前活跃 Provider 的可用模型列表
func (s *Service) AIListModels() map[string]interface{} {
	s.mu.RLock()
	var config ai.ProviderConfig
	found := false
	for _, p := range s.providers {
		if p.ID == s.activeProvider {
			config = p
			found = true
			break
		}
	}
	s.mu.RUnlock()

	if !found {
		return map[string]interface{}{"success": false, "models": []string{}, "error": "未找到活跃 Provider"}
	}

	config = normalizeProviderConfig(config)
	if staticModels := defaultStaticModelsForProvider(config); len(staticModels) > 0 {
		return map[string]interface{}{"success": true, "models": staticModels, "source": "static"}
	}

	models, err := fetchModelsFunc(config)
	if err != nil {
		// 回退到配置中的静态模型列表
		if len(config.Models) > 0 {
			return map[string]interface{}{"success": true, "models": config.Models, "source": "static"}
		}
		return map[string]interface{}{"success": false, "models": []string{}, "error": err.Error()}
	}

	models, err = filterFetchedModelsForProvider(config, models)
	if err != nil {
		return map[string]interface{}{"success": false, "models": []string{}, "error": err.Error()}
	}

	return map[string]interface{}{"success": true, "models": models, "source": "api"}
}

// fetchModels 从供应商 API 获取可用模型列表
var fetchModelsFunc = fetchModels

func fetchModels(config ai.ProviderConfig) ([]string, error) {
	providerType := normalizedProviderType(config)
	if staticModels := defaultStaticModelsForProvider(config); len(staticModels) > 0 {
		return staticModels, nil
	}

	switch providerType {
	case "openai":
		return fetchOpenAIModels(config)
	case "anthropic":
		return fetchAnthropicModels(config)
	case "gemini":
		return fetchGeminiModels(config)
	default:
		return fetchOpenAIModels(config)
	}
}

// fetchOpenAIModels 获取 OpenAI 兼容 API 的模型列表
func fetchOpenAIModels(config ai.ProviderConfig) ([]string, error) {
	req, err := newModelsRequest(config)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求模型列表失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("获取模型列表失败 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析模型列表失败: %w", err)
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		models = append(models, m.ID)
	}
	return models, nil
}

// fetchAnthropicModels 获取 Anthropic API 的模型列表
func fetchAnthropicModels(config ai.ProviderConfig) ([]string, error) {
	req, err := newModelsRequest(config)
	if err != nil {
		return nil, err
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求模型列表失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("获取模型列表失败 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析模型列表失败: %w", err)
	}

	models := make([]string, 0, len(result.Data))
	for _, m := range result.Data {
		models = append(models, m.ID)
	}
	return models, nil
}

// fetchGeminiModels 获取 Gemini API 的模型列表
func fetchGeminiModels(config ai.ProviderConfig) ([]string, error) {
	baseURL := strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	if baseURL == "" {
		baseURL = "https://generativelanguage.googleapis.com"
	}

	req, err := http.NewRequest("GET", baseURL+"/v1beta/models?key="+config.APIKey, nil)
	if err != nil {
		return nil, fmt.Errorf("创建请求失败: %w", err)
	}

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("请求模型列表失败: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("获取模型列表失败 (HTTP %d): %s", resp.StatusCode, string(body))
	}

	var result struct {
		Models []struct {
			Name string `json:"name"` // e.g. "models/gemini-2.5-flash"
		} `json:"models"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("解析模型列表失败: %w", err)
	}

	models := make([]string, 0, len(result.Models))
	for _, m := range result.Models {
		// 去掉 "models/" 前缀
		name := m.Name
		if strings.HasPrefix(name, "models/") {
			name = strings.TrimPrefix(name, "models/")
		}
		models = append(models, name)
	}
	return models, nil
}

// --- 安全控制 ---

// AIGetSafetyLevel 获取当前安全级别
func (s *Service) AIGetSafetyLevel() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.safetyLevel)
}

// AISetSafetyLevel 设置安全级别
func (s *Service) AISetSafetyLevel(level string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch ai.SQLPermissionLevel(level) {
	case ai.PermissionReadOnly, ai.PermissionReadWrite, ai.PermissionFull:
		s.safetyLevel = ai.SQLPermissionLevel(level)
	default:
		s.safetyLevel = ai.PermissionReadOnly
	}
	s.guard.SetPermissionLevel(s.safetyLevel)
	_ = s.saveConfig()
}

// --- 上下文控制 ---

// AIGetContextLevel 获取上下文传递级别
func (s *Service) AIGetContextLevel() string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return string(s.contextLevel)
}

// AISetContextLevel 设置上下文传递级别
func (s *Service) AISetContextLevel(level string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	switch ai.ContextLevel(level) {
	case ai.ContextSchemaOnly, ai.ContextWithSamples, ai.ContextWithResults:
		s.contextLevel = ai.ContextLevel(level)
	default:
		s.contextLevel = ai.ContextSchemaOnly
	}
	_ = s.saveConfig()
}

// --- AI 对话 ---

// AIChatSend 非流式发送 AI 对话
func (s *Service) AIChatSend(messages []ai.Message, tools []ai.Tool) map[string]interface{} {
	p, err := s.getActiveProvider()
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	resp, err := p.Chat(context.Background(), ai.ChatRequest{Messages: messages, Tools: tools})
	if err != nil {
		return map[string]interface{}{"success": false, "error": err.Error()}
	}

	return map[string]interface{}{
		"success":    true,
		"content":    resp.Content,
		"tool_calls": resp.ToolCalls,
		"tokensUsed": map[string]int{
			"promptTokens":     resp.TokensUsed.PromptTokens,
			"completionTokens": resp.TokensUsed.CompletionTokens,
			"totalTokens":      resp.TokensUsed.TotalTokens,
		},
	}
}

// AIChatStream 流式发送 AI 对话（通过 EventsEmit 推送）
func (s *Service) AIChatStream(sessionID string, messages []ai.Message, tools []ai.Tool) {
	streamCtx, cancel := context.WithCancel(context.Background())
	s.mu.Lock()
	s.cancelFuncs[sessionID] = cancel
	s.mu.Unlock()

	go func() {
		defer func() {
			s.mu.Lock()
			delete(s.cancelFuncs, sessionID)
			s.mu.Unlock()
			cancel() // 确保释放
		}()

		p, err := s.getActiveProvider()
		if err != nil {
			web.GlobalRuntime.EventsEmit(s.ctx, "ai:stream:"+sessionID, map[string]interface{}{
				"error": err.Error(),
				"done":  true,
			})
			return
		}

		err = p.ChatStream(streamCtx, ai.ChatRequest{Messages: messages, Tools: tools}, func(chunk ai.StreamChunk) {
			web.GlobalRuntime.EventsEmit(s.ctx, "ai:stream:"+sessionID, map[string]interface{}{
				"content":    chunk.Content,
				"thinking":   chunk.Thinking,
				"tool_calls": chunk.ToolCalls,
				"done":       chunk.Done,
				"error":      chunk.Error,
			})
		})

		// 当 context 被主动 cancel 的时候，不把这个视为向外抛的 error
		if err != nil && err != context.Canceled {
			web.GlobalRuntime.EventsEmit(s.ctx, "ai:stream:"+sessionID, map[string]interface{}{
				"error": err.Error(),
				"done":  true,
			})
		}
	}()
}

// AIChatCancel 立即终止某个 Session 的流式对话请求
func (s *Service) AIChatCancel(sessionID string) {
	s.mu.RLock()
	cancel, ok := s.cancelFuncs[sessionID]
	s.mu.RUnlock()
	if ok && cancel != nil {
		cancel()
	}
}

// AICheckSQL 检查 SQL 的安全性
func (s *Service) AICheckSQL(sql string) ai.SafetyResult {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.guard.Check(sql)
}

// --- 内部方法 ---

func (s *Service) getActiveProvider() (provider.Provider, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	if s.activeProvider == "" && len(s.providers) > 0 {
		s.activeProvider = s.providers[0].ID
	}

	for _, cfg := range s.providers {
		if cfg.ID == s.activeProvider {
			return provider.NewProvider(normalizeProviderConfig(cfg))
		}
	}

	return nil, fmt.Errorf("未配置 AI Provider，请先在设置中配置")
}

// --- 配置持久化 ---

type aiConfig struct {
	Providers      []ai.ProviderConfig `json:"providers"`
	ActiveProvider string              `json:"activeProvider"`
	SafetyLevel    string              `json:"safetyLevel"`
	ContextLevel   string              `json:"contextLevel"`
}

func (s *Service) loadConfig() {
	path := filepath.Join(s.configDir, "ai_config.json")
	data, err := os.ReadFile(path)
	if err != nil {
		return // 首次启动，无配置文件
	}

	var cfg aiConfig
	if err := json.Unmarshal(data, &cfg); err != nil {
		logger.Error(err, "加载 AI 配置失败")
		return
	}

	s.providers = cfg.Providers
	if s.providers == nil {
		s.providers = make([]ai.ProviderConfig, 0)
	}
	for i := range s.providers {
		s.providers[i] = normalizeProviderConfig(s.providers[i])
	}
	s.activeProvider = cfg.ActiveProvider

	switch ai.SQLPermissionLevel(cfg.SafetyLevel) {
	case ai.PermissionReadOnly, ai.PermissionReadWrite, ai.PermissionFull:
		s.safetyLevel = ai.SQLPermissionLevel(cfg.SafetyLevel)
	default:
		s.safetyLevel = ai.PermissionReadOnly
	}
	s.guard.SetPermissionLevel(s.safetyLevel)

	switch ai.ContextLevel(cfg.ContextLevel) {
	case ai.ContextSchemaOnly, ai.ContextWithSamples, ai.ContextWithResults:
		s.contextLevel = ai.ContextLevel(cfg.ContextLevel)
	default:
		s.contextLevel = ai.ContextSchemaOnly
	}
}

func (s *Service) saveConfig() error {
	cfg := aiConfig{
		Providers:      s.providers,
		ActiveProvider: s.activeProvider,
		SafetyLevel:    string(s.safetyLevel),
		ContextLevel:   string(s.contextLevel),
	}

	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化 AI 配置失败: %w", err)
	}

	if err := os.MkdirAll(s.configDir, 0o755); err != nil {
		return fmt.Errorf("创建配置目录失败: %w", err)
	}

	path := filepath.Join(s.configDir, "ai_config.json")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		return fmt.Errorf("写入 AI 配置失败: %w", err)
	}

	return nil
}

// --- 会话文件持久化 ---

// sessionFileData 会话文件的 JSON 结构
type sessionFileData struct {
	ID        string          `json:"id"`
	Title     string          `json:"title"`
	UpdatedAt int64           `json:"updatedAt"`
	Messages  json.RawMessage `json:"messages"` // 透传前端格式，后端不解析消息体
}

func (s *Service) sessionsDir() string {
	return filepath.Join(s.configDir, "sessions")
}

// AIGetSessions 获取所有会话的元数据列表（不含消息体）
func (s *Service) AIGetSessions() []map[string]interface{} {
	dir := s.sessionsDir()
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []map[string]interface{}{}
	}

	var sessions []map[string]interface{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var sfd sessionFileData
		if err := json.Unmarshal(data, &sfd); err != nil {
			continue
		}
		sessions = append(sessions, map[string]interface{}{
			"id":        sfd.ID,
			"title":     sfd.Title,
			"updatedAt": sfd.UpdatedAt,
		})
	}

	// 按 updatedAt 降序排列
	for i := 0; i < len(sessions); i++ {
		for j := i + 1; j < len(sessions); j++ {
			ti, _ := sessions[i]["updatedAt"].(int64)
			tj, _ := sessions[j]["updatedAt"].(int64)
			if tj > ti {
				sessions[i], sessions[j] = sessions[j], sessions[i]
			}
		}
	}

	return sessions
}

// AILoadSession 加载指定会话的完整数据（含消息）
func (s *Service) AILoadSession(sessionID string) map[string]interface{} {
	path := filepath.Join(s.sessionsDir(), sessionID+".json")
	data, err := os.ReadFile(path)
	if err != nil {
		return map[string]interface{}{"success": false, "error": "会话不存在"}
	}
	var sfd sessionFileData
	if err := json.Unmarshal(data, &sfd); err != nil {
		return map[string]interface{}{"success": false, "error": "会话数据损坏"}
	}
	return map[string]interface{}{
		"success":   true,
		"id":        sfd.ID,
		"title":     sfd.Title,
		"updatedAt": sfd.UpdatedAt,
		"messages":  sfd.Messages,
	}
}

// AISaveSession 保存会话数据到文件
func (s *Service) AISaveSession(sessionID string, title string, updatedAt float64, messagesJSON string) error {
	dir := s.sessionsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("创建 sessions 目录失败: %w", err)
	}

	sfd := sessionFileData{
		ID:        sessionID,
		Title:     title,
		UpdatedAt: int64(updatedAt),
		Messages:  json.RawMessage(messagesJSON),
	}

	data, err := json.MarshalIndent(sfd, "", "  ")
	if err != nil {
		return fmt.Errorf("序列化会话数据失败: %w", err)
	}

	path := filepath.Join(dir, sessionID+".json")
	return os.WriteFile(path, data, 0o644)
}

// AIDeleteSession 删除会话文件
func (s *Service) AIDeleteSession(sessionID string) error {
	path := filepath.Join(s.sessionsDir(), sessionID+".json")
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("删除会话失败: %w", err)
	}
	return nil
}

// --- 工具函数 ---

func resolveConfigDir() string {
	if os.Getenv("GONAVI_WEB") == "true" {
		return "/app/data/ai"
	}
	homeDir, err := os.UserHomeDir()
	if err != nil {
		homeDir = "."
	}
	return filepath.Join(homeDir, ".gonavi")
}

func maskAPIKey(apiKey string) string {
	if len(apiKey) <= 8 {
		return "****"
	}
	return apiKey[:4] + "****" + apiKey[len(apiKey)-4:]
}

func isMaskedAPIKey(apiKey string) bool {
	return strings.Contains(apiKey, "****")
}

func truncateString(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

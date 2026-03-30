export interface SSHConfig {
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
}

export interface ProxyConfig {
  type: 'socks5' | 'http';
  host: string;
  port: number;
  user?: string;
  password?: string;
}

export interface HTTPTunnelConfig {
  host: string;
  port: number;
  user?: string;
  password?: string;
}

export interface ConnectionConfig {
  type: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  savePassword?: boolean;
  database?: string;
  useSSL?: boolean;
  sslMode?: 'preferred' | 'required' | 'skip-verify' | 'disable';
  sslCertPath?: string;
  sslKeyPath?: string;
  useSSH?: boolean;
  ssh?: SSHConfig;
  useProxy?: boolean;
  proxy?: ProxyConfig;
  useHttpTunnel?: boolean;
  httpTunnel?: HTTPTunnelConfig;
  driver?: string;
  dsn?: string;
  timeout?: number;
  redisDB?: number; // Redis database index (0-15)
  uri?: string; // Connection URI for copy/paste
  hosts?: string[]; // Multi-host addresses: host:port
  topology?: 'single' | 'replica' | 'cluster';
  mysqlReplicaUser?: string;
  mysqlReplicaPassword?: string;
  replicaSet?: string;
  authSource?: string;
  readPreference?: string;
  mongoSrv?: boolean;
  mongoAuthMechanism?: string;
  mongoReplicaUser?: string;
  mongoReplicaPassword?: string;
}

export interface MongoMemberInfo {
  host: string;
  role: string;
  state: string;
  stateCode?: number;
  healthy: boolean;
  isSelf?: boolean;
}

export interface SavedConnection {
  id: string;
  name: string;
  config: ConnectionConfig;
  includeDatabases?: string[];
  includeRedisDatabases?: number[]; // Redis databases to show (0-15)
  iconType?: string;   // 自定义图标类型（如 'mysql','postgres'），不填则取 config.type
  iconColor?: string;  // 自定义图标颜色（十六进制），不填则取类型默认色
}

export interface ConnectionTag {
  id: string;
  name: string;
  connectionIds: string[];
}

export interface ColumnDefinition {
  name: string;
  type: string;
  nullable: string;
  key: string;
  default?: string;
  extra: string;
  comment: string;
}

export interface IndexDefinition {
  name: string;
  columnName: string;
  nonUnique: number;
  seqInIndex: number;
  indexType: string;
}

export interface ForeignKeyDefinition {
  name: string;
  columnName: string;
  refTableName: string;
  refColumnName: string;
  constraintName: string;
}

export interface TriggerDefinition {
  name: string;
  timing: string;
  event: string;
  statement: string;
}

export interface TabData {
  id: string;
  title: string;
  type: 'query' | 'table' | 'design' | 'redis-keys' | 'redis-command' | 'redis-monitor' | 'trigger' | 'view-def' | 'routine-def' | 'table-overview';
  connectionId: string;
  dbName?: string;
  tableName?: string;
  query?: string;
  initialTab?: string;
  readOnly?: boolean;
  redisDB?: number; // Redis database index for redis tabs
  triggerName?: string; // Trigger name for trigger tabs
  viewName?: string; // View name for view definition tabs
  routineName?: string; // Routine name for function/procedure definition tabs
  routineType?: string; // 'FUNCTION' or 'PROCEDURE'
  savedQueryId?: string; // Saved query identity for quick-save behavior
}

export interface DatabaseNode {
  title: string;
  key: string;
  isLeaf?: boolean;
  children?: DatabaseNode[];
  icon?: any;
}

export interface SavedQuery {
  id: string;
  name: string;
  sql: string;
  connectionId: string;
  dbName: string;
  createdAt: number;
}

// Redis types
export interface RedisKeyInfo {
  key: string;
  type: string;
  ttl: number;
}

export interface RedisScanResult {
  keys: RedisKeyInfo[];
  cursor: string;
}

export interface RedisValue {
  type: 'string' | 'hash' | 'list' | 'set' | 'zset' | 'stream';
  ttl: number;
  value: any;
  length: number;
}

export interface RedisDBInfo {
  index: number;
  keys: number;
}

export interface ZSetMember {
  member: string;
  score: number;
}

export interface StreamEntry {
  id: string;
  fields: Record<string, string>;
}

// --- AI Types ---

export type AIProviderType = 'openai' | 'anthropic' | 'gemini' | 'custom';
export type AISafetyLevel = 'readonly' | 'readwrite' | 'full';
export type AIContextLevel = 'schema_only' | 'with_samples' | 'with_results';

export interface AIContextItem {
  dbName: string;
  tableName: string;
  ddl: string;
}

export interface AIProviderConfig {
  id: string;
  type: AIProviderType;
  name: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  models?: string[];
  apiFormat?: string; // custom 专用: openai | anthropic | gemini | claude-cli
  headers?: Record<string, string>;
  maxTokens: number;
  temperature: number;
}

export interface AIToolCall {
  id: string;
  type: string;
  function: {
    name: string;
    arguments: string;
  };
}

export type ChatPhase = 'idle' | 'connecting' | 'thinking' | 'generating' | 'tool_calling';

export interface AIChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  phase?: ChatPhase;
  content: string;
  thinking?: string;
  timestamp: number;
  loading?: boolean;
  images?: string[]; // base64 encoded images with data URI prefix
  tool_calls?: AIToolCall[];
  tool_call_id?: string;
  tool_name?: string; // used for UI display
  rawError?: string; // 存储未清洗的原始错误信息，用于用户复制排查
  success?: boolean; // 标记探针执行是否成功
}

export interface AISafetyResult {
  allowed: boolean;
  operationType: 'query' | 'dml' | 'ddl' | 'other';
  requiresConfirm: boolean;
  warningMessage?: string;
}

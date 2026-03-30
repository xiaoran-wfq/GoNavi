import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Button, Space, message } from 'antd';
import { PlayCircleOutlined, ClearOutlined } from '@ant-design/icons';
import { useStore } from '../store';
import Editor, { OnMount } from '@monaco-editor/react';

interface RedisCommandEditorProps {
    connectionId: string;
    redisDB: number;
}

interface CommandResult {
    command: string;
    result: any;
    error?: string;
    timestamp: number;
    durationMs: number;
}

// 智能解析 Redis 脚本块，保护多行引号内的换行符
function parseRedisScriptBlocks(script: string): string[] {
    const blocks: string[] = [];
    let currentBlock = "";
    let inQuote: string | null = null;
    let isEscaping = false;

    const lines = script.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();

        if (!inQuote && (trimmed === '' || trimmed.startsWith('//') || trimmed.startsWith('#'))) {
            continue;
        }

        for (let j = 0; j < line.length; j++) {
            const char = line[j];
            
            if (isEscaping) {
                isEscaping = false;
                currentBlock += char;
                continue;
            }

            if (char === '\\') {
                isEscaping = true;
                currentBlock += char;
                continue;
            }

            if (char === '"' || char === "'") {
                if (inQuote === char) {
                    inQuote = null;
                } else if (!inQuote) {
                    inQuote = char;
                }
            }

            currentBlock += char;
        }

        if (inQuote || (i < lines.length - 1 && currentBlock.trim() !== '')) {
            if (!inQuote) {
                blocks.push(currentBlock.trim());
                currentBlock = "";
            } else {
                currentBlock += '\n';
            }
        }
    }

    if (currentBlock.trim() !== '') {
        blocks.push(currentBlock.trim());
    }

    return blocks.filter(b => b.trim() !== '');
}

const RedisCommandEditor: React.FC<RedisCommandEditorProps> = ({ connectionId, redisDB }) => {
    const { connections } = useStore();
    const connection = connections.find(c => c.id === connectionId);

    const [command, setCommand] = useState('');
    const [results, setResults] = useState<CommandResult[]>([]);
    const [loading, setLoading] = useState(false);
    
    // UI Layout state
    const [editorHeight, setEditorHeight] = useState(250);
    const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const resultsEndRef = useRef<HTMLDivElement>(null);
    
    const editorRef = useRef<any>(null);

    const getConfig = useCallback(() => {
        if (!connection) return null;
        return {
            ...connection.config,
            port: Number(connection.config.port),
            password: connection.config.password || "",
            useSSH: connection.config.useSSH || false,
            ssh: connection.config.ssh || { host: "", port: 22, user: "", password: "", keyPath: "" },
            redisDB: redisDB
        };
    }, [connection, redisDB]);

    const handleEditorMount: OnMount = (editor, monaco) => {
        editorRef.current = editor;
        editor.addCommand(
            monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter,
            () => handleExecute()
        );

        if (!(window as any).__redisCompletionRegistered) {
            (window as any).__redisCompletionRegistered = true;
            
            const redisCommands = [
                "APPEND", "AUTH", "BGREWRITEAOF", "BGSAVE", "BITCOUNT", "BITFIELD", "BITOP", 
                "BITPOS", "BLPOP", "BRPOP", "BRPOPLPUSH", "BZMPOP", "BZPOPMIN", "BZPOPMAX",
                "CLIENT", "CLUSTER", "COMMAND", "CONFIG", "DBSIZE", "DEBUG", "DECR", "DECRBY",
                "DEL", "DISCARD", "DUMP", "ECHO", "EVAL", "EVALSHA", "EXEC", "EXISTS", "EXPIRE",
                "EXPIREAT", "EXPIRETIME", "FLUSHALL", "FLUSHDB", "GEOADD", "GEODIST", "GEOHASH",
                "GEOPOS", "GEORADIUS", "GEORADIUSBYMEMBER", "GEOSEARCH", "GEOSEARCHSTORE",
                "GET", "GETBIT", "GETDEL", "GETEX", "GETRANGE", "GETSET", "HDEL", "HELLO", 
                "HEXISTS", "HGET", "HGETALL", "HINCRBY", "HINCRBYFLOAT", "HKEYS", "HLEN", 
                "HMGET", "HMSET", "HSCAN", "HSET", "HSETNX", "HSTRLEN", "HVALS", "INCR", 
                "INCRBY", "INCRBYFLOAT", "INFO", "KEYS", "LASTSAVE", "LCS", "LINDEX", "LINSERT",
                "LLEN", "LMOVE", "LMPOP", "LPOP", "LPOS", "LPUSH", "LPUSHX", "LRANGE", "LREM",
                "LSET", "LTRIM", "MEMORY", "MGET", "MIGRATE", "MODULE", "MONITOR", "MOVE", "MSET",
                "MSETNX", "MULTI", "OBJECT", "PERSIST", "PEXPIRE", "PEXPIREAT", "PEXPIRETIME",
                "PFADD", "PFCOUNT", "PFMERGE", "PING", "PSETEX", "PSUBSCRIBE", "PTTL", "PUBLISH",
                "PUBSUB", "PUNSUBSCRIBE", "QUIT", "RANDOMKEY", "READONLY", "READWRITE", "RENAME",
                "RENAMENX", "RESET", "RESTORE", "ROLE", "RPOP", "RPOPLPUSH", "RPUSH", "RPUSHX",
                "SADD", "SAVE", "SCAN", "SCARD", "SCRIPT", "SDIFF", "SDIFFSTORE", "SELECT",
                "SET", "SETBIT", "SETEX", "SETNX", "SETRANGE", "SHUTDOWN", "SINTER", "SINTERCARD",
                "SINTERSTORE", "SISMEMBER", "SLAVEOF", "SLOWLOG", "SMEMBERS", "SMISMEMBER",
                "SMOVE", "SORT", "SORT_RO", "SPOP", "SRANDMEMBER", "SREM", "SSCAN", "STRLEN",
                "SUBSCRIBE", "SUNION", "SUNIONSTORE", "SWAPDB", "SYNC", "TIME", "TOUCH", "TTL",
                "TYPE", "UNLINK", "UNSUBSCRIBE", "UNWATCH", "WAIT", "WATCH", "XACK", "XADD",
                "XAUTOCLAIM", "XCLAIM", "XDEL", "XGROUP", "XINFO", "XLEN", "XPENDING", "XRANGE",
                "XREAD", "XREADGROUP", "XREVRANGE", "XTRIM", "ZADD", "ZCARD", "ZCOUNT", "ZDIFF",
                "ZDIFFSTORE", "ZINCRBY", "ZINTER", "ZINTERCARD", "ZINTERSTORE", "ZLEXCOUNT",
                "ZMPOP", "ZMSCORE", "ZPOPMAX", "ZPOPMIN", "ZRANDMEMBER", "ZRANGE", "ZRANGEBYLEX",
                "ZRANGEBYSCORE", "ZRANK", "ZREM", "ZREMRANGEBYLEX", "ZREMRANGEBYRANK",
                "ZREMRANGEBYSCORE", "ZREVRANGE", "ZREVRANGEBYLEX", "ZREVRANGEBYSCORE", "ZREVRANK",
                "ZSCAN", "ZSCORE", "ZUNION", "ZUNIONSTORE"
            ];
            
            monaco.languages.registerCompletionItemProvider('redis', {
                provideCompletionItems: (model: any, position: any) => {
                    const word = model.getWordUntilPosition(position);
                    const range = {
                        startLineNumber: position.lineNumber,
                        endLineNumber: position.lineNumber,
                        startColumn: word.startColumn,
                        endColumn: word.endColumn
                    };
                    return {
                        suggestions: redisCommands.map(cmd => ({
                            label: cmd,
                            kind: monaco.languages.CompletionItemKind.Keyword,
                            insertText: cmd,
                            range: range,
                            detail: "Redis Command"
                        }))
                    };
                }
            });
        }
    };

    const handleExecute = async () => {
        const config = getConfig();
        if (!config) return;

        let cmdToExecute = '';
        
        // 1. 获取用户是否有高亮选中的文本
        const selection = editorRef.current?.getSelection();
        if (selection && !selection.isEmpty()) {
            cmdToExecute = editorRef.current?.getModel()?.getValueInRange(selection) || '';
        } else {
            // 没有选中则取全部文本
            cmdToExecute = editorRef.current?.getValue() || '';
        }

        cmdToExecute = cmdToExecute.trim();
        if (!cmdToExecute) {
            message.warning('请输入要执行的命令');
            return;
        }

        // 2. 智能解析多行命令
        const commands = parseRedisScriptBlocks(cmdToExecute);
        if (commands.length === 0) return;

        setLoading(true);
        const newResults: CommandResult[] = [];

        for (const cmd of commands) {
            const start = Date.now();
            try {
                const res = await (window as any).go.app.App.RedisExecuteCommand(config, cmd);
                newResults.push({
                    command: cmd,
                    result: res.success ? res.data : null,
                    error: res.success ? undefined : res.message,
                    timestamp: Date.now(),
                    durationMs: Date.now() - start
                });
            } catch (e: any) {
                newResults.push({
                    command: cmd,
                    result: null,
                    error: e?.message || String(e),
                    timestamp: Date.now(),
                    durationMs: Date.now() - start
                });
            }
        }

        setResults(prev => [...prev, ...newResults]);
        setLoading(false);
    };
    
    // Auto scroll to bottom when new results arrive
    useEffect(() => {
        if (resultsEndRef.current) {
            resultsEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [results]);

    const handleClear = () => {
        setResults([]);
    };

    const formatResult = (result: any): React.ReactNode => {
        if (result === null || result === undefined) {
            return <span style={{ color: '#569cd6' }}>(nil)</span>;
        }
        if (typeof result === 'string') {
            // 尝试美化 JSON 字符串
            try {
                const parsed = JSON.parse(result);
                if (typeof parsed === 'object' && parsed !== null) {
                    return (
                        <div style={{ marginTop: 4, padding: 8, background: 'rgba(0,0,0,0.2)', borderRadius: 4 }}>
                            {JSON.stringify(parsed, null, 2)}
                        </div>
                    );
                }
            } catch (e) {
                // not a valid json, just return string
            }
            return <span style={{ color: '#ce9178' }}>"{result}"</span>;
        }
        if (typeof result === 'number') {
            return <span style={{ color: '#b5cea8' }}>(integer) {result}</span>;
        }
        if (Array.isArray(result)) {
            if (result.length === 0) {
                return '(empty array)';
            }
            return (
                <div style={{ marginLeft: 8 }}>
                    {result.map((item, index) => (
                        <div key={index} style={{ display: 'flex' }}>
                            <span style={{ color: '#608b4e', marginRight: 8, userSelect: 'none' }}>{index + 1})</span>
                            <div>{formatResult(item)}</div>
                        </div>
                    ))}
                </div>
            );
        }
        if (typeof result === 'object') {
            return JSON.stringify(result, null, 2);
        }
        return String(result);
    };

    // Resizing logic
    const handleDragStart = (e: React.MouseEvent) => {
        e.preventDefault();
        dragRef.current = { startY: e.clientY, startHeight: editorHeight };
        document.addEventListener('mousemove', handleDragMove);
        document.addEventListener('mouseup', handleDragEnd);
        document.body.style.cursor = 'row-resize';
    };

    const handleDragMove = useCallback((e: MouseEvent) => {
        if (!dragRef.current) return;
        const delta = e.clientY - dragRef.current.startY;
        let newHeight = dragRef.current.startHeight + delta;
        
        // 限制高度
        const minHeight = 100;
        const maxHeight = containerRef.current ? containerRef.current.clientHeight - 100 : 800;
        if (newHeight < minHeight) newHeight = minHeight;
        if (newHeight > maxHeight) newHeight = maxHeight;
        
        setEditorHeight(newHeight);
        
        // 更新编辑器布局
        if (editorRef.current) {
            editorRef.current.layout();
        }
    }, []);

    const handleDragEnd = useCallback(() => {
        dragRef.current = null;
        document.removeEventListener('mousemove', handleDragMove);
        document.removeEventListener('mouseup', handleDragEnd);
        document.body.style.cursor = 'default';
        if (editorRef.current) {
            editorRef.current.layout();
        }
    }, [handleDragMove]);

    if (!connection) {
        return <div style={{ padding: 20 }}>连接不存在</div>;
    }

    return (
        <div ref={containerRef} style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: '#fff' }}>
            {/* Editor Top Pane */}
            <div style={{ height: editorHeight, minHeight: 100, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fdfdfd' }}>
                    <Space>
                        <span style={{ fontWeight: 600 }}>Redis Console</span>
                        <span style={{ color: '#888', fontSize: 13, background: '#f0f0f0', padding: '2px 8px', borderRadius: 12 }}>db{redisDB}</span>
                    </Space>
                    <Space>
                        <Button
                            type="primary"
                            icon={<PlayCircleOutlined />}
                            onClick={handleExecute}
                            loading={loading}
                        >
                            执行 (Cmd+Enter)
                        </Button>
                    </Space>
                </div>
                <div style={{ flex: 1, position: 'relative' }}>
                    <Editor
                        defaultLanguage="redis"
                        language="redis"
                        value={command}
                        onChange={(value) => setCommand(value || '')}
                        onMount={handleEditorMount}
                        options={{
                            minimap: { enabled: false },
                            lineNumbers: 'on',
                            fontSize: 14,
                            wordWrap: 'on',
                            scrollBeyondLastLine: false,
                            automaticLayout: true,
                            tabSize: 4,
                            padding: { top: 10, bottom: 10 }
                        }}
                    />
                </div>
            </div>

            {/* Resizer Handle */}
            <div 
                className="horizontal-resizer"
                onMouseDown={handleDragStart}
                style={{ 
                    height: 8, 
                    cursor: 'row-resize', 
                    background: '#f0f0f0', 
                    borderTop: '1px solid #e0e0e0',
                    borderBottom: '1px solid #e0e0e0',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 10
                }}
            >
                <div style={{ width: 40, height: 4, background: '#ccc', borderRadius: 2 }} />
            </div>

            {/* Results Terminal Bottom Pane */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                 <div style={{ padding: '4px 12px', background: '#252526', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #333' }}>
                    <span style={{ color: '#ccc', fontSize: 12 }}>Execution Output</span>
                    <Button type="text" size="small" icon={<ClearOutlined />} onClick={handleClear} style={{ color: '#aaa' }}>清空控制台</Button>
                </div>
                <div style={{ flex: 1, overflow: 'auto', background: '#1e1e1e', color: '#d4d4d4', fontFamily: '"Consolas", "Courier New", monospace', fontSize: 13, padding: 12 }}>
                    {results.length === 0 ? (
                        <div style={{ color: '#666', textAlign: 'center', marginTop: 40 }}>
                            <div>在此终端执行命令，结果会以原样输出</div>
                            <div style={{ fontSize: 12, marginTop: 12 }}>
                                Tips: <code>选中任意行</code> 按 <code style={{ color: '#999' }}>Ctrl + Enter</code> 仅执行选中段落
                            </div>
                        </div>
                    ) : (
                        results.map((item, index) => (
                            <div key={item.timestamp + index} style={{ marginBottom: 16 }}>
                                <div style={{ color: '#569cd6', marginBottom: 6, fontWeight: 'bold' }}>
                                    <span style={{ color: '#4CAF50', marginRight: 8 }}>➜</span>
                                    {item.command}
                                    <span style={{ color: '#666', fontSize: 11, marginLeft: 12, fontWeight: 'normal' }}>[{item.durationMs}ms]</span>
                                </div>
                                
                                <div style={{ paddingLeft: 20 }}>
                                    {item.error ? (
                                        <div style={{ color: '#f14c4c', whiteSpace: 'pre-wrap' }}>
                                            (error) {item.error}
                                        </div>
                                    ) : (
                                        <div style={{ whiteSpace: 'pre-wrap' }}>
                                            {formatResult(item.result)}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))
                    )}
                    <div ref={resultsEndRef} />
                </div>
            </div>
        </div>
    );
};

export default RedisCommandEditor;

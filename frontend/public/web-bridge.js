// web-bridge.js
// 这个脚本将在非 Wails 环境下提供 window.go 和 window.runtime 的 Mock
// 并将调用重定向到后端 API

(function() {
    if (typeof window === 'undefined') return;
    
    // 如果已经存在 wails 环境，则不进行拦截
    if (window.go && !window._is_web_bridge) return;

    window._is_web_bridge = true;

    const eventListeners = {};
    let socket = null;

    function getSocket() {
        if (socket && socket.readyState === WebSocket.OPEN) return socket;
        
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
        
        socket.onmessage = async function(event) {
            const data = JSON.parse(event.data);
            const { name, args } = data;
            if (name === "WebRequestOpenFileDialog") {
                const payload = args[0] || {};
                const path = await window.runtime.OpenFileDialog(payload.options || {});
                fetch("/api/dialog_response", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ requestID: payload.requestID, path: path || "" }) });
                return;
            }
            if (name === "WebRequestSaveFileDialog") {
                const payload = args[0] || {};
                const path = await window.runtime.SaveFileDialog(payload.options || {});
                fetch("/api/dialog_response", { method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({ requestID: payload.requestID, path: path || "" }) });
                return;
            }
            if (eventListeners[name]) {
                eventListeners[name].forEach(handler => handler(...(args || [])));
            }
        };

        socket.onclose = function() {
            setTimeout(getSocket, 3000); // 自动重连
        };

        return socket;
    }

    // 初始化 WebSocket
    getSocket();

    async function rpcCall(service, method, args) {
        const response = await fetch('/api/rpc', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ service, method, args })
        });
        const result = await response.json();
        if (!result.success) {
            throw new Error(result.message || 'RPC call failed');
        }
        
        // 自动下载：如果结果是一个包含 Success:true 且数据看起来像文件路径的对象（例如 Export 结果）
        // 原项目的 QueryResult 通常结构为 { Success, Message, Data }
        if (result.data && result.data.Success && typeof result.data.Data === 'string' && 
           (method.startsWith('Export') || method.startsWith('Backup'))) {
            const filePath = result.data.Data;
            if (filePath.includes('/tmp/') || filePath.includes('gonavi_export')) {
                 window.location.href = `/api/download?path=${encodeURIComponent(filePath)}`;
            }
        }

        return result.data;
    }

    // Proxy for window.go
    window.go = new Proxy({}, {
        get(target, serviceNamespace) {
            return new Proxy({}, {
                get(target, serviceName) {
                    return new Proxy({}, {
                        get(target, methodName) {
                            return (...args) => rpcCall(serviceName, methodName, args);
                        }
                    });
                }
            });
        }
    });

    // Mock window.runtime
    window.runtime = {
        async OpenFileDialog(options) {
            return new Promise((resolve, reject) => {
                const input = document.createElement('input');
                input.type = 'file';
                input.style.display = 'none';
                document.body.appendChild(input);

                input.onchange = async (e) => {
                    const file = e.target.files[0];
                    if (!file) {
                        document.body.removeChild(input);
                        resolve("");
                        return;
                    }

                    const formData = new FormData();
                    formData.append('file', file);

                    try {
                        const response = await fetch('/api/upload', {
                            method: 'POST',
                            body: formData
                        });
                        const result = await response.json();
                        document.body.removeChild(input);
                        if (result.success) {
                            resolve(result.file_path);
                        } else {
                            alert('Upload failed: ' + result.message);
                            resolve("");
                        }
                    } catch (err) {
                        document.body.removeChild(input);
                        alert('Upload error: ' + err.message);
                        resolve("");
                    }
                };

                input.click();
            });
        },
        async SaveFileDialog(options) {
            // Web 端无法指定保存路径，这里简单的返回一个虚拟路径。
            // 后端在调用这个方法获取路径后，会写入文件。
            // 我们需要一种方式通知用户下载这个文件。
            // 解决方案：后端写入后，通过 RPC 返回路径，前端监听并触发 /api/download?path=...
            const randomId = Math.random().toString(36).substring(7);
            const ext = options.DefaultFilename ? options.DefaultFilename.split('.').pop() : 'txt';
            return `/tmp/gonavi_export_${randomId}.${ext}`;
        },
        async MessageDialog(options) {
            alert(`${options.Title || 'Message'}\n\n${options.Message}`);
            return "ok";
        },
        EventsOnMultiple(name, handler, maxCallbacks) {
            let counter = 0;
            const wrappedHandler = (...args) => {
                if (maxCallbacks > 0) {
                    counter++;
                    if (counter > maxCallbacks) {
                        this.EventsOff(name, wrappedHandler);
                        return;
                    }
                }
                handler(...args);
            };
            if (!eventListeners[name]) eventListeners[name] = [];
            eventListeners[name].push(wrappedHandler);
            return () => this.EventsOff(name, wrappedHandler);
        },
        EventsOffAll(name) {
            if (name) {
                delete eventListeners[name];
            } else {
                for (const key in eventListeners) delete eventListeners[key];
            }
        },
        EventsOn(name, handler) {
            if (!eventListeners[name]) eventListeners[name] = [];
            eventListeners[name].push(handler);
            return () => this.EventsOff(name, handler);
        },
        EventsOff(name, handler) {
            if (!eventListeners[name]) return;
            eventListeners[name] = eventListeners[name].filter(h => h !== handler);
        },
        EventsEmit(name, ...args) {
            // Web 端目前不一定需要向后端 Emit，看具体逻辑
            console.log('EventsEmit', name, args);
        },
        WindowIsMaximised: async () => false,
        WindowIsFullscreen: async () => false,
        BrowserOpenURL: (url) => window.open(url, '_blank'),
        LogInfo: (msg) => console.log(msg),
        LogDebug: (msg) => console.debug(msg),
        LogWarning: (msg) => console.warn(msg),
        LogError: (msg) => console.error(msg),
        Quit: () => console.log('Quit requested'),
        Environment: async () => ({ platform: 'web', buildType: 'production' }),
    };
})();

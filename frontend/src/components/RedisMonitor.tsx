import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Card, Row, Col, Statistic, Select, Button, message, Tag, Typography, Tooltip, Spin } from 'antd';
import { AreaChart, Area, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, CartesianGrid, Legend, LineChart, Line } from 'recharts';
import {
  DesktopOutlined,
  DashboardOutlined,
  ApiOutlined,
  HddOutlined,
  ReloadOutlined,
  PlayCircleOutlined,
  PauseCircleOutlined
} from '@ant-design/icons';
import { useStore } from '../store';
import { SavedConnection } from '../types';
import { RedisGetServerInfo } from '../../wailsjs/go/app/App';

const { Title, Text } = Typography;

interface RedisMonitorProps {
  connectionId: string;
  redisDB: number;
}

// Data point for charts
interface MetricPoint {
  time: string;
  qps: number;
  memory: number; // in MB
  memory_rss: number; // in MB
  clients: number;
  cpuSys: number;
  cpuUser: number;
  hitRate: number;
  keys: number;
}

const MAX_HISTORY_POINTS = 60; // Keep up to 60 data points

const RedisMonitor: React.FC<RedisMonitorProps> = ({ connectionId, redisDB }) => {
  const connections = useStore(state => state.connections);
  const theme = useStore(state => state.theme);
  const darkMode = theme === 'dark';

  const [isRunning, setIsRunning] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  const [history, setHistory] = useState<MetricPoint[]>([]);
  const [currentInfo, setCurrentInfo] = useState<Record<string, string>>({});
  
  // Ref to track if component is mounted to prevent state updates after unmount
  const mountedRef = useRef(true);
  // Interval ref
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  // Previous ops counter to calculate QPS if instantaneous_ops_per_sec is not enough
  const prevMetricsRef = useRef({ prevOps: 0, prevTime: 0 });

  const connection = connections.find((c: SavedConnection) => c.id === connectionId);

  const fetchMetrics = async () => {
    if (!connection) return;

    try {
      const config = { ...connection.config, redisDB } as any;
      const res = await RedisGetServerInfo(config);
      
      if (!mountedRef.current) return;

      if (!res.success) {
        setError(res.message || 'Failed to fetch Redis info');
        return;
      }

      setError(null);
      const infoMap = res.data as Record<string, string>;
      setCurrentInfo(infoMap);

      const now = new Date();
      const timeStr = now.toLocaleTimeString([], { hour12: false, second: '2-digit' });
      
      // Parse values
      const qps = parseInt(infoMap['instantaneous_ops_per_sec'] || '0', 10);
      const memBytes = parseInt(infoMap['used_memory'] || '0', 10);
      const memRssBytes = parseInt(infoMap['used_memory_rss'] || '0', 10);
      const clients = parseInt(infoMap['connected_clients'] || '0', 10);
      const cpuSys = parseFloat(infoMap['used_cpu_sys'] || '0');
      const cpuUser = parseFloat(infoMap['used_cpu_user'] || '0');
      
      const hits = parseInt(infoMap['keyspace_hits'] || '0', 10);
      const misses = parseInt(infoMap['keyspace_misses'] || '0', 10);
      const hitRate = (hits + misses) > 0 ? (hits / (hits + misses)) * 100 : 0;
      
      let keys = 0;
      Object.keys(infoMap).forEach(k => {
        if (k.startsWith('db')) {
          const m = infoMap[k].match(/keys=(\d+)/);
          if (m) keys += parseInt(m[1], 10);
        }
      });

      const point: MetricPoint = {
        time: timeStr,
        qps,
        memory: parseFloat((memBytes / 1024 / 1024).toFixed(2)),
        memory_rss: parseFloat((memRssBytes / 1024 / 1024).toFixed(2)),
        clients,
        cpuSys: parseFloat(cpuSys.toFixed(2)),
        cpuUser: parseFloat(cpuUser.toFixed(2)),
        hitRate: parseFloat(hitRate.toFixed(2)),
        keys
      };

      setHistory(prev => {
        const next = [...prev, point];
        if (next.length > MAX_HISTORY_POINTS) {
          return next.slice(next.length - MAX_HISTORY_POINTS);
        }
        return next;
      });

      if (loading) setLoading(false);

    } catch (err: any) {
      if (mountedRef.current) {
        setError(err.message || 'Unknown error');
        if (loading) setLoading(false);
      }
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    fetchMetrics(); // initial fetch
    return () => {
      mountedRef.current = false;
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    if (isRunning) {
      intervalRef.current = setInterval(fetchMetrics, 2000); // 2 second interval
    }
    
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRunning, connectionId, redisDB, connection]);

  if (!connection) {
    return <div style={{ padding: 20 }}>Connection not found.</div>;
  }

  // Determine styles for charts based on theme
  const chartTextColor = darkMode ? 'rgba(255,255,255,0.65)' : 'rgba(0,0,0,0.65)';
  const chartGridColor = darkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
  const cardBgColor = darkMode ? '#1f1f1f' : '#ffffff';
  
  const getFormatMemoryString = (bytes: string) => {
    const val = parseInt(bytes || '0', 10);
    if (val > 1024*1024*1024) return (val/1024/1024/1024).toFixed(2) + ' GB';
    if (val > 1024*1024) return (val/1024/1024).toFixed(2) + ' MB';
    if (val > 1024) return (val/1024).toFixed(2) + ' KB';
    return val + ' B';
  };

  const getUptimeString = (seconds: string) => {
    const d = parseInt(seconds || '0', 10);
    if (d < 60) return `${d}s`;
    if (d < 3600) return `${Math.floor(d/60)}m ${d%60}s`;
    if (d < 86400) return `${Math.floor(d/3600)}h ${Math.floor((d%3600)/60)}m`;
    return `${Math.floor(d/86400)}d ${Math.floor((d%86400)/3600)}h`;
  };

  return (
    <div style={{ height: '100%', overflow: 'auto', padding: '16px 24px', backgroundColor: darkMode ? '#141414' : '#f0f2f5' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <Title level={3} style={{ margin: 0, fontWeight: 600 }}>
            <DashboardOutlined style={{ marginRight: 8, color: '#1677ff' }} />
            Redis 实例监控
          </Title>
          <Text type="secondary">
            {connection.name} 
            {currentInfo.redis_version && ` •  Redis ${currentInfo.redis_version}`}
            {currentInfo.os && ` •  ${currentInfo.os}`}
          </Text>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          {error && <Tag color="error" style={{ height: 32, lineHeight: '30px', fontSize: 13 }}>{error}</Tag>}
          {loading && !error && <Spin style={{ alignSelf: 'center', marginRight: 16 }} />}
          
          <Button 
            type={isRunning ? "default" : "primary"}
            icon={isRunning ? <PauseCircleOutlined /> : <PlayCircleOutlined />} 
            onClick={() => setIsRunning(!isRunning)}
          >
            {isRunning ? '暂停刷新' : '恢复刷新'}
          </Button>
          <Button icon={<ReloadOutlined />} onClick={fetchMetrics}>
            立即刷新
          </Button>
        </div>
      </div>

      <Row gutter={[16, 16]}>
        <Col span={6}>
          <Card bordered={false} style={{ background: cardBgColor, borderRadius: 8, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}>
            <Statistic 
              title={<span style={{ fontWeight: 500 }}><DesktopOutlined /> 已用内存 (Used)</span>}
              value={getFormatMemoryString(currentInfo.used_memory || '0')}
              valueStyle={{ color: '#eb2f96', fontWeight: 600 }}
              suffix={<Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>Peak: {getFormatMemoryString(currentInfo.used_memory_peak || '0')}</Text>}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} style={{ background: cardBgColor, borderRadius: 8, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}>
            <Statistic 
              title={<span style={{ fontWeight: 500 }}><ApiOutlined /> 客户端数量 (Clients)</span>}
              value={currentInfo.connected_clients || '0'}
              valueStyle={{ color: '#1677ff', fontWeight: 600 }}
              suffix={<Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>Blocked: {currentInfo.blocked_clients || '0'}</Text>}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} style={{ background: cardBgColor, borderRadius: 8, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}>
            <Statistic 
              title={<span style={{ fontWeight: 500 }}><HddOutlined /> 吞吐量 (OPS)</span>}
              value={currentInfo.instantaneous_ops_per_sec || '0'}
              valueStyle={{ color: '#52c41a', fontWeight: 600 }}
              suffix={<Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>cmds/s</Text>}
            />
          </Card>
        </Col>
        <Col span={6}>
          <Card bordered={false} style={{ background: cardBgColor, borderRadius: 8, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}>
            <Statistic 
              title={<span style={{ fontWeight: 500 }}>启动时长 (Uptime)</span>}
              value={getUptimeString(currentInfo.uptime_in_seconds || '0')}
              valueStyle={{ color: '#fa8c16', fontWeight: 600 }}
              suffix={<Text type="secondary" style={{ fontSize: 13, marginLeft: 8 }}>Days: {currentInfo.uptime_in_days || '0'}</Text>}
            />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card 
            bordered={false} 
            title="请求吞吐量 (QPS)" 
            style={{ background: cardBgColor, borderRadius: 8, height: 350, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}
            styles={{ body: { padding: '16px 16px 0 0', height: 290 } }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorQps" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#52c41a" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#52c41a" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                <XAxis dataKey="time" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: cardBgColor, border: `1px solid ${chartGridColor}`, borderRadius: 6 }}
                  itemStyle={{ fontWeight: 600 }}
                />
                <Area type="monotone" dataKey="qps" name="QPS" stroke="#52c41a" strokeWidth={2} fillOpacity={1} fill="url(#colorQps)" isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        
        <Col span={12}>
          <Card 
            bordered={false} 
            title="内存开销 (Memory)" 
            style={{ background: cardBgColor, borderRadius: 8, height: 350, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}
            styles={{ body: { padding: '16px 16px 0 0', height: 290 } }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                <XAxis dataKey="time" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: cardBgColor, border: `1px solid ${chartGridColor}`, borderRadius: 6 }}
                  itemStyle={{ fontWeight: 600 }}
                  formatter={(value: any) => [`${value} MB`]}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" dataKey="memory" name="Used Memory" stroke="#eb2f96" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="memory_rss" name="RSS Memory" stroke="#722ed1" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={12}>
          <Card 
            bordered={false} 
            title="CPU 使用率 (CPU Usage)" 
            style={{ background: cardBgColor, borderRadius: 8, height: 300, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}
            styles={{ body: { padding: '16px 16px 0 0', height: 240 } }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                <XAxis dataKey="time" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: cardBgColor, border: `1px solid ${chartGridColor}`, borderRadius: 6 }}
                  itemStyle={{ fontWeight: 600 }}
                  formatter={(value: any) => [`${value} s`]}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line type="monotone" dataKey="cpuSys" name="System" stroke="#cf1322" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line type="monotone" dataKey="cpuUser" name="User" stroke="#1677ff" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        
        <Col span={12}>
          <Card 
            bordered={false} 
            title="连接信息 (Clients & Keys)" 
            style={{ background: cardBgColor, borderRadius: 8, height: 300, boxShadow: '0 1px 2px 0 rgba(0,0,0,0.03)' }}
            styles={{ body: { padding: '16px 16px 0 0', height: 240 } }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={history} margin={{ top: 10, right: 10, left: 10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={chartGridColor} />
                <XAxis dataKey="time" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} minTickGap={20} />
                <YAxis yAxisId="left" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                <YAxis yAxisId="right" orientation="right" tick={{ fill: chartTextColor, fontSize: 12 }} axisLine={false} tickLine={false} />
                <RechartsTooltip 
                  contentStyle={{ backgroundColor: cardBgColor, border: `1px solid ${chartGridColor}`, borderRadius: 6 }}
                  itemStyle={{ fontWeight: 600 }}
                />
                <Legend verticalAlign="top" height={36}/>
                <Line yAxisId="left" type="stepAfter" dataKey="clients" name="Clients" stroke="#1677ff" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Line yAxisId="right" type="stepAfter" dataKey="keys" name="Total Keys" stroke="#fa8c16" strokeWidth={2} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <div style={{ marginTop: 24 }}>
        <Card bordered={false} title="详细服务器参数" style={{ background: cardBgColor, borderRadius: 8 }}>
          <div style={{ columnCount: 3, columnGap: 40 }}>
            {['redis_version', 'os', 'arch_bits', 'multiplexing_api', 'gcc_version', 'run_id', 'tcp_port', 'uptime_in_days', 'hz', 'lru_clock', 'role', 'maxmemory_human', 'maxmemory_policy', 'mem_fragmentation_ratio', 'keyspace_hits', 'keyspace_misses', 'total_connections_received'].map(key => (
              currentInfo[key] ? (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, borderBottom: `1px dashed ${chartGridColor}` }}>
                  <Text type="secondary">{key}</Text>
                  <Text strong>{currentInfo[key]}</Text>
                </div>
              ) : null
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
};

export default RedisMonitor;

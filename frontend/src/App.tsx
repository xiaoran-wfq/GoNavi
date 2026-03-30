import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Layout, Button, ConfigProvider, theme, message, Modal, Spin, Slider, Progress, Switch, Input, InputNumber, Select, Tooltip } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { PlusOutlined, ConsoleSqlOutlined, UploadOutlined, DownloadOutlined, CloudDownloadOutlined, BugOutlined, ToolOutlined, GlobalOutlined, InfoCircleOutlined, GithubOutlined, SkinOutlined, CheckOutlined, MinusOutlined, BorderOutlined, CloseOutlined, SettingOutlined, LinkOutlined, BgColorsOutlined, AppstoreOutlined, RobotOutlined } from '@ant-design/icons';
import { BrowserOpenURL, Environment, EventsOn, Quit, WindowFullscreen, WindowGetPosition, WindowGetSize, WindowIsFullscreen, WindowIsMaximised, WindowMaximise, WindowMinimise, WindowSetPosition, WindowSetSize, WindowToggleMaximise, WindowUnfullscreen } from '../wailsjs/runtime';
import Sidebar from './components/Sidebar';
import TabManager from './components/TabManager';
import ConnectionModal from './components/ConnectionModal';
import DataSyncModal from './components/DataSyncModal';
import DriverManagerModal from './components/DriverManagerModal';
import LogPanel from './components/LogPanel';
import AIChatPanel from './components/AIChatPanel';
import AISettingsModal from './components/AISettingsModal';
import { useStore } from './store';
import { SavedConnection } from './types';
import { blurToFilter, normalizeBlurForPlatform, normalizeOpacityForPlatform, isWindowsPlatform, resolveAppearanceValues } from './utils/appearance';
import { getMacNativeTitlebarPaddingLeft, getMacNativeTitlebarPaddingRight, shouldHandleMacNativeFullscreenShortcut, shouldSuppressMacNativeEscapeExit } from './utils/macWindow';
import { buildOverlayWorkbenchTheme } from './utils/overlayWorkbenchTheme';
import { getConnectionWorkbenchState } from './utils/startupReadiness';
import {
  SHORTCUT_ACTION_META,
  SHORTCUT_ACTION_ORDER,
  ShortcutAction,
  eventToShortcut,
  getShortcutDisplay,
  hasModifierKey,
  isEditableElement,
  isShortcutMatch,
  normalizeShortcutCombo,
} from './utils/shortcuts';
import {
  SIDEBAR_UTILITY_ITEM_KEYS,
  resolveAIEntryPlacement,
  resolveAIEdgeHandleAttachment,
  resolveAIEdgeHandleDockStyle,
  resolveAIEdgeHandleStyle,
} from './utils/aiEntryLayout';
import { ConfigureGlobalProxy, SetMacNativeWindowControls, SetWindowTranslucency } from '../wailsjs/go/app/App';
import './App.css';

const { Sider, Content } = Layout;
const MIN_UI_SCALE = 0.8;
const MAX_UI_SCALE = 1.25;
const MIN_FONT_SIZE = 12;
const MAX_FONT_SIZE = 20;
const DEFAULT_UI_SCALE = 1.0;
const DEFAULT_FONT_SIZE = 14;

const detectNavigatorPlatform = (): string => {
  if (typeof navigator === 'undefined') {
      return '';
  }
  const uaDataPlatform = (navigator as Navigator & {
      userAgentData?: { platform?: string };
  }).userAgentData?.platform;
  if (uaDataPlatform) {
      return uaDataPlatform;
  }
  return navigator.userAgent || '';
};

function App() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [isDriverModalOpen, setIsDriverModalOpen] = useState(false);
  const [editingConnection, setEditingConnection] = useState<SavedConnection | null>(null);
  const themeMode = useStore(state => state.theme);
  const setTheme = useStore(state => state.setTheme);
  const appearance = useStore(state => state.appearance);
  const setAppearance = useStore(state => state.setAppearance);
  const uiScale = useStore(state => state.uiScale);
  const setUiScale = useStore(state => state.setUiScale);
  const fontSize = useStore(state => state.fontSize);
  const setFontSize = useStore(state => state.setFontSize);
  const startupFullscreen = useStore(state => state.startupFullscreen);
  const setStartupFullscreen = useStore(state => state.setStartupFullscreen);
  const globalProxy = useStore(state => state.globalProxy);
  const setGlobalProxy = useStore(state => state.setGlobalProxy);
  const shortcutOptions = useStore(state => state.shortcutOptions);
  const updateShortcut = useStore(state => state.updateShortcut);
  const resetShortcutOptions = useStore(state => state.resetShortcutOptions);
  const darkMode = themeMode === 'dark';
  const effectiveUiScale = Math.min(MAX_UI_SCALE, Math.max(MIN_UI_SCALE, Number(uiScale) || DEFAULT_UI_SCALE));
  const effectiveFontSize = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(Number(fontSize) || DEFAULT_FONT_SIZE)));
  const tokenFontSize = Math.round(effectiveFontSize * effectiveUiScale);
  const tokenFontSizeSM = Math.max(10, Math.round(tokenFontSize * 0.86));
  const tokenFontSizeLG = Math.max(tokenFontSize + 1, Math.round(tokenFontSize * 1.14));
  const tokenControlHeight = Math.max(24, Math.round(32 * effectiveUiScale));
  const tokenControlHeightSM = Math.max(20, Math.round(24 * effectiveUiScale));
  const tokenControlHeightLG = Math.max(30, Math.round(40 * effectiveUiScale));
  const appComponentSize: 'small' | 'middle' | 'large' = effectiveUiScale <= 0.92 ? 'small' : (effectiveUiScale >= 1.12 ? 'large' : 'middle');
  const titleBarHeight = Math.max(28, Math.round(32 * effectiveUiScale));
  const titleBarButtonWidth = Math.max(40, Math.round(46 * effectiveUiScale));
  const floatingLogButtonHeight = Math.max(30, Math.round(34 * effectiveUiScale));
  const resolvedAppearance = resolveAppearanceValues(appearance);
  const effectiveOpacity = normalizeOpacityForPlatform(resolvedAppearance.opacity);
  const effectiveBlur = normalizeBlurForPlatform(resolvedAppearance.blur);
  const blurFilter = blurToFilter(effectiveBlur);
  const windowCornerRadius = 14;
  const [runtimePlatform, setRuntimePlatform] = useState('');
  const [isLinuxRuntime, setIsLinuxRuntime] = useState(false);
  const [isStoreHydrated, setIsStoreHydrated] = useState(() => useStore.persist.hasHydrated());
  const [hasAppliedInitialGlobalProxy, setHasAppliedInitialGlobalProxy] = useState(false);
  const sidebarWidth = useStore(state => state.sidebarWidth);
  const setSidebarWidth = useStore(state => state.setSidebarWidth);
  const aiPanelVisible = useStore(state => state.aiPanelVisible);
  const toggleAIPanel = useStore(state => state.toggleAIPanel);
  const setAIPanelVisible = useStore(state => state.setAIPanelVisible);
  const globalProxyInvalidHintShownRef = React.useRef(false);
  const connectionWorkbenchState = getConnectionWorkbenchState(isStoreHydrated, hasAppliedInitialGlobalProxy);

  // 同步 macOS 窗口透明度：opacity=1.0 且 blur=0 时关闭 NSVisualEffectView，
  // 避免 GPU 持续计算窗口背后的模糊合成
  useEffect(() => {
    try {
        void SetWindowTranslucency(resolvedAppearance.opacity, resolvedAppearance.blur).catch(() => undefined);
    } catch(e) { /* ignore */ }
  }, [resolvedAppearance.blur, resolvedAppearance.opacity]);

  useEffect(() => {
      let cancelled = false;
      try {
          Environment()
              .then((env) => {
                  if (cancelled) return;
                  const platform = String(env?.platform || '').toLowerCase();
                  setRuntimePlatform(platform);
                  setIsLinuxRuntime(platform === 'linux');
              })
              .catch(() => {
                  if (cancelled) return;
                  const platform = detectNavigatorPlatform();
                  const normalized = /linux/i.test(platform)
                      ? 'linux'
                      : (/mac/i.test(platform) ? 'darwin' : (/win/i.test(platform) ? 'windows' : ''));
                  setRuntimePlatform(normalized);
                  setIsLinuxRuntime(normalized === 'linux');
              });
      } catch(e) {
          if (cancelled) return;
          const platform = detectNavigatorPlatform();
          const normalized = /linux/i.test(platform)
              ? 'linux'
              : (/mac/i.test(platform) ? 'darwin' : (/win/i.test(platform) ? 'windows' : ''));
          setRuntimePlatform(normalized);
          setIsLinuxRuntime(normalized === 'linux');
      }
      return () => {
          cancelled = true;
      };
  }, []);

  useEffect(() => {
      if (isStoreHydrated) {
          return;
      }
      const unsubscribe = useStore.persist.onFinishHydration(() => {
          setIsStoreHydrated(true);
      });
      return () => {
          unsubscribe();
      };
  }, [isStoreHydrated]);

  useEffect(() => {
      if (!isStoreHydrated) {
          return;
      }

      const host = String(globalProxy.host || '').trim();
      const port = Number(globalProxy.port);
      const portValid = Number.isFinite(port) && port > 0 && port <= 65535;
      const invalidWhenEnabled = globalProxy.enabled && (!host || !portValid);

      if (invalidWhenEnabled) {
          if (!globalProxyInvalidHintShownRef.current) {
              void message.warning({
                  content: '全局代理已开启，但地址或端口无效，当前按未启用处理',
                  key: 'global-proxy-invalid',
              });
              globalProxyInvalidHintShownRef.current = true;
          }
      } else {
          globalProxyInvalidHintShownRef.current = false;
          void message.destroy('global-proxy-invalid');
      }

      const enabledForBackend = globalProxy.enabled && !invalidWhenEnabled;
      let cancelled = false;
      try {
          ConfigureGlobalProxy(enabledForBackend, {
              type: globalProxy.type,
              host,
              port: portValid ? port : (globalProxy.type === 'http' ? 8080 : 1080),
              user: String(globalProxy.user || '').trim(),
              password: globalProxy.password || '',
          })
              .then((res) => {
                  if (cancelled || res?.success) {
                      return;
                  }
                  void message.error({
                      content: '全局代理配置失败: ' + (res?.message || '未知错误'),
                      key: 'global-proxy-sync-error',
                  });
              })
              .catch((err) => {
                  if (cancelled) {
                      return;
                  }
                  const errMsg = err instanceof Error ? err.message : String(err || '未知错误');
                  void message.error({
                      content: '全局代理配置失败: ' + errMsg,
                      key: 'global-proxy-sync-error',
                  });
              })
              .finally(() => {
                  if (!cancelled) {
                      setHasAppliedInitialGlobalProxy(true);
                  }
              });
      } catch (e) {
          if (!cancelled) {
              setHasAppliedInitialGlobalProxy(true);
          }
          console.warn("Wails API: ConfigureGlobalProxy unavailable", e);
      }

      return () => {
          cancelled = true;
      };
  }, [
      isStoreHydrated,
      globalProxy.enabled,
      globalProxy.type,
      globalProxy.host,
      globalProxy.port,
      globalProxy.user,
      globalProxy.password,
  ]);

  useEffect(() => {
      let cancelled = false;
      let startupWindowTimer: number | null = null;
      const maxApplyAttempts = 6;
      const applyRetryDelayMs = 400;
      const settleDelayMs = 160;
      const useMaximiseForStartup = isWindowsPlatform();

      const checkStartupPreferenceApplied = async (): Promise<boolean> => {
          try {
              if (await WindowIsFullscreen()) {
                  return true;
              }
          } catch (_) {
              // ignore
          }
          try {
              if (await WindowIsMaximised()) {
                  return true;
              }
          } catch (_) {
              // ignore
          }
          return false;
      };

      const applyStartupWindowPreference = (attempt: number) => {
          if (startupWindowTimer !== null) {
              window.clearTimeout(startupWindowTimer);
          }
          startupWindowTimer = window.setTimeout(() => {
              if (cancelled) {
                  return;
              }
              if (!useStore.getState().startupFullscreen) {
                  return;
              }
              void Promise.resolve()
                  .then(async () => {
                      if (await checkStartupPreferenceApplied()) {
                          return;
                      }
                      // Windows 使用最大化，避免进入真正全屏后无法通过标题栏交互退出。
                      // 其他平台保持全屏优先、最大化兜底。
                      try {
                          if (useMaximiseForStartup) {
                              await WindowMaximise();
                              await new Promise((resolve) => window.setTimeout(resolve, settleDelayMs));
                          } else {
                              await WindowFullscreen();
                              await new Promise((resolve) => window.setTimeout(resolve, settleDelayMs));
                              if (await checkStartupPreferenceApplied()) {
                                  return;
                              }
                              await WindowMaximise();
                              await new Promise((resolve) => window.setTimeout(resolve, settleDelayMs));
                          }
                      } catch (e) {
                          console.warn("Wails Window APIs unavailable", e);
                      }
                      
                      if (await checkStartupPreferenceApplied()) {
                          return;
                      }
                      if (attempt < maxApplyAttempts) {
                          applyStartupWindowPreference(attempt + 1);
                      }
                  });
          }, applyRetryDelayMs);
      };

      const restoreWindowState = async () => {
          if (cancelled) return;
          const state = useStore.getState();
          // startupFullscreen 设置优先
          if (state.startupFullscreen) {
              applyStartupWindowPreference(1);
              return;
          }
          // 根据上次保存的窗口状态恢复
          const savedState = state.windowState;
          if (savedState === 'fullscreen') {
              applyStartupWindowPreference(1);
              return;
          }
          if (savedState === 'maximized') {
              try { await WindowMaximise(); } catch (_) {}
              return;
          }
          // 普通窗口：恢复尺寸和位置
          const bounds = state.windowBounds;
          if (!bounds || bounds.width < 400 || bounds.height < 300) return;
          try {
              WindowSetSize(bounds.width, bounds.height);
              WindowSetPosition(bounds.x, bounds.y);
          } catch (e) {
              console.warn('Failed to restore window bounds', e);
          }
      };

      if (useStore.persist.hasHydrated()) {
          void restoreWindowState();
      }
      const unsubscribeHydration = useStore.persist.onFinishHydration(() => {
          if (cancelled) {
              return;
          }
          void restoreWindowState();
      });

      return () => {
          cancelled = true;
          if (startupWindowTimer !== null) {
              window.clearTimeout(startupWindowTimer);
          }
          unsubscribeHydration();
      };
  }, []);

  // 定时保存窗口状态、尺寸与位置
  useEffect(() => {
      const SAVE_INTERVAL_MS = 2000;
      let lastSaved = '';

      const saveWindowState = async () => {
          try {
              const [isFs, isMax] = await Promise.all([
                  WindowIsFullscreen().catch(() => false),
                  WindowIsMaximised().catch(() => false),
              ]);

              // 保存窗口状态
              const store = useStore.getState();
              const newState = isFs ? 'fullscreen' : (isMax ? 'maximized' : 'normal');
              if (store.windowState !== newState) {
                  store.setWindowState(newState);
              }

              // 只在普通窗口模式下保存尺寸和位置
              if (isFs || isMax) return;

              const [size, pos] = await Promise.all([
                  WindowGetSize().catch(() => null),
                  WindowGetPosition().catch(() => null),
              ]);
              if (!size || !pos) return;
              const w = Math.trunc(Number(size.w || 0));
              const h = Math.trunc(Number(size.h || 0));
              const x = Math.trunc(Number(pos.x || 0));
              const y = Math.trunc(Number(pos.y || 0));
              if (w < 400 || h < 300) return;

              const key = `${w},${h},${x},${y}`;
              if (key === lastSaved) return;
              lastSaved = key;
              store.setWindowBounds({ width: w, height: h, x, y });
          } catch (e) {
              // 静默忽略
          }
      };

      const timer = window.setInterval(saveWindowState, SAVE_INTERVAL_MS);
      return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
      if (!isWindowsPlatform()) {
          return;
      }

      let cancelled = false;
      let inFlight = false;
      let lastRatio = Number(window.devicePixelRatio) || 1;
      let lastFixAt = 0;
      let activationTimer: number | null = null;

      const wait = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms));

      const fixWindowScaleIfNeeded = async () => {
          if (cancelled || inFlight) return;
          const now = Date.now();
          if (now - lastFixAt < 700) return;
          inFlight = true;
          try {
              const [isFullscreen, isMaximised] = await Promise.all([
                  WindowIsFullscreen().catch(() => false),
                  WindowIsMaximised().catch(() => false),
              ]);

              // 避免在全屏/最大化状态下强制改尺寸；这两种状态通常能自行保持 DPI 同步。
              if (isFullscreen || isMaximised) {
                  window.dispatchEvent(new Event('resize'));
                  lastFixAt = Date.now();
                  return;
              }

              const size = await WindowGetSize().catch(() => null);
              const width = Math.trunc(Number(size?.w || 0));
              const height = Math.trunc(Number(size?.h || 0));
              if (width <= 0 || height <= 0) {
                  window.dispatchEvent(new Event('resize'));
                  lastFixAt = Date.now();
                  return;
              }

              const nudgedWidth = width > 480 ? width - 1 : width + 1;
              try {
                  WindowSetSize(nudgedWidth, height);
                  await wait(28);
                  WindowSetSize(width, height);
              } catch(e) {}
              window.dispatchEvent(new Event('resize'));
              lastFixAt = Date.now();
          } catch(e) {
              console.warn("Wails Window APIs unavailable in fixWindowScaleIfNeeded", e);
          } finally {
              inFlight = false;
          }
      };

      const checkDevicePixelRatio = () => {
          if (cancelled) return;
          const currentRatio = Number(window.devicePixelRatio) || 1;
          if (Math.abs(currentRatio - lastRatio) < 0.02) {
              return;
          }
          lastRatio = currentRatio;
          void fixWindowScaleIfNeeded();
      };

      const scheduleActivationFix = () => {
          if (cancelled) return;
          if (activationTimer !== null) {
              window.clearTimeout(activationTimer);
          }
          activationTimer = window.setTimeout(() => {
              activationTimer = null;
              if (cancelled) return;
              void fixWindowScaleIfNeeded();
          }, 80);
      };

      const handleWindowFocus = () => {
          if (cancelled) return;
          checkDevicePixelRatio();
          scheduleActivationFix();
      };

      const handleVisibilityChange = () => {
          if (cancelled) return;
          if (document.visibilityState !== 'visible') {
              return;
          }
          checkDevicePixelRatio();
          scheduleActivationFix();
      };

      const handlePageShow = () => {
          if (cancelled) return;
          checkDevicePixelRatio();
          scheduleActivationFix();
      };

      const pollTimer = window.setInterval(checkDevicePixelRatio, 900);
      window.addEventListener('resize', checkDevicePixelRatio);
      window.addEventListener('focus', handleWindowFocus);
      window.addEventListener('pageshow', handlePageShow);
      document.addEventListener('visibilitychange', handleVisibilityChange);

      return () => {
          cancelled = true;
          if (activationTimer !== null) {
              window.clearTimeout(activationTimer);
          }
          window.clearInterval(pollTimer);
          window.removeEventListener('resize', checkDevicePixelRatio);
          window.removeEventListener('focus', handleWindowFocus);
          window.removeEventListener('pageshow', handlePageShow);
          document.removeEventListener('visibilitychange', handleVisibilityChange);
      };
  }, []);

  // Background Helper
  const getBg = (darkHex: string) => {
      if (!darkMode) return `rgba(255, 255, 255, ${effectiveOpacity})`; // Light mode usually white
      
      // Parse hex to rgb
      const hex = darkHex.replace('#', '');
      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${effectiveOpacity})`;
  };
  // Specific colors
  const bgMain = getBg('#141414');
  const bgContent = getBg('#1d1d1d');
  const floatingLogButtonBorderColor = darkMode ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.16)';
  const floatingLogButtonTextColor = darkMode ? 'rgba(255,255,255,0.92)' : 'rgba(0,0,0,0.82)';
  const floatingLogButtonBgColor = darkMode
      ? `rgba(34, 34, 34, ${Math.max(effectiveOpacity, 0.82)})`
      : `rgba(255, 255, 255, ${Math.max(effectiveOpacity, 0.9)})`;
  const floatingLogButtonShadow = darkMode
      ? '0 8px 22px rgba(0,0,0,0.38)'
      : '0 8px 20px rgba(0,0,0,0.16)';
  const isOpaqueUtilityMode = resolvedAppearance.opacity >= 0.999 && resolvedAppearance.blur <= 0;
  const utilityButtonBgAlpha = darkMode
      ? Math.max(0.28, Math.min(0.76, effectiveOpacity * 0.72))
      : Math.max(0.52, Math.min(0.92, effectiveOpacity * 0.9));
  const utilityButtonBgColor = isOpaqueUtilityMode
      ? 'transparent'
      : (darkMode
          ? `rgba(20, 26, 38, ${utilityButtonBgAlpha})`
          : `rgba(255, 255, 255, ${utilityButtonBgAlpha})`);
  const utilityButtonBorderColor = isOpaqueUtilityMode
      ? (darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.10)')
      : (darkMode
          ? `rgba(255,255,255,${Math.max(0.08, Math.min(0.18, effectiveOpacity * 0.16))})`
          : `rgba(16,24,40,${Math.max(0.06, Math.min(0.14, effectiveOpacity * 0.12))})`);
  const utilityButtonShadow = isOpaqueUtilityMode
      ? 'none'
      : (darkMode
          ? `0 8px 18px rgba(0,0,0,${Math.max(0.10, Math.min(0.22, effectiveOpacity * 0.24))})`
          : `0 8px 18px rgba(15,23,42,${Math.max(0.04, Math.min(0.12, effectiveOpacity * 0.12))})`);
  const isSidebarNarrow = sidebarWidth < 360;
  const isSidebarCompact = sidebarWidth < 320;
  const isSidebarUltraCompact = sidebarWidth < 260;
  const utilityButtonStyle = useMemo(() => ({
      height: Math.max(30, Math.round(32 * effectiveUiScale)),
      width: '100%',
      paddingInline: isSidebarCompact ? Math.max(8, Math.round(9 * effectiveUiScale)) : Math.max(10, Math.round(12 * effectiveUiScale)),
      borderRadius: 10,
      border: `1px solid ${utilityButtonBorderColor}`,
      background: utilityButtonBgColor,
      color: darkMode ? 'rgba(255,255,255,0.94)' : '#162033',
      boxShadow: utilityButtonShadow,
      backdropFilter: isOpaqueUtilityMode ? 'none' : blurFilter,
      WebkitBackdropFilter: isOpaqueUtilityMode ? 'none' : blurFilter,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: isSidebarCompact ? 4 : 6,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
      fontSize: isSidebarCompact ? 13 : 14,
  }), [blurFilter, darkMode, effectiveUiScale, isOpaqueUtilityMode, isSidebarCompact, utilityButtonBgColor, utilityButtonBorderColor, utilityButtonShadow]);
  const overlayTheme = useMemo(() => buildOverlayWorkbenchTheme(darkMode), [darkMode]);

  const sidebarQuickActionBaseStyle = useMemo(() => ({
      height: Math.max(34, Math.round(36 * effectiveUiScale)),
      borderRadius: 12,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingInline: Math.max(12, Math.round(14 * effectiveUiScale)),
      fontWeight: 700,
      boxShadow: darkMode ? '0 8px 18px rgba(0,0,0,0.16)' : '0 8px 16px rgba(15,23,42,0.08)',
      backdropFilter: blurFilter,
      WebkitBackdropFilter: blurFilter,
      minWidth: 0,
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }), [blurFilter, darkMode, effectiveUiScale]);
  const sidebarQueryActionStyle = useMemo(() => ({
      ...sidebarQuickActionBaseStyle,
      flex: '1 1 0',
      border: `1px solid ${darkMode ? 'rgba(255,255,255,0.12)' : 'rgba(16,24,40,0.10)'}`,
      background: darkMode ? `rgba(255,255,255,0.05)` : 'rgba(255,255,255,0.88)',
      color: darkMode ? 'rgba(255,255,255,0.92)' : '#162033',
    }), [darkMode, sidebarQuickActionBaseStyle]);
  const sidebarCreateConnectionActionStyle = useMemo(() => ({
      ...sidebarQuickActionBaseStyle,
      flex: '1 1 0',
      border: 'none',
      background: 'linear-gradient(135deg, rgba(255,214,102,0.96) 0%, rgba(240,183,39,0.92) 100%)',
      color: '#2a1f00',
    }), [sidebarQuickActionBaseStyle]);

  const utilityModalShellStyle = useMemo(() => ({
      background: overlayTheme.shellBg,
      border: overlayTheme.shellBorder,
      boxShadow: overlayTheme.shellShadow,
      backdropFilter: overlayTheme.shellBackdropFilter,
  }), [overlayTheme]);
  const utilityPanelStyle = useMemo(() => ({
      padding: 16,
      borderRadius: 14,
      border: overlayTheme.sectionBorder,
      background: overlayTheme.sectionBg,
  }), [overlayTheme]);
  const utilityMutedTextStyle = useMemo(() => ({
      color: overlayTheme.mutedText,
      fontSize: 12,
      lineHeight: 1.6,
  }), [overlayTheme]);
  const renderUtilityModalTitle = (icon: React.ReactNode, title: string, description: string) => (
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: overlayTheme.iconBg, color: overlayTheme.iconColor, flexShrink: 0 }}>
              {icon}
          </div>
          <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 700, color: overlayTheme.titleText }}>{title}</div>
              <div style={{ marginTop: 4, color: overlayTheme.mutedText, fontSize: 12, lineHeight: 1.6 }}>{description}</div>
          </div>
      </div>
  );
  const utilityActionCardStyle = useMemo(() => ({
      width: '100%',
      minHeight: 68,
      borderRadius: 14,
      border: overlayTheme.sectionBorder,
      background: overlayTheme.sectionBg,
      color: overlayTheme.titleText,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'flex-start',
      gap: 14,
      paddingInline: 16,
      boxShadow: 'none',
      fontSize: 15,
      fontWeight: 600,
  }), [overlayTheme]);
  const utilityActionHintStyle = useMemo(() => ({
      fontSize: 12,
      color: overlayTheme.mutedText,
      fontWeight: 400,
      marginTop: 2,
  }), [overlayTheme]);

  const sidebarHorizontalPadding = isSidebarCompact ? 8 : 10;
  
  const addTab = useStore(state => state.addTab);
  const activeContext = useStore(state => state.activeContext);
  const connections = useStore(state => state.connections);
  const addConnection = useStore(state => state.addConnection);
  const tabs = useStore(state => state.tabs);
  const activeTabId = useStore(state => state.activeTabId);
  const updateCheckInFlightRef = React.useRef(false);
  const updateDownloadInFlightRef = React.useRef(false);
  const updateUserDismissedRef = React.useRef(false);
  const updateDownloadedVersionRef = React.useRef<string | null>(null);
  const updateInstallTriggeredVersionRef = React.useRef<string | null>(null);
  const updateDownloadMetaRef = React.useRef<UpdateDownloadResultData | null>(null);
  const updateNotifiedVersionRef = React.useRef<string | null>(null);
  const updateMutedVersionRef = React.useRef<string | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const isAboutOpenRef = React.useRef(false);
  const [aboutLoading, setAboutLoading] = useState(false);
  const [aboutInfo, setAboutInfo] = useState<{ version: string; author: string; buildTime?: string; repoUrl?: string; issueUrl?: string; releaseUrl?: string; communityUrl?: string } | null>(null);
  const [aboutUpdateStatus, setAboutUpdateStatus] = useState<string>('');
  const [lastUpdateInfo, setLastUpdateInfo] = useState<UpdateInfo | null>(null);
  const [updateDownloadProgress, setUpdateDownloadProgress] = useState<{
      open: boolean;
      version: string;
      status: 'idle' | 'start' | 'downloading' | 'done' | 'error';
      percent: number;
      downloaded: number;
      total: number;
      message: string;
  }>({
      open: false,
      version: '',
      status: 'idle',
      percent: 0,
      downloaded: 0,
      total: 0,
      message: ''
  });

  type UpdateInfo = {
      hasUpdate: boolean;
      currentVersion: string;
      latestVersion: string;
      releaseName?: string;
      releaseNotesUrl?: string;
      assetName?: string;
      assetUrl?: string;
      assetSize?: number;
      sha256?: string;
      downloaded?: boolean;
      downloadPath?: string;
  };

  type UpdateDownloadProgressEvent = {
      status?: 'start' | 'downloading' | 'done' | 'error';
      percent?: number;
      downloaded?: number;
      total?: number;
      message?: string;
  };

  type UpdateDownloadResultData = {
      info?: UpdateInfo;
      downloadPath?: string;
      installLogPath?: string;
      installTarget?: string;
      platform?: string;
      autoRelaunch?: boolean;
  };

  const isMacRuntime = runtimePlatform === 'darwin'
      || (runtimePlatform === '' && /mac/i.test(detectNavigatorPlatform()));
  const isWebMode = runtimePlatform === "web";
  const isWindowsRuntime = runtimePlatform === 'windows'
      || (runtimePlatform === '' && isWindowsPlatform());
  const useNativeMacWindowControls = isMacRuntime && appearance.useNativeMacWindowControls === true;

  useEffect(() => {
      if (!isStoreHydrated || !isMacRuntime) {
          return;
      }

      try {
          void SetMacNativeWindowControls(useNativeMacWindowControls).catch(() => undefined);
      } catch (e) {
          console.warn('Wails API: SetMacNativeWindowControls unavailable', e);
      }
  }, [isMacRuntime, isStoreHydrated, useNativeMacWindowControls]);

  const formatBytes = (bytes?: number) => {
      if (!bytes || bytes <= 0) return '0 B';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let value = bytes;
      let idx = 0;
      while (value >= 1024 && idx < units.length - 1) {
          value /= 1024;
          idx++;
      }
      return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
  };

  const downloadUpdate = React.useCallback(async (info: UpdateInfo, silent: boolean) => {
      if (updateDownloadInFlightRef.current) return;
      if (updateDownloadedVersionRef.current === info.latestVersion) {
          if (!silent) {
              const cachedDownloadPath = updateDownloadMetaRef.current?.downloadPath;
              void message.info(cachedDownloadPath ? `更新包已就绪（${info.latestVersion}），路径：${cachedDownloadPath}` : `更新包已就绪（${info.latestVersion}）`);
              showUpdateDownloadProgress();
          }
          return;
      }
      updateDownloadInFlightRef.current = true;
      updateUserDismissedRef.current = false;
      updateDownloadMetaRef.current = null;
      setUpdateDownloadProgress({
          open: true,
          version: info.latestVersion,
          status: 'start',
          percent: 0,
          downloaded: 0,
          total: info.assetSize || 0,
          message: ''
      });
      let res: any = null;
      try {
          res = await (window as any).go.app.App.DownloadUpdate();
      } catch (e) {
          console.warn("Wails API: DownloadUpdate unavailable", e);
      }
      updateDownloadInFlightRef.current = false;
      if (res?.success) {
          const resultData = (res?.data || {}) as UpdateDownloadResultData;
          updateDownloadMetaRef.current = resultData;
          updateDownloadedVersionRef.current = info.latestVersion;
          setUpdateDownloadProgress(prev => {
              const total = prev.total > 0 ? prev.total : (info.assetSize || 0);
              return { ...prev, status: 'done', percent: 100, downloaded: total, total, message: '', open: false };
          });
          setLastUpdateInfo((prev) => {
              if (!prev || prev.latestVersion !== info.latestVersion) {
                  return {
                      ...info,
                      downloaded: true,
                      downloadPath: resultData?.downloadPath || info.downloadPath,
                  };
              }
              return {
                  ...prev,
                  downloaded: true,
                  downloadPath: resultData?.downloadPath || prev.downloadPath || info.downloadPath,
              };
          });
          if (resultData?.downloadPath) {
              void message.success({ content: `更新下载完成，更新包路径：${resultData.downloadPath}`, duration: 5 });
          } else {
              void message.success({ content: '更新下载完成', duration: 2 });
          }
          setAboutUpdateStatus(`发现新版本 ${info.latestVersion}（已下载，请点击"下载进度"后安装）`);
          // macOS：如果用户没有主动隐藏进度弹窗，则下载完成后自动打开下载目录
          if (isMacRuntime && !updateUserDismissedRef.current) {
              try {
                  const openRes = await (window as any).go.app.App.OpenDownloadedUpdateDirectory();
                  if (openRes?.success) {
                      void message.success(openRes?.message || '已打开安装目录，请手动完成替换');
                  }
              } catch (e) {
                  console.warn('自动打开下载目录失败', e);
              }
          }
      } else {
          setUpdateDownloadProgress(prev => ({
              ...prev,
              status: 'error',
              message: res?.message || '未知错误'
          }));
          void message.error({ content: '更新下载失败: ' + (res?.message || '未知错误'), duration: 4 });
      }
  }, []);

  const showUpdateDownloadProgress = React.useCallback(() => {
      setUpdateDownloadProgress((prev) => {
          if (prev.status === 'idle') return prev;
          return { ...prev, open: true };
      });
  }, []);

  const hideUpdateDownloadProgress = React.useCallback(() => {
      setUpdateDownloadProgress((prev) => ({ ...prev, open: false }));
  }, []);

  const isLatestUpdateDownloaded = Boolean(lastUpdateInfo?.hasUpdate) && (
      Boolean(lastUpdateInfo?.downloaded)
      || (Boolean(lastUpdateInfo?.latestVersion) && updateDownloadedVersionRef.current === lastUpdateInfo?.latestVersion)
  );
  const isBackgroundProgressForLatestUpdate = Boolean(lastUpdateInfo?.hasUpdate)
      && Boolean(lastUpdateInfo?.latestVersion)
      && updateDownloadProgress.version === lastUpdateInfo?.latestVersion
      && (updateDownloadProgress.status === 'start'
          || updateDownloadProgress.status === 'downloading'
          || updateDownloadProgress.status === 'done'
          || updateDownloadProgress.status === 'error');
  const canShowProgressEntry = (isLatestUpdateDownloaded || isBackgroundProgressForLatestUpdate)
      && updateInstallTriggeredVersionRef.current !== (lastUpdateInfo?.latestVersion || null);

  const handleInstallFromProgress = React.useCallback(async () => {
      // 允许从下载进度弹窗（status=done）或关于弹窗（isLatestUpdateDownloaded=true）触发
      const canInstall = updateDownloadProgress.status === 'done'
          || (Boolean(lastUpdateInfo?.hasUpdate) && (Boolean(lastUpdateInfo?.downloaded) || updateDownloadedVersionRef.current === lastUpdateInfo?.latestVersion));
      if (!canInstall) {
          return;
      }
      if (isMacRuntime) {
          const res = await (window as any).go.app.App.OpenDownloadedUpdateDirectory();
          if (!res?.success) {
              void message.error('打开安装目录失败: ' + (res?.message || '未知错误'));
              // 文件可能已被用户删除，清除已下载状态以允许重新下载
              updateDownloadedVersionRef.current = null;
              updateDownloadMetaRef.current = null;
              setUpdateDownloadProgress(prev => ({
                  ...prev,
                  status: 'idle',
                  percent: 0,
                  downloaded: 0,
                  open: false,
              }));
              setLastUpdateInfo(prev => prev ? { ...prev, downloaded: false, downloadPath: undefined } : prev);
              setAboutUpdateStatus(prev => prev.replace('已下载', '未下载'));
              return;
          }
          updateInstallTriggeredVersionRef.current = updateDownloadProgress.version || lastUpdateInfo?.latestVersion || null;
          hideUpdateDownloadProgress();
          void message.success(res?.message || '已打开安装目录，请手动完成替换');
          return;
      }
      const res = await (window as any).go.app.App.InstallUpdateAndRestart();
      if (!res?.success) {
          void message.error('更新安装失败: ' + (res?.message || '未知错误'));
          return;
      }
      updateInstallTriggeredVersionRef.current = updateDownloadProgress.version || lastUpdateInfo?.latestVersion || null;
      hideUpdateDownloadProgress();
  }, [hideUpdateDownloadProgress, isMacRuntime, lastUpdateInfo?.latestVersion, lastUpdateInfo?.hasUpdate, lastUpdateInfo?.downloaded, updateDownloadProgress.status, updateDownloadProgress.version]);

  const checkForUpdates = React.useCallback(async (silent: boolean) => {
      if (updateCheckInFlightRef.current) return;
      updateCheckInFlightRef.current = true;
      if (!silent) {
          setAboutUpdateStatus('正在检查更新...');
      }
      const res = await (window as any).go.app.App.CheckForUpdates();
      updateCheckInFlightRef.current = false;
      if (!res?.success) {
          if (!silent) {
              void message.error('检查更新失败: ' + (res?.message || '未知错误'));
              setAboutUpdateStatus('检查更新失败: ' + (res?.message || '未知错误'));
          }
          return;
      }
      const info: UpdateInfo = res.data;
      if (!info) return;
      const aboutOpen = isAboutOpenRef.current;
      if (info.hasUpdate) {
          // 以后端校验为准：如果后端确认文件不存在（downloaded=false），清除本地 ref
          if (!info.downloaded && updateDownloadedVersionRef.current === info.latestVersion) {
              updateDownloadedVersionRef.current = null;
              updateDownloadMetaRef.current = null;
          }
          const localDownloaded = updateDownloadedVersionRef.current === info.latestVersion;
          const hasDownloaded = Boolean(info.downloaded) || localDownloaded;
          if (hasDownloaded) {
              const downloadPath = info.downloadPath || updateDownloadMetaRef.current?.downloadPath || '';
              updateDownloadedVersionRef.current = info.latestVersion;
              updateDownloadMetaRef.current = {
                  ...(updateDownloadMetaRef.current || {}),
                  info,
                  downloadPath: downloadPath || undefined,
              };
              setUpdateDownloadProgress((prev) => {
                  if (prev.status === 'start' || prev.status === 'downloading') {
                      return prev;
                  }
                  const total = info.assetSize || prev.total || 0;
                  return {
                      ...prev,
                      open: prev.open && prev.version === info.latestVersion,
                      version: info.latestVersion,
                      status: 'done',
                      percent: 100,
                      downloaded: total,
                      total,
                      message: '',
                  };
              });
              setLastUpdateInfo({
                  ...info,
                  downloaded: true,
                  downloadPath: downloadPath || undefined,
              });
          } else {
              if (updateDownloadedVersionRef.current !== info.latestVersion) {
                  updateDownloadMetaRef.current = null;
              }
              setUpdateDownloadProgress((prev) => {
                  if (prev.status === 'start' || prev.status === 'downloading') {
                      return prev;
                  }
                  return {
                      ...prev,
                      open: false,
                      version: info.latestVersion,
                      status: 'idle',
                      percent: 0,
                      downloaded: 0,
                      total: info.assetSize || 0,
                      message: '',
                  };
              });
              setLastUpdateInfo(info);
          }
          const statusText = hasDownloaded
              ? `发现新版本 ${info.latestVersion}（已下载，请点击“下载进度”后安装）`
              : `发现新版本 ${info.latestVersion}（未下载）`;
          if (!silent) {
              void message.info(`发现新版本 ${info.latestVersion}`);
              setAboutUpdateStatus(statusText);
          }
          if (silent && aboutOpen) {
              setAboutUpdateStatus(statusText);
          }
          if (silent && !aboutOpen && updateMutedVersionRef.current !== info.latestVersion && updateNotifiedVersionRef.current !== info.latestVersion) {
              updateNotifiedVersionRef.current = info.latestVersion;
              setIsAboutOpen(true);
          }
      } else if (!silent) {
          setUpdateDownloadProgress((prev) => {
              if (prev.status === 'start' || prev.status === 'downloading') {
                  return prev;
              }
              return {
                  open: false,
                  version: '',
                  status: 'idle',
                  percent: 0,
                  downloaded: 0,
                  total: 0,
                  message: '',
              };
          });
          setLastUpdateInfo(info);
          const text = `当前已是最新版本（${info.currentVersion || '未知'}）`;
          void message.success(text);
          setAboutUpdateStatus(text);
      } else if (silent && aboutOpen) {
          setUpdateDownloadProgress((prev) => {
              if (prev.status === 'start' || prev.status === 'downloading') {
                  return prev;
              }
              return {
                  open: false,
                  version: '',
                  status: 'idle',
                  percent: 0,
                  downloaded: 0,
                  total: 0,
                  message: '',
              };
          });
          setLastUpdateInfo(info);
          const text = `当前已是最新版本（${info.currentVersion || '未知'}）`;
          setAboutUpdateStatus(text);
      } else {
          setLastUpdateInfo(info);
      }
  }, []);

  const loadAboutInfo = React.useCallback(async () => {
      setAboutLoading(true);
      const res = await (window as any).go.app.App.GetAppInfo();
      if (res?.success) {
          setAboutInfo(res.data);
      } else {
          void message.error('获取应用信息失败: ' + (res?.message || '未知错误'));
      }
      setAboutLoading(false);
  }, []);

  const handleNewQuery = useCallback(() => {
      let connId = '';
      let db = '';

      // Priority: Active Tab Context (if connection still valid) > Sidebar Selection (activeContext)
      if (activeTabId) {
          const currentTab = tabs.find(t => t.id === activeTabId);
          if (currentTab && currentTab.connectionId && connections.some(c => c.id === currentTab.connectionId)) {
              connId = currentTab.connectionId;
              db = currentTab.dbName || '';
          }
      }

      // Fallback: Sidebar selection context (only if connection still valid)
      if (!connId && activeContext?.connectionId && connections.some(c => c.id === activeContext.connectionId)) {
          connId = activeContext.connectionId;
          db = activeContext.dbName || '';
      }

      addTab({
          id: `query-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          title: '新建查询',
          type: 'query',
          connectionId: connId,
          dbName: db,
          query: ''
      });
  }, [activeTabId, tabs, connections, activeContext, addTab]);

  const handleImportConnections = async () => {
      const res = await (window as any).go.app.App.ImportConfigFile();
      if (res.success) {
          try {
              const imported = JSON.parse(res.data);
              if (Array.isArray(imported)) {
                  let count = 0;
                  imported.forEach((conn: any) => {
                      if (!connections.some(c => c.id === conn.id)) {
                          addConnection(conn);
                          count++;
                      }
                  });
                  void message.success(`成功导入 ${count} 个连接`);
              } else {
                  void message.error("文件格式错误：需要 JSON 数组");
              }
          } catch (e) {
              void message.error("解析 JSON 失败");
          }
      } else if (res.message !== "已取消") {
          void message.error("导入失败: " + res.message);
      }
  };

  const handleExportConnections = async () => {
      if (connections.length === 0) {
          void message.warning("没有连接可导出");
          return;
      }
      const res = await (window as any).go.app.App.ExportData(connections, ['id','name','config','includeDatabases','includeRedisDatabases'], "connections", "json");
      if (res.success) {
          void message.success("导出成功");
      } else if (res.message !== "已取消") {
          void message.error("导出失败: " + res.message);
      }
  };

  const [isToolsModalOpen, setIsToolsModalOpen] = useState(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [themeModalSection, setThemeModalSection] = useState<'theme' | 'appearance'>('theme');
  const [isAppearanceModalOpen, setIsAppearanceModalOpen] = useState(false);
  const [isShortcutModalOpen, setIsShortcutModalOpen] = useState(false);
  const [capturingShortcutAction, setCapturingShortcutAction] = useState<ShortcutAction | null>(null);
  const [isProxyModalOpen, setIsProxyModalOpen] = useState(false);
  const [isAISettingsOpen, setIsAISettingsOpen] = useState(false);
  const aiEntryPlacement = resolveAIEntryPlacement();
  const aiEdgeHandleAttachment = resolveAIEdgeHandleAttachment(aiPanelVisible);
  const aiEdgeHandleDockStyle = useMemo(
      () => resolveAIEdgeHandleDockStyle(aiEdgeHandleAttachment),
      [aiEdgeHandleAttachment],
  );
  const aiEdgeHandleStyle = useMemo(() => (
      resolveAIEdgeHandleStyle({
          darkMode,
          aiPanelVisible,
          effectiveUiScale,
      })
  ), [aiPanelVisible, darkMode, effectiveUiScale]);
  const sidebarUtilityItems = useMemo(() => {
      const itemMap = {
          tools: {
              key: 'tools',
              title: '工具',
              icon: <ToolOutlined />,
              onClick: () => setIsToolsModalOpen(true),
          },
          proxy: {
              key: 'proxy',
              title: '代理',
              icon: <GlobalOutlined />,
              onClick: () => setIsProxyModalOpen(true),
          },
          theme: {
              key: 'theme',
              title: '主题',
              icon: <SkinOutlined />,
              onClick: () => setIsThemeModalOpen(true),
          },
          about: {
              key: 'about',
              title: '关于',
              icon: <InfoCircleOutlined />,
              onClick: () => setIsAboutOpen(true),
          },
      } as const;

      return SIDEBAR_UTILITY_ITEM_KEYS.map((key) => itemMap[key]);
  }, []);
  const renderAIEdgeHandle = () => (
      <Tooltip title="AI 助手">
          <Button
              type="text"
              icon={<RobotOutlined />}
              onClick={toggleAIPanel}
              style={aiEdgeHandleStyle}
          >
              AI
          </Button>
      </Tooltip>
  );


  // Log Panel: 最小高度按“工具栏 + 1 条日志行（微增）”限制
  const LOG_PANEL_TOOLBAR_HEIGHT = 32;
  const LOG_PANEL_SINGLE_ROW_HEIGHT = 39;
  const LOG_PANEL_MIN_VISIBLE_ROWS = 1;
  const LOG_PANEL_MIN_HEIGHT = LOG_PANEL_TOOLBAR_HEIGHT + (LOG_PANEL_SINGLE_ROW_HEIGHT * LOG_PANEL_MIN_VISIBLE_ROWS);
  const LOG_PANEL_MAX_HEIGHT = 800;
  const [logPanelHeight, setLogPanelHeight] = useState(Math.max(200, LOG_PANEL_MIN_HEIGHT));
  const [isLogPanelOpen, setIsLogPanelOpen] = useState(false);
  const logResizeRef = React.useRef<{ startY: number, startHeight: number } | null>(null);
  const logGhostRef = React.useRef<HTMLDivElement>(null);

  const handleLogResizeStart = (e: React.MouseEvent) => {
      e.preventDefault();
      logResizeRef.current = { startY: e.clientY, startHeight: logPanelHeight };
      
      if (logGhostRef.current) {
          logGhostRef.current.style.top = `${e.clientY}px`;
          logGhostRef.current.style.display = 'block';
      }

      document.addEventListener('mousemove', handleLogResizeMove);
      document.addEventListener('mouseup', handleLogResizeUp);
  };

  const handleLogResizeMove = (e: MouseEvent) => {
      if (!logResizeRef.current) return;
      // Just update ghost line, no state update
      if (logGhostRef.current) {
          logGhostRef.current.style.top = `${e.clientY}px`;
      }
  };

  const handleLogResizeUp = (e: MouseEvent) => {
      if (logResizeRef.current) {
          const delta = logResizeRef.current.startY - e.clientY; 
          const newHeight = Math.max(
              LOG_PANEL_MIN_HEIGHT,
              Math.min(LOG_PANEL_MAX_HEIGHT, logResizeRef.current.startHeight + delta)
          );
          setLogPanelHeight(newHeight);
      }
      
      if (logGhostRef.current) {
          logGhostRef.current.style.display = 'none';
      }

      logResizeRef.current = null;
      document.removeEventListener('mousemove', handleLogResizeMove);
      document.removeEventListener('mouseup', handleLogResizeUp);
  };
  
  const handleEditConnection = (conn: SavedConnection) => {
      setEditingConnection(conn);
      setIsModalOpen(true);
  };

  const handleCloseModal = () => {
      setIsModalOpen(false);
      setEditingConnection(null);
  };

  const handleOpenDriverManagerFromConnection = () => {
      setIsModalOpen(false);
      setEditingConnection(null);
      setIsDriverModalOpen(true);
  };

  const handleTitleBarWindowToggle = async () => {
      try {
          if (await WindowIsFullscreen()) {
              await WindowUnfullscreen();
              return;
          }
          if (useNativeMacWindowControls && isMacRuntime) {
              await WindowFullscreen();
              return;
          }
          await WindowToggleMaximise();
      } catch (_) {
          // ignore
      }
  };

  const handleTitleBarDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-no-titlebar-toggle="true"]')) {
          return;
      }
      void handleTitleBarWindowToggle();
  };
  
  // Sidebar Resizing
  const sidebarDragRef = React.useRef<{ startX: number, startWidth: number } | null>(null);
  const rafRef = React.useRef<number | null>(null);
  const ghostRef = React.useRef<HTMLDivElement>(null);
  const latestMouseX = React.useRef<number>(0); // Store latest mouse position

  const handleSidebarMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      
      if (ghostRef.current) {
          ghostRef.current.style.left = `${sidebarWidth}px`;
          ghostRef.current.style.display = 'block';
      }
      
      sidebarDragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      latestMouseX.current = e.clientX; // Init
      document.addEventListener('mousemove', handleSidebarMouseMove);
      document.addEventListener('mouseup', handleSidebarMouseUp);
  };

  const handleSidebarMouseMove = (e: MouseEvent) => {
      if (!sidebarDragRef.current) return;
      
      latestMouseX.current = e.clientX; // Always update latest pos

      if (rafRef.current) return; // Schedule once per frame

      rafRef.current = requestAnimationFrame(() => {
          if (!sidebarDragRef.current || !ghostRef.current) return;
          // Use latestMouseX.current instead of stale closure 'e.clientX'
          const delta = latestMouseX.current - sidebarDragRef.current.startX;
          const newWidth = Math.max(200, Math.min(600, sidebarDragRef.current.startWidth + delta));
          ghostRef.current.style.left = `${newWidth}px`;
          rafRef.current = null;
      });
  };

  const handleSidebarMouseUp = (e: MouseEvent) => {
      if (rafRef.current) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
      }
      
      if (sidebarDragRef.current) {
          // Use latest position for final commit too
          const delta = e.clientX - sidebarDragRef.current.startX;
          const newWidth = Math.max(200, Math.min(600, sidebarDragRef.current.startWidth + delta));
          setSidebarWidth(newWidth);
      }

      if (ghostRef.current) {
          ghostRef.current.style.display = 'none';
      }
      
      sidebarDragRef.current = null;
      document.removeEventListener('mousemove', handleSidebarMouseMove);
      document.removeEventListener('mouseup', handleSidebarMouseUp);
  };

  useEffect(() => {
    document.body.style.backgroundColor = 'transparent';
    document.body.style.color = darkMode ? '#ffffff' : '#000000';
    document.body.setAttribute('data-theme', darkMode ? 'dark' : 'light');
    document.body.style.fontSize = `${effectiveFontSize}px`;
    document.documentElement.style.setProperty('--gonavi-font-size', `${effectiveFontSize}px`);
  }, [darkMode, effectiveFontSize]);

  useEffect(() => {
      isAboutOpenRef.current = isAboutOpen;
  }, [isAboutOpen]);

  useEffect(() => {
      if (isAboutOpen) {
          if (lastUpdateInfo?.hasUpdate) {
              const localDownloaded = updateDownloadedVersionRef.current === lastUpdateInfo.latestVersion;
              const hasDownloaded = Boolean(lastUpdateInfo.downloaded) || localDownloaded;
              setAboutUpdateStatus(
                  hasDownloaded
                      ? `发现新版本 ${lastUpdateInfo.latestVersion}（已下载，请点击“下载进度”后安装）`
                      : `发现新版本 ${lastUpdateInfo.latestVersion}（未下载）`
              );
          } else if (lastUpdateInfo) {
              setAboutUpdateStatus(`当前已是最新版本（${lastUpdateInfo.currentVersion || '未知'}）`);
          } else {
              setAboutUpdateStatus('未检查');
          }
          void loadAboutInfo();
      }
  }, [isAboutOpen, lastUpdateInfo, loadAboutInfo]);

  useEffect(() => {
      const startupTimer = window.setTimeout(() => {
          void checkForUpdates(true);
      }, 2000);
      const interval = window.setInterval(() => {
          void checkForUpdates(true);
      }, 30 * 60 * 1000);
      return () => {
          window.clearTimeout(startupTimer);
          window.clearInterval(interval);
      };
  }, [checkForUpdates]);

  useEffect(() => {
      let offDownloadProgress: any = null;
      try {
          offDownloadProgress = EventsOn('update:download-progress', (event: UpdateDownloadProgressEvent) => {
          if (!event) return;
          const status = event.status || 'downloading';
          const nextStatus: 'idle' | 'start' | 'downloading' | 'done' | 'error' =
              status === 'start' || status === 'downloading' || status === 'done' || status === 'error'
                  ? status
                  : 'downloading';
          const downloaded = typeof event.downloaded === 'number' ? event.downloaded : 0;
          const total = typeof event.total === 'number' ? event.total : 0;
          const percentRaw = typeof event.percent === 'number'
              ? event.percent
              : (total > 0 ? (downloaded / total) * 100 : 0);
          const percent = Math.max(0, Math.min(100, percentRaw));
          setUpdateDownloadProgress(prev => ({
              open: prev.open,
              version: prev.version,
              status: nextStatus,
              percent,
              downloaded,
              total,
              message: String(event.message || '')
          }));
      });
      } catch (e) {
          console.warn("Wails API: EventsOn unavailable", e);
      }
      return () => {
          if (offDownloadProgress) offDownloadProgress();
      };
  }, []);

  useEffect(() => {
      const handleOpenShortcutSettingsEvent = () => {
          setIsShortcutModalOpen(true);
      };
      window.addEventListener('gonavi:open-shortcut-settings', handleOpenShortcutSettingsEvent as EventListener);
      return () => {
          window.removeEventListener('gonavi:open-shortcut-settings', handleOpenShortcutSettingsEvent as EventListener);
      };
  }, []);

  useEffect(() => {
      if (!isMacRuntime || !useNativeMacWindowControls) {
          return;
      }

      const handleMacNativeEscapeCapture = (event: KeyboardEvent) => {
          if (!shouldSuppressMacNativeEscapeExit(isMacRuntime, useNativeMacWindowControls, useStore.getState().windowState === 'fullscreen', event)) {
              return;
          }
          event.preventDefault();
          event.stopPropagation();
      };

      window.addEventListener('keydown', handleMacNativeEscapeCapture, true);
      return () => {
          window.removeEventListener('keydown', handleMacNativeEscapeCapture, true);
      };
  }, [isMacRuntime, useNativeMacWindowControls]);

  useEffect(() => {
      const handleGlobalShortcut = (event: KeyboardEvent) => {
          const matchedAction = SHORTCUT_ACTION_ORDER.find((action) => {
              const binding = shortcutOptions[action];
              if (!binding?.enabled) {
                  return false;
              }
              if (isEditableElement(event.target) && !SHORTCUT_ACTION_META[action].allowInEditable) {
                  return false;
              }
              return isShortcutMatch(event, binding.combo);
          });

          if (!matchedAction) {
              return;
          }

          event.preventDefault();
          event.stopPropagation();

          switch (matchedAction) {
              case 'runQuery':
                  window.dispatchEvent(new CustomEvent('gonavi:run-active-query'));
                  break;
              case 'focusSidebarSearch':
                  window.dispatchEvent(new CustomEvent('gonavi:focus-sidebar-search'));
                  break;
              case 'newQueryTab':
                  handleNewQuery();
                  break;
              case 'toggleLogPanel':
                  setIsLogPanelOpen((prev) => !prev);
                  break;
              case 'toggleTheme':
                  setTheme(themeMode === 'dark' ? 'light' : 'dark');
                  break;
              case 'openShortcutManager':
                  setIsShortcutModalOpen(true);
                  break;
              case 'toggleMacFullscreen':
                  if (isMacRuntime && useNativeMacWindowControls) {
                      void handleTitleBarWindowToggle();
                  }
                  break;
          }
      };

      window.addEventListener('keydown', handleGlobalShortcut);
      return () => {
          window.removeEventListener('keydown', handleGlobalShortcut);
      };
  }, [handleNewQuery, handleTitleBarWindowToggle, isMacRuntime, shortcutOptions, themeMode, setTheme, useNativeMacWindowControls]);

  useEffect(() => {
      if (!capturingShortcutAction) {
          return;
      }

      const handleShortcutCapture = (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();

          if (event.key === 'Escape') {
              setCapturingShortcutAction(null);
              return;
          }

          const combo = eventToShortcut(event);
          if (!combo) {
              return;
          }
          if (!hasModifierKey(combo)) {
              void message.warning('快捷键至少包含 Ctrl / Alt / Shift / Meta 之一');
              return;
          }

          const normalizedCombo = normalizeShortcutCombo(combo);
          const conflictAction = SHORTCUT_ACTION_ORDER.find((action) => {
              if (action === capturingShortcutAction) {
                  return false;
              }
              const binding = shortcutOptions[action];
              if (!binding?.enabled) {
                  return false;
              }
              return normalizeShortcutCombo(binding.combo) === normalizedCombo;
          });
          if (conflictAction) {
              void message.warning(`与「${SHORTCUT_ACTION_META[conflictAction].label}」冲突，请换一个快捷键`);
              return;
          }

          updateShortcut(capturingShortcutAction, { combo: normalizedCombo, enabled: true });
          setCapturingShortcutAction(null);
      };

      window.addEventListener('keydown', handleShortcutCapture, true);
      return () => {
          window.removeEventListener('keydown', handleShortcutCapture, true);
      };
  }, [capturingShortcutAction, shortcutOptions, updateShortcut]);

  const linuxResizeHandleStyleBase = {
      position: 'fixed',
      zIndex: 12000,
      background: 'transparent',
      WebkitAppRegion: 'drag',
      '--wails-draggable': 'drag',
      userSelect: 'none'
  } as any;

  const showLinuxResizeHandles = isLinuxRuntime;
  const resizeGuideColor = darkMode ? 'rgba(246, 196, 83, 0.55)' : 'rgba(24, 144, 255, 0.5)';

  return (
    <ConfigProvider
        locale={zhCN}
        componentSize={appComponentSize}
        theme={{
            algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
            token: {
                fontSize: tokenFontSize,
                fontSizeSM: tokenFontSizeSM,
                fontSizeLG: tokenFontSizeLG,
                controlHeight: tokenControlHeight,
                controlHeightSM: tokenControlHeightSM,
                controlHeightLG: tokenControlHeightLG,
                colorBgLayout: 'transparent',
                colorBgContainer: darkMode 
                    ? `rgba(29, 29, 29, ${effectiveOpacity})` 
                    : `rgba(255, 255, 255, ${effectiveOpacity})`,
                colorBgElevated: darkMode 
                    ? '#1f1f1f' 
                    : '#ffffff',
                colorFillAlter: darkMode
                    ? `rgba(38, 38, 38, ${effectiveOpacity})`
                    : `rgba(250, 250, 250, ${effectiveOpacity})`,
                colorPrimary: darkMode ? '#f6c453' : '#1677ff',
                colorPrimaryHover: darkMode ? '#ffd666' : '#4096ff',
                colorPrimaryActive: darkMode ? '#d8a93b' : '#0958d9',
                colorInfo: darkMode ? '#f6c453' : '#1677ff',
                colorLink: darkMode ? '#ffd666' : '#1677ff',
                colorLinkHover: darkMode ? '#ffe58f' : '#4096ff',
                colorLinkActive: darkMode ? '#d8a93b' : '#0958d9',
                colorPrimaryBg: darkMode ? 'rgba(246, 196, 83, 0.22)' : '#e6f4ff',
                colorPrimaryBgHover: darkMode ? 'rgba(246, 196, 83, 0.30)' : '#bae0ff',
                colorPrimaryBorder: darkMode ? 'rgba(246, 196, 83, 0.45)' : '#91caff',
                colorPrimaryBorderHover: darkMode ? 'rgba(246, 196, 83, 0.60)' : '#69b1ff',
                controlItemBgActive: darkMode ? 'rgba(246, 196, 83, 0.20)' : 'rgba(22, 119, 255, 0.12)',
                controlItemBgActiveHover: darkMode ? 'rgba(246, 196, 83, 0.28)' : 'rgba(22, 119, 255, 0.18)',
                controlOutline: darkMode ? 'rgba(246, 196, 83, 0.50)' : 'rgba(5, 145, 255, 0.24)',
            },
            components: {
                Layout: {
                    bodyBg: 'transparent',
                    headerBg: 'transparent',
                    siderBg: 'transparent',
                    triggerBg: 'transparent'
                },
                Table: {
                    headerBg: 'transparent',
                    rowHoverBg: darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.02)',
                },
                Tabs: {
                    cardBg: 'transparent',
                    itemActiveColor: darkMode ? '#ffd666' : '#1890ff',
                    itemHoverColor: darkMode ? '#ffe58f' : '#40a9ff',
                    itemSelectedColor: darkMode ? '#ffd666' : '#1677ff',
                    inkBarColor: darkMode ? '#ffd666' : '#1677ff',
                }
            }
        }}
    >
        <Layout style={{ 
            height: '100vh', 
            overflow: 'hidden', 
            display: 'flex', 
            flexDirection: 'column',
            background: 'transparent',
            borderRadius: showLinuxResizeHandles ? 0 : windowCornerRadius,
            clipPath: showLinuxResizeHandles ? 'none' : `inset(0 round ${windowCornerRadius}px)`,
            backdropFilter: blurFilter,
            WebkitBackdropFilter: blurFilter,
        }}>
          {/* Custom Title Bar */}
          <div
            onDoubleClick={handleTitleBarDoubleClick}
            style={{
                height: titleBarHeight,
                flexShrink: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: bgMain,
                borderBottom: 'none',
                userSelect: 'none',
                WebkitAppRegion: 'drag', // Wails drag region
                '--wails-draggable': 'drag',
                paddingLeft: getMacNativeTitlebarPaddingLeft(effectiveUiScale, useNativeMacWindowControls),
                paddingRight: getMacNativeTitlebarPaddingRight(effectiveUiScale, useNativeMacWindowControls),
                fontSize: tokenFontSize
            } as any}
          >
              <div style={{ display: 'flex', alignItems: 'center', gap: Math.max(6, Math.round(8 * effectiveUiScale)), fontWeight: 600, minWidth: 0 }}>
                  {/* Logo can be added here if available */}
                  GoNavi
              </div>
              {isWebMode || useNativeMacWindowControls ? (
                  <div style={{ minWidth: Math.max(40, Math.round(48 * effectiveUiScale)) }} />
              ) : (
                  <div
                    data-no-titlebar-toggle="true"
                    onDoubleClick={(e) => e.stopPropagation()}
                    style={{ display: 'flex', height: '100%', WebkitAppRegion: 'no-drag', '--wails-draggable': 'no-drag' } as any}
                  >
                      <Button 
                        type="text" 
                        icon={<MinusOutlined />} 
                        style={{ height: '100%', borderRadius: 0, width: titleBarButtonWidth }} 
                        onClick={WindowMinimise} 
                      />
                      <Button 
                        type="text" 
                        icon={<BorderOutlined />} 
                        style={{ height: '100%', borderRadius: 0, width: titleBarButtonWidth }} 
                        onClick={() => { void handleTitleBarWindowToggle(); }} 
                      />
                      <Button 
                        type="text" 
                        icon={<CloseOutlined />} 
                        danger
                        className="titlebar-close-btn"
                        style={{ height: '100%', borderRadius: 0, width: titleBarButtonWidth }} 
                        onClick={Quit} 
                      />
                  </div>
              )}
          </div>

          <Layout style={{ flex: 1, minHeight: 0, minWidth: 0 }}>
          <Sider 
            width={sidebarWidth} 
            style={{ 
                borderRight: '1px solid rgba(128,128,128,0.2)',
                position: 'relative',
                background: bgMain
            }}
          >
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                <div style={{ padding: `12px ${sidebarHorizontalPadding}px 8px`, borderBottom: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, width: '100%' }}>
                        {sidebarUtilityItems.map((item) => (
                            <Tooltip key={item.key} title={item.title}>
                                <Button type="text" icon={item.icon} style={utilityButtonStyle} onClick={item.onClick} />
                            </Tooltip>
                        ))}
                    </div>
                </div>
                <div style={{ padding: `0 ${sidebarHorizontalPadding}px 10px`, borderBottom: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: isSidebarCompact ? 'minmax(0, 1fr)' : 'minmax(0, 1fr) minmax(0, 1fr)', gap: 8, width: '100%' }}>
                        <Button icon={<ConsoleSqlOutlined />} onClick={handleNewQuery} title="新建查询" style={sidebarQueryActionStyle}>
                            新建查询
                        </Button>
                        <Button icon={<PlusOutlined />} onClick={() => setIsModalOpen(true)} title="新建连接" style={sidebarCreateConnectionActionStyle}>
                            新建连接
                        </Button>
                    </div>
                </div>
                
                <div style={{ flex: 1, overflow: 'hidden', paddingBottom: 58, position: 'relative' }}>
                    <div style={{ height: '100%', opacity: connectionWorkbenchState.ready ? 1 : 0.72, pointerEvents: connectionWorkbenchState.ready ? 'auto' : 'none' }}>
                        <Sidebar onEditConnection={handleEditConnection} />
                    </div>
                    {!connectionWorkbenchState.ready && (
                        <div
                            style={{
                                position: 'absolute',
                                inset: 0,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                padding: 16,
                                background: darkMode ? 'rgba(7, 12, 20, 0.42)' : 'rgba(255, 255, 255, 0.58)',
                                backdropFilter: 'blur(4px)',
                                zIndex: 1,
                            }}
                        >
                            <div
                                style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 10,
                                    padding: '10px 14px',
                                    borderRadius: 999,
                                    background: darkMode ? 'rgba(15, 23, 36, 0.86)' : 'rgba(255, 255, 255, 0.94)',
                                    border: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(22,32,51,0.08)',
                                    boxShadow: darkMode ? '0 12px 24px rgba(0,0,0,0.26)' : '0 12px 24px rgba(15,23,42,0.08)',
                                    color: darkMode ? 'rgba(255,255,255,0.88)' : '#162033',
                                    fontSize: 12,
                                    fontWeight: 500,
                                }}
                            >
                                <Spin size="small" />
                                <span>{connectionWorkbenchState.message}</span>
                            </div>
                        </div>
                    )}
                </div>

                {/* Floating SQL Log Toggle */}
                <div
                    style={{
                        position: 'absolute',
                        left: 10,
                        right: 14,
                        bottom: 10,
                        zIndex: 20,
                        pointerEvents: 'none'
                    }}
                >
                    <Button
                        type={isLogPanelOpen ? "primary" : "text"}
                        icon={<BugOutlined />}
                        onClick={() => setIsLogPanelOpen(!isLogPanelOpen)}
                        style={isLogPanelOpen ? {
                            width: '100%',
                            height: floatingLogButtonHeight,
                            borderRadius: 999,
                            boxShadow: floatingLogButtonShadow,
                            pointerEvents: 'auto'
                        } : {
                            width: '100%',
                            height: floatingLogButtonHeight,
                            borderRadius: 999,
                            border: `1px solid ${floatingLogButtonBorderColor}`,
                            color: floatingLogButtonTextColor,
                            background: floatingLogButtonBgColor,
                            boxShadow: floatingLogButtonShadow,
                            backdropFilter: blurFilter,
                            pointerEvents: 'auto'
                        }}
                    >
                        SQL 执行日志
                    </Button>
                </div>
            </div>
            
            {/* Sidebar Resize Handle */}
            <div 
                onMouseDown={handleSidebarMouseDown}
                style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: '5px',
                    cursor: 'col-resize',
                    zIndex: 100,
                    // background: 'transparent' // transparent usually, visible on hover if desired
                }}
                title="拖动调整宽度"
            />
          </Sider>
           <Content style={{ background: isLogPanelOpen ? bgContent : 'transparent', overflow: 'hidden', display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
             <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'row', position: 'relative' }}>
               <div style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', background: bgContent, marginBottom: isLogPanelOpen ? 8 : 0, borderRadius: isLogPanelOpen ? windowCornerRadius : 0, clipPath: isLogPanelOpen ? `inset(0 round ${windowCornerRadius}px)` : 'none' }}>
                  <TabManager />
               </div>
               {aiEntryPlacement === 'content-edge' && aiEdgeHandleAttachment === 'content-shell' && (
                  <div style={aiEdgeHandleDockStyle}>
                      {renderAIEdgeHandle()}
                  </div>
               )}
               {aiPanelVisible && (
                  <div style={{ position: 'relative', display: 'flex', flexShrink: 0, overflow: 'visible' }}>
                      {aiEntryPlacement === 'content-edge' && aiEdgeHandleAttachment === 'panel-shell' && (
                          <div style={aiEdgeHandleDockStyle}>
                              {renderAIEdgeHandle()}
                          </div>
                      )}
                      <AIChatPanel darkMode={darkMode} bgColor={bgContent} onClose={() => setAIPanelVisible(false)} onOpenSettings={() => setIsAISettingsOpen(true)} overlayTheme={overlayTheme} />
                  </div>
               )}
             </div>
             {isLogPanelOpen && (
                 <LogPanel 
                    height={logPanelHeight} 
                    onClose={() => setIsLogPanelOpen(false)} 
                    onResizeStart={handleLogResizeStart} 
                />
            )}
          </Content>
          </Layout>
          <ConnectionModal 
            open={isModalOpen} 
            onClose={handleCloseModal} 
            initialValues={editingConnection}
            onOpenDriverManager={handleOpenDriverManagerFromConnection}
          />
          <Modal
            title={renderUtilityModalTitle(<ToolOutlined />, '工具中心', '集中处理连接配置、同步、驱动和快捷键相关操作。')}
            open={isToolsModalOpen}
            onCancel={() => setIsToolsModalOpen(false)}
            footer={null}
            width={560}
            styles={{ content: utilityModalShellStyle, header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 }, body: { paddingTop: 8 }, footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 } }}
          >
            <div style={{ display: 'grid', gap: 12, padding: '12px 0' }}>
              {[
                {
                  key: 'import',
                  icon: <UploadOutlined />,
                  title: '导入连接配置',
                  description: '从本地文件恢复连接列表。',
                  onClick: () => {
                    setIsToolsModalOpen(false);
                    void handleImportConnections();
                  },
                },
                {
                  key: 'export',
                  icon: <DownloadOutlined />,
                  title: '导出连接配置',
                  description: '导出当前连接与可见配置字段。',
                  onClick: () => {
                    setIsToolsModalOpen(false);
                    void handleExportConnections();
                  },
                },
                {
                  key: 'sync',
                  icon: <UploadOutlined rotate={90} />,
                  title: '数据同步',
                  description: '进入跨源同步工作流。',
                  onClick: () => {
                    setIsToolsModalOpen(false);
                    setIsSyncModalOpen(true);
                  },
                },
                {
                  key: 'drivers',
                  icon: <SettingOutlined />,
                  title: '驱动管理',
                  description: '安装、更新或移除数据库驱动。',
                  onClick: () => {
                    setIsToolsModalOpen(false);
                    setIsDriverModalOpen(true);
                  },
                },
                {
                  key: 'shortcut-settings',
                  icon: <LinkOutlined />,
                  title: '快捷键管理',
                  description: '查看并调整全局快捷键绑定。',
                  onClick: () => {
                    setIsToolsModalOpen(false);
                    setIsShortcutModalOpen(true);
                  },
                },
              ].map((item) => (
                <Button key={item.key} type="text" style={utilityActionCardStyle} onClick={item.onClick}>
                  <span style={{ width: 36, height: 36, borderRadius: 12, display: 'grid', placeItems: 'center', background: overlayTheme.iconBg, color: overlayTheme.iconColor, flexShrink: 0 }}>
                    {item.icon}
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
                    <span>{item.title}</span>
                    <span style={utilityActionHintStyle}>{item.description}</span>
                  </span>
                </Button>
              ))}
            </div>
          </Modal>
          <DataSyncModal
            open={isSyncModalOpen}
            onClose={() => setIsSyncModalOpen(false)}
          />
          <DriverManagerModal
            open={isDriverModalOpen}
            onClose={() => setIsDriverModalOpen(false)}
            onOpenGlobalProxySettings={() => setIsProxyModalOpen(true)}
          />
          <AISettingsModal
            open={isAISettingsOpen}
            onClose={() => setIsAISettingsOpen(false)}
            darkMode={darkMode}
            overlayTheme={overlayTheme}
          />
          <Modal
            title={renderUtilityModalTitle(<InfoCircleOutlined />, '关于 GoNavi', '查看版本信息、仓库地址、更新状态与下载入口。')}
            open={isAboutOpen}
            onCancel={() => setIsAboutOpen(false)}
            styles={{ content: utilityModalShellStyle, header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 }, body: { paddingTop: 8 }, footer: { background: 'transparent', borderTop: 'none', paddingTop: 10, display: 'flex', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' } }}
            footer={[
                isBackgroundProgressForLatestUpdate && !isLatestUpdateDownloaded ? (
                    <Button key="progress" icon={<DownloadOutlined />} onClick={showUpdateDownloadProgress}>下载进度</Button>
                ) : null,
                lastUpdateInfo?.hasUpdate && !isLatestUpdateDownloaded && !isBackgroundProgressForLatestUpdate ? (
                    <Button key="mute" onClick={() => { updateMutedVersionRef.current = lastUpdateInfo.latestVersion; setIsAboutOpen(false); }}>本次不再提示</Button>
                ) : null,
                <Button key="check" icon={<CloudDownloadOutlined />} onClick={() => checkForUpdates(false)}>检查更新</Button>,
                <Button key="close" onClick={() => setIsAboutOpen(false)}>关闭</Button>,
                lastUpdateInfo?.hasUpdate && !isLatestUpdateDownloaded && !isBackgroundProgressForLatestUpdate ? (
                    <Button key="download" type="primary" icon={<DownloadOutlined />} onClick={() => downloadUpdate(lastUpdateInfo, false)}>下载更新</Button>
                ) : null,
                isLatestUpdateDownloaded ? (
                    <Button key="install-direct" type="primary" icon={<DownloadOutlined />} onClick={handleInstallFromProgress}>
                        {isMacRuntime ? '打开安装目录' : '安装更新'}
                    </Button>
                ) : null,
            ].filter(Boolean)}
          >
            {aboutLoading ? (
                <div style={{ padding: '16px 0', textAlign: 'center' }}>
                    <Spin />
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div style={utilityPanelStyle}>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                            <div>
                                <div style={{ marginBottom: 6, fontWeight: 600 }}>版本</div>
                                <div style={utilityMutedTextStyle}>{aboutInfo?.version || '未知'}</div>
                            </div>
                            <div>
                                <div style={{ marginBottom: 6, fontWeight: 600 }}>作者</div>
                                <div style={utilityMutedTextStyle}>{aboutInfo?.author || '未知'}</div>
                            </div>
                            <div style={{ gridColumn: '1 / -1' }}>
                                <div style={{ marginBottom: 6, fontWeight: 600 }}>更新状态</div>
                                <div style={utilityMutedTextStyle}>{aboutUpdateStatus || '未检查'}</div>
                            </div>
                            {aboutInfo?.communityUrl ? (
                                <div style={{ gridColumn: '1 / -1' }}>
                                    <div style={{ marginBottom: 6, fontWeight: 600 }}>技术圈</div>
                                    <a onClick={(e) => { e.preventDefault(); if (aboutInfo?.communityUrl) BrowserOpenURL(aboutInfo.communityUrl); }} href={aboutInfo.communityUrl}>AI全书</a>
                                </div>
                            ) : null}
                        </div>
                    </div>
                    <div style={utilityPanelStyle}>
                        <div style={{ marginBottom: 10, fontWeight: 600 }}>项目入口</div>
                        <div style={{ display: 'grid', gap: 10 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <GithubOutlined />
                                {aboutInfo?.repoUrl ? (
                                    <a onClick={(e) => { e.preventDefault(); if (aboutInfo?.repoUrl) BrowserOpenURL(aboutInfo.repoUrl); }} href={aboutInfo.repoUrl}>{aboutInfo.repoUrl}</a>
                                ) : '未知'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <BugOutlined />
                                {aboutInfo?.issueUrl ? (
                                    <a onClick={(e) => { e.preventDefault(); if (aboutInfo?.issueUrl) BrowserOpenURL(aboutInfo.issueUrl); }} href={aboutInfo.issueUrl}>{aboutInfo.issueUrl}</a>
                                ) : '未知'}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                <CloudDownloadOutlined />
                                {aboutInfo?.releaseUrl ? (
                                    <a onClick={(e) => { e.preventDefault(); if (aboutInfo?.releaseUrl) BrowserOpenURL(aboutInfo.releaseUrl); }} href={aboutInfo.releaseUrl}>{aboutInfo.releaseUrl}</a>
                                ) : '未知'}
                            </div>
                        </div>
                    </div>
                </div>
            )}
          </Modal>

          <Modal
              title={renderUtilityModalTitle(
                  themeModalSection === 'theme' ? <SkinOutlined /> : <BgColorsOutlined />,
                  themeModalSection === 'theme' ? '主题设置' : '外观设置',
                  themeModalSection === 'theme'
                      ? '切换亮暗主题，保持整体视觉风格统一。'
                      : '统一调整缩放、字体、透明度与模糊效果。'
              )}
              open={isThemeModalOpen}
              onCancel={() => { setIsThemeModalOpen(false); setThemeModalSection('theme'); }}
              footer={null}
              width={820}
              styles={{ content: utilityModalShellStyle, header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 }, body: { paddingTop: 8, height: 620, overflow: 'hidden' }, footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 } }}
          >
              <div style={{ display: 'grid', gridTemplateColumns: '180px minmax(0, 1fr)', gap: 16, padding: '12px 0', height: '100%', minHeight: 0, overflow: 'hidden', alignItems: 'stretch' }}>
                  <div style={{ ...utilityPanelStyle, padding: 12, height: 'fit-content' }}>
                      <div style={{ marginBottom: 12, fontWeight: 600 }}>设置导航</div>
                      <div style={{ display: 'grid', gap: 10 }}>
                          {[
                              { key: 'theme', title: '主题模式', description: '亮色与暗色切换', icon: <SkinOutlined /> },
                              { key: 'appearance', title: '外观参数', description: '缩放、字体与透明度', icon: <BgColorsOutlined /> },
                          ].map((item) => {
                              const active = themeModalSection === item.key;
                              return (
                                  <button
                                      key={item.key}
                                      type="button"
                                      onClick={() => setThemeModalSection(item.key as 'theme' | 'appearance')}
                                      style={{
                                          textAlign: 'left',
                                          padding: '12px 12px',
                                          borderRadius: 12,
                                          border: `1px solid ${active
                                              ? (darkMode ? 'rgba(255,214,102,0.3)' : 'rgba(24,144,255,0.24)')
                                              : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,40,0.08)')}`,
                                          background: active
                                              ? (darkMode ? 'linear-gradient(180deg, rgba(255,214,102,0.12) 0%, rgba(255,214,102,0.06) 100%)' : 'linear-gradient(180deg, rgba(24,144,255,0.10) 0%, rgba(24,144,255,0.05) 100%)')
                                              : (darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.72)'),
                                          color: active ? (darkMode ? '#f5f7ff' : '#162033') : (darkMode ? 'rgba(255,255,255,0.82)' : '#3f4b5e'),
                                          cursor: 'pointer',
                                      }}
                                  >
                                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                          <span>{item.icon}</span>
                                          <span style={{ fontWeight: 700 }}>{item.title}</span>
                                      </div>
                                      <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: active ? (darkMode ? 'rgba(255,255,255,0.68)' : 'rgba(22,32,51,0.68)') : utilityMutedTextStyle.color }}>
                                          {item.description}
                                      </div>
                                  </button>
                              );
                          })}
                      </div>
                  </div>
                  <div style={{ minWidth: 0, minHeight: 0, height: '100%', overflowY: 'auto', overflowX: 'hidden', paddingRight: 8, paddingBottom: 28 }}>
                      {themeModalSection === 'theme' ? (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              <div style={utilityPanelStyle}>
                                  <div style={{ marginBottom: 10, fontWeight: 600 }}>主题模式</div>
                                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
                                      {[
                                          { key: 'light', label: '亮色主题', description: '适合明亮环境，层次更轻。' },
                                          { key: 'dark', label: '暗色主题', description: '适合低光环境，视觉更沉稳。' },
                                      ].map((item) => {
                                          const active = themeMode === item.key;
                                          return (
                                              <button
                                                  key={item.key}
                                                  type="button"
                                                  onClick={() => setTheme(item.key as 'light' | 'dark')}
                                                  style={{
                                                      textAlign: 'left',
                                                      padding: '14px 14px',
                                                      borderRadius: 14,
                                                      border: `1px solid ${active
                                                          ? (darkMode ? 'rgba(255,214,102,0.3)' : 'rgba(24,144,255,0.24)')
                                                          : (darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(16,24,40,0.08)')}`,
                                                      background: active
                                                          ? (darkMode ? 'linear-gradient(180deg, rgba(255,214,102,0.12) 0%, rgba(255,214,102,0.06) 100%)' : 'linear-gradient(180deg, rgba(24,144,255,0.10) 0%, rgba(24,144,255,0.05) 100%)')
                                                          : (darkMode ? 'rgba(255,255,255,0.02)' : 'rgba(255,255,255,0.72)'),
                                                      color: active ? (darkMode ? '#f5f7ff' : '#162033') : (darkMode ? 'rgba(255,255,255,0.82)' : '#3f4b5e'),
                                                      cursor: 'pointer',
                                                  }}
                                              >
                                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                      <span style={{ fontSize: 14, fontWeight: 700 }}>{item.label}</span>
                                                      {active ? <CheckOutlined style={{ color: darkMode ? '#ffd666' : '#1677ff' }} /> : null}
                                                  </div>
                                                  <div style={{ marginTop: 6, fontSize: 12, lineHeight: 1.6, color: active ? (darkMode ? 'rgba(255,255,255,0.68)' : 'rgba(22,32,51,0.68)') : utilityMutedTextStyle.color }}>
                                                      {item.description}
                                                  </div>
                                              </button>
                                          );
                                      })}
                                  </div>
                              </div>
                          </div>
                      ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                              <div style={utilityPanelStyle}>
                                  <div style={{ marginBottom: 8, fontWeight: 500 }}>界面缩放 (UI Scale)</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                      <Slider
                                        min={MIN_UI_SCALE}
                                        max={MAX_UI_SCALE}
                                        step={0.05}
                                        value={effectiveUiScale}
                                        onChange={(v) => setUiScale(Number(v))}
                                        style={{ flex: 1 }}
                                      />
                                      <span style={{ width: 56 }}>{Math.round(effectiveUiScale * 100)}%</span>
                                  </div>
                                  <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)', marginTop: 4 }}>
                                      * 建议小屏设备设置为 85%-95%
                                  </div>
                              </div>
                              <div style={utilityPanelStyle}>
                                  <div style={{ marginBottom: 8, fontWeight: 500 }}>基础字体大小 (Font Size)</div>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                      <Slider
                                        min={MIN_FONT_SIZE}
                                        max={MAX_FONT_SIZE}
                                        step={1}
                                        value={effectiveFontSize}
                                        onChange={(v) => setFontSize(Number(v))}
                                        style={{ flex: 1 }}
                                      />
                                      <span style={{ width: 56 }}>{effectiveFontSize}px</span>
                                  </div>
                              </div>
                              <div style={utilityPanelStyle}>
                                  <div style={{ marginBottom: 10, fontWeight: 500 }}>透明与模糊效果</div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                                      <div>
                                          <div style={{ fontWeight: 500 }}>启用透明与模糊</div>
                                          <div style={{ ...utilityMutedTextStyle, marginTop: 4 }}>关闭后保留当前阈值，重新开启时直接恢复之前的设置。</div>
                                      </div>
                                      <Switch checked={appearance.enabled !== false} onChange={(checked) => setAppearance({ enabled: checked })} />
                                  </div>
                                  <div style={{ display: 'grid', gap: 14, opacity: appearance.enabled !== false ? 1 : 0.6 }}>
                                      <div>
                                          <div style={{ marginBottom: 8, fontWeight: 500 }}>背景不透明度 (Opacity)</div>
                                          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                              <Slider 
                                                min={0.1} 
                                                max={1.0} 
                                                step={0.05} 
                                                disabled={appearance.enabled === false}
                                                value={appearance.opacity ?? 1.0} 
                                                onChange={(v) => setAppearance({ opacity: v })} 
                                                style={{ flex: 1 }}
                                              />
                                              <span style={{ width: 40 }}>{Math.round((appearance.opacity ?? 1.0) * 100)}%</span>
                                          </div>
                                      </div>
                                      <div>
                                          <div style={{ marginBottom: 8, fontWeight: 500 }}>高斯模糊 (Blur)</div>
                                          {isWindowsPlatform() ? (
                                              <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>
                                                  Windows 使用系统 Acrylic 效果，模糊程度由系统控制
                                              </div>
                                          ) : (
                                              <>
                                                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                                                      <Slider
                                                        min={0}
                                                        max={20}
                                                        disabled={appearance.enabled === false}
                                                        value={appearance.blur ?? 0}
                                                        onChange={(v) => setAppearance({ blur: v })}
                                                        style={{ flex: 1 }}
                                                      />
                                                      <span style={{ width: 40 }}>{appearance.blur}px</span>
                                                  </div>
                                                  <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)', marginTop: 4 }}>
                                                      * 仅控制应用内覆盖层的模糊效果
                                                  </div>
                                              </>
                                          )}
                                      </div>
                                  </div>
                              </div>
                              {isMacRuntime ? (
                                  <div style={utilityPanelStyle}>
                                      <div style={{ marginBottom: 8, fontWeight: 500 }}>macOS 窗口控制</div>
                                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                          <div>
                                              <div style={{ fontWeight: 500 }}>使用 macOS 原生窗口控制</div>
                                              <div style={{ ...utilityMutedTextStyle, marginTop: 4 }}>启用后显示左上角红黄绿按钮，并优先使用 macOS 原生全屏行为。</div>
                                          </div>
                                          <Switch
                                              checked={appearance.useNativeMacWindowControls === true}
                                              onChange={(checked) => setAppearance({ useNativeMacWindowControls: checked })}
                                          />
                                      </div>
                                      <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)', marginTop: 8 }}>
                                          * 已同步隐藏右上角自定义按钮；如系统窗口样式未立即刷新，可重启应用后再确认
                                      </div>
                                  </div>
                              ) : null}
                              <div style={utilityPanelStyle}>
                                  <div style={{ marginBottom: 8, fontWeight: 500 }}>启动窗口</div>
                                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                                      <span>{isWindowsRuntime ? '启动时全屏（Windows 按最大化处理）' : '启动时全屏'}</span>
                                      <Switch checked={startupFullscreen} onChange={(checked) => setStartupFullscreen(checked)} />
                                  </div>
                                  <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)', marginTop: 4 }}>
                                      {isWindowsRuntime ? '* Windows 下该选项按“启动时最大化”处理，修改后下次启动生效' : '* 修改后下次启动生效'}
                                  </div>
                              </div>
                              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, paddingTop: 8, paddingBottom: 12 }}>
                                  <Button
                                       onClick={() => {
                                           setUiScale(DEFAULT_UI_SCALE);
                                           setFontSize(DEFAULT_FONT_SIZE);
                                           setAppearance({ enabled: true, opacity: 1.0, blur: 0, useNativeMacWindowControls: false });
                                       }}
                                   >
                                       恢复默认
                                  </Button>
                              </div>
                          </div>
                      )}
                  </div>
              </div>
          </Modal>

          <Modal
              title={renderUtilityModalTitle(<LinkOutlined />, '快捷键管理', '统一查看、录制与启停常用快捷键，保持操作习惯一致。')}
              open={isShortcutModalOpen}
              onCancel={() => {
                  setIsShortcutModalOpen(false);
                  setCapturingShortcutAction(null);
              }}
              width={760}
              styles={{ content: utilityModalShellStyle, header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 }, body: { paddingTop: 8 }, footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 } }}
              footer={[
                  <Button
                      key="reset"
                      onClick={() => {
                          resetShortcutOptions();
                          setCapturingShortcutAction(null);
                          void message.success('已恢复默认快捷键');
                      }}
                  >
                      恢复默认
                  </Button>,
                  <Button
                      key="close"
                      type="primary"
                      onClick={() => {
                          setIsShortcutModalOpen(false);
                          setCapturingShortcutAction(null);
                      }}
                  >
                      关闭
                  </Button>,
              ]}
          >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, paddingTop: 8 }}>
                  <div style={utilityPanelStyle}>
                      <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>
                          点击“录制”后按下快捷键。按 Esc 可取消录制。建议至少包含一个修饰键（Ctrl/Alt/Shift/Meta）。
                      </div>
                  </div>
                  {SHORTCUT_ACTION_ORDER.map((action) => {
                      const meta = SHORTCUT_ACTION_META[action];
                      if (meta.platformOnly === 'mac' && !isMacRuntime) {
                          return null;
                      }
                      const binding = shortcutOptions[action] ?? { combo: '', enabled: false };
                      const isCapturing = capturingShortcutAction === action;
                      return (
                          <div
                              key={action}
                              style={{
                                  ...utilityPanelStyle,
                                  display: 'grid',
                                  gridTemplateColumns: '1fr auto',
                                  gap: 12,
                                  alignItems: 'center',
                                  padding: '10px 12px',
                              }}
                          >
                              <div>
                                  <div style={{ fontWeight: 500 }}>{meta.label}</div>
                                  <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>{meta.description}</div>
                              </div>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <Input
                                      readOnly
                                      value={isCapturing ? '请按下快捷键...' : getShortcutDisplay(binding.combo)}
                                      style={{ width: 180, fontFamily: 'Consolas, Menlo, Monaco, monospace' }}
                                  />
                                  <Button
                                      size="small"
                                      onClick={() => setCapturingShortcutAction((prev) => (prev === action ? null : action))}
                                  >
                                      {isCapturing ? '取消' : '录制'}
                                  </Button>
                                  <Switch
                                      checked={binding.enabled}
                                      onChange={(checked) => updateShortcut(action, { enabled: checked })}
                                  />
                              </div>
                          </div>
                      );
                  })}
              </div>
          </Modal>
          <Modal
              title={renderUtilityModalTitle(<GlobalOutlined />, '全局代理设置', '统一配置更新检查、驱动管理与未单独指定代理的连接网络出口。')}
              open={isProxyModalOpen}
              onCancel={() => setIsProxyModalOpen(false)}
              footer={null}
              width={520}
              styles={{ content: utilityModalShellStyle, header: { background: 'transparent', borderBottom: 'none', paddingBottom: 8 }, body: { paddingTop: 8 }, footer: { background: 'transparent', borderTop: 'none', paddingTop: 10 } }}
          >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '12px 0' }}>
                  <div style={utilityPanelStyle}>
                      <div style={{ marginBottom: 8, fontWeight: 500 }}>全局代理</div>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                          <span>启用全局代理</span>
                          <Switch checked={globalProxy.enabled} onChange={(checked) => setGlobalProxy({ enabled: checked })} />
                      </div>
                      <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, opacity: globalProxy.enabled ? 1 : 0.7 }}>
                          <div>
                              <div style={{ marginBottom: 6, fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>代理类型</div>
                              <Select
                                  value={globalProxy.type}
                                  disabled={!globalProxy.enabled}
                                  options={[
                                      { value: 'socks5', label: 'SOCKS5' },
                                      { value: 'http', label: 'HTTP' },
                                  ]}
                                  onChange={(value) => setGlobalProxy({ type: value as 'socks5' | 'http' })}
                              />
                          </div>
                          <div>
                              <div style={{ marginBottom: 6, fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>端口</div>
                              <InputNumber
                                  min={1}
                                  max={65535}
                                  style={{ width: '100%' }}
                                  value={globalProxy.port}
                                  disabled={!globalProxy.enabled}
                                  onChange={(value) => setGlobalProxy({
                                      port: typeof value === 'number' ? value : (globalProxy.type === 'http' ? 8080 : 1080),
                                  })}
                              />
                          </div>
                          <div style={{ gridColumn: '1 / span 2' }}>
                              <div style={{ marginBottom: 6, fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>代理地址</div>
                              <Input
                                  placeholder="例如：127.0.0.1"
                                  value={globalProxy.host}
                                  disabled={!globalProxy.enabled}
                                  onChange={(e) => setGlobalProxy({ host: e.target.value })}
                              />
                          </div>
                          <div>
                              <div style={{ marginBottom: 6, fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>用户名（可选）</div>
                              <Input
                                  placeholder="proxy-user"
                                  value={globalProxy.user}
                                  disabled={!globalProxy.enabled}
                                  onChange={(e) => setGlobalProxy({ user: e.target.value })}
                              />
                          </div>
                          <div>
                              <div style={{ marginBottom: 6, fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>密码（可选）</div>
                              <Input.Password
                                  placeholder="proxy-password"
                                  value={globalProxy.password}
                                  disabled={!globalProxy.enabled}
                                  onChange={(e) => setGlobalProxy({ password: e.target.value })}
                              />
                          </div>
                      </div>
                      <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)', marginTop: 6 }}>
                          * 作用于更新检查、驱动管理网络请求，以及未单独配置代理的数据库连接
                      </div>
                  </div>
              </div>
          </Modal>

          <Modal
              title={updateDownloadProgress.version ? `下载更新 ${updateDownloadProgress.version}` : '下载更新'}
              open={updateDownloadProgress.open}
              closable
              maskClosable
              keyboard
              onCancel={hideUpdateDownloadProgress}
              footer={updateDownloadProgress.status === 'start' || updateDownloadProgress.status === 'downloading' ? [
                  <Button
                      key="background"
                      onClick={() => {
                          updateUserDismissedRef.current = true;
                          hideUpdateDownloadProgress();
                      }}
                  >
                      隐藏到后台
                  </Button>
              ] : (updateDownloadProgress.status === 'done' ? [
                  <Button key="close" onClick={hideUpdateDownloadProgress}>关闭</Button>,
                  <Button key="install" type="primary" onClick={handleInstallFromProgress}>
                      {isMacRuntime ? '打开安装目录' : '安装更新'}
                  </Button>
              ] : (updateDownloadProgress.status === 'error' ? [
                  <Button key="close" onClick={hideUpdateDownloadProgress}>关闭</Button>
              ] : null))}
          >
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <Progress
                      percent={Math.round(updateDownloadProgress.percent)}
                      status={updateDownloadProgress.status === 'error' ? 'exception' : (updateDownloadProgress.status === 'done' ? 'success' : 'active')}
                  />
                  <div style={{ fontSize: 12, color: darkMode ? 'rgba(255,255,255,0.5)' : 'rgba(16,24,40,0.55)' }}>
                      {`${formatBytes(updateDownloadProgress.downloaded)} / ${formatBytes(updateDownloadProgress.total)}`}
                  </div>
                  {updateDownloadProgress.message ? (
                      <div style={{ fontSize: 12, color: '#ff4d4f' }}>{updateDownloadProgress.message}</div>
                  ) : null}
              </div>
          </Modal>

          {showLinuxResizeHandles && (
              <>
                  {/* Linux Mint 下 frameless 仅局部可缩放：补四边四角命中层 */}
                  <div style={{ ...linuxResizeHandleStyleBase, top: 0, left: 14, right: 14, height: 6, cursor: 'ns-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, bottom: 0, left: 14, right: 14, height: 6, cursor: 'ns-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, top: 14, bottom: 14, left: 0, width: 6, cursor: 'ew-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, top: 14, bottom: 14, right: 0, width: 6, cursor: 'ew-resize' }} />

                  <div style={{ ...linuxResizeHandleStyleBase, top: 0, left: 0, width: 14, height: 14, cursor: 'nwse-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, top: 0, right: 0, width: 14, height: 14, cursor: 'nesw-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, bottom: 0, left: 0, width: 14, height: 14, cursor: 'nesw-resize' }} />
                  <div style={{ ...linuxResizeHandleStyleBase, bottom: 0, right: 0, width: 14, height: 14, cursor: 'nwse-resize' }} />
              </>
          )}
          
          {/* Ghost Resize Line for Sidebar */}
          <div 
              ref={ghostRef}
              style={{
                  position: 'fixed',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  width: '4px',
                  background: resizeGuideColor,
                  zIndex: 9999,
                  pointerEvents: 'none',
                  display: 'none'
              }}
          />
          
          {/* Ghost Resize Line for Log Panel */}
          <div 
              ref={logGhostRef}
              style={{
                  position: 'fixed',
                  left: sidebarWidth, // Start from sidebar edge
                  right: 0,
                  height: '4px',
                  background: resizeGuideColor,
                  zIndex: 9999,
                  pointerEvents: 'none',
                  display: 'none',
                  cursor: 'row-resize'
              }}
          />
        </Layout>
    </ConfigProvider>
  );
}

export default App;

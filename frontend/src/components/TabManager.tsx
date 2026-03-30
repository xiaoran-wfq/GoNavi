import React, { useMemo, useRef, useState } from 'react';
import { Tabs, Dropdown } from 'antd';
import type { MenuProps, TabsProps } from 'antd';
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent, DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, horizontalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { useStore } from '../store';
import DataViewer from './DataViewer';
import QueryEditor from './QueryEditor';
import TableDesigner from './TableDesigner';
import RedisViewer from './RedisViewer';
import RedisCommandEditor from './RedisCommandEditor';
import RedisMonitor from './RedisMonitor';
import TriggerViewer from './TriggerViewer';
import DefinitionViewer from './DefinitionViewer';
import TableOverview from './TableOverview';
import type { TabData } from '../types';

const detectConnectionEnvLabel = (connectionName: string): string | null => {
  const tokens = connectionName.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (tokens.includes('prod') || tokens.includes('production')) return 'PROD';
  if (tokens.includes('uat')) return 'UAT';
  if (tokens.includes('dev') || tokens.includes('development')) return 'DEV';
  if (tokens.includes('sit')) return 'SIT';
  if (tokens.includes('stg') || tokens.includes('stage') || tokens.includes('staging') || tokens.includes('pre')) return 'STG';
  if (tokens.includes('test') || tokens.includes('qa')) return 'TEST';
  return null;
};

const buildTabDisplayTitle = (tab: TabData, connectionName: string | undefined): string => {
  if (tab.type !== 'table' && tab.type !== 'design' && tab.type !== 'table-overview') return tab.title;
  if (!connectionName) return tab.title;
  const prefix = detectConnectionEnvLabel(connectionName) || connectionName;
  return `[${prefix}] ${tab.title}`;
};

type SortableTabLabelProps = {
  displayTitle: string;
  menuItems: MenuProps['items'];
};

const SortableTabLabel: React.FC<SortableTabLabelProps> = ({
  displayTitle,
  menuItems,
}) => {
  return (
    <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']}>
      <span
        className="tab-dnd-label"
        onContextMenu={(e) => e.preventDefault()}
        title="拖拽调整标签顺序"
      >
        {displayTitle}
      </span>
    </Dropdown>
  );
};

type DraggableTabNodeProps = {
  node: React.ReactElement;
};

const DraggableTabNode: React.FC<DraggableTabNodeProps> = ({ node }) => {
  const tabId = String(node.key || '').trim();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tabId });
  const style: React.CSSProperties = {
    ...(node.props.style || {}),
    transform: CSS.Transform.toString(transform),
    transition: transition || 'transform 180ms cubic-bezier(0.22, 1, 0.36, 1)',
    opacity: isDragging ? 0.88 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
    touchAction: 'none',
    zIndex: isDragging ? 2 : node.props.style?.zIndex,
  };

  return React.cloneElement(node, {
    ref: setNodeRef,
    style,
    ...attributes,
    ...listeners,
    className: `${node.props.className || ''} tab-dnd-node${isDragging ? ' is-dragging' : ''}`,
  });
};

const TabManager: React.FC = () => {
  const tabs = useStore(state => state.tabs);
  const connections = useStore(state => state.connections);
  const theme = useStore(state => state.theme);
  const activeTabId = useStore(state => state.activeTabId);
  const setActiveTab = useStore(state => state.setActiveTab);
  const addTab = useStore(state => state.addTab);
  const closeTab = useStore(state => state.closeTab);
  const closeOtherTabs = useStore(state => state.closeOtherTabs);
  const closeTabsToLeft = useStore(state => state.closeTabsToLeft);
  const closeTabsToRight = useStore(state => state.closeTabsToRight);
  const closeAllTabs = useStore(state => state.closeAllTabs);
  const moveTab = useStore(state => state.moveTab);
  const tabsNavBorderColor = theme === 'dark' ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.08)';
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const suppressClickUntilRef = useRef<number>(0);
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const onChange = (newActiveKey: string) => {
    setActiveTab(newActiveKey);
  };

  const onEdit = (targetKey: React.MouseEvent | React.KeyboardEvent | string, action: 'add' | 'remove') => {
    if (action === 'remove') {
      closeTab(targetKey as string);
    }
  };

  const handleDragStart = (event: DragStartEvent) => {
    const sourceId = String(event.active.id || '').trim();
    setDraggingTabId(sourceId || null);
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const sourceId = String(event.active.id || '').trim();
    const targetId = String(event.over?.id || '').trim();
    setDraggingTabId(null);
    if (!sourceId || !targetId || sourceId === targetId) {
      return;
    }
    suppressClickUntilRef.current = Date.now() + 120;
    moveTab(sourceId, targetId);
  };

  const handleDragCancel = () => {
    setDraggingTabId(null);
  };

  React.useEffect(() => {
    const handleGlobalInsertSql = (e: any) => {
      const { sql, runImmediately, connectionId: eventConnId, dbName: eventDbName } = e.detail;
      if (!sql) return;

      const activeTab = tabs.find(t => t.id === activeTabId);
      
      // 🔧 runImmediately（点击"执行"）始终新建独立 tab，避免追加到已有 tab 导致 SQL 重复
      if (runImmediately) {
        const newTabId = 'tab-' + Date.now();
        const resolvedConnId = eventConnId || activeTab?.connectionId || (connections.length > 0 ? connections[0].id : '');
        const resolvedDbName = eventConnId ? (eventDbName || '') : (activeTab?.dbName || '');
        addTab({
            id: newTabId,
            type: 'query',
            title: '新建查询',
            query: sql,
            connectionId: resolvedConnId,
            dbName: resolvedDbName
        });
        setActiveTab(newTabId);
        setTimeout(() => {
            window.dispatchEvent(new CustomEvent('gonavi:insert-sql-to-tab', {
                detail: { tabId: newTabId, sql, runImmediately: true, connectionId: resolvedConnId, dbName: resolvedDbName }
            }));
        }, 300);
        return;
      }
      
      // 插入模式：追加到已有 tab 或新建 tab
      if (activeTab && activeTab.type === 'query') {
        window.dispatchEvent(new CustomEvent('gonavi:insert-sql-to-tab', {
          detail: { tabId: activeTab.id, sql, runImmediately: false, connectionId: eventConnId, dbName: eventDbName }
        }));
      } else {
        const newTabId = 'tab-' + Date.now();
        const resolvedConnId = eventConnId || activeTab?.connectionId || (connections.length > 0 ? connections[0].id : '');
        const resolvedDbName = eventConnId ? (eventDbName || '') : (activeTab?.dbName || '');
        addTab({
            id: newTabId,
            type: 'query',
            title: '新建查询',
            query: sql,
            connectionId: resolvedConnId,
            dbName: resolvedDbName
        });
        setActiveTab(newTabId);
      }
    };
    window.addEventListener('gonavi:insert-sql', handleGlobalInsertSql);
    return () => window.removeEventListener('gonavi:insert-sql', handleGlobalInsertSql);
  }, [tabs, activeTabId, addTab, setActiveTab, connections]);

  const tabIds = useMemo(() => tabs.map((tab) => tab.id), [tabs]);

  const renderTabBar: TabsProps['renderTabBar'] = (tabBarProps, DefaultTabBar) => (
    <DefaultTabBar {...tabBarProps}>
      {(node) => <DraggableTabNode key={node.key} node={node} />}
    </DefaultTabBar>
  );

  const items = useMemo(() => tabs.map((tab, index) => {
    const connectionName = connections.find((conn) => conn.id === tab.connectionId)?.name;
    const displayTitle = buildTabDisplayTitle(tab, connectionName);
    const tabIsActive = tab.id === activeTabId;
    let content;
    if (tab.type === 'query') {
      content = <QueryEditor tab={tab} isActive={tabIsActive} />;
    } else if (tab.type === 'table') {
      content = <DataViewer tab={tab} isActive={tabIsActive} />;
    } else if (tab.type === 'design') {
      content = <TableDesigner tab={tab} />;
    } else if (tab.type === 'redis-keys') {
      content = <RedisViewer connectionId={tab.connectionId} redisDB={tab.redisDB ?? 0} />;
    } else if (tab.type === 'redis-command') {
      content = <RedisCommandEditor connectionId={tab.connectionId} redisDB={tab.redisDB ?? 0} />;
    } else if (tab.type === 'redis-monitor') {
      content = <RedisMonitor connectionId={tab.connectionId} redisDB={tab.redisDB ?? 0} />;
    } else if (tab.type === 'trigger') {
      content = <TriggerViewer tab={tab} />;
    } else if (tab.type === 'view-def' || tab.type === 'routine-def') {
      content = <DefinitionViewer tab={tab} />;
    } else if (tab.type === 'table-overview') {
      content = <TableOverview tab={tab} />;
    }

    const menuItems: MenuProps['items'] = [
      {
        key: 'close-other',
        label: '关闭其他页',
        disabled: tabs.length <= 1,
        onClick: () => closeOtherTabs(tab.id),
      },
      {
        key: 'close-left',
        label: '关闭左侧',
        disabled: index === 0,
        onClick: () => closeTabsToLeft(tab.id),
      },
      {
        key: 'close-right',
        label: '关闭右侧',
        disabled: index === tabs.length - 1,
        onClick: () => closeTabsToRight(tab.id),
      },
      { type: 'divider' },
      {
        key: 'close-all',
        label: '关闭所有',
        disabled: tabs.length === 0,
        onClick: () => closeAllTabs(),
      },
    ];
    
    return {
      label: (
        <SortableTabLabel
          displayTitle={displayTitle}
          menuItems={menuItems}
        />
      ),
      key: tab.id,
      children: content,
    };
  }), [tabs, connections, activeTabId, closeOtherTabs, closeTabsToLeft, closeTabsToRight, closeAllTabs]);

  return (
    <>
        <style>{`
            .main-tabs {
              height: 100%;
              flex: 1 1 auto;
              min-height: 0;
              min-width: 0;
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            .main-tabs .ant-tabs-nav {
              flex: 0 0 auto;
            }
            .main-tabs .ant-tabs-content-holder {
              flex: 1 1 auto;
              min-height: 0;
              min-width: 0;
              overflow: hidden;
              display: flex;
              flex-direction: column;
            }
            .main-tabs .ant-tabs-content {
              flex: 1 1 auto;
              min-height: 0;
              min-width: 0;
              display: flex;
              flex-direction: column;
            }
            .main-tabs .ant-tabs-tabpane {
              flex: 1 1 auto;
              min-height: 0;
              min-width: 0;
              display: flex;
              flex-direction: column;
              overflow: hidden;
            }
            .main-tabs .ant-tabs-tabpane > div {
              flex: 1 1 auto;
              min-height: 0;
              min-width: 0;
            }
            .main-tabs .ant-tabs-tabpane-hidden {
              display: none !important;
            }
            .main-tabs .ant-tabs-nav::before {
                border-bottom: 1px solid ${tabsNavBorderColor} !important;
            }
            .main-tabs .ant-tabs-tab {
              transition: transform 180ms cubic-bezier(0.22, 1, 0.36, 1), background-color 120ms ease;
            }
            .main-tabs .tab-dnd-label {
              user-select: none;
              -webkit-user-select: none;
              display: inline-flex;
              align-items: center;
              max-width: 100%;
            }
            .main-tabs .tab-dnd-node.is-dragging,
            .main-tabs .tab-dnd-node.is-dragging .tab-dnd-label {
              cursor: grabbing !important;
            }
            body[data-theme='dark'] .main-tabs .ant-tabs-tab-btn:focus-visible {
              outline: none !important;
              border-radius: 6px;
              box-shadow: 0 0 0 2px rgba(255, 214, 102, 0.72);
              background: rgba(255, 214, 102, 0.16);
            }
            body[data-theme='light'] .main-tabs .ant-tabs-tab-btn:focus-visible {
              outline: none !important;
              border-radius: 6px;
              box-shadow: 0 0 0 2px rgba(9, 109, 217, 0.32);
              background: rgba(9, 109, 217, 0.08);
            }
            body[data-theme='dark'] .main-tabs .ant-tabs-tab.ant-tabs-tab-active {
              background: rgba(255, 214, 102, 0.12) !important;
              border-color: rgba(255, 214, 102, 0.4) !important;
            }
        `}</style>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          modifiers={[restrictToHorizontalAxis]}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
          <SortableContext items={tabIds} strategy={horizontalListSortingStrategy}>
            <Tabs
                className="main-tabs"
                type="editable-card"
                destroyInactiveTabPane={false}
                onChange={(newActiveKey) => {
                  if (Date.now() < suppressClickUntilRef.current) return;
                  onChange(newActiveKey);
                }}
                activeKey={activeTabId || undefined}
                onEdit={onEdit}
                items={items}
                hideAdd
                renderTabBar={renderTabBar}
            />
          </SortableContext>
        </DndContext>
    </>
  );
};

export default TabManager;

// cspell:ignore anticon sqls uuidv uuidv4 hscroll
import React, { useState, useEffect, useRef, useContext, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Table, message, Input, Button, Dropdown, MenuProps, Form, Pagination, Select, Modal, Checkbox, Segmented, Tooltip, Popover, DatePicker, TimePicker } from 'antd';
import dayjs from 'dayjs';
import type { SortOrder, ColumnType } from 'antd/es/table/interface';
import { ReloadOutlined, ImportOutlined, ExportOutlined, DownOutlined, PlusOutlined, DeleteOutlined, SaveOutlined, UndoOutlined, FilterOutlined, CloseOutlined, ConsoleSqlOutlined, FileTextOutlined, CopyOutlined, ClearOutlined, EditOutlined, VerticalAlignBottomOutlined, LeftOutlined, RightOutlined, RobotOutlined } from '@ant-design/icons';
import Editor from '@monaco-editor/react';
import { 
    DndContext, 
    DragEndEvent, 
    PointerSensor, 
    MouseSensor,
    TouchSensor,
    useSensor, 
    useSensors, 
    closestCenter 
} from '@dnd-kit/core';
import { 
    SortableContext, 
    useSortable, 
    horizontalListSortingStrategy, 
    arrayMove 
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImportData, ExportTable, ExportData, ExportQuery, ApplyChanges, DBGetColumns } from '../../wailsjs/go/app/App';
import ImportPreviewModal from './ImportPreviewModal';
import { useStore } from '../store';
import type { ColumnDefinition } from '../types';
import { v4 as generateUuid } from 'uuid';
import 'react-resizable/css/styles.css';
import { buildOrderBySQL, buildPaginatedSelectSQL, buildWhereSQL, escapeLiteral, hasExplicitSort, quoteIdentPart, quoteQualifiedIdent, withSortBufferTuningSQL, type FilterCondition } from '../utils/sql';
import { isMacLikePlatform, normalizeOpacityForPlatform, resolveAppearanceValues } from '../utils/appearance';
import { getDataSourceCapabilities } from '../utils/dataSourceCapabilities';
import { resolvePaginationPageText, resolvePaginationSummaryText, resolvePaginationTotalForControl } from '../utils/dataGridPagination';
import { calculateTableBodyBottomPadding, calculateVirtualTableScrollX } from './dataGridLayout';

// --- Error Boundary ---
interface DataGridErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
}

class DataGridErrorBoundary extends React.Component<
    { children: React.ReactNode },
    DataGridErrorBoundaryState
> {
    constructor(props: { children: React.ReactNode }) {
        super(props);
        this.state = { hasError: false, error: null };
    }

    static getDerivedStateFromError(error: Error): DataGridErrorBoundaryState {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
        console.error('DataGrid render error:', error, errorInfo);
    }

    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: 16, color: '#ff4d4f' }}>
                    <h4>渲染错误</h4>
                    <p>数据表格渲染时发生错误，可能是数据格式问题。</p>
                    <pre style={{ fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {this.state.error?.message}
                    </pre>
                    <Button
                        size="small"
                        onClick={() => this.setState({ hasError: false, error: null })}
                    >
                        重试
                    </Button>
                </div>
            );
        }
        return this.props.children;
    }
}

// 内部行标识字段：避免与真实业务字段（如 `key` 列）冲突。
export const GONAVI_ROW_KEY = '__gonavi_row_key__';

// Cell key helpers for batch selection/fill.
// Use a control character separator to avoid collisions with rowKey/columnName contents (e.g. `new-123`).
const CELL_KEY_SEP = '\u0001';
const DATE_TIME_CACHE_LIMIT = 2000;
const TABLE_CELL_PREVIEW_MAX_CHARS = 240;
const normalizedDateTimeCache = new Map<string, string>();
const objectCellPreviewCache = new WeakMap<object, string>();
const makeCellKey = (rowKey: string, colName: string) => `${rowKey}${CELL_KEY_SEP}${colName}`;
const splitCellKey = (cellKey: string): { rowKey: string; colName: string } | null => {
    const sepIndex = cellKey.indexOf(CELL_KEY_SEP);
    if (sepIndex === -1) return null;
    return {
        rowKey: cellKey.slice(0, sepIndex),
        colName: cellKey.slice(sepIndex + CELL_KEY_SEP.length),
    };
};

const trimSimpleCache = (cache: Map<string, string>, limit: number) => {
    if (cache.size < limit) return;
    const firstKey = cache.keys().next().value;
    if (typeof firstKey === 'string') {
        cache.delete(firstKey);
    }
};

const looksLikeDateTimeText = (val: string): boolean => {
    if (!val) return false;
    const len = val.length;
    if (len < 19 || len > 48) return false;
    const charCode0 = val.charCodeAt(0);
    if (charCode0 < 48 || charCode0 > 57) return false;
    return (
        val[4] === '-' &&
        val[7] === '-' &&
        (val[10] === ' ' || val[10] === 'T') &&
        val[13] === ':' &&
        val[16] === ':'
    );
};

// Normalize common datetime strings to `YYYY-MM-DD HH:mm:ss` for display/editing.
// Handles RFC3339 and Go-style datetime text like `2024-05-13 08:32:47 +0800 CST`.
// Also keep invalid datetime values like `0000-00-00 00:00:00` unchanged.
const normalizeDateTimeString = (val: string) => {
    if (!looksLikeDateTimeText(val)) {
        return val;
    }

    const cached = normalizedDateTimeCache.get(val);
    if (cached !== undefined) {
        return cached;
    }

    // 检查是否为无效日期时间（0000-00-00 或类似格式）
    if (/^0{4}-0{2}-0{2}/.test(val)) {
        return val; // 保持原样显示，不尝试转换
    }

    const match = val.match(
        /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:\s*(?:Z|[+-]\d{2}:?\d{2})(?:\s+[A-Za-z_\/+-]+)?)?$/
    );
    const normalized = match ? `${match[1]} ${match[2]}` : val;
    trimSimpleCache(normalizedDateTimeCache, DATE_TIME_CACHE_LIMIT);
    normalizedDateTimeCache.set(val, normalized);
    return normalized;
};

const isTemporalColumnType = (columnType?: string): boolean => {
    const raw = String(columnType || '').trim().toLowerCase();
    if (!raw) return false;
    if (raw.includes('datetime') || raw.includes('timestamp')) return true;
    const base = raw.split(/[ (]/)[0];
    return base === 'date' || base === 'time' || base === 'year';
};

// 根据列类型返回 DatePicker 的 picker 模式
type TemporalPickerType = 'datetime' | 'date' | 'time' | 'year' | null;
const getTemporalPickerType = (columnType?: string): TemporalPickerType => {
    const raw = String(columnType || '').trim().toLowerCase();
    if (!raw) return null;
    if (raw.includes('datetime') || raw.includes('timestamp')) return 'datetime';
    const base = raw.split(/[ (]/)[0];
    if (base === 'date') return 'date';
    if (base === 'time') return 'time';
    if (base === 'year') return 'year';
    return null;
};

const TEMPORAL_FORMATS: Record<string, string> = {
    datetime: 'YYYY-MM-DD HH:mm:ss',
    date: 'YYYY-MM-DD',
    time: 'HH:mm:ss',
    year: 'YYYY',
};

// 将字符串值转为 dayjs 对象（用于 DatePicker），无效值返回 null
const parseToDayjs = (val: any, pickerType: TemporalPickerType): dayjs.Dayjs | null => {
    if (val === null || val === undefined || val === '') return null;
    const str = String(val).trim();
    if (!str || /^0{4}-0{2}-0{2}/.test(str)) return null; // 无效日期
    const fmt = TEMPORAL_FORMATS[pickerType || 'datetime'];
    const d = dayjs(str, fmt);
    return d.isValid() ? d : dayjs(str).isValid() ? dayjs(str) : null;
};

// 将 dayjs 对象格式化为对应格式字符串
const formatFromDayjs = (val: dayjs.Dayjs | null, pickerType: TemporalPickerType): string => {
    if (!val || !val.isValid()) return '';
    const fmt = TEMPORAL_FORMATS[pickerType || 'datetime'];
    return val.format(fmt);
};

// --- Helper: Format Value ---
const formatCellValue = (val: any) => {
    try {
        if (val === null) return <span style={{ color: '#ccc' }}>NULL</span>;
        if (typeof val === 'object') {
            if (!Array.isArray(val) && !isPlainObject(val)) {
                return String(val);
            }
            const cached = objectCellPreviewCache.get(val);
            if (cached !== undefined) {
                return cached;
            }
            const topLevelSize = Array.isArray(val) ? val.length : Object.keys(val || {}).length;
            if (topLevelSize > 80) {
                const summary = Array.isArray(val) ? `[Array(${topLevelSize})]` : `{Object(${topLevelSize})}`;
                objectCellPreviewCache.set(val, summary);
                return summary;
            }
            try {
                const nextText = JSON.stringify(val);
                const previewText = nextText.length > TABLE_CELL_PREVIEW_MAX_CHARS ? `${nextText.slice(0, TABLE_CELL_PREVIEW_MAX_CHARS)}…` : nextText;
                objectCellPreviewCache.set(val, previewText);
                return previewText;
            } catch {
                return '[Object]';
            }
        }
        if (typeof val === 'string') {
            const normalized = normalizeDateTimeString(val);
            return normalized.length > TABLE_CELL_PREVIEW_MAX_CHARS ? `${normalized.slice(0, TABLE_CELL_PREVIEW_MAX_CHARS)}…` : normalized;
        }
        return String(val);
    } catch (e) {
        console.error('formatCellValue error:', e);
        return '[Error]';
    }
};

const toEditableText = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return val;
    try {
        return JSON.stringify(val, null, 2);
    } catch {
        return String(val);
    }
};

const toFormText = (val: any): string => {
    if (val === null || val === undefined) return '';
    if (typeof val === 'string') return normalizeDateTimeString(val);
    return toEditableText(val);
};

// 用于变更比较：NULL 与 undefined 视为同类空值；与空字符串严格区分。
const isCellValueEqualForDiff = (left: any, right: any): boolean => {
    if (left === right) return true;
    const leftNullish = left === null || left === undefined;
    const rightNullish = right === null || right === undefined;
    if (leftNullish || rightNullish) return leftNullish && rightNullish;
    return toFormText(left) === toFormText(right);
};

// 渲染阶段轻量比较：避免对象值在 shouldCellUpdate 中反复深度序列化导致卡顿。
const isCellValueEqualForRender = (left: any, right: any): boolean => {
    if (left === right) return true;
    const leftNullish = left === null || left === undefined;
    const rightNullish = right === null || right === undefined;
    if (leftNullish || rightNullish) return leftNullish && rightNullish;

    const leftType = typeof left;
    const rightType = typeof right;
    if (leftType === 'object' || rightType === 'object') {
        // 对象仅按引用比较；真正的值差异在提交保存时再做严格比对。
        return false;
    }

    if (leftType === 'string' || rightType === 'string') {
        return normalizeDateTimeString(String(left)) === normalizeDateTimeString(String(right));
    }
    return left === right;
};

const INLINE_EDIT_MAX_CHARS = 2000;

const shouldOpenModalEditor = (val: any): boolean => {
    if (val === null || val === undefined) return false;
    if (typeof val === 'string') {
        if (val.length > INLINE_EDIT_MAX_CHARS || val.includes('\n')) return true;
        const trimmed = val.trimStart();
        return trimmed.startsWith('{') || trimmed.startsWith('[');
    }
    return typeof val === 'object';
};

const getCellFieldName = (record: Item, dataIndex: string) => {
    const rowKey = record?.[GONAVI_ROW_KEY];
    if (rowKey === undefined || rowKey === null) return dataIndex;
    return [String(rowKey), dataIndex];
};

const setCellFieldValue = (form: any, fieldName: string | (string | number)[], value: any) => {
    if (!form) return;
    if (Array.isArray(fieldName)) {
        const [rowKey, colKey] = fieldName;
        form.setFieldsValue({ [rowKey]: { [colKey]: value } });
        return;
    }
    form.setFieldsValue({ [fieldName]: value });
};

const looksLikeJsonText = (text: string): boolean => {
    const raw = (text || '').trim();
    if (!raw) return false;
    const first = raw[0];
    const last = raw[raw.length - 1];
    return (first === '{' && last === '}') || (first === '[' && last === ']');
};

const isPlainObject = (value: any): value is Record<string, any> => {
    return Object.prototype.toString.call(value) === '[object Object]';
};

const normalizeValueForJsonView = (value: any): any => {
    if (value === null || value === undefined) return value;

    if (typeof value === 'string') {
        const normalizedText = normalizeDateTimeString(value);
        if (!looksLikeJsonText(normalizedText)) return normalizedText;
        try {
            return normalizeValueForJsonView(JSON.parse(normalizedText));
        } catch {
            return normalizedText;
        }
    }

    if (Array.isArray(value)) {
        return value.map((item) => normalizeValueForJsonView(item));
    }

    if (isPlainObject(value)) {
        const next: Record<string, any> = {};
        Object.entries(value).forEach(([key, val]) => {
            next[key] = normalizeValueForJsonView(val);
        });
        return next;
    }

    return value;
};

const isJsonViewValueEqual = (left: any, right: any): boolean => {
    const leftNormalized = normalizeValueForJsonView(left);
    const rightNormalized = normalizeValueForJsonView(right);

    if (leftNormalized === rightNormalized) return true;
    if (leftNormalized === null || rightNormalized === null) return leftNormalized === rightNormalized;
    if (leftNormalized === undefined || rightNormalized === undefined) return leftNormalized === rightNormalized;

    if (typeof leftNormalized !== 'object' && typeof rightNormalized !== 'object') {
        return String(leftNormalized) === String(rightNormalized);
    }

    try {
        return JSON.stringify(leftNormalized) === JSON.stringify(rightNormalized);
    } catch {
        return false;
    }
};

const coerceJsonEditorValueForStorage = (currentValue: any, editedValue: any): any => {
    if (typeof currentValue === 'string') {
        const raw = currentValue.trim();
        const parsedCurrent = looksLikeJsonText(raw);
        if (parsedCurrent && (isPlainObject(editedValue) || Array.isArray(editedValue))) {
            return JSON.stringify(editedValue);
        }
    }
    return editedValue;
};

// --- Resizable Header (Native Implementation) ---
const ResizableTitle = React.forwardRef<HTMLTableCellElement, any>((props, ref) => {
  const { onResizeStart, width, ...restProps } = props;

  const nextStyle = { ...(restProps.style || {}) } as React.CSSProperties;
  if (width) {
    nextStyle.width = width;
  }

  // 注意：virtual table 模式下，rc-table 会依赖 header cell 的 width 样式来渲染选择列。
  // 若这里丢失 width，可能导致左上角“全选”checkbox 不显示。
  if (!width || typeof onResizeStart !== 'function') {
    return <th ref={ref} {...restProps} style={nextStyle} />;
  }

  return (
    <th ref={ref} {...restProps} style={{ ...nextStyle, position: 'relative' }}>
      {restProps.children}
      <span
        className="react-resizable-handle"
        onMouseDown={(e) => {
            e.stopPropagation();
            // Pass the header element reference implicitly via event target
            onResizeStart(e);
        }}
        onPointerDown={(e) => {
            // 阻止 pointerdown 冒泡到 @dnd-kit 的 PointerSensor，
            // 避免调整列宽时意外触发列拖拽排序
            e.stopPropagation();
        }}
        onClick={(e) => e.stopPropagation()}
        style={{
            position: 'absolute',
            right: 0, // Align to right edge
            bottom: 0,
            top: 0,
            width: 10,
            cursor: 'col-resize',
            zIndex: 10,
            touchAction: 'none'
        }}
      />
    </th>
  );
});

// --- Sortable Header Cell ---
interface SortableHeaderCellProps extends React.HTMLAttributes<HTMLTableCellElement> {
    id?: string;
}

// --- Sortable Header Cell ---
interface SortableHeaderCellProps extends React.HTMLAttributes<HTMLTableCellElement> {
    id?: string;
}

// 静态 CSS 移到组件外，强制去除 th 内边距并确保指针穿透
const sortableHeaderStaticStyles = `
    .gonavi-sortable-header-cell {
        padding: 0 !important;
        overflow: hidden;
    }
    .gonavi-sortable-header-cell[data-cursor-grabbing="true"],
    .gonavi-sortable-header-cell[data-cursor-grabbing="true"] *,
    .gonavi-sortable-header-cell.is-dragging,
    .gonavi-sortable-header-cell.is-dragging * {
        cursor: grabbing !important;
    }
    .sortable-header-cell-drag-handle {
        display: flex;
        align-items: center;
        width: 100%;
        height: 100%;
        min-height: 44px;
        padding: 0 10px;
        user-select: none;
        cursor: inherit;
        overflow: hidden;
    }
`;

const SortableHeaderCell: React.FC<SortableHeaderCellProps> = React.memo((props) => {
    const { id, children, style: propStyle, className: propClassName, ...restProps } = props;
    const [isPressed, setIsPressed] = useState(false);
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: id || '' });

    const style: React.CSSProperties = {
        ...propStyle,
        transform: CSS.Transform.toString(transform),
        transition,
        ...(isDragging ? { 
            position: 'relative', 
            zIndex: 9999, 
            opacity: 0.6, 
            backgroundColor: 'rgba(24, 144, 255, 0.15)',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)'
        } : {}),
        touchAction: 'none',
        willChange: 'transform',
        // 核心修复：将指针直接绑定到 th 级别，并由 isPressed 控制
        cursor: (isDragging || isPressed) ? 'grabbing' : 'pointer',
    };

    useEffect(() => {
        const handleGlobalMouseUp = () => setIsPressed(false);
        window.addEventListener('mouseup', handleGlobalMouseUp);
        return () => window.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    if (!id || id === 'GONAVI_SELECTION_COLUMN') {
        return <ResizableTitle {...restProps} style={{ ...propStyle, ...style }}>{children}</ResizableTitle>;
    }

    return (
        <ResizableTitle 
            ref={setNodeRef} 
            style={style} 
            className={`${propClassName || ''} ${isDragging ? 'is-dragging' : ''}`}
            data-cursor-grabbing={isDragging || isPressed}
            {...restProps} 
            {...attributes} 
            {...listeners}
            onPointerDown={(e: any) => {
                setIsPressed(true);
                if (listeners?.onPointerDown) listeners.onPointerDown(e);
            }}
        >
            <style>{sortableHeaderStaticStyles}</style>
            <div className="sortable-header-cell-drag-handle" title="拖拽以调整列顺序">
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', minWidth: 0, cursor: 'inherit' }}>
                    {children}
                </div>
            </div>
        </ResizableTitle>
    );
});

// --- Contexts ---
const EditableContext = React.createContext<any>(null);
const CellContextMenuContext = React.createContext<{
    showMenu: (e: React.MouseEvent, record: Item, dataIndex: string, title: React.ReactNode) => void;
    handleBatchFillToSelected: (record: Item, dataIndex: string) => void;
} | null>(null);
const DataContext = React.createContext<{
    selectedRowKeysRef: React.MutableRefObject<React.Key[]>;
    displayDataRef: React.MutableRefObject<any[]>;
    handleCopyInsert: (r: any) => void;
    handleCopyJson: (r: any) => void;
    handleCopyCsv: (r: any) => void;
    handleExportSelected: (format: string, r: any) => Promise<void>;
    copyToClipboard: (t: string) => void;
    tableName?: string;
    enableRowContextMenu: boolean;
    supportsCopyInsert: boolean;
} | null>(null);

interface Item {
  [key: string]: any;
}

interface EditableCellProps {
  title: React.ReactNode;
  editable: boolean;
  children: React.ReactNode;
  dataIndex: string;
  record: Item;
  handleSave: (record: Item) => void;
  focusCell?: (record: Item, dataIndex: string, title: React.ReactNode) => void;
  columnType?: string;
  as?: any;
  [key: string]: any;
}

const EditableCell: React.FC<EditableCellProps> = React.memo(({
  title,
  editable,
  children,
  dataIndex,
  record,
  handleSave,
  focusCell,
  columnType,
  as: Component = 'td',
  ...restProps
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<any>(null);
  const form = useContext(EditableContext);
  const cellContextMenuContext = useContext(CellContextMenuContext);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
    }
  }, [editing]);

  const toggleEdit = () => {
    setEditing(!editing);
    const raw = record[dataIndex];
    const fieldName = getCellFieldName(record, dataIndex);
    if (isDateTimeField) {
      // 日期时间类型: 将字符串值转为 dayjs 对象供 DatePicker 使用
      const dayjsVal = parseToDayjs(raw, pickerType);
      setCellFieldValue(form, fieldName, dayjsVal);
    } else {
      const initialValue = typeof raw === 'string' ? normalizeDateTimeString(raw) : raw;
      setCellFieldValue(form, fieldName, initialValue);
    }
  };

  const save = async () => {
    try {
      if (!form) return;
      const fieldName = getCellFieldName(record, dataIndex);
      await form.validateFields([fieldName]);
      let nextValue = form.getFieldValue(fieldName);
      // 日期时间类型: 将 dayjs 对象转回格式化字符串
      if (isDateTimeField && nextValue && dayjs.isDayjs(nextValue)) {
        nextValue = formatFromDayjs(nextValue as dayjs.Dayjs, pickerType);
      } else if (isDateTimeField && !nextValue) {
        nextValue = null;
      }
      toggleEdit();
      // 仅当值发生变化时才标记为修改，避免“双击-失焦”导致整行进入 modified 状态（蓝色高亮不清除）。
      if (!isCellValueEqualForDiff(record?.[dataIndex], nextValue)) {
        handleSave({ ...record, [dataIndex]: nextValue });
      }
      // 保存后移除焦点
      if (inputRef.current) {
        inputRef.current.blur();
      }
    } catch (errInfo) {
      console.log('Save failed:', errInfo);
    }
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    if (!cellContextMenuContext) return;
    e.preventDefault();
    e.stopPropagation(); // 阻止冒泡到行级菜单
    cellContextMenuContext.showMenu(e, record, dataIndex, title);
  };

  let childNode = children;

  const pickerType = getTemporalPickerType(columnType);
  const isDateTimeField = !!pickerType && !(/^0{4}-0{2}-0{2}/.test(String(record?.[dataIndex] || '')));

  if (editable) {
    childNode = editing ? (
      <Form.Item style={{ margin: 0 }} name={getCellFieldName(record, dataIndex)}>
        {isDateTimeField ? (
          pickerType === 'time' ? (
            <TimePicker
              ref={inputRef}
              style={{ width: '100%' }}
              format={TEMPORAL_FORMATS[pickerType]}
              onChange={() => setTimeout(save, 0)}
              needConfirm={false}
            />
          ) : pickerType === 'datetime' ? (
            <DatePicker
              ref={inputRef}
              style={{ width: '100%' }}
              showTime
              format={TEMPORAL_FORMATS[pickerType]}
              onOk={() => setTimeout(save, 0)}
              onOpenChange={(open) => {
                // 面板关闭（点击外部）且非通过"确定"按钮触发时退出编辑，不保存
                if (!open) setTimeout(() => { if (editing) toggleEdit(); }, 0);
              }}
              needConfirm
            />
          ) : (
            <DatePicker
              ref={inputRef}
              style={{ width: '100%' }}
              format={TEMPORAL_FORMATS[pickerType]}
              picker={pickerType as any}
              onChange={() => setTimeout(save, 0)}
              needConfirm={false}
            />
          )
        ) : (
          <Input
            ref={inputRef}
            onPressEnter={save}
            onBlur={save}
            onFocus={(e) => {
              try {
                (e.target as HTMLInputElement)?.select?.();
              } catch {
                // ignore
              }
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              try {
                (e.target as HTMLInputElement)?.select?.();
              } catch {
                // ignore
              }
            }}
          />
        )}
      </Form.Item>
    ) : (
      <div
        className="editable-cell-value-wrap"
        style={{ paddingRight: 24, minHeight: 20, position: 'relative' }}
        onContextMenu={handleContextMenu}
      >
        {children}
      </div>
    );
  } else if (cellContextMenuContext) {
    // 非编辑模式（只读查询结果）也绑定右键菜单，支持复制为 INSERT/JSON/CSV 等操作
    childNode = (
      <div onContextMenu={handleContextMenu} style={{ minHeight: 20 }}>
        {children}
      </div>
    );
  }

  const handleDoubleClick = () => {
      if (!editable) return;
      // 已在编辑态时再次双击不应退出编辑；双击应支持在 Input 内进行全选。
      if (editing) return;
      const raw = record?.[dataIndex];
      if (focusCell && shouldOpenModalEditor(raw)) {
          focusCell(record, dataIndex, title);
          return;
      }
      toggleEdit();
  };

  return (
      <Component
          {...restProps}
          data-row-key={record ? String(record?.[GONAVI_ROW_KEY]) : undefined}
          data-col-name={dataIndex || undefined}
          onDoubleClick={editable ? handleDoubleClick : restProps?.onDoubleClick}
      >
          {childNode}
      </Component>
  );
});

const ContextMenuRow = React.memo(({ children, record, ...props }: any) => {
    const context = useContext(DataContext);
    
    if (!record || !context) return <tr {...props}>{children}</tr>;

    const { selectedRowKeysRef, displayDataRef, handleCopyInsert, handleCopyJson, handleCopyCsv, handleExportSelected, copyToClipboard, enableRowContextMenu, supportsCopyInsert } = context;

    if (!enableRowContextMenu) {
        return <tr {...props}>{children}</tr>;
    }

    const getTargets = () => {
        const keys = selectedRowKeysRef.current;
        const recordKey = record?.[GONAVI_ROW_KEY];
        if (recordKey !== undefined && keys.includes(recordKey)) {
            return displayDataRef.current.filter(d => keys.includes(d?.[GONAVI_ROW_KEY]));
        }
        return [record];
    };

    const menuItems: MenuProps['items'] = [
        ...(supportsCopyInsert ? [{
            key: 'insert',
            label: '复制为 INSERT',
            icon: <ConsoleSqlOutlined />,
            onClick: () => handleCopyInsert(record),
        }] : []),
        { key: 'json', label: '复制为 JSON', icon: <FileTextOutlined />, onClick: () => handleCopyJson(record) },
        { key: 'csv', label: '复制为 CSV', icon: <FileTextOutlined />, onClick: () => handleCopyCsv(record) },
        { key: 'copy', label: '复制为 Markdown', icon: <CopyOutlined />, onClick: () => { 
            const records = getTargets();
            const orderedCols = displayDataRef.current.length > 0
                ? Object.keys(displayDataRef.current[0]).filter(c => c !== GONAVI_ROW_KEY)
                : [];
            const header = `| ${orderedCols.join(' | ')} |`;
            const separator = `| ${orderedCols.map(() => '---').join(' | ')} |`;
            const rows = records.map((r: any) => {
                const values = orderedCols.map(c => {
                    const v = r[c];
                    if (v === null || v === undefined) return 'NULL';
                    return String(v).replace(/\|/g, '\\|').replace(/\n/g, ' ');
                });
                return `| ${values.join(' | ')} |`;
            });
            copyToClipboard([header, separator, ...rows].join('\n'));
        } },
        { type: 'divider' },
        {
            key: 'export-selected',
            label: '导出选中数据',
            icon: <ExportOutlined />,
            children: [
                { key: 'exp-csv', label: 'CSV', onClick: () => handleExportSelected('csv', record).catch(console.error) },
                { key: 'exp-xlsx', label: 'Excel', onClick: () => handleExportSelected('xlsx', record).catch(console.error) },
                { key: 'exp-json', label: 'JSON', onClick: () => handleExportSelected('json', record).catch(console.error) },
                { key: 'exp-md', label: 'Markdown', onClick: () => handleExportSelected('md', record).catch(console.error) },
                { key: 'exp-html', label: 'HTML', onClick: () => handleExportSelected('html', record).catch(console.error) },
            ]
        }
    ];

    return (
        <Dropdown menu={{ items: menuItems }} trigger={['contextMenu']} getPopupContainer={() => document.body} autoAdjustOverflow>
            <tr {...props}>{children}</tr>
        </Dropdown>
    );
});

interface DataGridProps {
    data: any[];
    columnNames: string[];
    loading: boolean;
    tableName?: string;
    exportScope?: 'table' | 'queryResult';
    resultSql?: string;
    dbName?: string;
    connectionId?: string;
    pkColumns?: string[];
    readOnly?: boolean;
    onReload?: () => void;
    onSort?: (field: string, order: string) => void;
    onPageChange?: (page: number, size: number) => void;
    pagination?: {
        current: number,
        pageSize: number,
        total: number,
        totalKnown?: boolean,
        totalApprox?: boolean,
        approximateTotal?: number,
        totalCountLoading?: boolean,
        totalCountCancelled?: boolean,
    };
    onRequestTotalCount?: () => void;
    onCancelTotalCount?: () => void;
    sortInfoExternal?: Array<{ columnKey: string, order: string, enabled?: boolean }>;
    // Filtering
    showFilter?: boolean;
    onToggleFilter?: () => void;
    exportSqlWithFilter?: string;
    onApplyFilter?: (conditions: GridFilterCondition[]) => void;
    appliedFilterConditions?: FilterCondition[];
    scrollSnapshot?: { top: number; left: number };
    onScrollSnapshotChange?: (snapshot: { top: number; left: number }) => void;
}

type GridFilterCondition = FilterCondition & {
    id: number;
    column: string;
    op: string;
    value: string;
    value2?: string;
};

type GridViewMode = 'table' | 'json' | 'text';

type ColumnMeta = {
    type: string;
    comment: string;
};

// P2 性能优化：提取内联 style 对象为模块级常量，避免每次 render 创建新对象
const CELL_ELLIPSIS_STYLE: React.CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' };
const VIRTUAL_CELL_WRAPPER_STYLE: React.CSSProperties = { margin: -8, padding: '8px 8px 8px 8px' };

const DataGrid: React.FC<DataGridProps> = ({
    data, columnNames, loading, tableName, exportScope = 'table', resultSql, dbName, connectionId, pkColumns = [], readOnly = false,
    onReload, onSort, onPageChange, pagination, onRequestTotalCount, onCancelTotalCount, sortInfoExternal, showFilter, onToggleFilter, exportSqlWithFilter, onApplyFilter, appliedFilterConditions,
    scrollSnapshot, onScrollSnapshotChange
}) => {
  const connections = useStore(state => state.connections);
  const addSqlLog = useStore(state => state.addSqlLog);
  const theme = useStore(state => state.theme);
  const appearance = useStore(state => state.appearance);
  const queryOptions = useStore(state => state.queryOptions);
  const setQueryOptions = useStore(state => state.setQueryOptions);
  const tableColumnOrders = useStore(state => state.tableColumnOrders);
  const enableColumnOrderMemory = useStore(state => state.enableColumnOrderMemory);
  const setTableColumnOrder = useStore(state => state.setTableColumnOrder);
  const setEnableColumnOrderMemory = useStore(state => state.setEnableColumnOrderMemory);
  const clearTableColumnOrder = useStore(state => state.clearTableColumnOrder);
  
  const tableHiddenColumns = useStore(state => state.tableHiddenColumns);
  const enableHiddenColumnMemory = useStore(state => state.enableHiddenColumnMemory);
  const setTableHiddenColumns = useStore(state => state.setTableHiddenColumns);
  const setEnableHiddenColumnMemory = useStore(state => state.setEnableHiddenColumnMemory);
  const clearTableHiddenColumns = useStore(state => state.clearTableHiddenColumns);
  
  const isMacLike = useMemo(() => isMacLikePlatform(), []);
  const darkMode = theme === 'dark';
  const resolvedAppearance = resolveAppearanceValues(appearance);
  const opacity = normalizeOpacityForPlatform(resolvedAppearance.opacity);
  const canModifyData = !readOnly && !!tableName;
  const showColumnComment = queryOptions?.showColumnComment ?? true;
  const showColumnType = queryOptions?.showColumnType ?? true;

  // --- Display Columns Order & Visibility Management ---
  const [allOrderedColumnNames, setAllOrderedColumnNames] = useState<string[]>([]);
  const [displayColumnNames, setDisplayColumnNames] = useState<string[]>([]);
  const [localHiddenColumns, setLocalHiddenColumns] = useState<string[]>([]);
  const [columnSearchText, setColumnSearchText] = useState('');

  // Sync hidden columns from store
  useEffect(() => {
      if (enableHiddenColumnMemory && connectionId && dbName && tableName) {
          const storedHidden = tableHiddenColumns[`${connectionId}-${dbName}-${tableName}`];
          setLocalHiddenColumns(Array.isArray(storedHidden) ? storedHidden : []);
      } else {
          setLocalHiddenColumns([]);
      }
  }, [tableHiddenColumns, enableHiddenColumnMemory, connectionId, dbName, tableName]);

  const toggleColumnVisibility = useCallback((col: string, visible: boolean) => {
      setLocalHiddenColumns(prev => {
          const nextSet = new Set(prev);
          if (visible) nextSet.delete(col);
          else nextSet.add(col);
          const nextArray = Array.from(nextSet);
          if (enableHiddenColumnMemory && connectionId && dbName && tableName) {
              setTableHiddenColumns(connectionId, dbName, tableName, nextArray);
          }
          return nextArray;
      });
  }, [enableHiddenColumnMemory, connectionId, dbName, tableName, setTableHiddenColumns]);

  const toggleAllColumnsVisibility = useCallback((visible: boolean) => {
      setLocalHiddenColumns(() => {
          const nextArray = visible ? [] : [...allOrderedColumnNames];
          if (enableHiddenColumnMemory && connectionId && dbName && tableName) {
              setTableHiddenColumns(connectionId, dbName, tableName, nextArray);
          }
          return nextArray;
      });
  }, [allOrderedColumnNames, enableHiddenColumnMemory, connectionId, dbName, tableName, setTableHiddenColumns]);

  // Sync display order from incoming prop and store memory
  useEffect(() => {
    let nextOrder = [...columnNames];
    if (enableColumnOrderMemory && connectionId && dbName && tableName) {
      const storedOrder = tableColumnOrders[`${connectionId}-${dbName}-${tableName}`];
      if (Array.isArray(storedOrder) && storedOrder.length > 0) {
        // Only layout known columns. Filter out missing or new columns.
        const storedSet = new Set(storedOrder);
        const incomingSet = new Set(nextOrder);
        const validStored = storedOrder.filter(col => incomingSet.has(col));
        const missingNew = nextOrder.filter(col => !storedSet.has(col));
        nextOrder = [...validStored, ...missingNew];
      }
    }
    setAllOrderedColumnNames(nextOrder);
  }, [columnNames, tableColumnOrders, enableColumnOrderMemory, connectionId, dbName, tableName]);

  // Compute final display columns
  useEffect(() => {
      const hiddenSet = new Set(localHiddenColumns);
      setDisplayColumnNames(allOrderedColumnNames.filter(col => !hiddenSet.has(col)));
  }, [allOrderedColumnNames, localHiddenColumns]);

  // Handle Dragging
  const sensors = useSensors(
      useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
      useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
      useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    // 防御性检查：若正在调整列宽，忽略拖拽排序事件
    if (isResizingRef.current) return;
    const { active, over } = event;
    if (active.id !== over?.id && over) {
      setAllOrderedColumnNames((prevAllOrder) => {
          // Calculate the new order of all columns by applying the movement
          // We only move the visible columns relative to each other, but the easiest way 
          // is to map the visible column movement back to the full array.
          const hiddenSet = new Set(localHiddenColumns);
          const visibleOrder = prevAllOrder.filter(col => !hiddenSet.has(col));
          
          const oldVisibleIndex = visibleOrder.indexOf(active.id as string);
          const newVisibleIndex = visibleOrder.indexOf(over.id as string);
          
          if (oldVisibleIndex === -1 || newVisibleIndex === -1) return prevAllOrder;
          
          const nextVisibleOrder = arrayMove(visibleOrder, oldVisibleIndex, newVisibleIndex);
          
          // Reconstruct allOrderedColumnNames by inserting hidden columns back to their original relative positions
          // Or simpler: just keep hidden columns at the end, but that ruins user's layout.
          // Better approach: build a new array
          let vIndex = 0;
          const nextOrder = prevAllOrder.map(col => {
              if (hiddenSet.has(col)) {
                  return col; // Hidden columns stay at their absolute index in the master list
              } else {
                  return nextVisibleOrder[vIndex++];
              }
          });

          if (enableColumnOrderMemory && connectionId && dbName && tableName) {
              setTableColumnOrder(connectionId, dbName, tableName, nextOrder);
          }
          return nextOrder;
      });
    }
  };

  const selectionColumnWidth = 46;
  const currentConnConfig = connections.find(c => c.id === connectionId)?.config;
  const dataSourceCaps = getDataSourceCapabilities(currentConnConfig);
  const prefersManualTotalCount = dataSourceCaps.preferManualTotalCount;
  const supportsApproximateTableCount = dataSourceCaps.supportsApproximateTableCount;
  const supportsApproximateTotalPages = dataSourceCaps.supportsApproximateTotalPages;
  const supportsCopyInsert = dataSourceCaps.supportsCopyInsert;
  const supportsSqlQueryExport = dataSourceCaps.supportsSqlQueryExport;
  const isQueryResultExport = exportScope === 'queryResult';
  const canImport = exportScope === 'table' && !!tableName;
  const canExport = !!connectionId && (isQueryResultExport || !!tableName);
  const filteredExportSql = useMemo(() => String(exportSqlWithFilter || '').trim(), [exportSqlWithFilter]);
  const hasFilteredExportSql = exportScope === 'table' && filteredExportSql.length > 0;

  // --- 主题样式变量（仅在 darkMode / opacity / blur 变化时重算） ---
  const themeStyles = useMemo(() => {
      const _getBg = (darkHex: string) => {
          if (!darkMode) return `rgba(255, 255, 255, ${opacity})`;
          const hex = darkHex.replace('#', '');
          const r = parseInt(hex.substring(0, 2), 16);
          const g = parseInt(hex.substring(2, 4), 16);
          const b = parseInt(hex.substring(4, 6), 16);
          return `rgba(${r}, ${g}, ${b}, ${opacity})`;
      };
      const _rowBg = (r: number, g: number, b: number) => `rgba(${r}, ${g}, ${b}, ${opacity})`;
      const _glassMode = opacity < 0.999 || resolvedAppearance.blur > 0;

      return {
          bgContent: _getBg('#1d1d1d'),
          bgFilter: _getBg('#262626'),
          bgContextMenu: darkMode ? '#1f1f1f' : '#ffffff',
          rowAddedBg: darkMode ? _rowBg(22, 43, 22) : _rowBg(246, 255, 237),
          rowModBg: darkMode ? _rowBg(22, 34, 56) : _rowBg(230, 247, 255),
          rowAddedHover: darkMode ? _rowBg(31, 61, 31) : _rowBg(217, 247, 190),
          rowModHover: darkMode ? _rowBg(29, 53, 94) : _rowBg(186, 231, 255),
          selectionAccentHex: darkMode ? '#f6c453' : '#1890ff',
          selectionAccentRgb: darkMode ? '246, 196, 83' : '24, 144, 255',
          columnMetaHintColor: darkMode ? 'rgba(255, 236, 179, 0.98)' : '#595959',
          columnMetaTooltipColor: darkMode ? 'rgba(255, 236, 179, 0.98)' : '#262626',
          panelFrameColor: darkMode ? 'rgba(0, 0, 0, 0.42)' : 'rgba(0, 0, 0, 0.18)',
          floatingScrollbarThumbBg: darkMode ? 'rgba(255,255,255,0.68)' : 'rgba(0,0,0,0.44)',
          floatingScrollbarThumbBorderColor: darkMode ? 'rgba(255,255,255,0.26)' : 'rgba(255,255,255,0.52)',
          floatingScrollbarThumbShadow: darkMode ? '0 4px 14px rgba(0,0,0,0.42)' : '0 4px 10px rgba(0,0,0,0.20)',
          verticalScrollbarTrackBg: darkMode ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          horizontalScrollbarThumbBg: darkMode ? 'rgba(255,255,255,0.20)' : 'rgba(0,0,0,0.14)',
          toolbarDividerColor: darkMode ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.10)',
          paginationShellBg: darkMode
              ? `linear-gradient(135deg, rgba(17,22,34,${_glassMode ? Math.max(0.22, opacity * 0.38) : 0.82}) 0%, rgba(10,14,24,${_glassMode ? Math.max(0.28, opacity * 0.46) : 0.9}) 100%)`
              : `linear-gradient(135deg, rgba(255,255,255,${_glassMode ? Math.max(0.24, opacity * 0.36) : 0.96}) 0%, rgba(246,248,252,${_glassMode ? Math.max(0.32, opacity * 0.44) : 0.99}) 100%)`,
          paginationShellBorderColor: darkMode
              ? `rgba(255,255,255,${_glassMode ? 0.10 : 0.08})`
              : `rgba(16,24,40,${_glassMode ? 0.08 : 0.08})`,
          paginationShellShadow: darkMode
              ? `0 16px 34px rgba(0,0,0,${_glassMode ? 0.10 : 0.22})`
              : `0 14px 30px rgba(15,23,42,${_glassMode ? 0.03 : 0.08})`,
          paginationChipBg: darkMode
              ? `rgba(255,255,255,${_glassMode ? Math.max(0.02, opacity * 0.035) : 0.04})`
              : `rgba(255,255,255,${_glassMode ? Math.max(0.18, opacity * 0.26) : 0.86})`,
          paginationChipBorderColor: darkMode
              ? `rgba(255,255,255,${_glassMode ? 0.10 : 0.08})`
              : `rgba(16,24,40,${_glassMode ? 0.10 : 0.08})`,
          paginationHoverBg: darkMode
              ? `rgba(255,255,255,${_glassMode ? Math.max(0.04, opacity * 0.06) : 0.07})`
              : `rgba(255,255,255,${_glassMode ? Math.max(0.24, opacity * 0.34) : 0.96})`,
          paginationPrimaryTextColor: darkMode ? '#f5f7ff' : '#162033',
          paginationSecondaryTextColor: darkMode ? 'rgba(255,255,255,0.54)' : 'rgba(16,24,40,0.56)',
          paginationAccentBg: darkMode ? 'rgba(255,214,102,0.14)' : 'rgba(24,144,255,0.10)',
          paginationAccentBorderColor: darkMode ? 'rgba(255,214,102,0.38)' : 'rgba(24,144,255,0.22)',
          paginationActiveItemBg: darkMode ? 'rgba(255,214,102,0.18)' : 'rgba(24,144,255,0.12)',
          paginationActiveItemBorderColor: darkMode ? 'rgba(255,214,102,0.46)' : 'rgba(24,144,255,0.28)',
          paginationActiveItemTextColor: darkMode ? '#fff7d6' : '#0958d9',
      };
  }, [darkMode, opacity, resolvedAppearance.blur]);

  // 解构常用变量以保持后续代码引用不变
  const {
      bgContent, bgFilter, bgContextMenu,
      rowAddedBg, rowModBg, rowAddedHover, rowModHover,
      selectionAccentHex, selectionAccentRgb,
      columnMetaHintColor, columnMetaTooltipColor,
      panelFrameColor,
      floatingScrollbarThumbBg, floatingScrollbarThumbBorderColor, floatingScrollbarThumbShadow,
      verticalScrollbarTrackBg, horizontalScrollbarThumbBg,
      toolbarDividerColor,
      paginationShellBg, paginationShellBorderColor, paginationShellShadow,
      paginationChipBg, paginationChipBorderColor, paginationHoverBg,
      paginationPrimaryTextColor, paginationSecondaryTextColor,
      paginationAccentBg, paginationAccentBorderColor,
      paginationActiveItemBg, paginationActiveItemBorderColor, paginationActiveItemTextColor,
  } = themeStyles;

  // 布局常量（纯数字/字符串，无需 memoize）
  const panelRadius = 10;
  const panelOuterGap = 6;
  const panelPaddingY = 10;
  const panelPaddingX = 12;
  const toolbarBottomPadding = 6;
  const filterTopPadding = 2;
  const floatingScrollbarGap = 8;
  const floatingScrollbarBottomOffset = 0;
  const floatingScrollbarInset = 10;
  const floatingScrollbarHeight = 10;
  const horizontalScrollbarTrackBg = 'transparent';
  const horizontalScrollbarTrackBorderColor = 'transparent';
  const horizontalScrollbarTrackShadow = 'none';
  const horizontalScrollbarThumbBorderColor = 'transparent';
  const horizontalScrollbarThumbShadow = 'none';
  const externalScrollbarMinWidth = 1;
  const paginationPageSizeOptions = ['100', '200', '500', '1000'];
  
  const [form] = Form.useForm();
  const [modal, contextHolder] = Modal.useModal();
  const gridId = useMemo(() => `grid-${generateUuid()}`, []);
  const [viewMode, setViewMode] = useState<GridViewMode>('table');
  const [textRecordIndex, setTextRecordIndex] = useState(0);
  const [cellEditorOpen, setCellEditorOpen] = useState(false);
  const [cellEditorValue, setCellEditorValue] = useState('');
  const [cellEditorIsJson, setCellEditorIsJson] = useState(false);
  const [cellEditorMeta, setCellEditorMeta] = useState<{ record: Item; dataIndex: string; title: string } | null>(null);
  const cellEditorApplyRef = useRef<((val: string) => void) | null>(null);
  const [jsonEditorOpen, setJsonEditorOpen] = useState(false);
  const [jsonEditorValue, setJsonEditorValue] = useState('');

  // --- Data Preview Panel State ---
  const [dataPanelOpen, setDataPanelOpen] = useState(false);
  const dataPanelOpenRef = useRef(false);
  const [focusedCellInfo, setFocusedCellInfo] = useState<{ record: Item; dataIndex: string; title: string } | null>(null);
  const [dataPanelValue, setDataPanelValue] = useState('');
  const [dataPanelIsJson, setDataPanelIsJson] = useState(false);
  const dataPanelDirtyRef = useRef(false);
  const [rowEditorOpen, setRowEditorOpen] = useState(false);
  const [rowEditorRowKey, setRowEditorRowKey] = useState<string>('');
  const rowEditorBaseRawRef = useRef<Record<string, any>>({});
  const rowEditorDisplayRef = useRef<Record<string, string>>({});
  const rowEditorNullColsRef = useRef<Set<string>>(new Set());
  const [rowEditorForm] = Form.useForm();

  // Cell Context Menu State
  const [cellContextMenu, setCellContextMenu] = useState<{
    visible: boolean;
    x: number;
    y: number;
    record: Item | null;
    dataIndex: string;
    title: string;
  }>({
    visible: false,
    x: 0,
    y: 0,
    record: null,
    dataIndex: '',
    title: '',
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const tableContainerRef = useRef<HTMLDivElement | null>(null);
  const tableScrollTargetsRef = useRef<HTMLElement[]>([]);
  const externalHorizontalScrollRef = useRef<HTMLDivElement | null>(null);
  const horizontalSyncSourceRef = useRef<'table' | 'external' | ''>('');
  const lastTableScrollLeftRef = useRef(0);
  const lastExternalScrollLeftRef = useRef(0);
  const pendingScrollToBottomRef = useRef(false);
  const lastReportedScrollRef = useRef<{ top: number; left: number }>({ top: 0, left: 0 });
  const didRestoreScrollRef = useRef(false);

  // 批量编辑模式状态
  const [cellEditMode, setCellEditMode] = useState(false);
  const [selectedCells, setSelectedCells] = useState<Set<string>>(new Set());
  const [copiedCellPatch, setCopiedCellPatch] = useState<{ sourceRowKey: string; values: Record<string, any> } | null>(null);
  const [batchEditModalOpen, setBatchEditModalOpen] = useState(false);
  const [batchEditValue, setBatchEditValue] = useState('');
  const [batchEditSetNull, setBatchEditSetNull] = useState(false);

  // 使用 ref 来优化拖拽性能，完全避免状态更新
  const cellSelectionRafRef = useRef<number | null>(null);
  const cellSelectionScrollRafRef = useRef<number | null>(null);
  const cellSelectionAutoScrollRafRef = useRef<number | null>(null);
  const cellSelectionPointerRef = useRef<{ x: number; y: number } | null>(null);
  const isDraggingRef = useRef(false);

  // 导入预览 Modal 状态
  const [importPreviewVisible, setImportPreviewVisible] = useState(false);
  const [importFilePath, setImportFilePath] = useState('');
  const currentSelectionRef = useRef<Set<string>>(new Set());
  const selectionStartRef = useRef<{ rowKey: string; colName: string; rowIndex: number; colIndex: number } | null>(null);
  const rowIndexMapRef = useRef<Map<string, number>>(new Map());

  const scrollTableBodyToBottom = useCallback(() => {
      const root = containerRef.current;
      if (!root) return;
      const body = root.querySelector('.ant-table-body') as HTMLElement | null;
      if (!body) return;
      body.scrollTop = body.scrollHeight;
  }, []);

  // Close cell context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (cellContextMenu.visible) {
        setCellContextMenu(prev => ({ ...prev, visible: false }));
      }
      // Remove focus from any focused cell when clicking outside the table
      const target = e.target as HTMLElement;
      const tableContainer = containerRef.current;
      if (tableContainer && !tableContainer.contains(target)) {
        // Remove focus from any input elements in the table
        const focusedElement = document.activeElement as HTMLElement;
        if (focusedElement && focusedElement.tagName === 'INPUT' && tableContainer.contains(focusedElement)) {
          focusedElement.blur();
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [cellContextMenu.visible]);

  const showCellContextMenu = useCallback((e: React.MouseEvent, record: Item, dataIndex: string, title: React.ReactNode) => {
    e.preventDefault();
    e.stopPropagation();
    const titleText = typeof (title as any) === 'string' ? (title as string) : (typeof (title as any) === 'number' ? String(title) : String(dataIndex));
    // 预估菜单尺寸（菜单项数 × 行高 + 分隔线 + padding）
    const estimatedMenuHeight = 320;
    const estimatedMenuWidth = 200;
    const viewportH = window.innerHeight;
    const viewportW = window.innerWidth;
    let menuY = e.clientY;
    let menuX = e.clientX;
    // 底部空间不足时向上偏移
    if (menuY + estimatedMenuHeight > viewportH) {
      menuY = Math.max(4, viewportH - estimatedMenuHeight);
    }
    // 右侧空间不足时向左偏移
    if (menuX + estimatedMenuWidth > viewportW) {
      menuX = Math.max(4, viewportW - estimatedMenuWidth);
    }
    setCellContextMenu({
      visible: true,
      x: menuX,
      y: menuY,
      record,
      dataIndex,
      title: titleText,
    });
  }, []);

  // Helper to export specific data
  const exportData = async (rows: any[], format: string) => {
      const hide = message.loading(`正在导出 ${rows.length} 条数据...`, 0);
      try {
          const cleanRows = rows.map(({ [GONAVI_ROW_KEY]: _rowKey, ...rest }) => rest);
          // Pass tableName (or 'export') as default filename
          const res = await ExportData(cleanRows, displayColumnNames, tableName || 'export', format);
          if (res.success) {
              void message.success("导出成功");
          } else if (res.message !== "已取消") {
              void message.error("导出失败: " + res.message);
          }
      } catch (e: any) {
          void message.error("导出失败: " + (e?.message || String(e)));
      } finally {
          hide();
      }
  };
  
  const [sortInfo, setSortInfo] = useState<Array<{ columnKey: string, order: string, enabled?: boolean }>>([]);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [columnMetaMap, setColumnMetaMap] = useState<Record<string, ColumnMeta>>({});
  const columnMetaCacheRef = useRef<Record<string, Record<string, ColumnMeta>>>({});
  const columnMetaSeqRef = useRef(0);

  useEffect(() => {
      const ext = sortInfoExternal || [];
      const extKey = JSON.stringify(ext);
      const curKey = JSON.stringify(sortInfo);
      if (extKey === curKey) return;
      setSortInfo(ext);
  }, [sortInfoExternal, sortInfo]);

  useEffect(() => {
      const normalizedTableName = String(tableName || '').trim();
      const normalizedDbName = String(dbName || '').trim();
      if (!connectionId || !normalizedTableName) {
          setColumnMetaMap({});
          return;
      }
      const cacheKey = `${connectionId}|${normalizedDbName}|${normalizedTableName}`;
      setColumnMetaMap(columnMetaCacheRef.current[cacheKey] || {});
  }, [connectionId, dbName, tableName]);

  useEffect(() => {
      const normalizedTableName = String(tableName || '').trim();
      const normalizedDbName = String(dbName || '').trim();
      if (!connectionId || !normalizedTableName) return;

      const cacheKey = `${connectionId}|${normalizedDbName}|${normalizedTableName}`;
      if (columnMetaCacheRef.current[cacheKey]) return;

      const conn = connections.find(c => c.id === connectionId);
      if (!conn) {
          setColumnMetaMap({});
          return;
      }

      const config = {
          ...conn.config,
          port: Number(conn.config.port),
          password: conn.config.password || "",
          database: conn.config.database || "",
          useSSH: conn.config.useSSH || false,
          ssh: conn.config.ssh || { host: "", port: 22, user: "", password: "", keyPath: "" }
      };

      const seq = ++columnMetaSeqRef.current;
      DBGetColumns(config as any, normalizedDbName, normalizedTableName)
          .then((res) => {
              if (seq !== columnMetaSeqRef.current) return;
              if (!res.success || !Array.isArray(res.data)) {
                  setColumnMetaMap({});
                  return;
              }
              const nextMap: Record<string, ColumnMeta> = {};
              (res.data as ColumnDefinition[]).forEach((column: any) => {
                  const name = String(column?.name ?? column?.Name ?? '').trim();
                  if (!name) return;
                  const type = String(column?.type ?? column?.Type ?? '').trim();
                  const comment = String(column?.comment ?? column?.Comment ?? '').trim();
                  nextMap[name] = { type, comment };
              });
              columnMetaCacheRef.current[cacheKey] = nextMap;
              setColumnMetaMap(nextMap);
          })
          .catch(() => {
              if (seq !== columnMetaSeqRef.current) return;
              setColumnMetaMap({});
          });
  }, [connections, connectionId, dbName, tableName]);

  const columnMetaMapByLowerName = useMemo(() => {
      const next: Record<string, ColumnMeta> = {};
      Object.entries(columnMetaMap).forEach(([name, meta]) => {
          const lowerName = String(name || '').toLowerCase();
          if (!lowerName || next[lowerName]) return;
          next[lowerName] = meta;
      });
      return next;
  }, [columnMetaMap]);

  const normalizeCommitCellValue = useCallback(
      (columnName: string, value: any, mode: 'insert' | 'update') => {
          if (value === undefined) return undefined;
          const normalizedName = String(columnName || '').trim();
          const meta = columnMetaMap[normalizedName] || columnMetaMapByLowerName[normalizedName.toLowerCase()];
          const temporal = isTemporalColumnType(meta?.type);

          if (!temporal) {
              return value;
          }

          if (value === null) {
              return null;
          }

          if (typeof value === 'string') {
              const raw = value.trim();
              if (raw === '') {
                  // INSERT 空时间值直接忽略字段，让数据库默认值生效；UPDATE 空时间值转 NULL。
                  return mode === 'insert' ? undefined : null;
              }
              return normalizeDateTimeString(value);
          }

          return value;
      },
      [columnMetaMap, columnMetaMapByLowerName]
  );

  const renderColumnTitle = useCallback((name: string): React.ReactNode => {
      const normalizedName = String(name || '');
      const meta = columnMetaMap[normalizedName] || columnMetaMapByLowerName[normalizedName.toLowerCase()];
      const hoverLines: string[] = [];
      if (meta?.type) hoverLines.push(`类型：${meta.type}`);
      if (meta?.comment) hoverLines.push(`备注：${meta.comment}`);

      const titleNode = (
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, lineHeight: 1.2 }}>
              <span style={{ whiteSpace: 'nowrap' }}>{normalizedName}</span>
              {showColumnType && meta?.type && (
                  <span
                      style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: columnMetaHintColor,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                      }}
                  >
                      {meta.type}
                  </span>
              )}
              {showColumnComment && meta?.comment && (
                  <span
                      style={{
                          marginTop: 2,
                          fontSize: 11,
                          color: columnMetaHintColor,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '100%',
                      }}
                  >
                      {meta.comment}
                  </span>
              )}
          </div>
      );

      if (hoverLines.length === 0) return titleNode;
      return (
          <Tooltip
              title={<pre style={{ maxHeight: 260, overflow: 'auto', margin: 0, fontSize: 12, whiteSpace: 'pre-wrap', color: darkMode ? columnMetaTooltipColor : '#fff' }}>{hoverLines.join('\n')}</pre>}
              styles={{ root: { maxWidth: 640 } }}
              {...(!darkMode ? { color: 'rgba(0, 0, 0, 0.82)' } : {})}
          >
              <span style={{ display: 'inline-flex', maxWidth: '100%' }}>{titleNode}</span>
          </Tooltip>
      );
  }, [columnMetaHintColor, columnMetaTooltipColor, columnMetaMap, columnMetaMapByLowerName, showColumnComment, showColumnType]);

  const closeCellEditor = useCallback(() => {
      setCellEditorOpen(false);
      setCellEditorMeta(null);
      setCellEditorValue('');
      setCellEditorIsJson(false);
      cellEditorApplyRef.current = null;
  }, []);

  // --- Data Preview Panel Helpers ---
  const updateFocusedCell = useCallback((record: Item, dataIndex: string) => {
      if (!record || !dataIndex) return;
      const raw = record?.[dataIndex];
      const text = toEditableText(raw);
      const isJson = looksLikeJsonText(text);
      setFocusedCellInfo({ record, dataIndex, title: dataIndex });
      // 仅在面板未被用户手动编辑时自动同步值
      if (!dataPanelDirtyRef.current) {
          setDataPanelValue(text);
          setDataPanelIsJson(isJson);
      }
  }, []);

  const handleDataPanelFormatJson = useCallback(() => {
      if (!dataPanelIsJson) return;
      try {
          const obj = JSON.parse(dataPanelValue);
          setDataPanelValue(JSON.stringify(obj, null, 2));
          dataPanelDirtyRef.current = true;
      } catch (e: any) {
          void message.error('JSON 格式无效：' + (e?.message || String(e)));
      }
  }, [dataPanelIsJson, dataPanelValue]);

  // 同步 ref 用于 onCell 闭包
  useEffect(() => { dataPanelOpenRef.current = dataPanelOpen; }, [dataPanelOpen]);

  const openCellEditor = useCallback((record: Item, dataIndex: string, title: React.ReactNode, onApplyValue?: (val: string) => void) => {
      if (!record || !dataIndex) return;
      const raw = record?.[dataIndex];
      const text = toEditableText(raw);
      const isJson = looksLikeJsonText(text);
      const titleText = typeof (title as any) === 'string' ? (title as string) : (typeof (title as any) === 'number' ? String(title) : String(dataIndex));

      setCellEditorMeta({ record, dataIndex, title: titleText });
      setCellEditorValue(text);
      setCellEditorIsJson(isJson);
      setCellEditorOpen(true);
      cellEditorApplyRef.current = typeof onApplyValue === 'function' ? onApplyValue : null;
  }, []);

  // Dynamic Height
  const [tableHeight, setTableHeight] = useState(500);
  const [tableViewportWidth, setTableViewportWidth] = useState(0);
  const [tableBodyBottomPadding, setTableBodyBottomPadding] = useState(0);

  // P0 性能优化：CSS 模板字符串 memoize，仅在主题/布局变量变化时重算
  const gridCssText = useMemo(() => `
                .${gridId} .data-grid-toolbar-scroll > * {
                    flex-shrink: 0;
                }
                .${gridId} .data-grid-toolbar-scroll::-webkit-scrollbar {
                    height: 7px;
                }
                .${gridId} .data-grid-toolbar-scroll::-webkit-scrollbar-thumb {
                    background: ${darkMode ? 'rgba(255,255,255,0.28)' : 'rgba(0,0,0,0.22)'};
                    border-radius: 999px;
                }
                .${gridId} .data-grid-toolbar-scroll::-webkit-scrollbar-track {
                    background: transparent;
                }
                .${gridId} .ant-table,
                .${gridId} .ant-table-wrapper,
                .${gridId} .ant-table-container {
                    background: transparent !important;
                    border-radius: ${panelRadius}px !important;
                }
                .${gridId} .ant-table-wrapper,
                .${gridId} .ant-table-container {
                    border: none !important;
                    overflow: hidden !important;
                }
                .${gridId} .ant-table-tbody > tr > td,
                .${gridId} .ant-table-tbody .ant-table-row > .ant-table-cell { background: transparent !important; border-bottom: 1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} !important; border-inline-end: 1px solid transparent !important; }
                .${gridId} .ant-table-thead > tr > th { background: transparent !important; border-bottom: 1px solid ${darkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} !important; border-inline-end: 1px solid transparent !important; }
                /* 选择列对齐：header TH 无 class（Ant Design 虚拟模式），需用 :first-child 匹配 */
                .${gridId} .ant-table-header th:first-child,
                .${gridId} .ant-table-thead > tr > th:first-child {
                    text-align: center !important;
                    padding-inline-start: 0 !important;
                    padding-inline-end: 0 !important;
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                }
                .${gridId} .ant-table-selection-column {
                    text-align: center !important;
                    padding-inline-start: 0 !important;
                    padding-inline-end: 0 !important;
                }
                /* 窄表场景下 rc-table 会按视口等比放大选择列宽度，不能再额外锁死 header 宽度；
                   这里只统一 header/body 的内边距与对齐方式，避免第一列把后续数据列整体顶偏。 */
                .${gridId} .ant-table-tbody > tr > td.ant-table-selection-column,
                .${gridId} .ant-table-tbody .ant-table-row > .ant-table-cell.ant-table-selection-column,
                .${gridId} .ant-table-tbody-virtual-holder .ant-table-row > .ant-table-cell.ant-table-selection-column {
                    text-align: center !important;
                    padding-inline-start: 0 !important;
                    padding-inline-end: 0 !important;
                    padding-left: 0 !important;
                    padding-right: 0 !important;
                }
                .${gridId} .ant-table-thead > tr:first-child > th:first-child,
                .${gridId} .ant-table-header table > thead > tr:first-child > th:first-child {
                    border-top-left-radius: ${panelRadius}px !important;
                }
                .${gridId} .ant-table-thead > tr:first-child > th:last-child,
                .${gridId} .ant-table-header table > thead > tr:first-child > th:last-child {
                    border-top-right-radius: ${panelRadius}px !important;
                }
                .${gridId} .ant-table-body {
                    border-bottom-left-radius: ${panelRadius}px !important;
                    border-bottom-right-radius: ${panelRadius}px !important;
                }
                .${gridId} .ant-table-thead > tr > th::before { display: none !important; }
                .${gridId} .ant-table-thead > tr > th .ant-table-column-sorters { cursor: default !important; }
                .${gridId} .ant-table-thead > tr > th .ant-table-column-sorter,
                .${gridId} .ant-table-thead > tr > th .ant-table-column-sorter * { cursor: pointer !important; }
                .${gridId} .ant-table-tbody > tr:hover > td,
                .${gridId} .ant-table-tbody .ant-table-row:hover > .ant-table-cell { background-color: ${darkMode ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.02)'} !important; }
                .${gridId} .ant-table-tbody > tr.ant-table-row-selected > td,
                .${gridId} .ant-table-tbody .ant-table-row.ant-table-row-selected > .ant-table-cell { background-color: ${darkMode ? `rgba(${selectionAccentRgb}, 0.18)` : `rgba(${selectionAccentRgb}, 0.08)`} !important; }
                .${gridId} .ant-table-tbody > tr.ant-table-row-selected:hover > td,
                .${gridId} .ant-table-tbody .ant-table-row.ant-table-row-selected:hover > .ant-table-cell { background-color: ${darkMode ? `rgba(${selectionAccentRgb}, 0.28)` : `rgba(${selectionAccentRgb}, 0.12)`} !important; }
                .${gridId} .row-added td,
                .${gridId} .row-added > .ant-table-cell { background-color: ${rowAddedBg} !important; color: ${darkMode ? '#e6fffb' : 'inherit'}; }
                .${gridId} .row-modified td,
                .${gridId} .row-modified > .ant-table-cell { background-color: ${rowModBg} !important; color: ${darkMode ? '#e6f7ff' : 'inherit'}; }
                .${gridId} .ant-table-tbody > tr.row-added:hover > td,
                .${gridId} .ant-table-tbody .ant-table-row.row-added:hover > .ant-table-cell { background-color: ${rowAddedHover} !important; }
                .${gridId} .ant-table-tbody > tr.row-modified:hover > td,
                .${gridId} .ant-table-tbody .ant-table-row.row-modified:hover > .ant-table-cell { background-color: ${rowModHover} !important; }
                .${gridId} .ant-table-tbody > tr > td[data-col-name],
                .${gridId} .ant-table-tbody .ant-table-row > .ant-table-cell[data-col-name] { user-select: none; -webkit-user-select: none; cursor: crosshair; }
                .${gridId} .ant-table-tbody > tr > td[data-cell-selected="true"],
                .${gridId} .ant-table-tbody .ant-table-row > .ant-table-cell[data-cell-selected="true"],
                .${gridId} [data-cell-selected="true"] {
                    box-shadow: inset 0 0 0 2px ${selectionAccentHex} !important;
                    background-image: linear-gradient(${darkMode ? `rgba(${selectionAccentRgb}, 0.20)` : `rgba(${selectionAccentRgb}, 0.08)`}, ${darkMode ? `rgba(${selectionAccentRgb}, 0.20)` : `rgba(${selectionAccentRgb}, 0.08)`}) !important;
                }
                .${gridId} .ant-table-content,
                .${gridId} .ant-table-body {
                    scrollbar-gutter: stable;
                }
                .${gridId} .ant-table-body {
                    padding-bottom: ${tableBodyBottomPadding}px;
                    box-sizing: border-box;
                    scroll-padding-bottom: ${tableBodyBottomPadding}px;
                }
                .${gridId} .ant-table-tbody-virtual-holder,
                .${gridId} .rc-virtual-list-holder {
                    padding-bottom: ${tableBodyBottomPadding}px;
                    box-sizing: border-box;
                    scroll-padding-bottom: ${tableBodyBottomPadding}px;
                }
                .${gridId} .ant-table-tbody-virtual-holder-inner {
                    padding-bottom: ${tableBodyBottomPadding}px;
                    box-sizing: border-box;
                }
                .${gridId} .data-grid-table-wrap {
                    width: 100%;
                    max-width: 100%;
                    overflow: hidden;
                }
                .${gridId} .ant-table-sticky-scroll {
                    display: none !important;
                }
                /* 虚拟表列对齐：阻止 header <table> 通过 min-width:100% 拉伸到视口，
                   使 header 列宽与虚拟 body 单元格宽度精确一致 */
                .${gridId} .ant-table-header > table {
                    min-width: 0 !important;
                }
                .${gridId} .ant-table-tbody-virtual-scrollbar.ant-table-tbody-virtual-scrollbar-horizontal {
                    display: none !important;
                }
                .${gridId} .data-grid-table-wrap.data-grid-table-wrap-external-active .ant-table-content {
                    overflow-x: hidden !important;
                }
                .${gridId} .data-grid-table-wrap.data-grid-table-wrap-external-active .ant-table-body {
                    overflow-x: hidden !important;
                    overflow-y: auto !important;
                }
                .${gridId} .data-grid-table-wrap.data-grid-table-wrap-external-active .ant-table-tbody-virtual-holder,
                .${gridId} .data-grid-table-wrap.data-grid-table-wrap-external-active .rc-virtual-list-holder {
                    overflow-x: hidden !important;
                }
                .${gridId} .ant-table-body {
                    scrollbar-width: thin;
                    scrollbar-color: ${floatingScrollbarThumbBg} transparent;
                }
                .${gridId} .ant-table-body::-webkit-scrollbar {
                    width: ${floatingScrollbarHeight}px;
                    height: 0;
                }
                .${gridId} .ant-table-body::-webkit-scrollbar-track {
                    background: ${verticalScrollbarTrackBg};
                    margin: 8px 0;
                    border-radius: 999px;
                }
                .${gridId} .ant-table-body::-webkit-scrollbar-thumb {
                    background: ${floatingScrollbarThumbBg};
                    border: 1px solid ${floatingScrollbarThumbBorderColor};
                    border-radius: 999px;
                    box-shadow: ${floatingScrollbarThumbShadow};
                }
                .${gridId} .rc-virtual-list-holder {
                    scrollbar-width: thin;
                    scrollbar-color: ${floatingScrollbarThumbBg} transparent;
                }
                .${gridId} .rc-virtual-list-holder::-webkit-scrollbar {
                    width: ${floatingScrollbarHeight}px;
                    height: 0;
                }
                .${gridId} .rc-virtual-list-holder::-webkit-scrollbar-track {
                    background: ${verticalScrollbarTrackBg};
                    margin: 8px 0;
                    border-radius: 999px;
                }
                .${gridId} .rc-virtual-list-holder::-webkit-scrollbar-thumb {
                    background: ${floatingScrollbarThumbBg};
                    border: 1px solid ${floatingScrollbarThumbBorderColor};
                    border-radius: 999px;
                    box-shadow: ${floatingScrollbarThumbShadow};
                }
                .${gridId} .data-grid-external-horizontal-scroll {
                    position: absolute;
                    left: ${floatingScrollbarInset}px;
                    right: ${floatingScrollbarInset}px;
                    bottom: ${floatingScrollbarBottomOffset}px;
                    height: ${floatingScrollbarHeight + 4}px;
                    overflow-x: auto;
                    overflow-y: hidden;
                    background: transparent;
                    z-index: 24;
                }
                .${gridId} .data-grid-external-horizontal-scroll::-webkit-scrollbar {
                    height: ${floatingScrollbarHeight}px;
                }
                .${gridId} .data-grid-external-horizontal-scroll::-webkit-scrollbar-track {
                    background: ${horizontalScrollbarTrackBg};
                    border: 1px solid ${horizontalScrollbarTrackBorderColor};
                    border-radius: 999px;
                    box-shadow: ${horizontalScrollbarTrackShadow};
                }
                .${gridId} .data-grid-external-horizontal-scroll::-webkit-scrollbar-thumb {
                    background: ${horizontalScrollbarThumbBg};
                    border: 1px solid ${horizontalScrollbarThumbBorderColor};
                    border-radius: 999px;
                    box-shadow: ${horizontalScrollbarThumbShadow};
                }
                .${gridId} .data-grid-external-horizontal-scroll-inner {
                    height: 1px;
                }
                .${gridId} .data-grid-pagination-shell {
                    display: inline-flex;
                    align-items: center;
                    justify-content: flex-end;
                    gap: 10px;
                    flex-wrap: wrap;
                    max-width: 100%;
                    padding: 8px 10px;
                    border-radius: 16px;
                    border: 1px solid ${paginationShellBorderColor};
                    background: ${paginationShellBg};
                    box-shadow: ${paginationShellShadow};
                    backdrop-filter: ${opacity < 0.999 ? 'blur(14px)' : 'none'};
                    -webkit-backdrop-filter: ${opacity < 0.999 ? 'blur(14px)' : 'none'};
                }
                .${gridId} .data-grid-pagination-summary,
                .${gridId} .data-grid-pagination-page-chip {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    min-height: 34px;
                    padding: 0 12px;
                    border-radius: 999px;
                    border: 1px solid ${paginationChipBorderColor};
                    background: ${paginationChipBg};
                    color: ${paginationPrimaryTextColor};
                    font-size: 12px;
                    line-height: 1;
                    font-variant-numeric: tabular-nums;
                    white-space: nowrap;
                }
                .${gridId} .data-grid-pagination-kicker {
                    display: inline-flex;
                    align-items: center;
                    height: 20px;
                    padding: 0 8px;
                    border-radius: 999px;
                    background: ${paginationAccentBg};
                    border: 1px solid ${paginationAccentBorderColor};
                    color: ${paginationActiveItemTextColor};
                    font-size: 11px;
                    font-weight: 700;
                    letter-spacing: 0.02em;
                }
                .${gridId} .data-grid-pagination-summary-value {
                    color: ${paginationPrimaryTextColor};
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                }
                .${gridId} .data-grid-pagination-page-chip {
                    color: ${paginationSecondaryTextColor};
                    font-weight: 600;
                }
                .${gridId} .ant-pagination {
                    display: inline-flex;
                    align-items: center;
                    gap: 6px;
                    margin: 0;
                    color: ${paginationPrimaryTextColor};
                }
                .${gridId} .ant-pagination .ant-pagination-item,
                .${gridId} .ant-pagination .ant-pagination-prev,
                .${gridId} .ant-pagination .ant-pagination-next,
                .${gridId} .ant-pagination .ant-pagination-jump-prev,
                .${gridId} .ant-pagination .ant-pagination-jump-next {
                    min-width: 34px;
                    height: 34px;
                    margin-inline-end: 0;
                    border-radius: 12px;
                    border: 1px solid ${paginationChipBorderColor};
                    background: ${paginationChipBg};
                    box-shadow: none;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    overflow: hidden;
                    transition: border-color 160ms ease, background-color 160ms ease, transform 160ms ease, box-shadow 160ms ease;
                }
                .${gridId} .ant-pagination .ant-pagination-item a,
                .${gridId} .ant-pagination .ant-pagination-prev .ant-pagination-item-link,
                .${gridId} .ant-pagination .ant-pagination-next .ant-pagination-item-link,
                .${gridId} .ant-pagination .ant-pagination-prev > *,
                .${gridId} .ant-pagination .ant-pagination-next > * {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    color: ${paginationPrimaryTextColor};
                    font-weight: 600;
                    border: none;
                    background: transparent;
                    border-radius: inherit;
                    line-height: 1;
                }
                .${gridId} .ant-pagination .ant-pagination-item:hover,
                .${gridId} .ant-pagination .ant-pagination-prev:hover,
                .${gridId} .ant-pagination .ant-pagination-next:hover {
                    background: ${paginationHoverBg};
                    border-color: ${paginationActiveItemBorderColor};
                    transform: translateY(-1px);
                }
                .${gridId} .ant-pagination .ant-pagination-item-active {
                    border-color: ${paginationActiveItemBorderColor};
                    background: ${paginationActiveItemBg};
                    box-shadow: inset 0 0 0 1px ${paginationAccentBorderColor};
                }
                .${gridId} .ant-pagination .ant-pagination-item-active a {
                    color: ${paginationActiveItemTextColor};
                }
                .${gridId} .ant-pagination .ant-pagination-disabled,
                .${gridId} .ant-pagination .ant-pagination-disabled:hover {
                    background: transparent;
                    border-color: ${paginationChipBorderColor};
                    transform: none;
                    opacity: 0.42;
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev,
                .${gridId} .ant-pagination .ant-pagination-jump-next {
                    padding: 0;
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-link,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-link {
                    position: relative;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    padding: 0;
                    margin: 0;
                    line-height: 1;
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-container,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-container {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    position: relative;
                    line-height: 1;
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-ellipsis,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-ellipsis,
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-link-icon,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-link-icon {
                    position: absolute !important;
                    top: 0 !important;
                    right: 0 !important;
                    bottom: 0 !important;
                    left: 0 !important;
                    inset: 0 !important;
                    width: fit-content !important;
                    height: fit-content !important;
                    min-width: 0 !important;
                    min-height: 0 !important;
                    margin: auto !important;
                    padding: 0 !important;
                    transform: none !important;
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    line-height: 1 !important;
                    color: ${paginationSecondaryTextColor};
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-ellipsis,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-ellipsis {
                    letter-spacing: 0.18em;
                    text-indent: 0.18em;
                    text-align: center;
                }
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-link-icon .anticon,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-link-icon .anticon,
                .${gridId} .ant-pagination .ant-pagination-jump-prev .ant-pagination-item-link-icon svg,
                .${gridId} .ant-pagination .ant-pagination-jump-next .ant-pagination-item-link-icon svg {
                    display: inline-flex !important;
                    align-items: center !important;
                    justify-content: center !important;
                    width: 1em;
                    height: 1em;
                    line-height: 1;
                }
                .${gridId} .data-grid-pagination-nav-icon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                    font-size: 12px;
                    line-height: 1;
                }
                .${gridId} .data-grid-pagination-nav-icon .anticon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    width: 100%;
                    height: 100%;
                }
                .${gridId} .data-grid-pagination-size-select {
                    min-width: 112px;
                    height: 34px;
                    display: inline-flex;
                    align-items: stretch;
                }
                .${gridId} .data-grid-pagination-size-select.ant-select-single,
                .${gridId} .data-grid-pagination-size-select.ant-select-single.ant-select-sm {
                    height: 34px;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-selector {
                    height: 34px !important;
                    border-radius: 12px !important;
                    border: 1px solid ${paginationChipBorderColor} !important;
                    background: ${paginationChipBg} !important;
                    box-shadow: none !important;
                    padding: 0 12px !important;
                    display: flex !important;
                    align-items: center !important;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-wrap {
                    display: flex !important;
                    align-items: center !important;
                    height: 100%;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-search,
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-search-input {
                    height: 100% !important;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-item,
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-placeholder {
                    display: flex;
                    align-items: center;
                    height: 100%;
                    line-height: 34px !important;
                    color: ${paginationPrimaryTextColor};
                    font-weight: 600;
                    font-variant-numeric: tabular-nums;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-selection-search {
                    inset-inline-start: 12px !important;
                    inset-inline-end: 32px !important;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-arrow {
                    color: ${paginationSecondaryTextColor};
                    inset-inline-end: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    margin-top: 0;
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    height: 16px;
                    line-height: 1;
                }
                .${gridId} .data-grid-pagination-size-select .ant-select-arrow .anticon {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    line-height: 1;
                }
  `, [themeStyles, gridId, tableBodyBottomPadding, darkMode, opacity]);

  const recalculateTableMetrics = useCallback((targetElement?: HTMLElement | null) => {
      const target = targetElement || containerRef.current;
      if (!target) return;

      // P5 性能优化：合并 getBoundingClientRect 调用，减少 DOM 查询次数
      const rect = target.getBoundingClientRect();
      const height = rect.height;
      const width = rect.width;
      if (!Number.isFinite(height) || height < 50) return;
      if (Number.isFinite(width) && width > 0) {
          setTableViewportWidth(Math.floor(width));
      }

      const headerEl =
          (target.querySelector('.ant-table-header') as HTMLElement | null) ||
          (target.querySelector('.ant-table-thead') as HTMLElement | null);
      const rawHeaderHeight = headerEl ? headerEl.getBoundingClientRect().height : NaN;
      const headerHeight =
          Number.isFinite(rawHeaderHeight) && rawHeaderHeight >= 24 && rawHeaderHeight <= 120 ? rawHeaderHeight : 42;
      const paginationEl = target.querySelector('.data-grid-pagination-wrap') as HTMLElement | null;
      const rawPaginationHeight = paginationEl ? paginationEl.getBoundingClientRect().height : 0;
      const paginationHeight =
          Number.isFinite(rawPaginationHeight) && rawPaginationHeight > 0 ? rawPaginationHeight : 0;

      const bodyEl = target.querySelector('.ant-table-body') as HTMLElement | null;
      const virtualBodyEl = target.querySelector('.ant-table-tbody-virtual-holder') as HTMLElement | null;
      const rcVirtualHolderEl = target.querySelector('.rc-virtual-list-holder') as HTMLElement | null;
      const virtualScrollbarEl = target.querySelector('.ant-table-tbody-virtual-scrollbar-horizontal') as HTMLElement | null;
      const scrollableEl = virtualBodyEl || rcVirtualHolderEl || bodyEl;
      const hasHorizontalOverflow = !!scrollableEl && (scrollableEl.scrollWidth - scrollableEl.clientWidth > 1);
      // 普通表格可通过 body 底部内边距避开悬浮横向滚动条；
      // 但虚拟表格的内部横向滚动轨道会直接覆盖在可视区底部，需要同时从 y 高度里扣掉安全区。
      const nextBodyBottomPadding = calculateTableBodyBottomPadding({
          hasHorizontalOverflow,
          floatingScrollbarHeight,
          floatingScrollbarGap,
      });
      setTableBodyBottomPadding(nextBodyBottomPadding);
      const extraBottom = 2;
      const virtualScrollbarViewportReserve = hasHorizontalOverflow && !!virtualScrollbarEl
          ? Math.ceil(virtualScrollbarEl.getBoundingClientRect().height || (floatingScrollbarHeight + floatingScrollbarGap + 4))
          : 0;
      const nextHeight = Math.max(
          100,
          Math.floor(height - headerHeight - paginationHeight - extraBottom - virtualScrollbarViewportReserve)
      );
      setTableHeight(nextHeight);
  }, [floatingScrollbarGap, floatingScrollbarHeight]);

  useEffect(() => {
      const el = containerRef.current;
      if (!el) return;

      let rafId: number | null = null;

      const resizeObserver = new ResizeObserver(entries => {
          if (rafId !== null) cancelAnimationFrame(rafId);
          rafId = requestAnimationFrame(() => {
              const target = (entries[0]?.target as HTMLElement | undefined) || containerRef.current;
              recalculateTableMetrics(target);
          });
      });

      resizeObserver.observe(el);
      rafId = requestAnimationFrame(() => recalculateTableMetrics(el));
      return () => {
          resizeObserver.disconnect();
          if (rafId !== null) cancelAnimationFrame(rafId);
      };
  }, [recalculateTableMetrics]);

  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);
  const [addedRows, setAddedRows] = useState<any[]>([]);
  const [modifiedRows, setModifiedRows] = useState<Record<string, any>>({});
  const [deletedRowKeys, setDeletedRowKeys] = useState<Set<string>>(new Set());

  const normalizeFilterLogic = useCallback((logic: unknown): 'AND' | 'OR' => {
      return String(logic || '').trim().toUpperCase() === 'OR' ? 'OR' : 'AND';
  }, []);

  // P6 性能优化：使用 ref 缓存首列名，避免 displayColumnNames 变化导致级联更新
  const firstColumnNameRef = useRef(displayColumnNames[0] || '');
  firstColumnNameRef.current = displayColumnNames[0] || '';

  const normalizeGridFilterConditions = useCallback((conditions?: FilterCondition[]): GridFilterCondition[] => {
      if (!Array.isArray(conditions)) return [];
      return conditions.map((cond, index) => {
          const fallbackId = index + 1;
          const nextId = Number.isFinite(Number(cond?.id)) ? Number(cond?.id) : fallbackId;
          const op = String(cond?.op || '=');
          const rawColumn = String(cond?.column || '');
          return {
              id: nextId,
              enabled: cond?.enabled !== false,
              logic: normalizeFilterLogic(cond?.logic),
              column: rawColumn || (op === 'CUSTOM' ? '' : String(firstColumnNameRef.current || '')),
              op,
              value: String(cond?.value ?? ''),
              value2: String(cond?.value2 ?? ''),
          };
      });
  }, [normalizeFilterLogic]);

  // Filter State
  const [filterConditions, setFilterConditions] = useState<GridFilterCondition[]>([]);
  const [nextFilterId, setNextFilterId] = useState(1);

  useEffect(() => {
      const nextConditions = normalizeGridFilterConditions(appliedFilterConditions);
      setFilterConditions(nextConditions);
      const maxId = nextConditions.reduce((max, cond) => (cond.id > max ? cond.id : max), 0);
      setNextFilterId(Math.max(1, maxId + 1));
  }, [appliedFilterConditions, normalizeGridFilterConditions]);

  const selectedRowKeysRef = useRef(selectedRowKeys);
  const displayDataRef = useRef<any[]>([]);

  useEffect(() => { selectedRowKeysRef.current = selectedRowKeys; }, [selectedRowKeys]);

  useEffect(() => {
      if (!pendingScrollToBottomRef.current) return;
      pendingScrollToBottomRef.current = false;
      // 等待 Table 渲染出新增行后再滚动到底部（virtual 模式也适用）
      requestAnimationFrame(() => {
          scrollTableBodyToBottom();
          requestAnimationFrame(() => scrollTableBodyToBottom());
      });
  }, [addedRows.length, scrollTableBodyToBottom]);

  // Reset local state when data source likely changes (e.g. tableName change)
  useEffect(() => {
      setAddedRows([]);
      setModifiedRows({});
      setDeletedRowKeys(new Set());
      setSelectedRowKeys([]);
      setCopiedCellPatch(null);
      setRowEditorOpen(false);
      setRowEditorRowKey('');
      rowEditorBaseRawRef.current = {};
      rowEditorDisplayRef.current = {};
      rowEditorNullColsRef.current = new Set();
      rowEditorForm.resetFields();
      closeCellEditor();
      form.resetFields();
  }, [tableName, dbName, connectionId]); // Reset on context change

  const rowKeyStr = useCallback((k: React.Key) => String(k), []);

  const columnIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    displayColumnNames.forEach((name: string, idx: number) => map.set(name, idx));
    return map;
  }, [displayColumnNames]);

  // 直接操作 DOM 更新选中效果，避免 React 重渲染
  const updateCellSelection = useCallback((newSelection: Set<string>) => {
    const container = containerRef.current;
    if (!container) return;

    // 只同步可见单元格，严格限定 `.ant-table-cell`，避免虚拟列表中内嵌的 EditableCell 被重复获取并打上 selected 样式从而产生白边。
    const visibleCells = container.querySelectorAll('.ant-table-cell[data-row-key][data-col-name]');
    visibleCells.forEach((cell) => {
      const el = cell as HTMLElement;
      const rowKey = el.getAttribute('data-row-key');
      const colName = el.getAttribute('data-col-name');
      if (!rowKey || !colName) return;
      const key = makeCellKey(rowKey, colName);
      if (newSelection.has(key)) {
        if (el.getAttribute('data-cell-selected') !== 'true') el.setAttribute('data-cell-selected', 'true');
      } else {
        if (el.hasAttribute('data-cell-selected')) el.removeAttribute('data-cell-selected');
      }
    });
  }, []);

  // 批量填充选中的单元格
  const handleBatchFillCells = useCallback(() => {
    const cellsToFill = currentSelectionRef.current;
    if (cellsToFill.size === 0) {
      void message.info('请先选择要填充的单元格');
      return;
    }

    const fillValue = batchEditSetNull ? null : batchEditValue;

    const addedRowMap = new Map<string, any>();
    addedRows.forEach((r) => {
      const k = r?.[GONAVI_ROW_KEY];
      if (k === undefined) return;
      addedRowMap.set(rowKeyStr(k), r);
    });

    const baseRowMap = new Map<string, any>();
    displayDataRef.current.forEach((r) => {
      const k = r?.[GONAVI_ROW_KEY];
      if (k === undefined) return;
      baseRowMap.set(rowKeyStr(k), r);
    });

    const patchesByRow = new Map<string, Record<string, any>>();
    let updatedCount = 0;

    cellsToFill.forEach((cellKey) => {
      const parts = splitCellKey(cellKey);
      if (!parts) return;
      const { rowKey, colName } = parts;

      const existing = modifiedRows[rowKey];
      const baseRow = baseRowMap.get(rowKey);
      let currentVal: any;

      const addedRow = addedRowMap.get(rowKey);
      if (addedRow) {
        currentVal = addedRow?.[colName];
      } else if (existing && Object.prototype.hasOwnProperty.call(existing as any, GONAVI_ROW_KEY)) {
        currentVal = (existing as any)?.[colName];
      } else if (existing && Object.prototype.hasOwnProperty.call(existing as any, colName)) {
        currentVal = (existing as any)?.[colName];
      } else {
        currentVal = baseRow?.[colName];
      }

      const isSame = isCellValueEqualForDiff(currentVal, fillValue);
      if (isSame) return;

      const patch = patchesByRow.get(rowKey) || {};
      patch[colName] = fillValue;
      patchesByRow.set(rowKey, patch);
      updatedCount++;
    });

    if (updatedCount === 0) {
      void message.info('选中的单元格无需更新');
      return;
    }

    // 仅做一次状态提交，避免大量 setState 循环
    setAddedRows(prev => prev.map(r => {
      const k = r?.[GONAVI_ROW_KEY];
      if (k === undefined) return r;
      const patch = patchesByRow.get(rowKeyStr(k));
      if (!patch) return r;
      return { ...r, ...patch };
    }));

    setModifiedRows(prev => {
      let next: Record<string, any> | null = null;

      patchesByRow.forEach((patch, keyStr) => {
        if (addedRowMap.has(keyStr)) return;

        const existing = prev[keyStr];
        const merged = existing ? { ...(existing as any), ...patch } : patch;
        if (!next) next = { ...prev };
        next[keyStr] = merged;
      });

      return next || prev;
    });

    void message.success(`已填充 ${updatedCount} 个单元格`);
    setBatchEditModalOpen(false);

    // 清除选中状态
    setSelectedCells(new Set());
    currentSelectionRef.current = new Set();
    selectionStartRef.current = null;
    isDraggingRef.current = false;
    cellSelectionPointerRef.current = null;
    if (cellSelectionAutoScrollRafRef.current !== null) {
      cancelAnimationFrame(cellSelectionAutoScrollRafRef.current);
      cellSelectionAutoScrollRafRef.current = null;
    }
    updateCellSelection(new Set());
  }, [batchEditValue, batchEditSetNull, addedRows, modifiedRows, rowKeyStr, updateCellSelection]);

  // 事件委托：在容器级别处理批量编辑模式的鼠标事件
  useEffect(() => {
    if (!cellEditMode) return;

    const container = containerRef.current;
    if (!container) return;
    const EDGE_THRESHOLD_PX = 28;
    const MIN_SCROLL_STEP = 8;
    const MAX_SCROLL_STEP = 24;

    const getCellInfo = (target: HTMLElement | null): { rowKey: string; colName: string } | null => {
      if (!target) return null;
      const cell = target.closest('[data-row-key][data-col-name]') as HTMLElement;
      if (!cell) return null;
      const rowKey = cell.getAttribute('data-row-key');
      const colName = cell.getAttribute('data-col-name');
      if (!rowKey || !colName) return null;
      return { rowKey, colName };
    };

    const getCellInfoFromPoint = (x: number, y: number): { rowKey: string; colName: string } | null => {
      const target = document.elementFromPoint(x, y) as HTMLElement | null;
      return getCellInfo(target);
    };

    const scheduleSelectionUpdate = (cellInfo: { rowKey: string; colName: string }) => {
      if (cellSelectionRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionRafRef.current);
      }

      cellSelectionRafRef.current = requestAnimationFrame(() => {
        cellSelectionRafRef.current = null;
        const start = selectionStartRef.current;
        if (!start) return;

        const currentData = displayDataRef.current;
        const rowIndexMap = rowIndexMapRef.current;
        const startRowIndex = start.rowIndex;
        const endRowIndex = rowIndexMap.get(cellInfo.rowKey) ?? -1;
        if (startRowIndex === -1 || endRowIndex === -1) return;

        const startColIndex = start.colIndex;
        const endColIndex = columnIndexMap.get(cellInfo.colName) ?? -1;
        if (startColIndex === -1 || endColIndex === -1) return;

        const minRowIndex = Math.min(startRowIndex, endRowIndex);
        const maxRowIndex = Math.max(startRowIndex, endRowIndex);
        const minColIndex = Math.min(startColIndex, endColIndex);
        const maxColIndex = Math.max(startColIndex, endColIndex);

        const newSelectedCells = new Set<string>();
        for (let i = minRowIndex; i <= maxRowIndex; i++) {
          const row = currentData[i];
          const rKey = String(row?.[GONAVI_ROW_KEY]);
          for (let j = minColIndex; j <= maxColIndex; j++) {
            newSelectedCells.add(makeCellKey(rKey, displayColumnNames[j]));
          }
        }

        currentSelectionRef.current = newSelectedCells;
        updateCellSelection(newSelectedCells);
      });
    };

    const stopAutoScroll = () => {
      if (cellSelectionAutoScrollRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionAutoScrollRafRef.current);
        cellSelectionAutoScrollRafRef.current = null;
      }
    };

    const getScrollStep = (distanceToEdge: number): number => {
      const ratio = Math.min(1, Math.max(0, distanceToEdge / EDGE_THRESHOLD_PX));
      return Math.round(MIN_SCROLL_STEP + (MAX_SCROLL_STEP - MIN_SCROLL_STEP) * ratio);
    };

    const autoScrollTick = () => {
      if (!isDraggingRef.current || !selectionStartRef.current) {
        stopAutoScroll();
        return;
      }

      const pointer = cellSelectionPointerRef.current;
      const tableBody = container.querySelector('.ant-table-body') as HTMLElement | null;
      if (!pointer || !tableBody) {
        cellSelectionAutoScrollRafRef.current = requestAnimationFrame(autoScrollTick);
        return;
      }

      const rect = tableBody.getBoundingClientRect();
      const maxScrollTop = Math.max(0, tableBody.scrollHeight - tableBody.clientHeight);
      const maxScrollLeft = Math.max(0, tableBody.scrollWidth - tableBody.clientWidth);
      let deltaY = 0;
      let deltaX = 0;

      if (pointer.y < rect.top + EDGE_THRESHOLD_PX && tableBody.scrollTop > 0) {
        const distance = rect.top + EDGE_THRESHOLD_PX - pointer.y;
        deltaY = -getScrollStep(distance);
      } else if (pointer.y > rect.bottom - EDGE_THRESHOLD_PX && tableBody.scrollTop < maxScrollTop) {
        const distance = pointer.y - (rect.bottom - EDGE_THRESHOLD_PX);
        deltaY = getScrollStep(distance);
      }

      if (pointer.x < rect.left + EDGE_THRESHOLD_PX && tableBody.scrollLeft > 0) {
        const distance = rect.left + EDGE_THRESHOLD_PX - pointer.x;
        deltaX = -getScrollStep(distance);
      } else if (pointer.x > rect.right - EDGE_THRESHOLD_PX && tableBody.scrollLeft < maxScrollLeft) {
        const distance = pointer.x - (rect.right - EDGE_THRESHOLD_PX);
        deltaX = getScrollStep(distance);
      }

      let didScroll = false;
      if (deltaY !== 0) {
        const nextTop = Math.max(0, Math.min(maxScrollTop, tableBody.scrollTop + deltaY));
        if (nextTop !== tableBody.scrollTop) {
          tableBody.scrollTop = nextTop;
          didScroll = true;
        }
      }

      if (deltaX !== 0) {
        const nextLeft = Math.max(0, Math.min(maxScrollLeft, tableBody.scrollLeft + deltaX));
        if (nextLeft !== tableBody.scrollLeft) {
          tableBody.scrollLeft = nextLeft;
          didScroll = true;
        }
      }

      if (didScroll) {
        const cellInfo = getCellInfoFromPoint(pointer.x, pointer.y);
        if (cellInfo) scheduleSelectionUpdate(cellInfo);
      }

      cellSelectionAutoScrollRafRef.current = requestAnimationFrame(autoScrollTick);
    };

    const ensureAutoScroll = () => {
      if (cellSelectionAutoScrollRafRef.current !== null) return;
      cellSelectionAutoScrollRafRef.current = requestAnimationFrame(autoScrollTick);
    };

    const onMouseDown = (e: MouseEvent) => {
      const target = e.target instanceof HTMLElement ? e.target : null;
      const cellInfo = getCellInfo(target);
      if (!cellInfo) return;

      e.preventDefault();
      isDraggingRef.current = true;
      cellSelectionPointerRef.current = { x: e.clientX, y: e.clientY };
      const currentData = displayDataRef.current;
      const nextRowIndexMap = new Map<string, number>();
      currentData.forEach((r, idx) => {
        const k = r?.[GONAVI_ROW_KEY];
        if (k === undefined) return;
        nextRowIndexMap.set(String(k), idx);
      });
      rowIndexMapRef.current = nextRowIndexMap;

      const startRowIndex = nextRowIndexMap.get(cellInfo.rowKey) ?? -1;
      const startColIndex = columnIndexMap.get(cellInfo.colName) ?? -1;
      selectionStartRef.current = { rowKey: cellInfo.rowKey, colName: cellInfo.colName, rowIndex: startRowIndex, colIndex: startColIndex };
      currentSelectionRef.current = new Set([makeCellKey(cellInfo.rowKey, cellInfo.colName)]);
      updateCellSelection(currentSelectionRef.current);
      ensureAutoScroll();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!isDraggingRef.current || !selectionStartRef.current) return;
      cellSelectionPointerRef.current = { x: e.clientX, y: e.clientY };
      ensureAutoScroll();

      const target = e.target instanceof HTMLElement ? e.target : null;
      const cellInfo = getCellInfo(target) || getCellInfoFromPoint(e.clientX, e.clientY);
      if (!cellInfo) return;
      scheduleSelectionUpdate(cellInfo);
    };

    const onMouseUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      cellSelectionPointerRef.current = null;
      stopAutoScroll();

      if (cellSelectionRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionRafRef.current);
        cellSelectionRafRef.current = null;
      }

      if (currentSelectionRef.current.size > 0) {
        setSelectedCells(new Set(currentSelectionRef.current));
      }
    };

    const onScroll = () => {
      if (currentSelectionRef.current.size === 0) return;
      if (cellSelectionScrollRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionScrollRafRef.current);
      }
      cellSelectionScrollRafRef.current = requestAnimationFrame(() => {
        cellSelectionScrollRafRef.current = null;
        updateCellSelection(currentSelectionRef.current);
      });
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('scroll', onScroll, true);
    document.addEventListener('mouseup', onMouseUp);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mouseup', onMouseUp);
      if (cellSelectionRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionRafRef.current);
        cellSelectionRafRef.current = null;
      }
      if (cellSelectionScrollRafRef.current !== null) {
        cancelAnimationFrame(cellSelectionScrollRafRef.current);
        cellSelectionScrollRafRef.current = null;
      }
      stopAutoScroll();
      cellSelectionPointerRef.current = null;
      isDraggingRef.current = false;
    };
  }, [cellEditMode, displayColumnNames, columnIndexMap, updateCellSelection]);

  const handleCopySelectedColumnsFromRow = useCallback(() => {
    const activeSelection = currentSelectionRef.current.size > 0 ? currentSelectionRef.current : selectedCells;
    if (activeSelection.size === 0) {
      void message.info('请先在同一行选中要复制的单元格');
      return;
    }

    const parsed = Array.from(activeSelection)
      .map((cellKey) => splitCellKey(cellKey))
      .filter((item): item is { rowKey: string; colName: string } => !!item);
    if (parsed.length === 0) {
      void message.info('未识别到可复制的单元格');
      return;
    }

    const sourceRowKeySet = new Set(parsed.map((item) => item.rowKey));
    if (sourceRowKeySet.size !== 1) {
      void message.info('复制列值时请只选择同一行的单元格');
      return;
    }

    const sourceRowKey = parsed[0].rowKey;
    const selectedColumnNames = Array.from(new Set(parsed.map((item) => item.colName)));
    if (selectedColumnNames.length === 0) {
      void message.info('未识别到可复制的列');
      return;
    }

    const sourceBaseRow = displayDataRef.current.find((row) => {
      const key = row?.[GONAVI_ROW_KEY];
      return key !== undefined && key !== null && rowKeyStr(key) === sourceRowKey;
    });
    const sourceAddedRow = addedRows.find((row) => {
      const key = row?.[GONAVI_ROW_KEY];
      return key !== undefined && key !== null && rowKeyStr(key) === sourceRowKey;
    });
    const sourceModified = modifiedRows[sourceRowKey];

    const values: Record<string, any> = {};
    selectedColumnNames.forEach((colName) => {
      if (sourceAddedRow) {
        values[colName] = sourceAddedRow[colName];
        return;
      }

      if (sourceModified && Object.prototype.hasOwnProperty.call(sourceModified as any, colName)) {
        values[colName] = (sourceModified as any)[colName];
        return;
      }

      values[colName] = sourceBaseRow?.[colName];
    });

    setCopiedCellPatch({ sourceRowKey, values });
    void message.success(`已复制 ${selectedColumnNames.length} 列，可粘贴到目标行`);
  }, [selectedCells, rowKeyStr, addedRows, modifiedRows]);

  const handlePasteCopiedColumnsToSelectedRows = useCallback((fallbackRowKey?: React.Key) => {
    if (!copiedCellPatch || Object.keys(copiedCellPatch.values).length === 0) {
      void message.info('请先复制列值');
      return;
    }

    const targetKeySet = new Set<string>();
    const selectedKeys = selectedRowKeysRef.current;
    if (selectedKeys.length > 0) {
      selectedKeys.forEach((key) => targetKeySet.add(rowKeyStr(key)));
    } else if (fallbackRowKey !== undefined && fallbackRowKey !== null) {
      targetKeySet.add(rowKeyStr(fallbackRowKey));
    } else {
      void message.info('请先选择目标行');
      return;
    }

    targetKeySet.delete(copiedCellPatch.sourceRowKey);
    if (targetKeySet.size === 0) {
      void message.info('目标行不能仅为源行，请选择其他行');
      return;
    }

    const addedRowMap = new Map<string, any>();
    addedRows.forEach((row) => {
      const key = row?.[GONAVI_ROW_KEY];
      if (key === undefined || key === null) return;
      addedRowMap.set(rowKeyStr(key), row);
    });

    const baseRowMap = new Map<string, any>();
    displayDataRef.current.forEach((row) => {
      const key = row?.[GONAVI_ROW_KEY];
      if (key === undefined || key === null) return;
      baseRowMap.set(rowKeyStr(key), row);
    });

    const patchesByRow = new Map<string, Record<string, any>>();
    let updatedCellCount = 0;

    targetKeySet.forEach((targetRowKey) => {
      const patch: Record<string, any> = {};
      const existing = modifiedRows[targetRowKey];
      const addedRow = addedRowMap.get(targetRowKey);
      const baseRow = baseRowMap.get(targetRowKey);

      Object.entries(copiedCellPatch.values).forEach(([colName, nextValue]) => {
        let currentValue: any;

        if (addedRow) {
          currentValue = addedRow[colName];
        } else if (existing && Object.prototype.hasOwnProperty.call(existing as any, GONAVI_ROW_KEY)) {
          currentValue = (existing as any)[colName];
        } else if (existing && Object.prototype.hasOwnProperty.call(existing as any, colName)) {
          currentValue = (existing as any)[colName];
        } else {
          currentValue = baseRow?.[colName];
        }

        if (isCellValueEqualForDiff(currentValue, nextValue)) return;
        patch[colName] = nextValue;
        updatedCellCount++;
      });

      if (Object.keys(patch).length > 0) {
        patchesByRow.set(targetRowKey, patch);
      }
    });

    if (patchesByRow.size === 0 || updatedCellCount === 0) {
      void message.info('目标行无需更新');
      return;
    }

    setAddedRows(prev => prev.map((row) => {
      const key = row?.[GONAVI_ROW_KEY];
      if (key === undefined || key === null) return row;
      const patch = patchesByRow.get(rowKeyStr(key));
      if (!patch) return row;
      return { ...row, ...patch };
    }));

    setModifiedRows(prev => {
      let next: Record<string, any> | null = null;

      patchesByRow.forEach((patch, keyStr) => {
        if (addedRowMap.has(keyStr)) return;
        const existing = prev[keyStr];
        const merged = existing ? { ...(existing as any), ...patch } : patch;
        if (!next) next = { ...prev };
        next[keyStr] = merged;
      });

      return next || prev;
    });

    void message.success(`已粘贴到 ${patchesByRow.size} 行，共 ${updatedCellCount} 个单元格`);
    setCellContextMenu(prev => ({ ...prev, visible: false }));
  }, [copiedCellPatch, addedRows, modifiedRows, rowKeyStr]);

  // 批量填充到选中行
  const handleBatchFillToSelected = useCallback((sourceRecord: Item, dataIndex: string) => {
    const sourceValue = sourceRecord[dataIndex];
    const selKeys = selectedRowKeysRef.current;

    if (selKeys.length === 0) {
      void message.info('请先选择要填充的行');
      return;
    }

    const sourceKey = sourceRecord?.[GONAVI_ROW_KEY];
    // 过滤掉源行本身
    const targetKeys = selKeys.filter(k => k !== sourceKey);

    if (targetKeys.length === 0) {
      void message.info('没有其他选中的行可以填充');
      return;
    }

    // 批量更新
    const addedKeySet = new Set<string>();
    addedRows.forEach((r) => {
      const k = r?.[GONAVI_ROW_KEY];
      if (k === undefined) return;
      addedKeySet.add(rowKeyStr(k));
    });

    const targetKeyStrList = targetKeys.map(rowKeyStr);
    const targetKeyStrSet = new Set(targetKeyStrList);
    const updatedCount = targetKeyStrSet.size;

    setAddedRows(prev => prev.map(r => {
      const k = r?.[GONAVI_ROW_KEY];
      if (k === undefined) return r;
      const keyStr = rowKeyStr(k);
      if (!targetKeyStrSet.has(keyStr)) return r;
      return { ...r, [dataIndex]: sourceValue };
    }));

    setModifiedRows(prev => {
      let next: Record<string, any> | null = null;

      targetKeyStrSet.forEach((keyStr) => {
        if (addedKeySet.has(keyStr)) return;
        const existing = prev[keyStr];
        const patch = { [dataIndex]: sourceValue };
        const merged = existing ? { ...(existing as any), ...patch } : patch;
        if (!next) next = { ...prev };
        next[keyStr] = merged;
      });

      return next || prev;
    });

    void message.success(`已填充 ${updatedCount} 行`);
    setCellContextMenu(prev => ({ ...prev, visible: false }));
  }, [addedRows, rowKeyStr]);

  const displayData = useMemo(() => {
      return [...data, ...addedRows].filter(item => {
          const k = item?.[GONAVI_ROW_KEY];
          return k === undefined ? true : !deletedRowKeys.has(rowKeyStr(k));
      });
  }, [data, addedRows, deletedRowKeys]);

  useEffect(() => { displayDataRef.current = displayData; }, [displayData]);

  const hasChanges = addedRows.length > 0 || Object.keys(modifiedRows).length > 0 || deletedRowKeys.size > 0;

  const addedRowKeySet = useMemo(() => {
      const next = new Set<string>();
      addedRows.forEach((row) => {
          const key = row?.[GONAVI_ROW_KEY];
          if (key === undefined || key === null) return;
          next.add(rowKeyStr(key));
      });
      return next;
  }, [addedRows, rowKeyStr]);

  const modifiedRowKeySet = useMemo(() => new Set(Object.keys(modifiedRows)), [modifiedRows]);
  const rowClassName = useCallback((record: Item) => {
      const k = record?.[GONAVI_ROW_KEY];
      if (k === undefined || k === null) return '';
      const keyStr = rowKeyStr(k);
      if (addedRowKeySet.has(keyStr)) return 'row-added';
      if (modifiedRowKeySet.has(keyStr) || deletedRowKeys.has(keyStr)) return 'row-modified';
      return '';
  }, [addedRowKeySet, modifiedRowKeySet, deletedRowKeys, rowKeyStr]);

  const handleTableChange = useCallback((_pag: any, _filtersArg: any, sorter: any) => {
      if (isResizingRef.current) return; // Block sort if resizing
      // Ant Design 多列排序模式下 sorter 可能是数组
      const sorters = Array.isArray(sorter) ? sorter : (sorter?.field ? [sorter] : []);
      if (sorters.length === 0) {
          setSortInfo([]);
          if (onSort) onSort(JSON.stringify([]), '');
          return;
      }
      // 在现有排序数组基础上增量更新
      const next = [...sortInfo];
      for (const s of sorters) {
          const field = String(s.field || '');
          if (!field) continue;
          const order = s.order as string;
          const normalizedOrder = order === 'ascend' || order === 'descend' ? order : '';
          const existIdx = next.findIndex(item => item.columnKey === field);
          if (!normalizedOrder) {
              // Ant Design 第三次点击想取消排序：
              // 如果该字段已在排序数组中，回转为升序而非移除
              if (existIdx >= 0) {
                  next[existIdx] = { ...next[existIdx], order: 'ascend', enabled: true };
              }
              // 不在数组中则忽略
          } else if (existIdx >= 0) {
              // 已存在：更新排序方向
              next[existIdx] = { ...next[existIdx], order: normalizedOrder, enabled: true };
          } else {
              // 不存在：追加到末尾
              next.push({ columnKey: field, order: normalizedOrder, enabled: true });
          }
      }
      setSortInfo(next);
      if (onSort) onSort(JSON.stringify(next), '');
  }, [onSort, sortInfo]);

    // Native Drag State
    const draggingRef = useRef<{
        startX: number,
        startWidth: number,
        key: string,
        containerLeft: number
    } | null>(null);
    const ghostRef = useRef<HTMLDivElement>(null);
    const resizeRafRef = useRef<number | null>(null);
    const latestClientXRef = useRef<number | null>(null);
    const isResizingRef = useRef(false); // Lock for sorting

    const flushGhostPosition = useCallback(() => {
        resizeRafRef.current = null;
        if (!draggingRef.current || !ghostRef.current) return;
        if (latestClientXRef.current === null) return;
        const relativeLeft = latestClientXRef.current - draggingRef.current.containerLeft;
        ghostRef.current.style.transform = `translateX(${relativeLeft}px)`;
    }, []);
  
        // 1. Drag Start
  
        const handleResizeStart = useCallback((key: string) => (e: React.MouseEvent) => {
  
            e.preventDefault(); 
  
            e.stopPropagation(); 
  
            
  
            isResizingRef.current = true; // Engage lock
  
      
  
            const startX = e.clientX;
  
            const currentWidth = columnWidths[key] || 200; 
  
            const containerLeft = containerRef.current?.getBoundingClientRect().left ?? 0;
  
            draggingRef.current = { startX, startWidth: currentWidth, key, containerLeft };
            latestClientXRef.current = startX;
  
      
  
            // Show Ghost Line at initial position
  
            if (ghostRef.current && containerRef.current) {
                const relativeLeft = startX - containerLeft;
                ghostRef.current.style.transform = `translateX(${relativeLeft}px)`;
  
                ghostRef.current.style.display = 'block';
  
            }
  
      
  
            // Add global listeners
  
            document.addEventListener('mousemove', handleResizeMove);
  
            document.addEventListener('mouseup', handleResizeStop);
  
            document.body.style.cursor = 'col-resize'; 
  
            document.body.style.userSelect = 'none'; 
  
        }, [columnWidths]);

  // 2. Drag Move (Global)
  const handleResizeMove = useCallback((e: MouseEvent) => {
      if (!draggingRef.current) return;
      latestClientXRef.current = e.clientX;
      if (resizeRafRef.current !== null) return;
      resizeRafRef.current = requestAnimationFrame(flushGhostPosition);
  }, [flushGhostPosition]);

  // 3. Drag Stop (Global)
  const handleResizeStop = useCallback((e: MouseEvent) => {
      if (!draggingRef.current) return;

      const { startX, startWidth, key } = draggingRef.current;
      const deltaX = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + deltaX);

      // Commit State
      setColumnWidths(prev => ({ ...prev, [key]: newWidth }));

      // Cleanup
      if (resizeRafRef.current !== null) {
          cancelAnimationFrame(resizeRafRef.current);
          resizeRafRef.current = null;
      }
      latestClientXRef.current = null;
      if (ghostRef.current) ghostRef.current.style.display = 'none';
      document.removeEventListener('mousemove', handleResizeMove);
      document.removeEventListener('mouseup', handleResizeStop);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      draggingRef.current = null;
      
      // Release lock after a short delay to block subsequent click events (sorting)
      setTimeout(() => {
          isResizingRef.current = false;
      }, 100);
  }, []);

  const handleCellSave = useCallback((row: any) => {
      // Optimistic update for display
      // In parent-controlled data, we might need parent to update 'data', 
      // but here we manage 'modifiedRows' locally and overlay it.
      // Since 'displayData' is derived from 'data' + 'modifiedRows', we need to update the source if it's in 'data'.
      // But 'data' prop is immutable.
      // So we update 'modifiedRows'.
      
      // Check if it's an added row
      const rowKey = row?.[GONAVI_ROW_KEY];
      if (rowKey === undefined) return;
      const isAdded = addedRows.some(r => r?.[GONAVI_ROW_KEY] === rowKey);
      if (isAdded) {
          setAddedRows(prev => prev.map(r => r?.[GONAVI_ROW_KEY] === rowKey ? { ...r, ...row } : r));
      } else {
          setModifiedRows(prev => ({ ...prev, [rowKeyStr(rowKey)]: row }));
      }
  }, [addedRows]);

  const handleDataPanelSave = useCallback(() => {
      if (!focusedCellInfo) return;
      const nextRow: any = { ...focusedCellInfo.record, [focusedCellInfo.dataIndex]: dataPanelValue };
      handleCellSave(nextRow);
      dataPanelDirtyRef.current = false;
      void message.success('已保存');
  }, [focusedCellInfo, dataPanelValue, handleCellSave]);

  const handleCellSetNull = useCallback(() => {
    if (!cellContextMenu.record) return;
    handleCellSave({ ...cellContextMenu.record, [cellContextMenu.dataIndex]: null });
    setCellContextMenu(prev => ({ ...prev, visible: false }));
  }, [cellContextMenu, handleCellSave]);

  const handleCellEditorSave = useCallback(() => {
      if (!cellEditorMeta) return;
      const apply = cellEditorApplyRef.current;
      if (apply) {
          apply(cellEditorValue);
          closeCellEditor();
          return;
      }
      const nextRow: any = { ...cellEditorMeta.record, [cellEditorMeta.dataIndex]: cellEditorValue };
      handleCellSave(nextRow);
      closeCellEditor();
  }, [cellEditorMeta, cellEditorValue, handleCellSave, closeCellEditor]);

  const handleFormatJsonInEditor = useCallback(() => {
      if (!cellEditorIsJson) return;
      try {
          const obj = JSON.parse(cellEditorValue);
          setCellEditorValue(JSON.stringify(obj, null, 2));
      } catch (e: any) {
          void message.error("JSON 格式无效：" + (e?.message || String(e)));
      }
  }, [cellEditorIsJson, cellEditorValue]);

  const handleVirtualCellActivate = useCallback((record: Item, dataIndex: string, title: React.ReactNode) => {
      if (!canModifyData) return;
      openCellEditor(record, dataIndex, title);
  }, [canModifyData, openCellEditor]);

  // Merge Data for Display
  // 'displayData' already merges addedRows. 
  // We need to merge modifiedRows into it for rendering.
  const mergedDisplayData = useMemo(() => {
      return displayData.map(row => {
          const k = row?.[GONAVI_ROW_KEY];
          if (k !== undefined && modifiedRows[rowKeyStr(k)]) {
              return { ...row, ...modifiedRows[rowKeyStr(k)] };
          }
          return row;
      });
  }, [displayData, modifiedRows]);

  useEffect(() => {
      setTextRecordIndex(prev => {
          if (mergedDisplayData.length === 0) return 0;
          return Math.min(prev, mergedDisplayData.length - 1);
      });
  }, [mergedDisplayData.length]);

  const jsonViewText = useMemo(() => {
      if (viewMode !== 'json') return '';
      const cleanRows = mergedDisplayData.map((row) => {
          const { [GONAVI_ROW_KEY]: _rowKey, ...rest } = row || {};
          return normalizeValueForJsonView(rest);
      });
      return JSON.stringify(cleanRows, null, 2);
  }, [viewMode, mergedDisplayData]);

  const textViewRows = useMemo(() => {
      if (viewMode !== 'text') return [];
      return mergedDisplayData.map((row) => {
          const { [GONAVI_ROW_KEY]: _rowKey, ...rest } = row || {};
          return rest;
      });
  }, [viewMode, mergedDisplayData]);

  const currentTextRow = useMemo(() => {
      if (viewMode !== 'text') return null;
      if (textViewRows.length === 0) return null;
      return textViewRows[textRecordIndex] || null;
  }, [viewMode, textViewRows, textRecordIndex]);

  const formatTextViewValue = useCallback((val: any): string => {
      if (val === null) return 'NULL';
      if (val === undefined) return '';
      if (typeof val === 'string') return normalizeDateTimeString(val);
      if (typeof val === 'object') {
          try {
              return JSON.stringify(val, null, 2);
          } catch {
              return String(val);
          }
      }
      return String(val);
  }, []);

  const closeRowEditor = useCallback(() => {
      setRowEditorOpen(false);
      setRowEditorRowKey('');
      rowEditorBaseRawRef.current = {};
      rowEditorDisplayRef.current = {};
      rowEditorNullColsRef.current = new Set();
      rowEditorForm.resetFields();
  }, [rowEditorForm]);

  const openRowEditorByKey = useCallback((keyStr?: string) => {
      if (!canModifyData) return;
      if (!keyStr) {
          void message.info('请先定位到要编辑的记录');
          return;
      }
      const displayRow = mergedDisplayData.find(r => rowKeyStr(r?.[GONAVI_ROW_KEY]) === keyStr);
      if (!displayRow) {
          void message.error('未找到目标行，请刷新后重试');
          return;
      }

      const baseRow =
          data.find(r => rowKeyStr(r?.[GONAVI_ROW_KEY]) === keyStr) ||
          addedRows.find(r => rowKeyStr(r?.[GONAVI_ROW_KEY]) === keyStr) ||
          displayRow;

      const baseRawMap: Record<string, any> = {};
      const displayMap: Record<string, string> = {};
      const formMap: Record<string, any> = {};
      const nullCols = new Set<string>();

      columnNames.forEach((col) => {
          const baseVal = (baseRow as any)?.[col];
          const displayVal = (displayRow as any)?.[col];
          baseRawMap[col] = baseVal;
          displayMap[col] = toFormText(displayVal);
          // 日期时间类型: 将字符串值转为 dayjs 对象供 DatePicker 使用
          const colMeta = columnMetaMap[col] || columnMetaMapByLowerName[col.toLowerCase()];
          const rowPickerType = getTemporalPickerType(colMeta?.type);
          if (rowPickerType && displayVal !== null && displayVal !== undefined) {
              const dVal = parseToDayjs(displayVal, rowPickerType);
              formMap[col] = dVal;
          } else {
              formMap[col] = displayVal === null || displayVal === undefined ? undefined : toFormText(displayVal);
          }
          if (baseVal === null || baseVal === undefined) nullCols.add(col);
      });

      rowEditorBaseRawRef.current = baseRawMap;
      rowEditorDisplayRef.current = displayMap;
      rowEditorNullColsRef.current = nullCols;

      rowEditorForm.setFieldsValue(formMap);
      setRowEditorRowKey(keyStr);
      setRowEditorOpen(true);
  }, [canModifyData, mergedDisplayData, data, addedRows, displayColumnNames, rowEditorForm, rowKeyStr, columnMetaMap, columnMetaMapByLowerName]);

  const openRowEditor = useCallback(() => {
      if (!canModifyData) return;
      if (selectedRowKeys.length > 1) {
          void message.info('一次只能编辑一行，请仅选择一行');
          return;
      }
      const keyStr = selectedRowKeys.length === 1 ? rowKeyStr(selectedRowKeys[0]) : undefined;
      if (!keyStr) {
          void message.info('请先选择一行（勾选复选框）');
          return;
      }
      openRowEditorByKey(keyStr);
  }, [canModifyData, selectedRowKeys, rowKeyStr, openRowEditorByKey]);

  const openCurrentViewRowEditor = useCallback(() => {
      if (!canModifyData) return;
      const currentRow = mergedDisplayData[textRecordIndex];
      const rowKey = currentRow?.[GONAVI_ROW_KEY];
      if (rowKey === undefined || rowKey === null) {
          void message.info('当前记录不可编辑');
          return;
      }
      openRowEditorByKey(rowKeyStr(rowKey));
  }, [canModifyData, mergedDisplayData, textRecordIndex, rowKeyStr, openRowEditorByKey]);

  const openJsonEditor = useCallback(() => {
      if (!canModifyData) return;
      setJsonEditorValue(jsonViewText);
      setJsonEditorOpen(true);
  }, [canModifyData, jsonViewText]);

  const handleFormatJsonEditor = useCallback(() => {
      try {
          const parsed = JSON.parse(jsonEditorValue);
          setJsonEditorValue(JSON.stringify(parsed, null, 2));
      } catch (e: any) {
          void message.error("JSON 格式无效：" + (e?.message || String(e)));
      }
  }, [jsonEditorValue]);

  const applyJsonEditor = useCallback(() => {
      if (!canModifyData) return;
      let parsed: any;
      try {
          parsed = JSON.parse(jsonEditorValue);
      } catch (e: any) {
          void message.error("JSON 解析失败：" + (e?.message || String(e)));
          return;
      }

      if (!Array.isArray(parsed)) {
          void message.error("JSON 视图必须是数组格式（每项对应一条记录）");
          return;
      }
      if (parsed.length !== mergedDisplayData.length) {
          void message.error(`记录条数不一致：当前 ${mergedDisplayData.length} 条，JSON 中 ${parsed.length} 条。请勿在此模式增删记录。`);
          return;
      }

      const addedKeySet = new Set<string>();
      addedRows.forEach((r) => {
          const key = r?.[GONAVI_ROW_KEY];
          if (key === undefined) return;
          addedKeySet.add(rowKeyStr(key));
      });

      const originalMap = new Map<string, any>();
      data.forEach((r) => {
          const key = r?.[GONAVI_ROW_KEY];
          if (key === undefined) return;
          originalMap.set(rowKeyStr(key), r);
      });

      const addedPatchMap = new Map<string, Record<string, any>>();
      const updatePatchMap = new Map<string, Record<string, any>>();

      for (let idx = 0; idx < parsed.length; idx += 1) {
          const nextItem = parsed[idx];
          if (!isPlainObject(nextItem)) {
              void message.error(`第 ${idx + 1} 条记录不是对象，无法应用`);
              return;
          }

          const currentRow = mergedDisplayData[idx];
          const rowKey = currentRow?.[GONAVI_ROW_KEY];
          if (rowKey === undefined || rowKey === null) {
              void message.error(`第 ${idx + 1} 条记录缺少行标识，无法应用`);
              return;
          }
          const keyStr = rowKeyStr(rowKey);
          const normalizedNext: Record<string, any> = {};
          let hasAnyVisibleChange = false;
          columnNames.forEach((col) => {
              const currentVal = (currentRow as any)?.[col];
              const editedVal = Object.prototype.hasOwnProperty.call(nextItem, col) ? (nextItem as any)[col] : currentVal;
              if (!isJsonViewValueEqual(currentVal, editedVal)) hasAnyVisibleChange = true;
              normalizedNext[col] = coerceJsonEditorValueForStorage(currentVal, editedVal);
          });

          if (!hasAnyVisibleChange) {
              continue;
          }

          if (addedKeySet.has(keyStr)) {
              addedPatchMap.set(keyStr, normalizedNext);
              continue;
          }

          const originalRow = originalMap.get(keyStr);
          if (!originalRow) continue;
          const patch: Record<string, any> = {};
          columnNames.forEach((col) => {
              const prevVal = (originalRow as any)?.[col];
              const nextVal = normalizedNext[col];
              if (!isCellValueEqualForDiff(prevVal, nextVal)) patch[col] = nextVal;
          });
          updatePatchMap.set(keyStr, patch);
      }

      setAddedRows((prev) => prev.map((row) => {
          const key = row?.[GONAVI_ROW_KEY];
          if (key === undefined) return row;
          const patch = addedPatchMap.get(rowKeyStr(key));
          if (!patch) return row;
          return { ...row, ...patch };
      }));

      setModifiedRows((prev) => {
          const next = { ...prev };
          updatePatchMap.forEach((patch, keyStr) => {
              if (Object.keys(patch).length === 0) delete next[keyStr];
              else next[keyStr] = patch;
          });
          return next;
      });

      setJsonEditorOpen(false);
      void message.success("JSON 修改已应用到当前结果集，可继续“提交事务”");
  }, [canModifyData, jsonEditorValue, mergedDisplayData, addedRows, rowKeyStr, data, displayColumnNames]);

  const openRowEditorFieldEditor = useCallback((dataIndex: string) => {
      if (!dataIndex) return;
      const val = rowEditorForm.getFieldValue(dataIndex);
      openCellEditor(
          { [dataIndex]: val ?? '' },
          dataIndex,
          dataIndex,
          (nextVal) => rowEditorForm.setFieldsValue({ [dataIndex]: nextVal }),
      );
  }, [rowEditorForm, openCellEditor]);

  const applyRowEditor = useCallback(() => {
      const keyStr = rowEditorRowKey;
      if (!keyStr) return;
      const values = rowEditorForm.getFieldsValue(true) || {};

      const isAdded = addedRows.some(r => rowKeyStr(r?.[GONAVI_ROW_KEY]) === keyStr);
      if (isAdded) {
          // 日期时间类型: 将 dayjs 对象转回格式化字符串
          const convertedValues: Record<string, any> = {};
          Object.entries(values).forEach(([col, val]) => {
              if (val && dayjs.isDayjs(val)) {
                  const colMeta = columnMetaMap[col] || columnMetaMapByLowerName[col.toLowerCase()];
                  const rowPickerType = getTemporalPickerType(colMeta?.type);
                  convertedValues[col] = formatFromDayjs(val as dayjs.Dayjs, rowPickerType);
              } else {
                  convertedValues[col] = val;
              }
          });
          setAddedRows(prev => prev.map(r => rowKeyStr(r?.[GONAVI_ROW_KEY]) === keyStr ? { ...r, ...convertedValues } : r));
          closeRowEditor();
          return;
      }

      const baseRawMap = rowEditorBaseRawRef.current || {};
      const patch: Record<string, any> = {};
      columnNames.forEach((col) => {
          let nextVal = values[col];
          // 日期时间类型: 将 dayjs 对象转回格式化字符串
          if (nextVal && dayjs.isDayjs(nextVal)) {
              const colMeta = columnMetaMap[col] || columnMetaMapByLowerName[col.toLowerCase()];
              const rowPickerType = getTemporalPickerType(colMeta?.type);
              nextVal = formatFromDayjs(nextVal as dayjs.Dayjs, rowPickerType);
          }
          const baseVal = baseRawMap[col];
          if (!isCellValueEqualForDiff(baseVal, nextVal)) patch[col] = nextVal;
      });

      setModifiedRows(prev => {
          const next = { ...prev };
          if (Object.keys(patch).length === 0) delete next[keyStr];
          else next[keyStr] = patch;
          return next;
      });

      closeRowEditor();
  }, [rowEditorRowKey, rowEditorForm, addedRows, columnNames, rowKeyStr, closeRowEditor]);


  const enableVirtual = viewMode === 'table';
  const enableInlineEditableCell = canModifyData;

  const columns: (ColumnType<any> & { editable?: boolean })[] = useMemo(() => {
      return displayColumnNames.map(key => ({
          title: renderColumnTitle(key),
          dataIndex: key,
          key: key,
          // 不使用 ellipsis，避免 Ant Design 的 Tooltip 展开行为
          width: columnWidths[key] || 200,
          sorter: onSort ? { multiple: displayColumnNames.indexOf(key) + 1 } : false,
          sortOrder: (sortInfo.find(s => s.columnKey === key && s.enabled !== false)?.order || null) as SortOrder | undefined,
          editable: canModifyData, // Only editable if table name known and not readonly
          render: (text: any) => (
              <div style={CELL_ELLIPSIS_STYLE}>
                  {formatCellValue(text)}
              </div>
          ),
          shouldCellUpdate: (record: Item, prevRecord: Item) => {
              const rowKeyChanged = record?.[GONAVI_ROW_KEY] !== prevRecord?.[GONAVI_ROW_KEY];
              if (rowKeyChanged) return true;
              return !isCellValueEqualForRender(record?.[key], prevRecord?.[key]);
          },
          onHeaderCell: (column: any) => ({
              id: key,
              width: column.width,
              className: 'gonavi-sortable-header-cell',
              onResizeStart: handleResizeStart(key), // Only need start
              onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
                  if (!onSort) return;
                  const headerCell = event.currentTarget as HTMLElement;
                  const upArrow = headerCell.querySelector('.ant-table-column-sorter-up') as HTMLElement | null;
                  const downArrow = headerCell.querySelector('.ant-table-column-sorter-down') as HTMLElement | null;
                  const isInArrow = [upArrow, downArrow].some((el) => {
                      if (!el) return false;
                      const rect = el.getBoundingClientRect();
                      return (
                          event.clientX >= rect.left &&
                          event.clientX <= rect.right &&
                          event.clientY >= rect.top &&
                          event.clientY <= rect.bottom
                      );
                  });
                  if (isInArrow) return;
                  // 仅允许点击上下箭头触发排序，点击字段名或表头其它区域不触发排序。
                  event.preventDefault();
                  event.stopPropagation();
              },
          }),
      }));
  }, [displayColumnNames, columnWidths, sortInfo, handleResizeStart, canModifyData, onSort, renderColumnTitle]);

  const mergedColumns = useMemo(() => columns.map((col): ColumnType<any> => {
      const dataIndex = String(col.dataIndex);
      // 即使不可编辑，也需要通过 onCell/render 绑定右键菜单
      return {
          ...col,
          onCell: (record: Item) => {
              const rowKey = record?.[GONAVI_ROW_KEY];
              const cellProps: any = {
                  'data-row-key': rowKey === undefined || rowKey === null ? undefined : String(rowKey),
                  'data-col-name': dataIndex,
              };
              // 数据预览面板：单击单元格时更新聚焦信息
              cellProps.onClick = () => {
                  if (dataPanelOpenRef.current) {
                      updateFocusedCell(record, dataIndex);
                  }
              };

              if (col.editable && enableInlineEditableCell) {
                  // 可编辑模式（非虚拟）：传递给 EditableCell 的 props
                  cellProps.record = record;
                  cellProps.editable = col.editable;
                  cellProps.dataIndex = col.dataIndex;
                  cellProps.title = dataIndex;
                  cellProps.handleSave = handleCellSave;
                  cellProps.focusCell = openCellEditor;
                  cellProps.columnType = (columnMetaMap[dataIndex] || columnMetaMapByLowerName[dataIndex.toLowerCase()])?.type;
              } else if (col.editable && !enableInlineEditableCell) {
                  // 可编辑但非 inline（虚拟模式下）：双击和右键通过 onCell 绑定
                  cellProps.onDoubleClick = () => handleVirtualCellActivate(record, dataIndex, dataIndex);
                  cellProps.onContextMenu = (e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      showCellContextMenu(e, record, dataIndex, dataIndex);
                  };
              } else {
                  // 不可编辑（只读查询结果）：只绑定右键菜单
                  cellProps.onContextMenu = (e: React.MouseEvent) => {
                      e.preventDefault();
                      e.stopPropagation();
                      showCellContextMenu(e, record, dataIndex, dataIndex);
                  };
              }
              return cellProps;
          },
          render: (text: any, record: Item, index: number) => {
              const originalRenderContent = col.render ? (col.render as any)(text, record, index) : text;
              if (enableVirtual && enableInlineEditableCell) {
                  return (
                      <EditableCell
                          title={dataIndex}
                          editable={!!col.editable}
                          dataIndex={dataIndex}
                          record={record}
                          handleSave={handleCellSave}
                          focusCell={openCellEditor}
                          columnType={(columnMetaMap[dataIndex] || columnMetaMapByLowerName[dataIndex.toLowerCase()])?.type}
                          as="div"
                          style={VIRTUAL_CELL_WRAPPER_STYLE}
                      >
                          {originalRenderContent}
                      </EditableCell>
                  );
              }
              if (enableVirtual) {
                  return (
                      <div
                          style={VIRTUAL_CELL_WRAPPER_STYLE}
                          onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              showCellContextMenu(e, record, dataIndex, dataIndex);
                          }}
                      >
                          {originalRenderContent}
                      </div>
                  );
              }
              return originalRenderContent;
          }
      };
  }), [columns, enableInlineEditableCell, enableVirtual, handleCellSave, openCellEditor, handleVirtualCellActivate, showCellContextMenu, columnMetaMap, columnMetaMapByLowerName]);

  const handleAddRow = () => {
      const newKey = `new-${Date.now()}`;
      const newRow: any = { [GONAVI_ROW_KEY]: newKey };
      columnNames.forEach(col => newRow[col] = ''); 
      pendingScrollToBottomRef.current = true;
      setAddedRows(prev => [...prev, newRow]);
  };
  const handleDeleteSelected = () => {
      setDeletedRowKeys(prev => {
          const newDeleted = new Set(prev);
          selectedRowKeys.forEach(key => newDeleted.add(rowKeyStr(key)));
          return newDeleted;
      });
      setSelectedRowKeys([]);
  };

  const handleCommit = async () => {
      if (!connectionId || !tableName) return;
      const conn = connections.find(c => c.id === connectionId);
      if (!conn) return;

      const inserts: any[] = [];
      const updates: any[] = [];
      const deletes: any[] = [];

      addedRows.forEach(row => {
          const { [GONAVI_ROW_KEY]: _rowKey, ...vals } = row;
          const normalizedValues: Record<string, any> = {};
          Object.entries(vals).forEach(([col, val]) => {
              const normalizedVal = normalizeCommitCellValue(col, val, 'insert');
              if (normalizedVal !== undefined) {
                  normalizedValues[col] = normalizedVal;
              }
          });
          inserts.push(normalizedValues);
      });
      deletedRowKeys.forEach(keyStr => {
          // Find original data
          const originalRow = data.find(d => rowKeyStr(d?.[GONAVI_ROW_KEY]) === keyStr) || addedRows.find(d => rowKeyStr(d?.[GONAVI_ROW_KEY]) === keyStr);
          if (originalRow) {
              const pkData: any = {};
              if (pkColumns.length > 0) pkColumns.forEach(k => pkData[k] = originalRow[k]);
              else { const { [GONAVI_ROW_KEY]: _rowKey, ...rest } = originalRow; Object.assign(pkData, rest); }
              deletes.push(pkData);
          }
      });
      Object.entries(modifiedRows).forEach(([keyStr, newRow]) => {
          if (deletedRowKeys.has(keyStr)) return;
          const originalRow = data.find(d => rowKeyStr(d?.[GONAVI_ROW_KEY]) === keyStr);
          if (!originalRow) return; // Should not happen for modified rows unless deleted
          
          const pkData: any = {};
          if (pkColumns.length > 0) pkColumns.forEach(k => pkData[k] = originalRow[k]);
          else { const { [GONAVI_ROW_KEY]: _rowKey, ...rest } = originalRow; Object.assign(pkData, rest); }

          const hasRowKey = Object.prototype.hasOwnProperty.call(newRow as any, GONAVI_ROW_KEY);
          let values: any = {};

          if (!hasRowKey) {
              values = { ...(newRow as any) };
          } else {
              columnNames.forEach((col) => {
                  const nextVal = (newRow as any)?.[col];
                  const prevVal = (originalRow as any)?.[col];
                  if (!isCellValueEqualForDiff(prevVal, nextVal)) values[col] = nextVal;
              });
          }

          const normalizedValues: Record<string, any> = {};
          Object.entries(values).forEach(([col, val]) => {
              const normalizedVal = normalizeCommitCellValue(col, val, 'update');
              if (normalizedVal !== undefined) {
                  normalizedValues[col] = normalizedVal;
              }
          });

          if (Object.keys(normalizedValues).length === 0) return;
          updates.push({ keys: pkData, values: normalizedValues });
      });

      if (inserts.length === 0 && updates.length === 0 && deletes.length === 0) {
          void message.info("No changes to commit");
          return;
      }

      const config = { 
          ...conn.config, 
          port: Number(conn.config.port), 
          password: conn.config.password || "", 
          database: conn.config.database || "", 
          useSSH: conn.config.useSSH || false, 
          ssh: conn.config.ssh || { host: "", port: 22, user: "", password: "", keyPath: "" } 
      };
      
      const startTime = Date.now();
      const res = await ApplyChanges(config as any, dbName || '', tableName, { inserts, updates, deletes } as any);
      const duration = Date.now() - startTime;
      
      // Construct a pseudo-SQL representation for the log
      let logSql = `/* Batch Apply on ${tableName} */\n`;
      if (inserts.length > 0) logSql += `INSERT ${inserts.length} rows;\n`;
      if (updates.length > 0) logSql += `UPDATE ${updates.length} rows;\n`;
      if (deletes.length > 0) logSql += `DELETE ${deletes.length} rows;\n`;
      
      if (res.success) {
          addSqlLog({
              id: Date.now().toString(),
              timestamp: Date.now(),
              sql: logSql.trim(),
              status: 'success',
              duration,
              message: res.message,
              dbName
          });
          void message.success("事务提交成功");
          setAddedRows([]);
          setModifiedRows({});
          setDeletedRowKeys(new Set());
          if (onReload) onReload();
      } else {
          addSqlLog({
              id: Date.now().toString(),
              timestamp: Date.now(),
              sql: logSql.trim(),
              status: 'error',
              duration,
              message: res.message,
              dbName
          });
          void message.error("提交失败: " + res.message);
      }
  };

  const copyToClipboard = useCallback((text: string) => {
      navigator.clipboard.writeText(text).catch(console.error);
      void message.success("Copied to clipboard");
  }, []);
  
  const getTargets = useCallback((clickedRecord: any) => {
      const selKeys = selectedRowKeysRef.current;
      const currentData = displayDataRef.current;
      const clickedKey = clickedRecord?.[GONAVI_ROW_KEY];
      if (clickedKey !== undefined && selKeys.includes(clickedKey)) {
          return currentData.filter(d => selKeys.includes(d?.[GONAVI_ROW_KEY]));
      }
      return [clickedRecord];
  }, []);

  const handleCopyInsert = useCallback((record: any) => {
      if (!supportsCopyInsert) {
          void message.warning("当前数据源不支持复制为 INSERT，请使用 JSON/CSV/Markdown 复制。");
          return;
      }
      const records = getTargets(record);
      // 使用 columnNames 保持表定义的字段顺序，而非 Object.keys() 的不确定顺序
      const orderedCols = columnNames.filter(c => c !== GONAVI_ROW_KEY);
      const sqlList = records.map((r: any) => {
          const values = orderedCols.map(c => {
              const v = r[c];
              if (v === null || v === undefined) return 'NULL';
              const str = typeof v === 'string' ? normalizeDateTimeString(v) : String(v);
              const escaped = str.replace(/'/g, "''");
              return `'${escaped}'`;
          });
          const targetTable = tableName || 'table';
          return `INSERT INTO \`${targetTable}\` (${orderedCols.map(c => `\`${c}\``).join(', ')}) VALUES (${values.join(', ')});`;
      });
      copyToClipboard(sqlList.join('\n'));  }, [supportsCopyInsert, tableName, columnNames, getTargets, copyToClipboard]);

  const handleCopyJson = useCallback((record: any) => {
      const records = getTargets(record);
      const cleanRecords = records.map((r: any) => {
          const { [GONAVI_ROW_KEY]: _rowKey, ...rest } = r;
          return rest;
      });
      copyToClipboard(JSON.stringify(cleanRecords, null, 2));
  }, [getTargets, copyToClipboard]);

  const handleCopyCsv = useCallback((record: any) => {
      const records = getTargets(record);
      // 使用 columnNames 保持表定义的字段顺序
      const orderedCols = columnNames.filter(c => c !== GONAVI_ROW_KEY);
      const header = orderedCols.map(c => `"${c}"`).join(',');
      const lines = records.map((r: any) => {
          const values = orderedCols.map(c => {
              const v = r[c];
              if (v === null || v === undefined) return 'NULL';
              // CSV 标准：值中的双引号转义为两个双引号
              const escaped = String(v).replace(/"/g, '""');
              return `"${escaped}"`;
          });
          return values.join(',');
      });
      copyToClipboard([header, ...lines].join('\n'));
  }, [getTargets, columnNames, copyToClipboard]);

  const buildConnConfig = useCallback(() => {
      if (!connectionId) return null;
      const conn = connections.find(c => c.id === connectionId);
      if (!conn) return null;
      return {
          ...conn.config,
          port: Number(conn.config.port),
          password: conn.config.password || "",
          database: conn.config.database || "",
          useSSH: conn.config.useSSH || false,
          ssh: conn.config.ssh || { host: "", port: 22, user: "", password: "", keyPath: "" }
      };
  }, [connections, connectionId]);

  const exportByQuery = useCallback(async (sql: string, format: string, defaultName: string) => {
      const config = buildConnConfig();
      if (!config) return;
      const hide = message.loading(`正在导出...`, 0);
      try {
          const res = await ExportQuery(config as any, dbName || '', sql, defaultName || 'export', format);
          if (res.success) {
              void message.success("导出成功");
          } else if (res.message !== "已取消") {
              void message.error("导出失败: " + res.message);
          }
      } catch (e: any) {
          void message.error("导出失败: " + (e?.message || String(e)));
      } finally {
          hide();
      }
  }, [buildConnConfig, dbName]);

  const buildPkWhereSql = useCallback((rows: any[], dbType: string) => {
      if (!tableName || pkColumns.length === 0) return '';
      const targets = (rows || []).filter(Boolean);
      if (targets.length === 0) return '';

      const clauses: string[] = [];
      for (const r of targets) {
          const andParts: string[] = [];
          for (const pk of pkColumns) {
              const col = quoteIdentPart(dbType, pk);
              const v = r?.[pk];
              if (v === null || v === undefined) return '';
              andParts.push(`${col} = '${escapeLiteral(String(v))}'`);
          }
          if (andParts.length === pkColumns.length) {
              clauses.push(`(${andParts.join(' AND ')})`);
          }
      }
      if (clauses.length === 0) return '';
      return clauses.join(' OR ');
  }, [pkColumns, tableName]);

      const buildCurrentPageSql = useCallback((dbType: string) => {
      if (!tableName || !pagination) return '';
      const whereSQL = buildWhereSQL(dbType, filterConditions);
      const baseSql = `SELECT * FROM ${quoteQualifiedIdent(dbType, tableName)} ${whereSQL}`;
      const orderBySQL = buildOrderBySQL(dbType, sortInfo, pkColumns);
      const normalizedType = String(dbType || '').trim().toLowerCase();
      const hasSortForBuffer = hasExplicitSort(sortInfo);
      const offset = (pagination.current - 1) * pagination.pageSize;
      let sql = buildPaginatedSelectSQL(dbType, baseSql, orderBySQL, pagination.pageSize, offset);
      if (hasSortForBuffer && (normalizedType === 'mysql' || normalizedType === 'mariadb')) {
          sql = withSortBufferTuningSQL(normalizedType, sql, 32 * 1024 * 1024);
      }
      return sql;
  }, [tableName, pagination, filterConditions, sortInfo, pkColumns]);

  // Context Menu Export
  const handleExportSelected = useCallback(async (format: string, record: any) => {
      const records = getTargets(record);
      if (isQueryResultExport) {
          await exportData(records, format);
          return;
      }
      if (!connectionId || !tableName) {
          await exportData(records, format);
          return;
      }

      // 有未提交修改时，优先按界面数据导出，避免与数据库不一致。
      if (hasChanges) {
          void message.warning("当前存在未提交修改，导出将按界面数据生成；如需完整长字段建议先提交后再导出。");
          await exportData(records, format);
          return;
      }

      const config = buildConnConfig();
      if (!config) {
          await exportData(records, format);
          return;
      }

      const dbType = config.type || '';
      const pkWhere = buildPkWhereSql(records, dbType);
      if (!pkWhere) {
          await exportData(records, format);
          return;
      }

      const sql = `SELECT * FROM ${quoteQualifiedIdent(dbType, tableName)} WHERE ${pkWhere}`;
      await exportByQuery(sql, format, tableName || 'export');
  }, [getTargets, isQueryResultExport, connectionId, tableName, hasChanges, exportData, buildConnConfig, buildPkWhereSql, exportByQuery]);

  // Export
  const handleExport = async (format: string) => {
      if (!connectionId) return;
      
      // 1. Export Selected
      if (selectedRowKeys.length > 0) {
          const selectedRows = displayData.filter(d => selectedRowKeys.includes(d?.[GONAVI_ROW_KEY]));
          await handleExportSelected(format, selectedRows[0]);
          return;
      }

      // 查询结果页导出统一按当前结果集（已加载数据）导出，避免再次执行原 SQL 造成大数据导出或长时间阻塞。
      if (isQueryResultExport) {
          const sql = String(resultSql || '').trim();
          if (!hasChanges && supportsSqlQueryExport && sql) {
              await exportByQuery(sql, format, tableName || 'query_result');
          } else {
              await exportData(mergedDisplayData, format);
          }
          return;
      }

      // 2. Prompt for Current vs All
      // Using a custom modal content with buttons to handle 3 states
      let instance: any;
      const handleAll = async () => {
          instance.destroy();
          if (!tableName) return;
          const config = buildConnConfig();
          if (!config) return;
          const hide = message.loading(`正在导出全部数据...`, 0);
          try {
              const res = await ExportTable(config as any, dbName || '', tableName, format);
              if (res.success) {
                  void message.success("导出成功");
              } else if (res.message !== "已取消") {
                  void message.error("导出失败: " + res.message);
              }
          } catch (e: any) {
              void message.error("导出失败: " + (e?.message || String(e)));
          } finally {
              hide();
          }
      };
      const handlePage = async () => {
          instance.destroy();
          if (hasChanges) {
              void message.warning("当前存在未提交修改，导出将按界面数据生成；如需完整长字段建议先提交后再导出。");
              await exportData(displayData, format);
              return;
          }

          const config = buildConnConfig();
          if (!config) {
              await exportData(displayData, format);
              return;
          }

          const sql = buildCurrentPageSql(config.type || '');
          if (!sql) {
              await exportData(displayData, format);
              return;
          }

          await exportByQuery(sql, format, tableName || 'export');
      };

      instance = modal.info({
          title: '导出选项',
          content: (
              <div>
                  <p>您未选中任何行，请选择导出范围：</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 16, justifyContent: 'flex-end' }}>
                      <Button onClick={() => instance.destroy()}>取消</Button>
                      <Button onClick={handlePage}>导出当前页 ({displayData.length}条)</Button>
                      <Button type="primary" onClick={handleAll}>导出全部数据</Button>
                  </div>
              </div>
          ),
          icon: <ExportOutlined />,
          okButtonProps: { style: { display: 'none' } }, // Hide default OK
          maskClosable: true,
      });
  };

  const handleExportFilteredAll = async (format: string) => {
      if (!connectionId || !tableName) return;
      if (!filteredExportSql) {
          void message.warning('当前未应用筛选条件');
          return;
      }
      if (!supportsSqlQueryExport) {
          void message.error('当前数据源不支持按筛选结果导出');
          return;
      }
      if (hasChanges) {
          void message.warning("当前存在未提交修改，筛选结果导出基于数据库已提交数据。");
      }

      await exportByQuery(filteredExportSql, format, `${tableName || 'export'}_filtered`);
  };

  const handleImport = async () => {
      if (!connectionId || !tableName) return;
      const config = buildConnConfig();
      if (!config) return;

      const res = await ImportData(config as any, dbName || '', tableName);
      if (res.success && res.data && res.data.filePath) {
          setImportFilePath(res.data.filePath);
          setImportPreviewVisible(true);
      } else if (res.message !== "已取消") {
          void message.error("选择文件失败: " + res.message);
      }
  };

  const handleImportSuccess = () => {
      setImportPreviewVisible(false);
      setImportFilePath('');
      void message.success('导入完成');
      if (onReload) onReload();
  };

  // Filters
  const filterOpOptions = useMemo(() => ([
      { value: '=', label: '=' },
      { value: '!=', label: '!=' },
      { value: '<', label: '<' },
      { value: '<=', label: '<=' },
      { value: '>', label: '>' },
      { value: '>=', label: '>=' },
      { value: 'CONTAINS', label: '包含' },
      { value: 'NOT_CONTAINS', label: '不包含' },
      { value: 'STARTS_WITH', label: '开始以' },
      { value: 'NOT_STARTS_WITH', label: '不是开始于' },
      { value: 'ENDS_WITH', label: '结束以' },
      { value: 'NOT_ENDS_WITH', label: '不是结束于' },
      { value: 'IS_NULL', label: '是 null' },
      { value: 'IS_NOT_NULL', label: '不是 null' },
      { value: 'IS_EMPTY', label: '是空的' },
      { value: 'IS_NOT_EMPTY', label: '不是空的' },
      { value: 'BETWEEN', label: '介于' },
      { value: 'NOT_BETWEEN', label: '不介于' },
      { value: 'IN', label: '在列表' },
      { value: 'NOT_IN', label: '不在列表' },
      { value: 'CUSTOM', label: '[自定义]' },
  ]), []);
  const filterLogicOptions = useMemo(() => ([
      { value: 'AND', label: '且 (AND)' },
      { value: 'OR', label: '或 (OR)' },
  ]), []);

  const isNoValueOp = useCallback((op: string) => (
      op === 'IS_NULL' || op === 'IS_NOT_NULL' || op === 'IS_EMPTY' || op === 'IS_NOT_EMPTY'
  ), []);
  const isBetweenOp = useCallback((op: string) => op === 'BETWEEN' || op === 'NOT_BETWEEN', []);
  const isListOp = useCallback((op: string) => op === 'IN' || op === 'NOT_IN', []);

  const addFilter = () => {
      setFilterConditions([
          ...filterConditions,
          {
              id: nextFilterId,
              enabled: true,
              logic: 'AND',
              column: displayColumnNames[0] || '',
              op: '=',
              value: '',
              value2: '',
          }
      ]);
      setNextFilterId(nextFilterId + 1);
  };
  const updateFilter = (id: number, field: keyof GridFilterCondition, val: string | boolean) => {
      setFilterConditions(prev => prev.map(c => {
          if (c.id !== id) return c;
          const next: GridFilterCondition = { ...c, [field]: val } as GridFilterCondition;
          if (field === 'op') {
              const nextOp = String(val);
              if (isNoValueOp(nextOp)) {
                  next.value = '';
                  next.value2 = '';
              } else if (isBetweenOp(nextOp)) {
                  if (typeof next.value2 !== 'string') next.value2 = '';
              } else {
                  next.value2 = '';
              }
          }
          return next;
      }));
  };
  const removeFilter = (id: number) => {
      setFilterConditions(prev => prev.filter(c => c.id !== id));
  };
  const applyFilters = () => {
      if (onApplyFilter) onApplyFilter(filterConditions);
  };

  const exportMenu: MenuProps['items'] = hasFilteredExportSql ? [
      { type: 'group', label: '筛选结果', children: [
          { key: 'filtered-csv', label: 'CSV', onClick: () => handleExportFilteredAll('csv') },
          { key: 'filtered-xlsx', label: 'Excel (XLSX)', onClick: () => handleExportFilteredAll('xlsx') },
          { key: 'filtered-json', label: 'JSON', onClick: () => handleExportFilteredAll('json') },
          { key: 'filtered-md', label: 'Markdown', onClick: () => handleExportFilteredAll('md') },
          { key: 'filtered-html', label: 'HTML', onClick: () => handleExportFilteredAll('html') },
      ]},
      { type: 'divider' },
      { type: 'group', label: '全表', children: [
          { key: 'table-csv', label: 'CSV', onClick: () => handleExport('csv') },
          { key: 'table-xlsx', label: 'Excel (XLSX)', onClick: () => handleExport('xlsx') },
          { key: 'table-json', label: 'JSON', onClick: () => handleExport('json') },
          { key: 'table-md', label: 'Markdown', onClick: () => handleExport('md') },
          { key: 'table-html', label: 'HTML', onClick: () => handleExport('html') },
      ]},
  ] : [
      { key: 'csv', label: 'CSV', onClick: () => handleExport('csv') },
      { key: 'xlsx', label: 'Excel (XLSX)', onClick: () => handleExport('xlsx') },
      { key: 'json', label: 'JSON', onClick: () => handleExport('json') },
      { key: 'md', label: 'Markdown', onClick: () => handleExport('md') },
      { key: 'html', label: 'HTML', onClick: () => handleExport('html') },
  ];

  const columnInfoSettingContent = (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 200, maxWidth: 300 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: darkMode ? '#ddd' : '#666' }}>显示设置</div>
          <Checkbox
              checked={showColumnComment}
              onChange={(e) => setQueryOptions({ showColumnComment: e.target.checked })}
          >
              表头显示备注
          </Checkbox>
          <Checkbox
              checked={showColumnType}
              onChange={(e) => setQueryOptions({ showColumnType: e.target.checked })}
          >
              表头显示类型
          </Checkbox>
          <div style={{ height: 1, backgroundColor: darkMode ? '#424242' : '#f0f0f0', margin: '4px 0' }} />
          
          <div style={{ fontWeight: 600, fontSize: 13, color: darkMode ? '#ddd' : '#666', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>列可见性</span>
              <div style={{ display: 'flex', gap: 8 }}>
                  <a style={{ fontSize: 12 }} onClick={() => toggleAllColumnsVisibility(true)}>全显</a>
                  <a style={{ fontSize: 12 }} onClick={() => toggleAllColumnsVisibility(false)}>全隐</a>
              </div>
          </div>
          <Input 
              placeholder="搜索列名..." 
              size="small" 
              value={columnSearchText}
              onChange={e => setColumnSearchText(e.target.value)}
              allowClear
          />
          <div className="custom-scrollbar" style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
              {allOrderedColumnNames.filter(col => !columnSearchText || col.toLowerCase().includes(columnSearchText.toLowerCase())).map(col => (
                  <Checkbox
                      key={col}
                      checked={!localHiddenColumns.includes(col)}
                      onChange={(e) => toggleColumnVisibility(col, e.target.checked)}
                      style={{ marginLeft: 0 }}
                  >
                      {col}
                  </Checkbox>
              ))}
          </div>

          <div style={{ height: 1, backgroundColor: darkMode ? '#424242' : '#f0f0f0', margin: '4px 0' }} />
          <Checkbox
              checked={enableColumnOrderMemory}
              onChange={(e) => setEnableColumnOrderMemory(e.target.checked)}
          >
              记忆自定义列序
          </Checkbox>
          <Checkbox
              checked={enableHiddenColumnMemory}
              onChange={(e) => setEnableHiddenColumnMemory(e.target.checked)}
          >
              记忆隐藏列配置
          </Checkbox>
          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <Button
                  size="small"
                  danger
                  style={{ flex: 1 }}
                  disabled={!connectionId || !dbName || !tableName || !tableColumnOrders[`${connectionId}-${dbName}-${tableName}`]}
                  onClick={() => {
                      if (connectionId && dbName && tableName) {
                          clearTableColumnOrder(connectionId, dbName, tableName);
                          void message.success('已恢复默认列排序');
                      }
                  }}
              >
                  重置排序
              </Button>
              <Button
                  size="small"
                  danger
                  style={{ flex: 1 }}
                  disabled={!connectionId || !dbName || !tableName || !tableHiddenColumns[`${connectionId}-${dbName}-${tableName}`]}
                  onClick={() => {
                      if (connectionId && dbName && tableName) {
                          clearTableHiddenColumns(connectionId, dbName, tableName);
                          setLocalHiddenColumns([]);
                          void message.success('已恢复全列显示');
                      }
                  }}
              >
                  重置隐藏
              </Button>
          </div>
      </div>
  );

  const dataContextValue = useMemo(() => ({
      selectedRowKeysRef,
      displayDataRef,
      handleCopyInsert,
      handleCopyJson,
      handleCopyCsv,
      handleExportSelected,
      copyToClipboard,
      tableName,
      enableRowContextMenu: false,
      supportsCopyInsert,
  }), [handleCopyCsv, handleCopyInsert, handleCopyJson, handleExportSelected, copyToClipboard, tableName, canModifyData, supportsCopyInsert]);

  const cellContextMenuValue = useMemo(() => ({
      showMenu: showCellContextMenu,
      handleBatchFillToSelected,
  }), [showCellContextMenu, handleBatchFillToSelected]);

  const rowSelectionConfig = useMemo(() => ({
      selectedRowKeys,
      onChange: setSelectedRowKeys,
      columnWidth: selectionColumnWidth,
  }), [selectedRowKeys, selectionColumnWidth]);

  const rowPropsFactory = useCallback((record: any) => ({ record } as any), []);

  const totalWidth = columns.reduce((sum: number, col: any) => sum + (Number(col.width) || 200), 0) + selectionColumnWidth;
  const useContextMenuRow = false;
  const tableScrollX = useMemo(() => {
      // rc-table 在 scroll.x 小于容器宽度时会把实际列宽按视口补齐。
      // 这里必须与其使用同一套 scroll.x 口径，否则少字段场景下 header/body 会错位。
      return calculateVirtualTableScrollX({
          totalWidth,
          tableViewportWidth,
          isMacLike,
      });
  }, [totalWidth, isMacLike, tableViewportWidth]);
  const horizontalScrollVisible = viewMode === 'table' && tableScrollX > tableViewportWidth + 1;
  const horizontalScrollWidth = Math.max(externalScrollbarMinWidth, tableScrollX);
  const tableScrollConfig = useMemo(() => ({ x: tableScrollX, y: tableHeight }), [tableScrollX, tableHeight]);
  const tableComponents = useMemo(() => {
      const body: Record<string, any> = {};
      if (enableInlineEditableCell) {
          body.cell = EditableCell;
      }
      if (useContextMenuRow) {
          body.row = ContextMenuRow;
      }
      return Object.keys(body).length > 0
          ? { body, header: { cell: SortableHeaderCell } }
          : { header: { cell: SortableHeaderCell } };
  }, [enableInlineEditableCell, useContextMenuRow]);
  const tableOnRow = useMemo(() => (useContextMenuRow ? rowPropsFactory : undefined), [useContextMenuRow, rowPropsFactory]);

  const resolveVirtualHorizontalElements = useCallback((tableContainer: HTMLElement) => {
      const holderEl = tableContainer.querySelector('.ant-table-tbody-virtual-holder') as HTMLElement | null;
      const innerEl = holderEl?.querySelector('.ant-table-tbody-virtual-holder-inner') as HTMLElement | null;
      const headerEl = tableContainer.querySelector('.ant-table-header') as HTMLElement | null;
      return { holderEl, innerEl, headerEl };
  }, []);

  const readVirtualHorizontalOffset = useCallback((tableContainer: HTMLElement): number => {
      const { innerEl, headerEl } = resolveVirtualHorizontalElements(tableContainer);
      const marginLeft = innerEl ? Math.abs(parseFloat(innerEl.style.marginLeft) || 0) : 0;
      const headerLeft = headerEl ? Math.max(0, headerEl.scrollLeft) : 0;
      return Math.max(marginLeft, headerLeft);
  }, [resolveVirtualHorizontalElements]);

  const applyVirtualHorizontalOffset = useCallback((tableContainer: HTMLElement, nextOffset: number) => {
      const { holderEl, innerEl } = resolveVirtualHorizontalElements(tableContainer);
      if (!(holderEl instanceof HTMLElement) || !(innerEl instanceof HTMLElement)) {
          return false;
      }

      const maxScroll = Math.max(0, tableScrollX - holderEl.clientWidth);
      const clampedOffset = Math.max(0, Math.min(maxScroll, nextOffset));
      const currentOffset = Math.abs(parseFloat(innerEl.style.marginLeft) || 0);
      const deltaX = clampedOffset - currentOffset;
      if (Math.abs(deltaX) < 0.5) return true;

      // 通过合成 WheelEvent 驱动 rc-virtual-list 内部 offsetLeft state，
      // 让 rc-table onInternalScroll 自动同步 header scrollLeft。
      // 不直接操作 DOM marginLeft，避免 React re-render 覆盖。

      holderEl.dispatchEvent(new WheelEvent('wheel', {
          deltaX: deltaX,
          deltaY: 0,
          bubbles: true,
          cancelable: true,
      }));
      return true;
  }, [resolveVirtualHorizontalElements, tableScrollX]);

  const pickHorizontalScrollTargets = useCallback((tableContainer: HTMLElement): HTMLElement[] => {
      const virtualBody = tableContainer.querySelector('.ant-table-tbody-virtual-holder');
      const body = tableContainer.querySelector('.ant-table-body');
      const content = tableContainer.querySelector('.ant-table-content');
      const virtualHolder = tableContainer.querySelector('.rc-virtual-list-holder');
      const candidates = [virtualBody, virtualHolder, body, content].filter((node): node is HTMLElement => node instanceof HTMLElement);
      if (candidates.length === 0) {
          return [];
      }
      const active = candidates.find((target) => target.scrollWidth > target.clientWidth + 1) || candidates[0];
      return active ? [active] : [];
  }, []);

  const pickVerticalScrollTarget = useCallback((tableContainer: HTMLElement): HTMLElement | null => {
      const virtualHolder = tableContainer.querySelector('.ant-table-tbody-virtual-holder') as HTMLElement | null;
      const rcVirtualHolder = tableContainer.querySelector('.rc-virtual-list-holder') as HTMLElement | null;
      const body = tableContainer.querySelector('.ant-table-body') as HTMLElement | null;
      return virtualHolder || rcVirtualHolder || body;
  }, []);

  const syncExternalScrollFromTargets = useCallback((targets?: HTMLElement[], source?: HTMLElement | null) => {
      const externalScroll = externalHorizontalScrollRef.current;
      if (!(externalScroll instanceof HTMLDivElement) || horizontalSyncSourceRef.current === 'external') {
          return;
      }
      const tableContainer = tableContainerRef.current;
      if (enableVirtual && tableContainer instanceof HTMLElement) {
          const nextScrollLeft = readVirtualHorizontalOffset(tableContainer);
          if (Math.abs(lastTableScrollLeftRef.current - nextScrollLeft) < 1 && Math.abs(externalScroll.scrollLeft - nextScrollLeft) < 1) {
              return;
          }
          lastTableScrollLeftRef.current = nextScrollLeft;
          if (Math.abs(externalScroll.scrollLeft - nextScrollLeft) > 1) {
              externalScroll.scrollLeft = nextScrollLeft;
              lastExternalScrollLeftRef.current = nextScrollLeft;
          }
          return;
      }
      const nextTargets = targets && targets.length > 0 ? targets : tableScrollTargetsRef.current;
      if (!nextTargets || nextTargets.length === 0) {
          return;
      }
      const activeTarget = source || nextTargets.find((target) => target.scrollWidth > target.clientWidth + 1) || nextTargets[0];
      if (!(activeTarget instanceof HTMLElement)) {
          return;
      }
      const nextScrollLeft = activeTarget.scrollLeft;
      if (Math.abs(lastTableScrollLeftRef.current - nextScrollLeft) < 1 && Math.abs(externalScroll.scrollLeft - nextScrollLeft) < 1) {
          return;
      }
      lastTableScrollLeftRef.current = nextScrollLeft;
      if (Math.abs(externalScroll.scrollLeft - nextScrollLeft) > 1) {
          externalScroll.scrollLeft = nextScrollLeft;
          lastExternalScrollLeftRef.current = nextScrollLeft;
      }
  }, [enableVirtual, readVirtualHorizontalOffset]);

  const applyExternalScrollToTableTargets = useCallback(() => {
      const externalScroll = externalHorizontalScrollRef.current;
      if (!(externalScroll instanceof HTMLDivElement)) {
          return;
      }
      if (horizontalSyncSourceRef.current === 'table') {
          return;
      }

      if (Math.abs(lastExternalScrollLeftRef.current - externalScroll.scrollLeft) < 1) {
          return;
      }
      lastExternalScrollLeftRef.current = externalScroll.scrollLeft;

      horizontalSyncSourceRef.current = 'external';
      const tableContainer = tableContainerRef.current;
      // 虚拟表格路径：通过合成 WheelEvent 驱动 rc-virtual-list 内部状态，
      // rc-table 自动同步 header scrollLeft。
      if (enableVirtual && tableContainer instanceof HTMLElement) {
          const applied = applyVirtualHorizontalOffset(tableContainer, externalScroll.scrollLeft);
          if (applied) {
              // WheelEvent 经 rc-virtual-list 处理后状态异步更新，延迟同步 ref
              requestAnimationFrame(() => {
                  lastTableScrollLeftRef.current = readVirtualHorizontalOffset(tableContainer);
                  horizontalSyncSourceRef.current = '';
              });
              return;
          }
          // 空数据回退：virtual-holder 不存在时，直接滚动表头
          const headerEl = tableContainer.querySelector('.ant-table-header') as HTMLElement | null;
          const contentEl = tableContainer.querySelector('.ant-table-content') as HTMLElement | null;
          const fallbackTargets = [headerEl, contentEl].filter((el): el is HTMLElement => el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1);
          if (fallbackTargets.length > 0) {
              fallbackTargets.forEach((target) => {
                  target.scrollLeft = externalScroll.scrollLeft;
              });
              lastTableScrollLeftRef.current = externalScroll.scrollLeft;
              horizontalSyncSourceRef.current = '';
              return;
          }
          horizontalSyncSourceRef.current = '';
          return;
      }
      // 非虚拟表格路径：依赖 liveTargets 进行 scrollLeft 同步
      const liveTargets = tableScrollTargetsRef.current;
      if (liveTargets.length === 0) {
          horizontalSyncSourceRef.current = '';
          return;
      }
      liveTargets.forEach((target) => {
          if (target.scrollWidth <= target.clientWidth + 1) {
              return;
          }
          if (Math.abs(target.scrollLeft - externalScroll.scrollLeft) > 1) {
              target.scrollLeft = externalScroll.scrollLeft;
          }
      });
      lastTableScrollLeftRef.current = externalScroll.scrollLeft;
      horizontalSyncSourceRef.current = '';
  }, [applyVirtualHorizontalOffset, enableVirtual, readVirtualHorizontalOffset]);

  // 外部水平滚动条的 wheel 处理（通过原生事件绑定，确保 preventDefault 生效）
  useEffect(() => {
      const externalScroll = externalHorizontalScrollRef.current;
      if (!externalScroll || !horizontalScrollVisible) return;

      const handleExternalWheel = (e: WheelEvent) => {
          // 鼠标在水平滚动条区域时，始终阻止垂直滚动冒泡
          e.preventDefault();
          e.stopPropagation();

          const dominantDelta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
          if (!Number.isFinite(dominantDelta) || Math.abs(dominantDelta) < 0.5) return;

          const maxScrollLeft = Math.max(0, externalScroll.scrollWidth - externalScroll.clientWidth);
          if (maxScrollLeft <= 0) return;

          externalScroll.scrollLeft = Math.max(0, Math.min(maxScrollLeft, externalScroll.scrollLeft + dominantDelta));
      };

      externalScroll.addEventListener('wheel', handleExternalWheel, { passive: false, capture: true });
      return () => {
          externalScroll.removeEventListener('wheel', handleExternalWheel, { capture: true } as EventListenerOptions);
      };
  }, [horizontalScrollVisible]);

  // 支持在数据区直接使用触摸板/Shift+滚轮进行横向滚动。
  // 虚拟表格与普通表格统一走外部横向滚动条，避免内部轨道覆盖最后一行。
  useEffect(() => {
      if (viewMode !== 'table') return;
      const container = tableContainerRef.current;
      if (!(container instanceof HTMLElement)) return;

      const resolveHorizontalDelta = (event: WheelEvent) => {
          if (Math.abs(event.deltaX) > 0.5) {
              return event.deltaX;
          }
          if (event.shiftKey && Math.abs(event.deltaY) > 0.5) {
              return event.deltaY;
          }
          return 0;
      };

      const isTableDataAreaTarget = (target: EventTarget | null) => {
          const element = target instanceof HTMLElement ? target : null;
          if (!element) return false;
          // 排除外部滚动条与工具栏，其余容器内元素一律视为数据区域
          if (element.closest('.data-grid-external-horizontal-scroll')) return false;
          if (element.closest('.data-grid-toolbar')) return false;
          return true;
      };

      const handleContainerHorizontalWheel = (event: WheelEvent) => {
          // applyVirtualHorizontalOffset 分发的合成 WheelEvent（isTrusted=false）
          // 需要传播到 rc-virtual-list 的内部 handler，此处不拦截。
          if (!event.isTrusted) return;

          const horizontalDelta = resolveHorizontalDelta(event);
          if (!Number.isFinite(horizontalDelta) || Math.abs(horizontalDelta) < 0.5) return;
          if (!isTableDataAreaTarget(event.target)) return;

          if (enableVirtual) {
              event.preventDefault();
              event.stopPropagation();
              horizontalSyncSourceRef.current = 'table';

              // 空数据回退：virtual-holder 不存在时，手动滚动表头
              const virtualHolder = container.querySelector('.ant-table-tbody-virtual-holder') as HTMLElement | null;
              if (!virtualHolder) {
                  const headerEl = container.querySelector('.ant-table-header') as HTMLElement | null;
                  const contentEl = container.querySelector('.ant-table-content') as HTMLElement | null;
                  const fallbackTargets = [headerEl, contentEl].filter((el): el is HTMLElement => el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1);
                  if (fallbackTargets.length > 0) {
                      fallbackTargets.forEach((target) => {
                          const max = Math.max(0, target.scrollWidth - target.clientWidth);
                          target.scrollLeft = Math.max(0, Math.min(max, target.scrollLeft + horizontalDelta));
                      });
                      lastTableScrollLeftRef.current = (fallbackTargets[0]).scrollLeft;
                      const externalScroll = externalHorizontalScrollRef.current;
                      if (externalScroll && Math.abs(externalScroll.scrollLeft - lastTableScrollLeftRef.current) > 1) {
                          externalScroll.scrollLeft = lastTableScrollLeftRef.current;
                          lastExternalScrollLeftRef.current = lastTableScrollLeftRef.current;
                      }
                  }
                  horizontalSyncSourceRef.current = '';
                  return;
              }

              // 有数据：通过 applyVirtualHorizontalOffset 合成 WheelEvent 驱动 rc-virtual-list
              const currentOffset = readVirtualHorizontalOffset(container);
              applyVirtualHorizontalOffset(container, currentOffset + horizontalDelta);
              requestAnimationFrame(() => {
                  const nextScrollLeft = readVirtualHorizontalOffset(container);
                  lastTableScrollLeftRef.current = nextScrollLeft;
                  const externalScroll = externalHorizontalScrollRef.current;
                  if (externalScroll && Math.abs(externalScroll.scrollLeft - nextScrollLeft) > 1) {
                      externalScroll.scrollLeft = nextScrollLeft;
                      lastExternalScrollLeftRef.current = nextScrollLeft;
                  }
                  horizontalSyncSourceRef.current = '';
              });
              return;
          }

          // 非虚拟模式：拦截事件并手动同步
          const targets = pickHorizontalScrollTargets(container);
          event.preventDefault();
          event.stopPropagation();

          horizontalSyncSourceRef.current = 'table';
          const activeTarget = targets.find((target) => target.scrollWidth > target.clientWidth + 1) || targets[0];
          if (!(activeTarget instanceof HTMLElement)) {
              horizontalSyncSourceRef.current = '';
              return;
          }
          const maxScrollLeft = Math.max(0, activeTarget.scrollWidth - activeTarget.clientWidth);
          if (maxScrollLeft <= 0) {
              horizontalSyncSourceRef.current = '';
              return;
          }
          const nextScrollLeft = Math.max(0, Math.min(maxScrollLeft, activeTarget.scrollLeft + horizontalDelta));
          if (Math.abs(nextScrollLeft - activeTarget.scrollLeft) < 1) {
              horizontalSyncSourceRef.current = '';
              return;
          }
          activeTarget.scrollLeft = nextScrollLeft;
          lastTableScrollLeftRef.current = nextScrollLeft;

          const externalScroll = externalHorizontalScrollRef.current;
          if (externalScroll && Math.abs(externalScroll.scrollLeft - nextScrollLeft) > 1) {
              externalScroll.scrollLeft = nextScrollLeft;
              lastExternalScrollLeftRef.current = nextScrollLeft;
          }
          horizontalSyncSourceRef.current = '';
      };

      container.addEventListener('wheel', handleContainerHorizontalWheel, { passive: false, capture: true });
      return () => {
          container.removeEventListener('wheel', handleContainerHorizontalWheel, { capture: true } as EventListenerOptions);
      };
  }, [applyVirtualHorizontalOffset, enableVirtual, pickHorizontalScrollTargets, readVirtualHorizontalOffset, viewMode]);

  useEffect(() => {
      if (viewMode !== 'table') return;
      const rafId = requestAnimationFrame(() => recalculateTableMetrics(containerRef.current));
      return () => cancelAnimationFrame(rafId);
  }, [viewMode, totalWidth, mergedDisplayData.length, pagination?.total, pagination?.pageSize, recalculateTableMetrics]);

  // 虚拟表列对齐：antd 虚拟表 body 使用 <div>+<td>（非 <table>），
  // 不会自动拉伸列宽到视口。而 header <table> 会被 antd 的 CSS 或 JS
  // 设置为 width:100% 自动拉伸。强制 header table 宽度等于 scroll.x，
  // 使 header 列宽与 body 单元格宽度精确一致。
  useEffect(() => {
      if (viewMode !== 'table') return;
      const container = tableContainerRef.current;
      if (!container) return;
      const syncHeaderWidth = () => {
          const headerTable = container.querySelector('.ant-table-header > table') as HTMLElement;
          if (headerTable) {
              headerTable.style.setProperty('width', `${tableScrollX}px`, 'important');
              headerTable.style.setProperty('min-width', '0px', 'important');
              headerTable.style.setProperty('max-width', `${tableScrollX}px`, 'important');
          }
      };
      syncHeaderWidth();
      const rafId = requestAnimationFrame(syncHeaderWidth);
      // 监听 antd 可能的重渲染覆盖
      const observer = new MutationObserver(syncHeaderWidth);
      const headerEl = container.querySelector('.ant-table-header');
      if (headerEl) observer.observe(headerEl, { attributes: true, childList: true, subtree: true, attributeFilter: ['style'] });
      return () => { cancelAnimationFrame(rafId); observer.disconnect(); };
  }, [viewMode, tableScrollX, mergedDisplayData.length]);

  useEffect(() => {
      if (viewMode !== 'table' || !onScrollSnapshotChange) return;
      const tableContainer = tableContainerRef.current;
      if (!(tableContainer instanceof HTMLElement)) return;

      let rafId: number | null = null;
      let boundVerticalTarget: HTMLElement | null = null;
      let boundHorizontalTargets: HTMLElement[] = [];
      const externalScroll = externalHorizontalScrollRef.current;
      const hasStoredScroll = !!scrollSnapshot && (Math.abs(scrollSnapshot.top) > 0.5 || Math.abs(scrollSnapshot.left) > 0.5);

      const emitSnapshot = () => {
          if (!didRestoreScrollRef.current && hasStoredScroll) {
              return;
          }
          const verticalTarget = boundVerticalTarget || pickVerticalScrollTarget(tableContainer);
          const horizontalTargets = boundHorizontalTargets.length > 0 ? boundHorizontalTargets : pickHorizontalScrollTargets(tableContainer);
          const top = verticalTarget ? verticalTarget.scrollTop : 0;
          const left = horizontalTargets[0]?.scrollLeft ?? externalScroll?.scrollLeft ?? 0;
          if (Math.abs(lastReportedScrollRef.current.top - top) < 1 && Math.abs(lastReportedScrollRef.current.left - left) < 1) {
              return;
          }
          lastReportedScrollRef.current = { top, left };
          onScrollSnapshotChange({ top, left });
      };

      const bindTargets = () => {
          if (boundVerticalTarget) {
              boundVerticalTarget.removeEventListener('scroll', emitSnapshot);
          }
          boundHorizontalTargets.forEach(target => target.removeEventListener('scroll', emitSnapshot));
          externalScroll?.removeEventListener('scroll', emitSnapshot);

          boundVerticalTarget = pickVerticalScrollTarget(tableContainer);
          boundHorizontalTargets = pickHorizontalScrollTargets(tableContainer);

          boundVerticalTarget?.addEventListener('scroll', emitSnapshot, { passive: true });
          boundHorizontalTargets.forEach(target => target.addEventListener('scroll', emitSnapshot, { passive: true }));
          externalScroll?.addEventListener('scroll', emitSnapshot, { passive: true });
          emitSnapshot();
      };

      rafId = requestAnimationFrame(bindTargets);
      return () => {
          if (rafId !== null) cancelAnimationFrame(rafId);
          if (boundVerticalTarget) {
              boundVerticalTarget.removeEventListener('scroll', emitSnapshot);
          }
          boundHorizontalTargets.forEach(target => target.removeEventListener('scroll', emitSnapshot));
          externalScroll?.removeEventListener('scroll', emitSnapshot);
      };
  }, [viewMode, mergedDisplayData.length, onScrollSnapshotChange, pickHorizontalScrollTargets, pickVerticalScrollTarget, scrollSnapshot]);

  useEffect(() => {
      if (viewMode !== 'table') return;
      if (!scrollSnapshot) return;
      if (didRestoreScrollRef.current) return;
      const tableContainer = tableContainerRef.current;
      if (!(tableContainer instanceof HTMLElement)) return;
      if (mergedDisplayData.length === 0) return;

      let rafId = requestAnimationFrame(() => {
          const verticalTarget = pickVerticalScrollTarget(tableContainer);
          const horizontalTargets = pickHorizontalScrollTargets(tableContainer);
          const nextTop = Math.max(0, scrollSnapshot.top);
          const nextLeft = Math.max(0, scrollSnapshot.left);
          if (verticalTarget && Math.abs(verticalTarget.scrollTop - scrollSnapshot.top) > 1) {
              verticalTarget.scrollTop = nextTop;
          }
          if (Math.abs(nextLeft) > 0.5) {
              horizontalTargets.forEach(target => {
                  if (Math.abs(target.scrollLeft - nextLeft) > 1) {
                      target.scrollLeft = nextLeft;
                  }
              });
              const externalScroll = externalHorizontalScrollRef.current;
              if (externalScroll && Math.abs(externalScroll.scrollLeft - nextLeft) > 1) {
                  externalScroll.scrollLeft = nextLeft;
              }
              lastTableScrollLeftRef.current = nextLeft;
              lastExternalScrollLeftRef.current = nextLeft;
          }
          lastReportedScrollRef.current = { top: nextTop, left: nextLeft };
          didRestoreScrollRef.current = true;
          onScrollSnapshotChange?.({ top: nextTop, left: nextLeft });
      });

      return () => cancelAnimationFrame(rafId);
  }, [viewMode, mergedDisplayData.length, scrollSnapshot, pickHorizontalScrollTargets, pickVerticalScrollTarget, onScrollSnapshotChange]);

  useEffect(() => {
      if (viewMode !== 'table') return;
      const tableContainer = tableContainerRef.current;
      const externalScroll = externalHorizontalScrollRef.current;
      if (!(tableContainer instanceof HTMLElement) || !(externalScroll instanceof HTMLDivElement)) return;

      let rafId: number | null = null;
      let boundTargets: HTMLElement[] = [];

      const handleTargetScroll = (event: Event) => {
          const source = event.target as HTMLElement | null;
          if (horizontalSyncSourceRef.current === 'external') return;
          horizontalSyncSourceRef.current = 'table';
          syncExternalScrollFromTargets(undefined, source);
          horizontalSyncSourceRef.current = '';
      };

      const bindCurrentTableTargets = () => {
          // Unbind previous targets
          boundTargets.forEach(t => t.removeEventListener('scroll', handleTargetScroll));
          const nextTargets = pickHorizontalScrollTargets(tableContainer);
          tableScrollTargetsRef.current = nextTargets;
          boundTargets = nextTargets;
          // Bind scroll listener on new targets
          nextTargets.forEach(t => t.addEventListener('scroll', handleTargetScroll, { passive: true }));
          syncExternalScrollFromTargets(nextTargets);
      };

      const scheduleBind = () => {
          if (rafId !== null) {
              cancelAnimationFrame(rafId);
          }
          rafId = requestAnimationFrame(() => {
              bindCurrentTableTargets();
          });
      };

      window.addEventListener('resize', scheduleBind);
      scheduleBind();

      return () => {
          window.removeEventListener('resize', scheduleBind);
          boundTargets.forEach(t => t.removeEventListener('scroll', handleTargetScroll));
          tableScrollTargetsRef.current = [];
          if (rafId !== null) {
              cancelAnimationFrame(rafId);
          }
      };
  }, [viewMode, tableScrollX, mergedDisplayData.length, syncExternalScrollFromTargets, pickHorizontalScrollTargets]);

  const paginationSummaryText = useMemo(() => {
      if (!pagination) return '';
      return resolvePaginationSummaryText({
          pagination,
          prefersManualTotalCount,
          supportsApproximateTableCount,
      });
  }, [pagination, prefersManualTotalCount, supportsApproximateTableCount]);

  const paginationPageText = useMemo(() => {
      if (!pagination) return '';
      return resolvePaginationPageText({
          pagination,
          supportsApproximateTotalPages,
      });
  }, [pagination, supportsApproximateTotalPages]);

  const handlePageSizeChange = useCallback((value: string) => {
      if (!pagination || !onPageChange) return;
      const nextSize = Number(value);
      if (!Number.isFinite(nextSize) || nextSize <= 0) return;
      const firstRowIndex = Math.max(0, (pagination.current - 1) * pagination.pageSize);
      const nextPage = Math.floor(firstRowIndex / nextSize) + 1;
      onPageChange(nextPage, nextSize);
  }, [pagination, onPageChange]);

  return (
    <div className={`${gridId}${cellEditMode ? ' cell-edit-mode' : ''} data-grid-root`} style={{ flex: '1 1 auto', height: '100%', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column', minHeight: 0, minWidth: 0, background: 'transparent' }}>
		       {/* Toolbar + Filter Panel */}
           <div style={{ margin: `${panelOuterGap}px 0 ${panelOuterGap}px 0`, border: `1px solid ${panelFrameColor}`, borderRadius: `${panelRadius}px`, background: bgFilter, overflow: 'hidden', boxSizing: 'border-box' }}>
		        <div className="data-grid-toolbar-scroll" style={{ padding: showFilter ? `${panelPaddingY}px ${panelPaddingX}px ${toolbarBottomPadding}px ${panelPaddingX}px` : `${panelPaddingY}px ${panelPaddingX}px`, border: 'none', borderRadius: 0, background: 'transparent', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'nowrap', minWidth: 0, overflowX: 'auto', overflowY: 'hidden', scrollbarGutter: 'stable', WebkitOverflowScrolling: 'touch', boxSizing: 'border-box' }}>
	            {onReload && <Button icon={<ReloadOutlined />} disabled={loading} onClick={() => {
	                setAddedRows([]);
	                setModifiedRows({});
	               setDeletedRowKeys(new Set());
	               setSelectedRowKeys([]);
	               onReload();
	           }}>刷新</Button>}

	           {onToggleFilter && (
	               <>
	                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
	                   <Button icon={<FilterOutlined />} type={showFilter ? 'primary' : 'default'} onClick={() => { 
	                       onToggleFilter(); 
	                       if (filterConditions.length === 0 && !showFilter) addFilter(); 
	                   }}>筛选</Button>
	               </>
	           )}
	           
	           {canModifyData && (
	               <>
	                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
	                   <Button icon={<PlusOutlined />} onClick={handleAddRow}>添加行</Button>
	                   <Button
                           icon={<EditOutlined />}
                           disabled={selectedRowKeys.length !== 1}
                           onClick={openRowEditor}
                       >
                           编辑行
                       </Button>
	                   <Button icon={<DeleteOutlined />} danger disabled={selectedRowKeys.length === 0} onClick={handleDeleteSelected}>删除选中</Button>
	                   {selectedRowKeys.length > 0 && <span style={{ fontSize: '12px', color: '#888' }}>已选 {selectedRowKeys.length}</span>}
	                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
	                   <Button
                            icon={<EditOutlined />}
                            type={cellEditMode ? 'primary' : 'default'}
                            onClick={() => {
                                const next = !cellEditMode;
                                setCellEditMode(next);
                                setSelectedCells(new Set());
                                currentSelectionRef.current = new Set();
                                selectionStartRef.current = null;
                                isDraggingRef.current = false;
                                cellSelectionPointerRef.current = null;
                                if (cellSelectionRafRef.current !== null) {
                                    cancelAnimationFrame(cellSelectionRafRef.current);
                                    cellSelectionRafRef.current = null;
                                }
                                if (cellSelectionScrollRafRef.current !== null) {
                                    cancelAnimationFrame(cellSelectionScrollRafRef.current);
                                    cellSelectionScrollRafRef.current = null;
                                }
                                if (cellSelectionAutoScrollRafRef.current !== null) {
                                    cancelAnimationFrame(cellSelectionAutoScrollRafRef.current);
                                    cellSelectionAutoScrollRafRef.current = null;
                                }
                                updateCellSelection(new Set());
                                if (!next) setBatchEditModalOpen(false);
                                void message.info(next ? '已进入单元格编辑模式，可拖拽选择多个单元格' : '已退出单元格编辑模式').then();
                            }}
                        >
                            单元格编辑器
                        </Button>
                       {cellEditMode && selectedCells.size > 0 && (
                           <>
                               <Button
                                   icon={<CopyOutlined />}
                                   onClick={handleCopySelectedColumnsFromRow}
                               >
                                   复制选区列值 ({selectedCells.size})
                               </Button>
                                <Button
                                    type="primary"
                                    onClick={() => {
                                        setBatchEditValue('');
                                        setBatchEditSetNull(false);
                                       setBatchEditModalOpen(true);
                                   }}
                                >
                                    批量填充 ({selectedCells.size})
                                </Button>
                            </>
                        )}
                       {cellEditMode && copiedCellPatch && (
                           <>
                               <Button
                                   icon={<VerticalAlignBottomOutlined />}
                                   disabled={selectedRowKeys.length === 0}
                                   onClick={() => handlePasteCopiedColumnsToSelectedRows()}
                               >
                                   粘贴到选中行 ({selectedRowKeys.length})
                               </Button>
                               <span style={{ fontSize: '12px', color: '#888' }}>
                                   已复制 {Object.keys(copiedCellPatch.values).length} 列
                               </span>
                           </>
                       )}
	                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
	                   <Button icon={<SaveOutlined />} type="primary" disabled={!hasChanges} onClick={handleCommit}>提交事务 ({addedRows.length + Object.keys(modifiedRows).length + deletedRowKeys.size})</Button>
	                   {hasChanges && (<Button icon={<UndoOutlined />} onClick={() => {
	                        setAddedRows([]);
                        setModifiedRows({});
                        setDeletedRowKeys(new Set());
                   }}>回滚</Button>)}
               </>
           )}

           {(canImport || canExport) && (
               <>
                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
                   {canImport && <Button icon={<ImportOutlined />} onClick={handleImport}>导入</Button>}
                   {canExport && <Dropdown menu={{ items: exportMenu }}><Button icon={<ExportOutlined />}>导出 <DownOutlined /></Button></Dropdown>}
               </>
           )}

           <>
               <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
               <Tooltip title="一键借助 AI 智能分析当前查询页数据">
                   <Button 
                       icon={<RobotOutlined />} 
                       style={{
                           background: darkMode ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))' : 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))',
                           borderColor: darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.4)',
                           color: '#10b981',
                           fontWeight: 500,
                           boxShadow: darkMode ? '0 2px 8px rgba(16,185,129,0.1)' : '0 2px 6px rgba(16,185,129,0.05)',
                       }}
                       onMouseEnter={(e) => {
                           e.currentTarget.style.background = darkMode ? 'linear-gradient(135deg, rgba(16,185,129,0.25), rgba(16,185,129,0.1))' : 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))';
                           e.currentTarget.style.borderColor = '#10b981';
                       }}
                       onMouseLeave={(e) => {
                           e.currentTarget.style.background = darkMode ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.05))' : 'linear-gradient(135deg, rgba(16,185,129,0.1), rgba(16,185,129,0.02))';
                           e.currentTarget.style.borderColor = darkMode ? 'rgba(16,185,129,0.3)' : 'rgba(16,185,129,0.4)';
                       }}
                       onClick={() => {
                           const sampleData = mergedDisplayData.slice(0, 10);
                           const prompt = `请帮我分析以下查询结果数据（取前 ${sampleData.length} 条示例）：\n\`\`\`json\n${JSON.stringify(sampleData, null, 2)}\n\`\`\`\n\n请分析数据特征、发现规律，或者给出一些业务上的洞察。`;
                           const store = useStore.getState();
                           const wasClosed = !store.aiPanelVisible;
                           if (wasClosed) store.setAIPanelVisible(true);
                           // 如果面板刚打开，需要等待组件挂载完成后再注入 prompt
                           setTimeout(() => {
                               window.dispatchEvent(new CustomEvent('gonavi:ai:inject-prompt', { detail: { prompt } }));
                           }, wasClosed ? 350 : 0);
                       }}
                   >
                       AI 数据洞察
                   </Button>
               </Tooltip>
           </>

           {prefersManualTotalCount && onRequestTotalCount && (
               <>
                   <div style={{ width: 1, background: toolbarDividerColor, height: 20, margin: '0 8px' }} />
                   <Tooltip title={pagination?.totalCountLoading ? '取消本次精确总数统计（不会影响当前浏览）' : '按当前筛选统计精确总数'}>
                       <Button
                           icon={pagination?.totalCountLoading ? <CloseOutlined /> : <VerticalAlignBottomOutlined />}
                           onClick={() => {
                               if (pagination?.totalCountLoading) {
                                   if (onCancelTotalCount) onCancelTotalCount();
                                   return;
                               }
                               onRequestTotalCount();
                           }}
                       >
                           {pagination?.totalCountLoading ? '取消统计' : '统计总数'}
                       </Button>
                   </Tooltip>
               </>
           )}

           <div style={{ marginLeft: 'auto' }} />
	           <div style={{ flexShrink: 0 }}>
	               <Button
	                   icon={<EditOutlined />}
	                   type={dataPanelOpen ? 'primary' : 'default'}
	                   onClick={() => {
	                       const next = !dataPanelOpen;
	                       setDataPanelOpen(next);
	                       if (!next) {
	                           setFocusedCellInfo(null);
	                           setDataPanelValue('');
	                           setDataPanelIsJson(false);
	                           dataPanelDirtyRef.current = false;
	                       }
	                   }}
	               >
	                   数据预览
	               </Button>
	           </div>
	           <div style={{ flexShrink: 0 }}>
	               <Popover
	                   trigger="click"
	                   placement="bottomRight"
	                   content={columnInfoSettingContent}
	               >
	                   <Button icon={<FileTextOutlined />}>字段信息</Button>
	               </Popover>
	           </div>
	           <div style={{ flexShrink: 0 }}>
	               <Segmented
	                   size="small"
	                   value={viewMode}
	                   options={[
	                       { label: '表格', value: 'table' },
	                       { label: 'JSON', value: 'json' },
	                       { label: '文本', value: 'text' }
	                   ]}
	                   onChange={(val) => {
	                       const nextMode = String(val) as GridViewMode;
	                       if (nextMode === 'json' && cellEditMode) {
                           setCellEditMode(false);
                           setSelectedCells(new Set());
                           currentSelectionRef.current = new Set();
                           selectionStartRef.current = null;
                           isDraggingRef.current = false;
                           cellSelectionPointerRef.current = null;
                           if (cellSelectionRafRef.current !== null) {
                               cancelAnimationFrame(cellSelectionRafRef.current);
                               cellSelectionRafRef.current = null;
                           }
                           if (cellSelectionScrollRafRef.current !== null) {
                               cancelAnimationFrame(cellSelectionScrollRafRef.current);
                               cellSelectionScrollRafRef.current = null;
                           }
                           if (cellSelectionAutoScrollRafRef.current !== null) {
                               cancelAnimationFrame(cellSelectionAutoScrollRafRef.current);
                               cellSelectionAutoScrollRafRef.current = null;
                           }
                           updateCellSelection(new Set());
                       }
	                       if (nextMode === 'text') {
	                           const selectedKey = selectedRowKeys[0];
	                           if (selectedKey !== undefined) {
	                               const idx = mergedDisplayData.findIndex((row) => rowKeyStr(row?.[GONAVI_ROW_KEY]) === rowKeyStr(selectedKey));
	                               if (idx >= 0) {
	                                   setTextRecordIndex(idx);
	                               }
	                           }
	                       }
	                       setViewMode(nextMode);
	                   }}
	               />
	           </div>
	          </div>

       {showFilter && (
           <div style={{
               padding: `${filterTopPadding}px ${panelPaddingX}px ${panelPaddingY}px ${panelPaddingX}px`,
               background: 'transparent',
               boxSizing: 'border-box',
           }}>
               {filterConditions.map((cond, condIndex) => (
                   <div key={cond.id} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'flex-start', opacity: cond.enabled === false ? 0.58 : 1 }}>
                       <Checkbox
                           checked={cond.enabled !== false}
                           onChange={e => updateFilter(cond.id, 'enabled', e.target.checked)}
                            style={{ marginTop: 6, flex: '0 0 auto', whiteSpace: 'nowrap' }}
                       >
                           启用
                       </Checkbox>
                        <Select
                            style={{ width: 96, minWidth: 96, maxWidth: 96, flex: '0 0 96px' }}
                            value={condIndex === 0 ? '__FIRST__' : (cond.logic === 'OR' ? 'OR' : 'AND')}
                            onChange={v => updateFilter(cond.id, 'logic', v)}
                            options={condIndex === 0 ? [{ value: '__FIRST__', label: '首条' }] : (filterLogicOptions as any)}
                            disabled={condIndex === 0}
                        />
                        <Select
                            style={{ width: 180 }}
                            value={cond.column}
                            onChange={v => updateFilter(cond.id, 'column', v)}
                            options={displayColumnNames.map(c => ({ value: c, label: c }))}
                            showSearch
                            optionFilterProp="label"
                            filterOption={(input, option) =>
                                String(option?.label ?? '')
                                    .toLowerCase()
                                    .includes(String(input || '').trim().toLowerCase())
                            }
                            placeholder="搜索字段名"
                            disabled={cond.op === 'CUSTOM'}
                        />
                       <Select
                           style={{ width: 140 }}
                           value={cond.op}
                           onChange={v => updateFilter(cond.id, 'op', v)}
                           options={filterOpOptions as any}
                       />

                       {cond.op === 'CUSTOM' ? (
                           <Input.TextArea
                               style={{ flex: 1 }}
                               autoSize={{ minRows: 1, maxRows: 4 }}
                               value={cond.value}
                               onChange={e => updateFilter(cond.id, 'value', e.target.value)}
                               placeholder="输入自定义 WHERE 表达式（不需要再写 WHERE），例如：status IN ('A','B')"
                           />
                       ) : isListOp(cond.op) ? (
                           <Input.TextArea
                               style={{ flex: 1 }}
                               autoSize={{ minRows: 1, maxRows: 4 }}
                               value={cond.value}
                               onChange={e => updateFilter(cond.id, 'value', e.target.value)}
                               placeholder="多个值用逗号或换行分隔"
                           />
                       ) : isBetweenOp(cond.op) ? (
                           <>
                               <Input
                                   style={{ width: 220 }}
                                   value={cond.value}
                                   onChange={e => updateFilter(cond.id, 'value', e.target.value)}
                                   placeholder="开始值"
                               />
                               <Input
                                   style={{ width: 220 }}
                                   value={cond.value2 || ''}
                                   onChange={e => updateFilter(cond.id, 'value2', e.target.value)}
                                   placeholder="结束值"
                               />
                           </>
                       ) : isNoValueOp(cond.op) ? (
                           <Input style={{ width: 220 }} value="" disabled placeholder="无需输入值" />
                       ) : (
                           <Input
                               style={{ width: 280 }}
                               value={cond.value}
                               onChange={e => updateFilter(cond.id, 'value', e.target.value)}
                           />
                       )}

                       <Button icon={<CloseOutlined />} onClick={() => removeFilter(cond.id)} type="text" danger />
                   </div>
               ))}
                {onSort && (
                    <div style={{ paddingTop: filterConditions.length > 0 ? 4 : 0, borderTop: filterConditions.length > 0 ? `1px dashed ${panelFrameColor}` : 'none' }}>
                        {sortInfo.map((s, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', opacity: s.enabled === false ? 0.58 : 1 }}>
                                <Checkbox
                                    checked={s.enabled !== false}
                                    onChange={e => {
                                        const next = [...sortInfo];
                                        next[idx] = { ...next[idx], enabled: e.target.checked };
                                        onSort(JSON.stringify(next), '');
                                    }}
                                    style={{ flex: '0 0 auto' }}
                                />
                                <span style={{ fontSize: 12, color: 'inherit', opacity: 0.7, whiteSpace: 'nowrap', minWidth: 32 }}>{idx === 0 ? '排序' : '然后'}</span>
                                <Select
                                    style={{ width: 180 }}
                                    value={s.columnKey || undefined}
                                    onChange={v => {
                                        const next = [...sortInfo];
                                        if (!v) { next.splice(idx, 1); } else { next[idx] = { ...next[idx], columnKey: v }; }
                                        const filtered = next.filter(si => si.columnKey);
                                        onSort(JSON.stringify(filtered), '');
                                    }}
                                    options={displayColumnNames
                                        .filter(c => c === s.columnKey || !sortInfo.some(si => si.columnKey === c))
                                        .map(c => ({ value: c, label: c }))}
                                    showSearch
                                    optionFilterProp="label"
                                    filterOption={(input, option) =>
                                        String(option?.label ?? '')
                                            .toLowerCase()
                                            .includes(String(input || '').trim().toLowerCase())
                                    }
                                    placeholder="选择排序字段"
                                    allowClear
                                    onClear={() => {
                                        const next = sortInfo.filter((_, i) => i !== idx);
                                        onSort(JSON.stringify(next), '');
                                    }}
                                />
                                <Select
                                    style={{ width: 110 }}
                                    value={s.order || 'ascend'}
                                    onChange={v => {
                                        const next = [...sortInfo];
                                        next[idx] = { ...next[idx], order: v };
                                        onSort(JSON.stringify(next), '');
                                    }}
                                    options={[
                                        { value: 'ascend', label: '升序 ↑' },
                                        { value: 'descend', label: '降序 ↓' },
                                    ]}
                                    disabled={!s.columnKey}
                                />
                                <Button icon={<CloseOutlined />} type="text" danger size="small" onClick={() => {
                                    const next = sortInfo.filter((_, i) => i !== idx);
                                    onSort(JSON.stringify(next), '');
                                }} />
                            </div>
                        ))}
                        <Button type="dashed" size="small" icon={<PlusOutlined />} onClick={() => {
                            const next = [...sortInfo, { columnKey: displayColumnNames.find(c => !sortInfo.some(s => s.columnKey === c)) || displayColumnNames[0] || '', order: 'ascend', enabled: true }];
                            onSort(JSON.stringify(next), '');
                        }} disabled={sortInfo.length >= displayColumnNames.length} style={{ marginBottom: 4 }}>添加排序</Button>
                    </div>
                )}
               <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: (onSort && sortInfo.length > 0) ? 4 : 0, paddingTop: (onSort && sortInfo.length > 0) ? 6 : 0, borderTop: (onSort && sortInfo.length > 0) ? `1px dashed ${panelFrameColor}` : 'none' }}>
                   <Button type="dashed" onClick={addFilter} size="small" icon={<PlusOutlined />}>添加条件</Button>
                   <div style={{ width: 1, height: 16, background: panelFrameColor, margin: '0 2px', flexShrink: 0 }} />
                   <Button size="small" onClick={() => setFilterConditions(prev => prev.map(c => ({ ...c, enabled: true })))}>全启用</Button>
                   <Button size="small" onClick={() => setFilterConditions(prev => prev.map(c => ({ ...c, enabled: false })))}>全停用</Button>
                   <div style={{ width: 1, height: 16, background: panelFrameColor, margin: '0 2px', flexShrink: 0 }} />
                   <Button type="primary" onClick={applyFilters} size="small">应用</Button>
                   <Button size="small" icon={<ClearOutlined />} onClick={() => {
                       setFilterConditions([]);
                       if (onApplyFilter) onApplyFilter([]);
                       if (onSort) onSort('', '');
                   }}>清除</Button>
               </div>
           </div>
       )}
       </div>

	       <div ref={containerRef} style={{ flex: 1, overflow: 'hidden', position: 'relative', minHeight: 0, display: 'flex', flexDirection: 'column', background: bgContent, borderRadius: panelRadius, border: `1px solid ${panelFrameColor}`, boxSizing: 'border-box' }}>
	        {contextHolder}
            <Modal
                title="编辑行"
                open={rowEditorOpen}
                onCancel={closeRowEditor}
                width={980}
                destroyOnHidden
                maskClosable={false}
                footer={[
                    <Button key="cancel" onClick={closeRowEditor}>取消</Button>,
                    <Button key="ok" type="primary" onClick={applyRowEditor}>应用</Button>,
                ]}
            >
                <div style={{ marginBottom: 8, color: '#888', fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                    <span>{tableName ? `${tableName}` : ''}</span>
                    <span>{rowEditorRowKey ? `rowKey: ${rowEditorRowKey}` : ''}</span>
                </div>
                <Form form={rowEditorForm} layout="vertical">
                    <div className="custom-scrollbar" style={{ maxHeight: '62vh', overflow: 'auto', paddingRight: 8 }}>
                        {displayColumnNames.map((col: string) => {
                            const sample = rowEditorDisplayRef.current?.[col] ?? '';
                            const placeholder = rowEditorNullColsRef.current?.has(col) ? '(NULL)' : undefined;
                            const isJson = looksLikeJsonText(sample);
                            const useArea = isJson || sample.includes('\n') || sample.length >= 160;
                            const colMeta = columnMetaMap[col] || columnMetaMapByLowerName[col.toLowerCase()];
                            const rowPickerType = getTemporalPickerType(colMeta?.type);
                            const isRowDateTimeField = !!rowPickerType && !(/^0{4}-0{2}-0{2}/.test(String(sample || '')));

                            return (
                                <Form.Item key={col} label={col} style={{ marginBottom: 12 }}>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                        <Form.Item name={col} noStyle>
                                            {isRowDateTimeField ? (
                                                rowPickerType === 'time' ? (
                                                    <TimePicker
                                                        style={{ flex: 1, width: '100%' }}
                                                        format={TEMPORAL_FORMATS[rowPickerType]}
                                                        placeholder={placeholder}
                                                        needConfirm={false}
                                                    />
                                                ) : rowPickerType === 'datetime' ? (
                                                    <DatePicker
                                                        style={{ flex: 1, width: '100%' }}
                                                        showTime
                                                        format={TEMPORAL_FORMATS[rowPickerType]}
                                                        placeholder={placeholder}
                                                        needConfirm
                                                    />
                                                ) : (
                                                    <DatePicker
                                                        style={{ flex: 1, width: '100%' }}
                                                        format={TEMPORAL_FORMATS[rowPickerType]}
                                                        picker={rowPickerType as any}
                                                        placeholder={placeholder}
                                                        needConfirm={false}
                                                    />
                                                )
                                            ) : useArea ? (
                                                <Input.TextArea
                                                    style={{ flex: 1 }}
                                                    autoSize={{ minRows: isJson ? 4 : 1, maxRows: 10 }}
                                                    placeholder={placeholder}
                                                />
                                            ) : (
                                                <Input style={{ flex: 1 }} placeholder={placeholder} />
                                            )}
                                        </Form.Item>
                                        <Button size="small" onClick={() => openRowEditorFieldEditor(col)} title="弹窗编辑">...</Button>
                                    </div>
                                </Form.Item>
                            );
                        })}
                    </div>
                </Form>
            </Modal>
	        <Modal
	            title={cellEditorMeta ? `编辑单元格：${cellEditorMeta.title}` : '编辑单元格'}
	            open={cellEditorOpen}
	            onCancel={closeCellEditor}
            destroyOnHidden
            width={960}
            maskClosable={false}
            footer={[
                <Button key="format" onClick={handleFormatJsonInEditor} disabled={!cellEditorIsJson}>
                    格式化 JSON
                </Button>,
                <Button key="cancel" onClick={closeCellEditor}>取消</Button>,
                <Button key="ok" type="primary" onClick={handleCellEditorSave}>保存</Button>,
            ]}
        >
            <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
                {cellEditorMeta ? `${tableName || ''}${tableName ? '.' : ''}${cellEditorMeta.dataIndex}` : ''}
            </div>
            {cellEditorOpen && (
                <Editor
                    height="56vh"
                    language={cellEditorIsJson ? "json" : "plaintext"}
                    theme={darkMode ? "transparent-dark" : "transparent-light"}
                    value={cellEditorValue}
                    onChange={(val) => setCellEditorValue(val || '')}
                    options={{
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "on",
                        fontSize: 14,
                        tabSize: 2,
                        automaticLayout: true,
                    }}
                />
            )}
        </Modal>

        {/* 批量编辑弹窗 */}
        <Modal
            title={`批量填充 (${selectedCells.size} 个单元格)`}
            open={batchEditModalOpen}
            onCancel={() => setBatchEditModalOpen(false)}
            onOk={handleBatchFillCells}
            width={500}
        >
            <div style={{ marginBottom: 16 }}>
                <Checkbox
                    checked={batchEditSetNull}
                    onChange={(e) => setBatchEditSetNull(e.target.checked)}
                >
                    设置为 NULL
                </Checkbox>
            </div>
            {!batchEditSetNull && (
                <Input.TextArea
                    value={batchEditValue}
                    onChange={(e) => setBatchEditValue(e.target.value)}
                    placeholder="输入要填充的值"
                    autoSize={{ minRows: 3, maxRows: 10 }}
                    autoFocus
                />
            )}
        </Modal>
        <Modal
            title="编辑 JSON 结果集"
            open={jsonEditorOpen}
            onCancel={() => setJsonEditorOpen(false)}
            destroyOnHidden
            width={980}
            maskClosable={false}
            footer={[
                <Button key="format" onClick={handleFormatJsonEditor}>格式化 JSON</Button>,
                <Button key="cancel" onClick={() => setJsonEditorOpen(false)}>取消</Button>,
                <Button key="ok" type="primary" onClick={applyJsonEditor}>应用修改</Button>,
            ]}
        >
            <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
                说明：此处按当前结果集顺序编辑，不支持在 JSON 模式增删记录（可在表格模式操作）。
            </div>
            {jsonEditorOpen && (
                <Editor
                    height="56vh"
                    language="json"
                    theme={darkMode ? "transparent-dark" : "transparent-light"}
                    value={jsonEditorValue}
                    onChange={(val) => setJsonEditorValue(val || '')}
                    options={{
                        readOnly: false,
                        minimap: { enabled: false },
                        scrollBeyondLastLine: false,
                        wordWrap: "off",
                        fontSize: 12,
                        tabSize: 2,
                        automaticLayout: true,
                    }}
                />
            )}
        </Modal>

        {viewMode === 'table' ? (
            <div
                ref={tableContainerRef}
                className={`data-grid-table-wrap${horizontalScrollVisible ? ' data-grid-table-wrap-external-active' : ''}`}
                style={{
                    flex: '1 1 auto',
                    minHeight: 0,
                    position: 'relative',
                    boxSizing: 'border-box',
                    paddingBottom: enableVirtual ? tableBodyBottomPadding : 0,
                }}
            >
                <Form component={false} form={form}>
                    <DataContext.Provider value={dataContextValue}>
                        <CellContextMenuContext.Provider value={cellContextMenuValue}>
                                <EditableContext.Provider value={form}>
                                    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                                        <SortableContext items={displayColumnNames} strategy={horizontalListSortingStrategy}>
                                            <Table
                                                components={tableComponents}
                                                dataSource={mergedDisplayData}
                                                columns={mergedColumns}
                                                showSorterTooltip={{ target: 'sorter-icon' }}
                                                size="small"
                                                tableLayout="fixed"
                                                scroll={tableScrollConfig}
                                                sticky={false}
                                                virtual={enableVirtual}
                                                    loading={loading}
                                                    rowKey={GONAVI_ROW_KEY}
                                                    pagination={false}
                                                    onChange={handleTableChange}
                                                    bordered
                                                    rowSelection={rowSelectionConfig}
                                                    rowClassName={rowClassName}
                                                    onRow={tableOnRow}
                                                />
                                        </SortableContext>
                                    </DndContext>
                                </EditableContext.Provider>
                        </CellContextMenuContext.Provider>
                    </DataContext.Provider>
                </Form>
                <div
                    ref={externalHorizontalScrollRef}
                    className="data-grid-external-horizontal-scroll"
                    aria-hidden={!horizontalScrollVisible}
                    onScroll={applyExternalScrollToTableTargets}
                    style={{
                        opacity: horizontalScrollVisible ? 1 : 0,
                        pointerEvents: horizontalScrollVisible ? 'auto' : 'none',
                    }}
                >
                    <div
                        className="data-grid-external-horizontal-scroll-inner"
                        style={{ width: `${Math.max(horizontalScrollWidth, externalScrollbarMinWidth)}px` }}
                    />
                </div>
            </div>
        ) : viewMode === 'json' ? (
            <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 10px', borderBottom: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>
                        {mergedDisplayData.length === 0 ? '当前结果集无数据' : `当前结果集 ${mergedDisplayData.length} 条记录`}
                    </span>
                    {canModifyData && (
                        <Button size="small" type="primary" onClick={openJsonEditor} disabled={mergedDisplayData.length === 0}>
                            编辑 JSON
                        </Button>
                    )}
                </div>
                <div style={{ flex: 1, minHeight: 0, padding: '8px 10px 10px 10px' }}>
                    <Editor
                        height="100%"
                        defaultLanguage="json"
                        language="json"
                        theme={darkMode ? "transparent-dark" : "transparent-light"}
                        value={jsonViewText}
                        options={{
                            readOnly: true,
                            minimap: { enabled: false },
                            scrollBeyondLastLine: false,
                            wordWrap: "off",
                            fontSize: 12,
                            tabSize: 2,
                            automaticLayout: true,
                        }}
                    />
                </div>
            </div>
	        ) : (
	            <div style={{ height: '100%', minHeight: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '8px 12px', borderBottom: darkMode ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.08)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button size="small" onClick={() => setTextRecordIndex(i => Math.max(0, i - 1))} disabled={textViewRows.length === 0 || textRecordIndex <= 0}>
                        上一条
                    </Button>
                    <Button size="small" onClick={() => setTextRecordIndex(i => Math.min(textViewRows.length - 1, i + 1))} disabled={textViewRows.length === 0 || textRecordIndex >= textViewRows.length - 1}>
                        下一条
                    </Button>
                    <span style={{ fontSize: 12, color: darkMode ? '#999' : '#666' }}>
                        {textViewRows.length === 0 ? '当前结果集无数据' : `记录 ${textRecordIndex + 1} / ${textViewRows.length}`}
                    </span>
                    {canModifyData && (
                        <Button size="small" type="primary" onClick={openCurrentViewRowEditor} disabled={textViewRows.length === 0}>
                            编辑当前记录
                        </Button>
                    )}
                </div>
	                <div className="custom-scrollbar" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '8px 12px' }}>
                    {currentTextRow ? displayColumnNames.map((col) => (
                        <div key={col} style={{ display: 'grid', gridTemplateColumns: '240px 1fr', gap: 10, padding: '6px 0', borderBottom: darkMode ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)', alignItems: 'start' }}>
                            <div style={{ fontWeight: 600, color: darkMode ? 'rgba(255,255,255,0.9)' : 'rgba(0,0,0,0.88)', wordBreak: 'break-all' }}>
                                {col} :
                            </div>
                            <div style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: darkMode ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)' }}>
                                {formatTextViewValue((currentTextRow as any)[col])}
                            </div>
                        </div>
                    )) : (
                        <div style={{ fontSize: 12, color: darkMode ? '#999' : '#666', paddingTop: 4 }}>
                            当前结果集无数据
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Data Preview Panel */}
        {dataPanelOpen && viewMode === 'table' && (
            <div style={{
                height: 200,
                borderTop: darkMode ? '1px solid rgba(255,255,255,0.12)' : '1px solid rgba(0,0,0,0.12)',
                display: 'flex',
                flexDirection: 'column',
                background: darkMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.6)',
                flexShrink: 0,
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '4px 10px',
                    fontSize: 12,
                    borderBottom: darkMode ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(0,0,0,0.06)',
                    flexShrink: 0,
                }}>
                    <span style={{ color: darkMode ? '#aaa' : '#666', fontWeight: 500 }}>
                        {focusedCellInfo ? focusedCellInfo.dataIndex : '点击单元格查看数据'}
                    </span>
                    {focusedCellInfo && (() => {
                        const meta = columnMetaMap[focusedCellInfo.dataIndex] || columnMetaMapByLowerName[focusedCellInfo.dataIndex.toLowerCase()];
                        return meta?.type ? <span style={{ color: '#888', fontSize: 11 }}>({meta.type})</span> : null;
                    })()}
                    <div style={{ flex: 1 }} />
                    {dataPanelIsJson && (
                        <Button size="small" onClick={handleDataPanelFormatJson}>格式化 JSON</Button>
                    )}
                    {canModifyData && focusedCellInfo && (
                        <Button size="small" type="primary" onClick={handleDataPanelSave}>保存</Button>
                    )}
                </div>
                <div style={{ flex: 1, minHeight: 0 }}>
                    {focusedCellInfo ? (
                        <Editor
                            height="100%"
                            language={dataPanelIsJson ? 'json' : 'plaintext'}
                            theme={darkMode ? 'transparent-dark' : 'transparent-light'}
                            value={dataPanelValue}
                            onChange={(val) => {
                                setDataPanelValue(val || '');
                                dataPanelDirtyRef.current = true;
                            }}
                            options={{
                                minimap: { enabled: false },
                                scrollBeyondLastLine: false,
                                wordWrap: 'on',
                                fontSize: 13,
                                tabSize: 2,
                                automaticLayout: true,
                                readOnly: !canModifyData,
                                lineNumbers: 'off',
                                glyphMargin: false,
                                folding: false,
                                lineDecorationsWidth: 4,
                                padding: { top: 6, bottom: 6 },
                            }}
                        />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: 13 }}>
                            点击表格中的单元格以预览完整数据
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Cell Context Menu - 使用 Portal 渲染到 body，避免 backdropFilter 影响 fixed 定位 */}
        {viewMode === 'table' && cellContextMenu.visible && createPortal(
            <div
                style={{
                    position: 'fixed',
                    left: cellContextMenu.x,
                    top: cellContextMenu.y,
                    zIndex: 10000,
                    background: bgContextMenu,
                    border: darkMode ? '1px solid #303030' : '1px solid #d9d9d9',
                    borderRadius: 4,
                    boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
                    minWidth: 160,
                    maxHeight: `calc(100vh - ${cellContextMenu.y}px - 8px)`,
                    overflowY: 'auto',
                    color: darkMode ? '#fff' : 'rgba(0, 0, 0, 0.88)'
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {canModifyData && (
                    <>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={handleCellSetNull}
                >
                    设置为 NULL
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: selectedRowKeys.length > 0 ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s',
                        opacity: selectedRowKeys.length > 0 ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => {
                        if (selectedRowKeys.length > 0) e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5';
                    }}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (selectedRowKeys.length > 0 && cellContextMenu.record) {
                            handleBatchFillToSelected(cellContextMenu.record, cellContextMenu.dataIndex);
                        }
                    }}
                >
                    <VerticalAlignBottomOutlined style={{ marginRight: 8 }} />
                    填充到选中行 ({selectedRowKeys.length})
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: copiedCellPatch ? 'pointer' : 'not-allowed',
                        transition: 'background 0.2s',
                        opacity: copiedCellPatch ? 1 : 0.5,
                    }}
                    onMouseEnter={(e) => {
                        if (copiedCellPatch) e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5';
                    }}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (!copiedCellPatch) return;
                        const fallbackKey = cellContextMenu.record?.[GONAVI_ROW_KEY];
                        handlePasteCopiedColumnsToSelectedRows(fallbackKey);
                    }}
                >
                    <VerticalAlignBottomOutlined style={{ marginRight: 8 }} />
                    粘贴已复制列（同名列）
                </div>
                <div style={{ height: 1, background: darkMode ? '#303030' : '#f0f0f0', margin: '4px 0' }} />
                    </>
                )}
                {supportsCopyInsert && (
                    <div
                        style={{
                            padding: '8px 12px',
                            cursor: 'pointer',
                            transition: 'background 0.2s',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                        onClick={() => {
                            if (cellContextMenu.record) handleCopyInsert(cellContextMenu.record);
                            setCellContextMenu(prev => ({ ...prev, visible: false }));
                        }}
                    >
                        复制为 INSERT
                    </div>
                )}
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleCopyJson(cellContextMenu.record);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    复制为 JSON
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleCopyCsv(cellContextMenu.record);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    复制为 CSV
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) {
                            const records = getTargets(cellContextMenu.record);
                            const lines = records.map((r: any) => {
                                const { [GONAVI_ROW_KEY]: _rowKey, ...vals } = r;
                                return `| ${Object.values(vals).join(' | ')} |`;
                            });
                            copyToClipboard(lines.join('\n'));
                        }
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    复制为 Markdown
                </div>
                <div style={{ height: 1, background: darkMode ? '#303030' : '#f0f0f0', margin: '4px 0' }} />
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleExportSelected('csv', cellContextMenu.record).catch(console.error);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    导出为 CSV
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleExportSelected('xlsx', cellContextMenu.record).catch(console.error);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    导出为 Excel
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleExportSelected('json', cellContextMenu.record).catch(console.error);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    导出为 JSON
                </div>
                <div
                    style={{
                        padding: '8px 12px',
                        cursor: 'pointer',
                        transition: 'background 0.2s',
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.background = darkMode ? '#303030' : '#f5f5f5'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    onClick={() => {
                        if (cellContextMenu.record) handleExportSelected('html', cellContextMenu.record).catch(console.error);
                        setCellContextMenu(prev => ({ ...prev, visible: false }));
                    }}
                >
                    导出为 HTML
                </div>
            </div>,
            document.body
        )}
       </div>
       
       {pagination && (
           <div className="data-grid-pagination-wrap" style={{ padding: '12px 0 0', borderTop: 'none', display: 'flex', justifyContent: 'flex-end' }}>
               <div className="data-grid-pagination-shell">
                   <div className="data-grid-pagination-summary" aria-live="polite">
                       <span className="data-grid-pagination-kicker">结果集</span>
                       <span className="data-grid-pagination-summary-value">{paginationSummaryText}</span>
                   </div>
                   <div className="data-grid-pagination-page-chip">{paginationPageText}</div>
                   <Pagination
                       current={pagination.current}
                       pageSize={pagination.pageSize}
                       total={resolvePaginationTotalForControl({
                           pagination,
                           supportsApproximateTotalPages,
                       })}
                       showSizeChanger={false}
                       onChange={onPageChange}
                       showTitle={false}
                       size="small"
                       itemRender={(_page, type, originalElement) => {
                           if (type === 'prev') {
                               return <span className="data-grid-pagination-nav-icon" aria-hidden="true"><LeftOutlined /></span>;
                           }
                           if (type === 'next') {
                               return <span className="data-grid-pagination-nav-icon" aria-hidden="true"><RightOutlined /></span>;
                           }
                           return originalElement;
                       }}
                   />
                   <Select
                       size="small"
                       popupMatchSelectWidth={false}
                       value={String(pagination.pageSize)}
                       onChange={handlePageSizeChange}
                       options={paginationPageSizeOptions.map((value) => ({ value, label: `${value} 条 / 页` }))}
                       className="data-grid-pagination-size-select"
                       aria-label="每页条数"
                   />
               </div>
           </div>
       )}

		        <style>{gridCssText}</style>
       
       {/* Ghost Resize Line for Columns */}
       <div
           ref={ghostRef}
           style={{
               position: 'absolute',
               top: 0,
               bottom: 0, // Fits container height
               left: 0,
               width: '2px',
               background: selectionAccentHex,
               zIndex: 9999,
               display: 'none',
               pointerEvents: 'none',
               willChange: 'transform'
           }}
       />

       {/* Import Preview Modal */}
       <ImportPreviewModal
           visible={importPreviewVisible}
           filePath={importFilePath}
           connectionId={connectionId || ''}
           dbName={dbName || ''}
           tableName={tableName || ''}
           onClose={() => {
               setImportPreviewVisible(false);
               setImportFilePath('');
           }}
           onSuccess={handleImportSuccess}
       />
    </div>
  );
};

// 使用 ErrorBoundary 包裹 DataGrid，防止数据渲染错误导致应用崩溃
const MemoizedDataGrid = React.memo(DataGrid);

const DataGridWithErrorBoundary: React.FC<DataGridProps> = (props) => (
    <DataGridErrorBoundary>
        <MemoizedDataGrid {...props} />
    </DataGridErrorBoundary>
);

export default DataGridWithErrorBoundary;

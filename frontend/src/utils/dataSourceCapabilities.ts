import type { ConnectionConfig } from '../types';

type ConnectionLike = Pick<ConnectionConfig, 'type' | 'driver'> | null | undefined;

const normalizeDataSourceToken = (raw: string): string => {
  const normalized = String(raw || '').trim().toLowerCase();
  switch (normalized) {
    case 'doris':
      return 'diros';
    case 'postgresql':
      return 'postgres';
    case 'dm':
      return 'dameng';
    default:
      return normalized;
  }
};

export const resolveDataSourceType = (config: ConnectionLike): string => {
  if (!config) return '';
  const type = normalizeDataSourceToken(String(config.type || ''));
  if (type === 'custom') {
    const driver = normalizeDataSourceToken(String(config.driver || ''));
    return driver || 'custom';
  }
  return type;
};

const SQL_QUERY_EXPORT_TYPES = new Set([
  'mysql',
  'mariadb',
  'diros',
  'sphinx',
  'postgres',
  'kingbase',
  'highgo',
  'vastbase',
  'sqlserver',
  'sqlite',
  'duckdb',
  'oracle',
  'dameng',
  'tdengine',
  'clickhouse',
]);

const COPY_INSERT_TYPES = new Set([
  'mysql',
  'mariadb',
  'diros',
  'sphinx',
  'postgres',
  'kingbase',
  'highgo',
  'vastbase',
  'sqlserver',
  'sqlite',
  'duckdb',
  'oracle',
  'dameng',
  'tdengine',
  'clickhouse',
]);

const QUERY_EDITOR_DISABLED_TYPES = new Set(['redis']);
const FORCE_READ_ONLY_QUERY_TYPES = new Set(['tdengine', 'clickhouse']);
const MANUAL_TOTAL_COUNT_TYPES = new Set(['duckdb', 'oracle']);
const APPROXIMATE_TABLE_COUNT_TYPES = new Set(['duckdb', 'oracle']);
const APPROXIMATE_TOTAL_PAGE_TYPES = new Set(['duckdb']);

export type DataSourceCapabilities = {
  type: string;
  supportsQueryEditor: boolean;
  supportsSqlQueryExport: boolean;
  supportsCopyInsert: boolean;
  forceReadOnlyQueryResult: boolean;
  preferManualTotalCount: boolean;
  supportsApproximateTableCount: boolean;
  supportsApproximateTotalPages: boolean;
};

export const getDataSourceCapabilities = (config: ConnectionLike): DataSourceCapabilities => {
  const type = resolveDataSourceType(config);
  return {
    type,
    supportsQueryEditor: !QUERY_EDITOR_DISABLED_TYPES.has(type),
    supportsSqlQueryExport: SQL_QUERY_EXPORT_TYPES.has(type),
    supportsCopyInsert: COPY_INSERT_TYPES.has(type),
    forceReadOnlyQueryResult: FORCE_READ_ONLY_QUERY_TYPES.has(type),
    preferManualTotalCount: MANUAL_TOTAL_COUNT_TYPES.has(type),
    supportsApproximateTableCount: APPROXIMATE_TABLE_COUNT_TYPES.has(type),
    supportsApproximateTotalPages: APPROXIMATE_TOTAL_PAGE_TYPES.has(type),
  };
};

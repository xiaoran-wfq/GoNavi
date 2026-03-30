export type ApproximateTableCountStrategy = 'none' | 'duckdb-estimated-size' | 'oracle-num-rows';

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const toNonNegativeFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : null;
  }
  if (typeof value === 'bigint') {
    return value >= 0n && value <= MAX_SAFE_BIGINT ? Number(value) : null;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    if (/^[+-]?\d+$/.test(text)) {
      try {
        const parsed = BigInt(text);
        return parsed >= 0n && parsed <= MAX_SAFE_BIGINT ? Number(parsed) : null;
      } catch {
        return null;
      }
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) && parsed >= 0 && parsed <= Number.MAX_SAFE_INTEGER ? parsed : null;
  }
  return null;
};

const stripOuterQuotes = (value: string): string => {
  const trimmed = String(value || '').trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' && last === '"') || (first === '`' && last === '`') || (first === '[' && last === ']')) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
};

const escapeSQLLiteral = (value: string): string => String(value || '').replace(/'/g, "''");

const resolveOracleOwnerAndTable = (params: { dbName: string; tableName: string }) => {
  const rawTable = String(params.tableName || '').trim();
  const parts = rawTable.split('.').map(stripOuterQuotes).filter(Boolean);
  const tableName = String(parts[parts.length - 1] || rawTable || '').trim();
  const ownerCandidate = parts.length >= 2 ? parts[parts.length - 2] : String(params.dbName || '').trim();
  return {
    owner: ownerCandidate.toUpperCase(),
    tableName: tableName.toUpperCase(),
  };
};

export const resolveApproximateTableCountStrategy = (params: {
  dbType: string;
  whereSQL: string;
}): ApproximateTableCountStrategy => {
  const dbType = String(params.dbType || '').trim().toLowerCase();
  const whereSQL = String(params.whereSQL || '').trim();
  if (whereSQL) return 'none';
  if (dbType === 'duckdb') return 'duckdb-estimated-size';
  if (dbType === 'oracle') return 'oracle-num-rows';
  return 'none';
};

export const buildOracleApproximateTotalSql = (params: { dbName: string; tableName: string }): string => {
  const { owner, tableName } = resolveOracleOwnerAndTable(params);
  const escapedTable = escapeSQLLiteral(tableName);
  if (!owner) {
    return `SELECT num_rows AS approx_total FROM user_tables WHERE table_name = '${escapedTable}' AND ROWNUM = 1`;
  }
  return `SELECT num_rows AS approx_total FROM all_tables WHERE owner = '${escapeSQLLiteral(owner)}' AND table_name = '${escapedTable}' AND ROWNUM = 1`;
};

export const parseApproximateTableCountRow = (
  row: unknown,
  preferredKeys: string[] = ['approx_total', 'estimated_size', 'estimated_rows', 'row_count', 'num_rows', 'count', 'total'],
): number | null => {
  if (!row || typeof row !== 'object') return null;
  const entries = Object.entries(row as Record<string, unknown>);
  if (entries.length === 0) return null;

  for (const preferredKey of preferredKeys) {
    const normalizedPreferred = String(preferredKey || '').trim().toLowerCase();
    for (const [key, value] of entries) {
      if (String(key || '').trim().toLowerCase() !== normalizedPreferred) continue;
      const parsed = toNonNegativeFiniteNumber(value);
      if (parsed !== null) return parsed;
    }
  }

  for (const [key, value] of entries) {
    const normalizedKey = String(key || '').trim().toLowerCase();
    if (!normalizedKey.includes('estimate') && !normalizedKey.includes('row') && !normalizedKey.includes('count') && !normalizedKey.includes('total')) {
      continue;
    }
    const parsed = toNonNegativeFiniteNumber(value);
    if (parsed !== null) return parsed;
  }

  for (const [, value] of entries) {
    const parsed = toNonNegativeFiniteNumber(value);
    if (parsed !== null) return parsed;
  }

  return null;
};

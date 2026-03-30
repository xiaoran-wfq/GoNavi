import { describe, expect, it } from 'vitest';

import {
  buildOracleApproximateTotalSql,
  parseApproximateTableCountRow,
  resolveApproximateTableCountStrategy,
} from './approximateTableCount';

describe('approximateTableCount', () => {
  it('uses oracle metadata approximate total only for unfiltered full-table preview', () => {
    expect(resolveApproximateTableCountStrategy({ dbType: 'oracle', whereSQL: '' })).toBe('oracle-num-rows');
    expect(resolveApproximateTableCountStrategy({ dbType: 'oracle', whereSQL: 'WHERE id = 1' })).toBe('none');
  });

  it('keeps duckdb approximate count on unfiltered previews', () => {
    expect(resolveApproximateTableCountStrategy({ dbType: 'duckdb', whereSQL: '' })).toBe('duckdb-estimated-size');
  });

  it('builds Oracle approx count SQL from owner and table name', () => {
    expect(buildOracleApproximateTotalSql({ dbName: 'HR', tableName: 'HR.EMPLOYEES' })).toContain("owner = 'HR'");
    expect(buildOracleApproximateTotalSql({ dbName: 'HR', tableName: 'HR.EMPLOYEES' })).toContain("table_name = 'EMPLOYEES'");
  });

  it('parses approximate total rows using preferred keys', () => {
    expect(parseApproximateTableCountRow({ NUM_ROWS: '1234' }, ['num_rows'])).toBe(1234);
    expect(parseApproximateTableCountRow({ approx_total: 5678 }, ['approx_total'])).toBe(5678);
  });
});

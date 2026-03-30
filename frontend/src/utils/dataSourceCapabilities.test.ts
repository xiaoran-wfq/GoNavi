import { describe, expect, it } from 'vitest';

import { getDataSourceCapabilities } from './dataSourceCapabilities';

describe('dataSourceCapabilities', () => {
  it('treats Oracle table preview totals as manual exact count plus approximate metadata count', () => {
    expect(getDataSourceCapabilities({ type: 'oracle' })).toMatchObject({
      type: 'oracle',
      preferManualTotalCount: true,
      supportsApproximateTableCount: true,
      supportsApproximateTotalPages: false,
    });
  });

  it('keeps DuckDB manual count and approximate total support', () => {
    expect(getDataSourceCapabilities({ type: 'duckdb' })).toMatchObject({
      type: 'duckdb',
      preferManualTotalCount: true,
      supportsApproximateTableCount: true,
      supportsApproximateTotalPages: true,
    });
  });

  it('keeps MySQL on automatic total count mode', () => {
    expect(getDataSourceCapabilities({ type: 'mysql' })).toMatchObject({
      type: 'mysql',
      preferManualTotalCount: false,
      supportsApproximateTableCount: false,
      supportsApproximateTotalPages: false,
    });
  });
});

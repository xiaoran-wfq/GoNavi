import { describe, expect, it } from 'vitest';

import {
  resolvePaginationPageText,
  resolvePaginationSummaryText,
  resolvePaginationTotalForControl,
} from './dataGridPagination';

describe('dataGridPagination', () => {
  it('shows Oracle approximate total in summary but not in total-page chip', () => {
    const pagination = {
      current: 3,
      pageSize: 100,
      total: 301,
      totalKnown: false,
      totalApprox: true,
      approximateTotal: 1832451,
    };

    expect(resolvePaginationSummaryText({
      pagination,
      prefersManualTotalCount: true,
      supportsApproximateTableCount: true,
    })).toContain('约 1832451 条');

    expect(resolvePaginationPageText({
      pagination,
      supportsApproximateTotalPages: false,
    })).toBe('第 3 页');

    expect(resolvePaginationTotalForControl({
      pagination,
      supportsApproximateTotalPages: false,
    })).toBe(301);
  });

  it('still allows DuckDB to use approximate totals for page counts', () => {
    const pagination = {
      current: 2,
      pageSize: 100,
      total: 201,
      totalKnown: false,
      totalApprox: true,
      approximateTotal: 1000,
    };

    expect(resolvePaginationPageText({
      pagination,
      supportsApproximateTotalPages: true,
    })).toBe('第 2 / 10 页');

    expect(resolvePaginationTotalForControl({
      pagination,
      supportsApproximateTotalPages: true,
    })).toBe(1000);
  });
});

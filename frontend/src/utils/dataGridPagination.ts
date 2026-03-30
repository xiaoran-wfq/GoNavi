export type PaginationStateLike = {
  current: number;
  pageSize: number;
  total: number;
  totalKnown?: boolean;
  totalApprox?: boolean;
  approximateTotal?: number;
  totalCountLoading?: boolean;
  totalCountCancelled?: boolean;
};

const toFiniteNonNegativeNumber = (value: unknown): number | null => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
};

const resolveApproximateTotal = (pagination: PaginationStateLike): number | null => {
  if (!pagination.totalApprox) return null;
  const approximateTotal = toFiniteNonNegativeNumber(pagination.approximateTotal);
  return approximateTotal !== null && approximateTotal > 0 ? approximateTotal : null;
};

const resolveCurrentCount = (pagination: PaginationStateLike): number => {
  const total = toFiniteNonNegativeNumber(pagination.total) ?? 0;
  const rangeStart = Math.max(0, (pagination.current - 1) * pagination.pageSize + (total > 0 ? 1 : 0));
  const hasValidRange = total > 0 && rangeStart > 0;
  if (!hasValidRange) return 0;
  const rangeEnd = Math.min(total, rangeStart + pagination.pageSize - 1);
  return Math.max(0, rangeEnd - rangeStart + 1);
};

export const resolvePaginationSummaryText = (params: {
  pagination: PaginationStateLike;
  prefersManualTotalCount: boolean;
  supportsApproximateTableCount: boolean;
}): string => {
  const { pagination, prefersManualTotalCount, supportsApproximateTableCount } = params;
  const currentCount = resolveCurrentCount(pagination);
  const total = toFiniteNonNegativeNumber(pagination.total) ?? 0;
  const approximateTotal = resolveApproximateTotal(pagination);

  if (pagination.totalKnown === false) {
    if (prefersManualTotalCount) {
      if (pagination.totalCountLoading) return `当前 ${currentCount} 条 / 正在统计精确总数…`;
      if (supportsApproximateTableCount && approximateTotal !== null) return `当前 ${currentCount} 条 / 约 ${approximateTotal} 条`;
      if (pagination.totalCountCancelled) return `当前 ${currentCount} 条 / 已取消统计`;
      return `当前 ${currentCount} 条 / 总数未统计`;
    }
    return `当前 ${currentCount} 条 / 正在统计总数…`;
  }

  if (!Number.isFinite(total) || total <= 0) {
    return '当前 0 条 / 共 0 条';
  }

  return `当前 ${currentCount} 条 / 共 ${total} 条`;
};

export const resolvePaginationPageText = (params: {
  pagination: PaginationStateLike;
  supportsApproximateTotalPages: boolean;
}): string => {
  const { pagination, supportsApproximateTotalPages } = params;
  const exactTotal = toFiniteNonNegativeNumber(pagination.total) ?? 0;
  const approximateTotal = resolveApproximateTotal(pagination);
  const effectiveTotal =
    pagination.totalKnown !== false
      ? exactTotal
      : supportsApproximateTotalPages && approximateTotal !== null
        ? approximateTotal
        : 0;

  if (effectiveTotal <= 0) return `第 ${pagination.current} 页`;

  const totalPages = Math.max(1, Math.ceil(effectiveTotal / Math.max(1, pagination.pageSize)));
  if (pagination.totalKnown === false && !(supportsApproximateTotalPages && approximateTotal !== null)) {
    return `第 ${pagination.current} 页`;
  }
  return `第 ${pagination.current} / ${totalPages} 页`;
};

export const resolvePaginationTotalForControl = (params: {
  pagination: PaginationStateLike;
  supportsApproximateTotalPages: boolean;
}): number => {
  const { pagination, supportsApproximateTotalPages } = params;
  const exactTotal = toFiniteNonNegativeNumber(pagination.total) ?? 0;
  const approximateTotal = resolveApproximateTotal(pagination);
  if (pagination.totalKnown !== false) return exactTotal;
  if (supportsApproximateTotalPages && approximateTotal !== null) return approximateTotal;
  return exactTotal;
};

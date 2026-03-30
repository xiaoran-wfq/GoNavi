import { describe, expect, it } from 'vitest';

import { resolveDataViewerAutoFetchAction } from './dataViewerAutoFetch';

describe('resolveDataViewerAutoFetchAction', () => {
  it('skips one fetch while tab state is hydrating', () => {
    expect(resolveDataViewerAutoFetchAction({
      skipNextAutoFetch: true,
      hasInitialLoad: false,
    })).toBe('skip');
  });

  it('loads current page on the first real fetch', () => {
    expect(resolveDataViewerAutoFetchAction({
      skipNextAutoFetch: false,
      hasInitialLoad: false,
    })).toBe('load-current-page');
  });

  it('reloads from first page after sort or filter changes', () => {
    expect(resolveDataViewerAutoFetchAction({
      skipNextAutoFetch: false,
      hasInitialLoad: true,
    })).toBe('reload-first-page');
  });
});

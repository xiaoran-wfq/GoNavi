export type DataViewerAutoFetchAction = 'skip' | 'load-current-page' | 'reload-first-page';

export const resolveDataViewerAutoFetchAction = (params: {
  skipNextAutoFetch: boolean;
  hasInitialLoad: boolean;
}): DataViewerAutoFetchAction => {
  if (params.skipNextAutoFetch) {
    return 'skip';
  }

  if (!params.hasInitialLoad) {
    return 'load-current-page';
  }

  return 'reload-first-page';
};

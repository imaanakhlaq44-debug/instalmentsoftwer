import { useState, useEffect, useRef } from 'react';
import type { Pagination as PaginationMeta } from '../services/api.js';

export interface PaginationState {
  page: number;
  limit: number;
  pagination: PaginationMeta | null;
  setPage: (page: number) => void;
  setLimit: (limit: number) => void;
  setPagination: (meta: PaginationMeta | null) => void;
  /** Spread into the API call: `ApiService.getX({ ...paged.params, search })`. */
  params: { page: number; limit: number };
}

/**
 * Page/limit state for a paginated list.
 *
 * `filterDeps` are the values that change what is being listed (search text,
 * status tab, selected dealer). When any of them change the list jumps back to
 * page 1 — otherwise filtering while on page 7 shows an empty table, which
 * reads as "no results" rather than "you are past the end".
 */
export function usePagination(filterDeps: unknown[] = [], initialLimit = 50): PaginationState {
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(initialLimit);
  const [pagination, setPagination] = useState<PaginationMeta | null>(null);

  // Skip the reset on first render so the initial fetch isn't fired twice.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, filterDeps);

  return {
    page,
    limit,
    pagination,
    setPage,
    setLimit: (next: number) => {
      setLimit(next);
      setPage(1);
    },
    setPagination,
    params: { page, limit },
  };
}

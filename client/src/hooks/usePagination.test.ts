import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';

import { usePagination } from './usePagination.js';

const meta = (over: Partial<{ page: number; total: number }> = {}) => ({
  page: over.page ?? 1,
  limit: 50,
  total: over.total ?? 120,
  totalPages: 3,
  hasNextPage: true,
  hasPreviousPage: false,
});

describe('usePagination', () => {
  it('starts on page 1 with the given limit', () => {
    const { result } = renderHook(() => usePagination([], 25));

    expect(result.current.page).toBe(1);
    expect(result.current.limit).toBe(25);
    expect(result.current.params).toEqual({ page: 1, limit: 25 });
  });

  it('defaults to 50 per page', () => {
    const { result } = renderHook(() => usePagination());
    expect(result.current.limit).toBe(50);
  });

  it('moves between pages', () => {
    const { result } = renderHook(() => usePagination());

    act(() => result.current.setPage(3));

    expect(result.current.page).toBe(3);
    expect(result.current.params.page).toBe(3);
  });

  it('holds the pagination meta the server returned', () => {
    const { result } = renderHook(() => usePagination());

    act(() => result.current.setPagination(meta()));

    expect(result.current.pagination?.total).toBe(120);
  });

  /**
   * Changing the page size while on page 7 would ask for a page that may not
   * exist at the new size, so the list goes back to the start.
   */
  it('returns to page 1 when the page size changes', () => {
    const { result } = renderHook(() => usePagination());

    act(() => result.current.setPage(7));
    act(() => result.current.setLimit(100));

    expect(result.current.limit).toBe(100);
    expect(result.current.page).toBe(1);
  });
});

/**
 * The reason the hook takes `filterDeps` at all: filtering while on page 7
 * shows an empty table, which a user reads as "no results" rather than "you
 * are past the end of the new result set".
 */
describe('filter changes', () => {
  it('returns to page 1 when a filter changes', () => {
    const { result, rerender } = renderHook(({ search }) => usePagination([search]), {
      initialProps: { search: '' },
    });

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    rerender({ search: 'galaxy' });

    expect(result.current.page).toBe(1);
  });

  it('does not reset when an unrelated re-render happens', () => {
    const { result, rerender } = renderHook(({ search }) => usePagination([search]), {
      initialProps: { search: 'galaxy' },
    });

    act(() => result.current.setPage(4));
    rerender({ search: 'galaxy' });

    expect(result.current.page).toBe(4);
  });

  it('watches every dependency it is given', () => {
    const { result, rerender } = renderHook(
      ({ search, status }) => usePagination([search, status]),
      { initialProps: { search: '', status: 'ALL' } }
    );

    act(() => result.current.setPage(5));
    rerender({ search: '', status: 'OVERDUE' });

    expect(result.current.page).toBe(1);
  });

  /**
   * The hook skips its reset on the first run. Without that, mounting a list
   * page would set state during the initial render and fire the first fetch
   * twice.
   */
  it('does not reset on the first render', () => {
    const { result } = renderHook(() => usePagination(['initial-search']));

    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(2));
    expect(result.current.page).toBe(2);
  });
});

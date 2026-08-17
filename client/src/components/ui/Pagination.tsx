import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { Pagination as PaginationMeta } from '../../services/api.js';

interface Props {
  pagination: PaginationMeta | null;
  onPageChange: (page: number) => void;
  onLimitChange?: (limit: number) => void;
  /** Noun shown in the summary line, e.g. "devices". */
  itemLabel?: string;
  disabled?: boolean;
}

const PAGE_SIZES = [25, 50, 100, 200];

/**
 * Builds a compact page list with ellipses: 1 … 4 5 [6] 7 8 … 20.
 * Rendering every page number breaks the layout once a shop has a few thousand
 * records, which is exactly when pagination starts to matter.
 */
function pageWindow(current: number, total: number): (number | 'gap')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);

  const pages = new Set<number>([1, total, current]);
  for (const offset of [-2, -1, 1, 2]) {
    const p = current + offset;
    if (p > 1 && p < total) pages.add(p);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const result: (number | 'gap')[] = [];

  sorted.forEach((page, idx) => {
    if (idx > 0 && page - sorted[idx - 1] > 1) result.push('gap');
    result.push(page);
  });

  return result;
}

export const Pagination: React.FC<Props> = ({
  pagination,
  onPageChange,
  onLimitChange,
  itemLabel = 'records',
  disabled = false,
}) => {
  // A single page of results needs no controls at all — but the count is still
  // useful, so we keep the summary line and drop the buttons.
  if (!pagination || pagination.total === 0) return null;

  const { page, limit, total, totalPages, hasNextPage, hasPreviousPage } = pagination;
  const first = (page - 1) * limit + 1;
  const last = Math.min(page * limit, total);

  return (
    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-slate-100 bg-slate-50/60">
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span>
          Showing <span className="font-semibold text-slate-900">{first.toLocaleString()}</span>–
          <span className="font-semibold text-slate-900">{last.toLocaleString()}</span> of{' '}
          <span className="font-semibold text-slate-900">{total.toLocaleString()}</span> {itemLabel}
        </span>

        {onLimitChange && (
          <label className="hidden sm:flex items-center gap-1.5 text-slate-500">
            <span>Per page</span>
            <select
              value={limit}
              disabled={disabled}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              className="px-2 py-1 rounded-lg border border-slate-200 bg-white text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 disabled:opacity-50"
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center gap-1" aria-label="Pagination">
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={!hasPreviousPage || disabled}
            aria-label="Previous page"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          </button>

          {pageWindow(page, totalPages).map((entry, idx) =>
            entry === 'gap' ? (
              <span key={`gap-${idx}`} className="px-1.5 text-slate-400 text-xs select-none">
                …
              </span>
            ) : (
              <button
                key={entry}
                type="button"
                onClick={() => onPageChange(entry)}
                disabled={disabled}
                aria-current={entry === page ? 'page' : undefined}
                className={`min-w-[30px] px-2 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                  entry === page
                    ? 'bg-navy-950 text-white'
                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-100'
                } disabled:opacity-50`}
              >
                {entry}
              </button>
            )
          )}

          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={!hasNextPage || disabled}
            aria-label="Next page"
            className="p-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </nav>
      )}
    </div>
  );
};

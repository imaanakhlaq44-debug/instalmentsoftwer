import React, { useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import { Paged } from '../../services/api.js';
import { CsvColumn, exportCsv } from '../../utils/csv.js';
import { useAuth } from '../../context/AuthContext.js';

/** The server caps `limit` at 200, so large exports are fetched in chunks. */
const CHUNK_SIZE = 200;
/** Safety stop so a runaway loop can never hammer the API. */
const MAX_CHUNKS = 100;

interface Props<T> {
  /** Called with page/limit; must apply the SAME filters as the visible list. */
  fetchPage: (params: { page: number; limit: number }) => Promise<Paged<T>>;
  columns: CsvColumn<T>[];
  /** File name prefix, e.g. "payments" → payments-2026-08-17.csv */
  filenamePrefix: string;
  label?: string;
  disabled?: boolean;
}

/**
 * Exports the whole filtered result set, not just the page on screen.
 *
 * An export that silently contained only the visible 50 rows would be worse
 * than no export at all — the shopkeeper would hand a short list to their
 * accountant without realising it.
 */
export function ExportButton<T>({
  fetchPage,
  columns,
  filenamePrefix,
  label = 'Export CSV',
  disabled = false,
}: Props<T>) {
  const { showToast } = useAuth();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const handleExport = async () => {
    setBusy(true);
    setProgress(null);

    try {
      const rows: T[] = [];
      let page = 1;
      let totalPages = 1;

      do {
        const result = await fetchPage({ page, limit: CHUNK_SIZE });
        rows.push(...result.data);
        totalPages = result.pagination?.totalPages ?? 1;

        if (totalPages > 1) {
          setProgress(`${Math.min(page, totalPages)} / ${totalPages}`);
        }
        page++;
      } while (page <= totalPages && page <= MAX_CHUNKS);

      if (rows.length === 0) {
        showToast('There is nothing to export with the current filters.', 'info');
        return;
      }

      exportCsv(filenamePrefix, rows, columns);
      showToast(`Exported ${rows.length.toLocaleString()} row(s) to CSV.`, 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Export failed. Please try again.', 'error');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={busy || disabled}
      className="flex items-center gap-1.5 px-3.5 py-2 bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      title="Download the full filtered list as a CSV file"
    >
      {busy ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin text-blue-600" aria-hidden="true" />
          {progress ? `Exporting ${progress}` : 'Exporting…'}
        </>
      ) : (
        <>
          <Download className="w-4 h-4 text-emerald-600" aria-hidden="true" />
          {label}
        </>
      )}
    </button>
  );
}

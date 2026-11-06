import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { usePagination } from '../hooks/usePagination.js';
import { csvMoney, csvDate, csvDateTime, CsvColumn } from '../utils/csv.js';

import { FileSpreadsheet, RefreshCw, ArrowDownRight, ArrowUpRight, TrendingUp } from 'lucide-react';

export const TransactionsPage: React.FC = () => {
  const { selectedDealerId, showToast } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [totals, setTotals] = useState<{ inflow: number; outflow: number; net: number; count: number } | null>(null);

  const paged = usePagination([selectedDealerId]);

  const txCsvColumns: CsvColumn<any>[] = [
    { header: 'Transaction ID', value: (t) => t.id },
    { header: 'Date', value: (t) => csvDateTime(t.date) },
    { header: 'Customer', value: (t) => t.customerName },
    { header: 'Phone', value: (t) => t.customerPhone },
    { header: 'Type', value: (t) => t.type },
    { header: 'Amount (PKR)', value: (t) => csvMoney(t.amount) },
    { header: 'Status', value: (t) => t.status },
    { header: 'Notes', value: (t) => t.notes },
  ];

  const [loading, setLoading] = useState(true);

  const loadTransactions = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getTransactions({ dealerId: selectedDealerId, ...paged.params });
      setTransactions(data.data);
      setTotals(data.totals);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadTransactions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit]);

  const totalCollected = transactions
    .filter((t) => t.status === 'COMPLETED')
    .reduce((sum, t) => sum + t.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <p className="eyebrow">Money</p>
          <h1 className="mt-1 text-display text-ink-900">All transactions</h1>
          <p className="mt-1 max-w-2xl text-body text-ink-500">Every advance and installment received, in one list you can search and export.</p>
        </div>

        <div className="flex items-center gap-3">
        <ExportButton
          fetchPage={(p) => ApiService.getTransactions({ dealerId: selectedDealerId, ...p })}
          columns={txCsvColumns}
          filenamePrefix="transactions"
        />
        <div className="p-3 bg-white border border-slate-200 rounded-2xl flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center">
            <TrendingUp className="w-4 h-4" />
          </div>
          <div>
            <span className="text-micro text-slate-600 font-bold uppercase">Total Ledger Volume</span>
            <p className="text-sm font-extrabold text-slate-900">Rs. {totalCollected.toLocaleString()}</p>
          </div>
        </div>
        </div>
      </div>

      <div className="bg-white rounded-3xl border-2 border-ink-900 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> Loading transaction ledger...
          </div>
        ) : transactions.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <FileSpreadsheet className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No Transactions Found</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Transaction ID</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Date</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Description</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {transactions.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-mono font-bold text-slate-900">
                      #{t.id.slice(-8).toUpperCase()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800 block">{t.customerName}</span>
                      <span className="text-micro text-slate-400">{t.customerPhone}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-700">{t.type.replace('_', ' ')}</span>
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-slate-900">
                      Rs. {Number(t.amount).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-xs">
                      {new Date(t.date).toLocaleDateString()} {new Date(t.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="status-pill status-active text-micro">
                        {t.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-xs">
                      {t.notes || 'Ledger entry'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="transactions"
              disabled={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
};

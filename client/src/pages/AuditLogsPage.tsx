import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { usePagination } from '../hooks/usePagination.js';
import { csvMoney, csvDate, csvDateTime, CsvColumn } from '../utils/csv.js';

import { Activity, Search, ShieldCheck, RefreshCw, Lock, Unlock, User, CreditCard } from 'lucide-react';

export const AuditLogsPage: React.FC = () => {
  const { selectedDealerId, showToast } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [targetFilter, setTargetFilter] = useState('ALL');

  const paged = usePagination([searchQuery, targetFilter, selectedDealerId]);

  const auditQuery = (extra: Record<string, unknown>) => ({
    search: searchQuery || undefined,
    targetType: targetFilter === 'ALL' ? undefined : targetFilter,
    dealerId: selectedDealerId,
    ...extra,
  });

  const auditCsvColumns: CsvColumn<any>[] = [
    { header: 'Timestamp', value: (l) => csvDateTime(l.createdAt) },
    { header: 'Actor', value: (l) => l.actorName },
    { header: 'Role', value: (l) => l.actorRole },
    { header: 'Action', value: (l) => l.action },
    { header: 'Target Type', value: (l) => l.targetType },
    { header: 'Target ID', value: (l) => l.targetId },
    { header: 'Details', value: (l) => l.details },
    { header: 'IP Address', value: (l) => l.ipAddress },
  ];


  const loadAuditLogs = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getAuditLogs(auditQuery(paged.params));
      setLogs(data.data);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAuditLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, targetFilter, paged.page, paged.limit]);

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
          Immutable System Audit Trail
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Cryptographically recorded timeline of all dealer actions, lock commands, payment verifications, and policy modifications.
        </p>
        </div>
        <ExportButton
          fetchPage={(p) => ApiService.getAuditLogs(auditQuery(p))}
          columns={auditCsvColumns}
          filenamePrefix="audit-logs"
        />
      </div>

      {/* Filter Tabs & Search */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-card flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="flex items-center gap-2 overflow-x-auto w-full sm:w-auto">
          {['ALL', 'DEVICE', 'PAYMENT', 'CUSTOMER', 'POLICY', 'SYSTEM'].map((tab) => (
            <button
              key={tab}
              onClick={() => setTargetFilter(tab)}
              className={`px-3 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
                targetFilter === tab
                  ? 'bg-navy-950 text-white shadow-sm'
                  : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadAuditLogs();
          }}
          className="relative w-full sm:w-72"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search action or actor..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-1.5 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </form>
      </div>

      {/* Logs Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> Loading audit logs...
          </div>
        ) : logs.length === 0 ? (
          <div className="py-16 text-center text-xs text-slate-400">No matching audit logs found.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Timestamp</th>
                  <th className="py-3 px-4">Operator / Actor</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Action Event</th>
                  <th className="py-3 px-4">Target</th>
                  <th className="py-3 px-4">Audit Details</th>
                  <th className="py-3 px-4">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {logs.map((l) => (
                  <tr key={l.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleDateString()} {new Date(l.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                    <td className="py-3.5 px-4 font-bold text-slate-900">{l.actorName}</td>
                    <td className="py-3.5 px-4">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {l.actorRole}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-800">
                      {l.action.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-mono text-[11px] bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded font-bold">
                        {l.targetType}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-md">{l.details}</td>
                    <td className="py-3.5 px-4 text-slate-400 font-mono text-[11px]">{l.ipAddress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="log entries"
              disabled={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
};

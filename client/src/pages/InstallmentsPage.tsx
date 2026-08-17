import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { usePagination } from '../hooks/usePagination.js';
import { csvMoney, csvDate, csvDateTime, CsvColumn } from '../utils/csv.js';

import {
  CalendarDays,
  Search,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Smartphone,
  CreditCard,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export const InstallmentsPage: React.FC = () => {
  const { selectedDealerId, showToast, isDealerAdmin } = useAuth();
  const navigate = useNavigate();

  const [plans, setPlans] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [evaluatingOverdue, setEvaluatingOverdue] = useState(false);

  const paged = usePagination([statusFilter, selectedDealerId]);

  const planQuery = (extra: Record<string, unknown>) => ({
    status: statusFilter === 'ALL' ? undefined : statusFilter,
    dealerId: selectedDealerId,
    ...extra,
  });

  const planCsvColumns: CsvColumn<any>[] = [
    { header: 'Plan ID', value: (p) => p.id },
    { header: 'Customer', value: (p) => p.customerName },
    { header: 'Phone', value: (p) => p.customerPhone },
    { header: 'Device', value: (p) => `${p.deviceBrand} ${p.deviceModel}` },
    { header: 'IMEI', value: (p) => p.deviceImei },
    { header: 'Device Status', value: (p) => p.deviceStatus },
    { header: 'Total Price (PKR)', value: (p) => csvMoney(p.totalAmount) },
    { header: 'Down Payment (PKR)', value: (p) => csvMoney(p.downPayment) },
    { header: 'Financed (PKR)', value: (p) => csvMoney(p.financedAmount) },
    { header: 'Monthly (PKR)', value: (p) => csvMoney(p.monthlyInstallment) },
    { header: 'Paid Installments', value: (p) => p.paidInstallments },
    { header: 'Total Installments', value: (p) => p.totalInstallments },
    { header: 'Remaining Balance (PKR)', value: (p) => csvMoney(p.remainingBalance) },
    { header: 'Late Fees (PKR)', value: (p) => csvMoney(p.outstandingLateFees) },
    { header: 'Overdue Count', value: (p) => p.overdueInstallmentsCount },
    { header: 'Overdue Amount (PKR)', value: (p) => csvMoney(p.totalOverdueAmount) },
    { header: 'Next Due Date', value: (p) => p.nextDueDate ?? '' },
    { header: 'Plan Status', value: (p) => p.status },
  ];


  const loadPlans = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getInstallmentPlans(planQuery(paged.params));
      setPlans(data.data);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPlans();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, statusFilter, paged.page, paged.limit]);

  const handleRunOverdueEngine = async () => {
    try {
      setEvaluatingOverdue(true);
      const res = await ApiService.evaluateOverdue();
      showToast(res.message || 'Overdue engine completed', 'success');
      loadPlans();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setEvaluatingOverdue(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Installment Plans & Schedules
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Financing duration, monthly maturity, repayment balances, and automated grace-period overdue management.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
        <ExportButton
          fetchPage={(p) => ApiService.getInstallmentPlans(planQuery(p))}
          columns={planCsvColumns}
          filenamePrefix="installment-plans"
        />
        {isDealerAdmin && (
        <button
          onClick={handleRunOverdueEngine}
          disabled={evaluatingOverdue}
          className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-amber-500/20 transition-all self-start sm:self-auto"
        >
          <RefreshCw className={`w-4 h-4 ${evaluatingOverdue ? 'animate-spin' : ''}`} />
          <span>{evaluatingOverdue ? 'Evaluating...' : 'Run Automated Overdue Engine'}</span>
        </button>
        )}
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-card flex items-center gap-2 overflow-x-auto">
        {['ALL', 'CURRENT', 'OVERDUE', 'DUE_SOON', 'COMPLETED'].map((tab) => (
          <button
            key={tab}
            onClick={() => setStatusFilter(tab)}
            className={`px-4 py-1.5 rounded-xl text-xs font-bold whitespace-nowrap transition-all ${
              statusFilter === tab
                ? 'bg-navy-950 text-white shadow-sm'
                : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Plans Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin text-blue-600" /> Loading installment contracts...
          </div>
        ) : plans.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <CalendarDays className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No Installment Contracts Found</h3>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Plan / Contract</th>
                  <th className="py-3 px-4">Customer</th>
                  <th className="py-3 px-4">Financed Phone</th>
                  <th className="py-3 px-4">Total Amount</th>
                  <th className="py-3 px-4">Monthly Rate</th>
                  <th className="py-3 px-4">Repayment Progress</th>
                  <th className="py-3 px-4">Remaining Balance</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {plans.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      #{p.id.slice(-6).toUpperCase()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-800 block">{p.customerName}</span>
                      <span className="text-[10px] text-slate-400">{p.customerPhone}</span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="font-bold text-slate-900 block">{p.deviceBrand} {p.deviceModel}</span>
                      <span className="text-[10px] text-slate-400 font-mono">IMEI: {p.deviceImei}</span>
                    </td>
                    <td className="py-3.5 px-4 font-semibold text-slate-700">
                      Rs. {Number(p.totalAmount).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-blue-700">
                      Rs. {Number(p.monthlyInstallment).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <div className="space-y-1">
                        <div className="flex justify-between text-[11px] font-semibold text-slate-700">
                          <span>{p.paidInstallments}/{p.totalInstallments} Months</span>
                          <span>{Math.round((p.paidInstallments / p.totalInstallments) * 100)}%</span>
                        </div>
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            style={{ width: `${Math.min(100, Math.round((p.paidInstallments / p.totalInstallments) * 100))}%` }}
                            className="h-full bg-emerald-500 rounded-full"
                          ></div>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-slate-900">
                      Rs. {Number(p.remainingBalance).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`status-pill ${
                          p.status === 'OVERDUE'
                            ? 'status-overdue'
                            : p.status === 'COMPLETED'
                            ? 'status-active'
                            : 'status-active'
                        }`}
                      >
                        {p.status}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <button
                        onClick={() => navigate(`/devices/${p.deviceId}`)}
                        className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
                      >
                        Device 360
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="plans"
              disabled={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
};

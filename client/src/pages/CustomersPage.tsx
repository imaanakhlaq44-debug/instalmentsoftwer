import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import {
  Users,
  Search,
  PlusCircle,
  Smartphone,
  Phone,
  CreditCard,
  History,
  Eye,
  X,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';
import { EditCustomerModal } from '../components/modals/EditCustomerModal.js';
import { useNavigate } from 'react-router-dom';
import { Pagination } from '../components/ui/Pagination.js';
import { ExportButton } from '../components/ui/ExportButton.js';
import { usePagination } from '../hooks/usePagination.js';
import { csvMoney, csvDate, csvDateTime, CsvColumn } from '../utils/csv.js';


export const CustomersPage: React.FC = () => {
  const { selectedDealerId, showToast, isStaff } = useAuth();
  const navigate = useNavigate();

  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [showAddWizard, setShowAddWizard] = useState(false);
  const [viewCustomer, setViewCustomer] = useState<any | null>(null);
  const [editCustomer, setEditCustomer] = useState<any | null>(null);

  const paged = usePagination([searchQuery, selectedDealerId]);

  // Shared by the table and the CSV export so both always agree on the filters.
  const customerQuery = (extra: Record<string, unknown>) => ({
    search: searchQuery || undefined,
    dealerId: selectedDealerId,
    ...extra,
  });

  const customerCsvColumns: CsvColumn<any>[] = [
    { header: 'Name', value: (c) => c.name },
    { header: 'Phone', value: (c) => c.phone },
    { header: 'CNIC', value: (c) => c.cnic },
    { header: 'Address', value: (c) => c.address },
    { header: 'Emergency Contact', value: (c) => c.emergencyContactName },
    { header: 'Emergency Phone', value: (c) => c.emergencyContactPhone },
    { header: 'Devices', value: (c) => c.totalDevices },
    { header: 'Locked Devices', value: (c) => c.lockedDevices },
    { header: 'Outstanding Balance (PKR)', value: (c) => csvMoney(c.outstandingBalance) },
    { header: 'Late Fees (PKR)', value: (c) => csvMoney(c.outstandingLateFees) },
    { header: 'Advance Credit (PKR)', value: (c) => csvMoney(c.creditBalance) },
    { header: 'Payment Status', value: (c) => c.paymentStatus },
    { header: 'Last Payment Date', value: (c) => csvDate(c.lastPaymentDate) },
    { header: 'Last Payment (PKR)', value: (c) => csvMoney(c.lastPaymentAmount) },
    { header: 'Registered On', value: (c) => csvDate(c.createdAt) },
  ];


  const loadCustomers = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getCustomers(customerQuery(paged.params));
      setCustomers(data.data);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCustomers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit]);

  const handleViewCustomerDetail = async (custId: string) => {
    try {
      const data = await ApiService.getCustomer(custId);
      setViewCustomer(data);
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
            Customer Directory
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 mt-1">
            Financed customer profiles, identity verification, active smartphone allocations, and balances.
          </p>
        </div>

        <div className="flex items-center gap-3 self-start sm:self-auto">
          <ExportButton
            fetchPage={(p) => ApiService.getCustomers(customerQuery(p))}
            columns={customerCsvColumns}
            filenamePrefix="customers"
          />
          <button
            onClick={() => setShowAddWizard(true)}
            className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs sm:text-sm font-bold shadow-md shadow-blue-600/30 transition-all"
          >
            <PlusCircle className="w-4 h-4" /> Add Customer & Device
          </button>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-3xl border border-slate-200/80 shadow-card">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            loadCustomers();
          }}
          className="relative"
        >
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by customer name, mobile phone, or CNIC..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-600"
          />
        </form>
      </div>

      {/* Customers Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2 font-medium">
            <RefreshCw className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
            Loading customer records...
          </div>
        ) : customers.length === 0 ? (
          <div className="py-16 text-center space-y-3">
            <Users className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-800">No Customers Found</h3>
            <p className="text-xs text-slate-500">Add a new customer to initiate an installment financing contract.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                  <th className="py-3 px-4">Customer Name</th>
                  <th className="py-3 px-4">Phone (03XX)</th>
                  <th className="py-3 px-4">Masked CNIC</th>
                  <th className="py-3 px-4">Financed Devices</th>
                  <th className="py-3 px-4">Outstanding Balance</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Last Payment</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="py-3.5 px-4 font-bold text-slate-900">{c.name}</td>
                    <td className="py-3.5 px-4 text-slate-700">{c.phone}</td>
                    <td className="py-3.5 px-4 font-mono text-slate-600 bg-slate-50/50">{c.cnic}</td>
                    <td className="py-3.5 px-4">
                      <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-blue-50 text-blue-700 font-bold text-[11px]">
                        <Smartphone className="w-3 h-3" /> {c.totalDevices} Phone(s)
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-extrabold text-slate-900">
                      Rs. {Number(c.outstandingBalance || 0).toLocaleString()}
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`status-pill ${
                          c.paymentStatus === 'OVERDUE'
                            ? 'status-overdue'
                            : c.paymentStatus === 'COMPLETED'
                            ? 'status-active'
                            : 'status-active'
                        }`}
                      >
                        {c.paymentStatus}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-500 text-[11px]">
                      {c.lastPaymentAmount ? `Rs. ${c.lastPaymentAmount.toLocaleString()}` : 'None yet'}
                    </td>
                    <td className="py-3.5 px-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleViewCustomerDetail(c.id)}
                          className="px-3 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-600 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
                        >
                          Quick View
                        </button>
                        {isStaff && (
                          <button
                            onClick={() => setEditCustomer(c)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-amber-50 hover:text-amber-700 rounded-lg text-xs font-semibold text-slate-700 transition-colors"
                          >
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => navigate(`/customers/${c.id}`)}
                          className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-semibold transition-colors"
                        >
                          Full Profile
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="customers"
              disabled={loading}
            />
          </div>
        )}
      </div>

      {/* MODAL: Customer 360 Profile */}
      {viewCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white p-6 rounded-3xl max-w-2xl w-full space-y-5 shadow-2xl my-8">
            <div className="flex items-center justify-between border-b pb-3">
              <div>
                <span className="text-xs uppercase font-bold text-blue-600">Customer 360 Profile</span>
                <h3 className="text-lg font-bold text-slate-900">{viewCustomer.customer.name}</h3>
              </div>
              <button onClick={() => setViewCustomer(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Customer Info Box */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-slate-50 border rounded-2xl text-xs">
              <div>
                <span className="text-slate-400 block">Phone</span>
                <span className="font-bold text-slate-800">{viewCustomer.customer.phone}</span>
              </div>
              <div>
                <span className="text-slate-400 block">CNIC</span>
                <span className="font-mono font-bold text-slate-800">{viewCustomer.customer.cnic}</span>
              </div>
              <div>
                <span className="text-slate-400 block">Emergency Contact</span>
                <span className="font-medium text-slate-800">
                  {viewCustomer.customer.emergencyContactName} ({viewCustomer.customer.emergencyContactPhone})
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400 block">Address</span>
                <span className="font-medium text-slate-800">{viewCustomer.customer.address}</span>
              </div>
            </div>

            {/* Allocated Financed Devices */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Allocated Financed Smartphones ({viewCustomer.devices.length})
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {viewCustomer.devices.map((d: any) => (
                  <div
                    key={d.id}
                    onClick={() => {
                      setViewCustomer(null);
                      navigate(`/devices/${d.id}`);
                    }}
                    className="p-3 bg-slate-50 hover:bg-blue-50/50 border rounded-2xl cursor-pointer transition-all flex items-center justify-between"
                  >
                    <div>
                      <span className="font-bold text-slate-900 block text-xs">
                        {d.brand} {d.model}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">IMEI: ***************{d.imei.slice(-4)}</span>
                    </div>
                    <span
                      className={`status-pill text-[10px] ${
                        d.status === 'LOCKED' ? 'status-locked' : d.status === 'OVERDUE' ? 'status-overdue' : 'status-active'
                      }`}
                    >
                      {d.status}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Payment History */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Recent Repayments ({viewCustomer.payments.length})
              </h4>
              <div className="max-h-40 overflow-y-auto divide-y divide-slate-100 text-xs">
                {viewCustomer.payments.map((p: any) => (
                  <div key={p.id} className="py-2 flex items-center justify-between">
                    <div>
                      <span className="font-bold text-slate-800">Rs. {p.amount.toLocaleString()}</span>
                      <span className="text-[10px] text-slate-400 ml-2">via {p.paymentMethod} (Ref: {p.referenceNumber})</span>
                    </div>
                    <span className="text-[10px] text-emerald-600 font-semibold">Verified ✓</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setViewCustomer(null)}
                className="px-5 py-2 bg-slate-900 text-white rounded-xl text-xs font-bold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Wizard */}
      {showAddWizard && (
        <AddCustomerWizardModal
          onClose={() => setShowAddWizard(false)}
          onSuccess={() => {
            setShowAddWizard(false);
            loadCustomers();
          }}
        />
      )}

      {editCustomer && (
        <EditCustomerModal
          customer={editCustomer}
          onClose={() => setEditCustomer(null)}
          onSaved={loadCustomers}
        />
      )}
    </div>
  );
};

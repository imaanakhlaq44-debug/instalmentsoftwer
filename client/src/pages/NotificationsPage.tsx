import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { usePagination } from '../hooks/usePagination.js';

import { Bell, MessageSquare, Send, RefreshCw, Smartphone, CheckCircle2, AlertTriangle } from 'lucide-react';

export const NotificationsPage: React.FC = () => {
  const { selectedDealerId, showToast } = useAuth();
  const [notifications, setNotifications] = useState<any[]>([]);
  // Surfaced in the UI so nobody assumes a queued message actually reached a phone.
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const paged = usePagination([selectedDealerId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [notifs, tmpls] = await Promise.all([
        ApiService.getNotifications({ dealerId: selectedDealerId, ...paged.params }),
        ApiService.getNotificationTemplates(),
      ]);
      setNotifications(notifs.data);
      paged.setPagination(notifs.pagination);
      setDeliveryNote(notifs.deliveryEnabled ? null : notifs.deliveryNote);
      setTemplates(tmpls);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, paged.page, paged.limit]);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
          Notification Center & Customer Alerts
        </h1>
        <p className="text-xs sm:text-sm text-slate-500 mt-1">
          Automated SMS due date reminders, overdue warnings, push lock alerts, and payment receipts.
        </p>
      </div>

      {/* Nothing here has actually reached a customer's phone. Saying so plainly
          is the only honest option until an SMS gateway is connected. */}
      {deliveryNote && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-amber-900">Messages are not being delivered yet</p>
            <p className="text-xs text-amber-800 mt-0.5">{deliveryNote}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Notification Stream */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-3xl border border-slate-200/80 shadow-card overflow-hidden">
            <div className="p-4 border-b border-slate-100 font-bold text-slate-900 text-xs flex items-center justify-between">
              <span>Dispatched Customer Notifications ({notifications.length})</span>
              <button onClick={loadData} className="text-slate-400 hover:text-slate-600">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>

            {loading ? (
              <div className="p-12 text-center text-xs text-slate-400">Loading notifications...</div>
            ) : notifications.length === 0 ? (
              <div className="p-12 text-center text-xs text-slate-400">No notifications dispatched yet.</div>
            ) : (
              <div className="divide-y divide-slate-100">
                {notifications.map((n) => (
                  <div key={n.id} className="p-4 hover:bg-slate-50 transition-colors space-y-1 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                        {n.title}
                      </span>
                      <span className="text-[10px] text-slate-400">{new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="text-slate-600 text-xs leading-relaxed">{n.message}</p>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1">
                      <span>Customer: {n.customerName} ({n.channel})</span>
                      <span className="text-emerald-600 font-semibold">{n.status} ✓</span>
                    </div>
                  </div>
                ))}
                <Pagination
                  pagination={paged.pagination}
                  onPageChange={paged.setPage}
                  onLimitChange={paged.setLimit}
                  itemLabel="messages"
                  disabled={loading}
                />
              </div>
            )}
          </div>
        </div>

        {/* Right Col: Standard SMS Templates Preview */}
        <div className="space-y-4">
          <div className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-card space-y-3">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
              Standard Message Templates
            </h2>
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t.id} className="p-3 bg-slate-50 border rounded-2xl text-xs space-y-1">
                  <span className="font-bold text-slate-800 block">{t.name}</span>
                  <p className="text-[11px] text-slate-600 font-mono leading-relaxed bg-white p-2 rounded-lg border">
                    {t.bodyTemplate}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

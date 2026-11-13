import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { usePagination } from '../hooks/usePagination.js';
import { describeDelivery, smsCostLabel, SmsChannel } from '../utils/smsDelivery.js';
import { WhatsAppButton, type WhatsAppKind } from '../components/whatsapp/WhatsAppButton.js';

import { Bell, MessageSquare, MessageCircle, Send, RefreshCw, Smartphone, CheckCircle2, AlertTriangle, ShieldAlert, RadioTower } from 'lucide-react';

/** The WhatsApp message that follows up a queued notification of each type. */
const whatsappKindFor = (type: string): WhatsAppKind =>
  type === 'PAYMENT_OVERDUE' ? 'OVERDUE' : type === 'DEVICE_LOCKED' ? 'LOCK_WARNING' : 'DUE_REMINDER';

export const NotificationsPage: React.FC = () => {
  const { selectedDealerId, showToast, isStaff } = useAuth();
  /** Whether the server holds WhatsApp Business API credentials. Almost always false. */
  const [whatsappCloudEnabled, setWhatsappCloudEnabled] = useState(false);
  const [notifications, setNotifications] = useState<any[]>([]);
  // Surfaced in the UI so nobody assumes a queued message actually reached a phone.
  const [deliveryNote, setDeliveryNote] = useState<string | null>(null);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  /** Phones paired to send this dealership's SMS from their own SIM. */
  const [relays, setRelays] = useState<any[]>([]);
  const [deliveryEnabled, setDeliveryEnabled] = useState(false);
  /** How this shop's SMS leave: its paired phone, the SMS gateway, or both in turn. */
  const [smsChannel, setSmsChannel] = useState<SmsChannel>('PHONE');
  const [aggregator, setAggregator] = useState<{ configured: boolean; senderMask?: string }>({ configured: false });
  const [pairing, setPairing] = useState(false);
  const [relayName, setRelayName] = useState('');
  /**
   * The pairing code, held only until the page is left. The server transmits it
   * exactly once, so it is shown until dismissed and never fetched again.
   */
  const [pairingCode, setPairingCode] = useState<string | null>(null);

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
      setDeliveryEnabled(!!notifs.deliveryEnabled);
      setRelays(notifs.relays ?? []);
      setSmsChannel(notifs.smsChannel ?? 'PHONE');
      setAggregator(notifs.aggregator ?? { configured: false });
      setWhatsappCloudEnabled(!!notifs.whatsappCloudEnabled);
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

  const pairPhone = async () => {
    try {
      setPairing(true);
      const res = await ApiService.pairSmsRelay({ dealerId: selectedDealerId, name: relayName.trim() });
      setPairingCode(res.pairingCode);
      setRelayName('');
      showToast('Phone paired. Enter the code in the relay app.', 'success');
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setPairing(false);
    }
  };

  const unpairPhone = async (id: string, name: string) => {
    try {
      await ApiService.revokeSmsRelay(id);
      showToast(`"${name}" can no longer collect messages.`, 'info');
      loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <p className="eyebrow">Messages</p>
        <h1 className="mt-1 text-display text-ink-900">Reminders and alerts</h1>
        <p className="mt-1 max-w-2xl text-body text-ink-500">SMS reminders before a due date, late warnings and payment receipts sent to customers.</p>
      </div>

      {/* Whether a message reached a customer's phone is a fact, not a hope.
          The banner reflects whether a paired handset has actually checked in. */}
      {deliveryNote && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-amber-50 border border-amber-200">
          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-amber-900">Messages are not being delivered yet</p>
            <p className="text-xs text-amber-800 mt-0.5">{deliveryNote}</p>
          </div>
        </div>
      )}

      {deliveryEnabled && smsChannel === 'PHONE' && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-emerald-900">A paired phone is sending these messages</p>
            <p className="text-xs text-emerald-800 mt-0.5">
              They go out from that handset&apos;s own SIM and are charged to its package. &ldquo;Sent&rdquo; means
              the SIM accepted the message — a handset relay has no delivery receipt to offer.
            </p>
          </div>
        </div>
      )}

      {/* The gateway banner appears only for a shop that chose the gateway, on a
          server where an account is really configured. */}
      {smsChannel !== 'PHONE' && (
        <div className="flex items-start gap-3 p-4 rounded-2xl bg-emerald-50 border border-emerald-200">
          <RadioTower className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold text-emerald-900">The SMS gateway is sending these messages</p>
            {aggregator.senderMask && (
              <p className="text-xs font-bold text-emerald-900 mt-0.5">
                <span>Customers see the sender as:</span> <span data-i18n-skip>{aggregator.senderMask}</span>
              </p>
            )}
            <p className="text-xs text-emerald-800 mt-0.5">
              {smsChannel === 'AGGREGATOR_THEN_PHONE'
                ? 'A message the gateway cannot send is passed to your paired phone. “Sent” means the gateway or the SIM accepted the message, not that it reached the customer.'
                : '“Sent” means the gateway accepted the message, not that it reached the customer. A refused message is tried again, then shown as failed with the reason.'}
            </p>
            <p className="text-xs text-emerald-800 mt-0.5">You can change this in Settings, under “How SMS are sent”.</p>
          </div>
        </div>
      )}
      {/* WhatsApp: what works today, and what needs an account. */}
      <div className="flex items-start gap-3 p-4 rounded-2xl bg-white border-2 border-ink-900 shadow-card">
        <MessageCircle className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" aria-hidden="true" />
        <div>
          <p className="text-sm font-bold text-slate-900">WhatsApp</p>
          <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">
            Use the WhatsApp button beside any customer to open your own WhatsApp with the reminder already written.
            You press send yourself.
          </p>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            {whatsappCloudEnabled
              ? 'Automatic WhatsApp is connected. A message shows SENT once WhatsApp accepts it — that is not proof it was delivered.'
              : 'Automatic WhatsApp is not connected. That needs a WhatsApp Business API account from Meta.'}
          </p>
        </div>
      </div>

      {/* Paired phones — pairing and unpairing are staff-only on the server, so
          a customer reading their messages is not offered either. */}
      {isStaff && (
      <div className="bg-white rounded-3xl border-2 border-ink-900 shadow-card p-5 sm:p-6 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-sm font-extrabold text-slate-900 flex items-center gap-2">
              <Smartphone className="w-4 h-4 text-slate-500" aria-hidden="true" />
              Phones sending your SMS
            </h2>
            <p className="text-xs text-slate-500 mt-1 max-w-xl leading-relaxed">
              {smsChannel === 'AGGREGATOR'
                ? 'Your SMS go through the SMS gateway, so a paired phone is not given any messages right now.'
                : smsChannel === 'AGGREGATOR_THEN_PHONE'
                  ? 'Your SMS go through the SMS gateway first. A paired phone only sends what the gateway could not.'
                  : 'No SMS gateway is connected. Until one is, you can pair a phone of your own: it collects queued messages and sends them from its SIM. Fine for a small volume and for testing — a shop sending at scale needs an operator account with a registered sender mask.'}
            </p>
          </div>
        </div>

        {relays.length > 0 && (
          <div className="space-y-2">
            {relays.map((relay: any) => (
              <div
                key={relay.id}
                className="flex items-center justify-between gap-3 p-3 rounded-2xl border border-slate-200/80 bg-slate-50"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 truncate">{relay.name}</span>
                    <span
                      className={`text-micro uppercase font-bold px-2 py-0.5 rounded-full ${
                        relay.online ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'
                      }`}
                    >
                      {relay.online ? 'Connected' : 'Not checked in'}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Sent {relay.sentCount} · failed {relay.failedCount} ·{' '}
                    {relay.lastSeenAt ? `last seen ${new Date(relay.lastSeenAt).toLocaleString()}` : 'never seen'}
                  </p>
                </div>
                <button
                  onClick={() => unpairPhone(relay.id, relay.name)}
                  className="text-xs font-bold text-rose-600 hover:text-rose-500 shrink-0"
                >
                  Unpair
                </button>
              </div>
            ))}
          </div>
        )}

        {pairingCode && (
          <div className="p-4 rounded-2xl bg-slate-950 text-white space-y-2">
            <p className="text-micro uppercase font-bold text-slate-600 tracking-wider">
              Pairing code — shown once
            </p>
            <p className="font-mono text-xs font-bold text-emerald-400 break-all">{pairingCode}</p>
            <p className="text-xs text-slate-300">
              Enter this in the Almas SDM Relay app on the phone. It cannot be retrieved again; if it is lost,
              unpair the phone and pair it afresh.
            </p>
            <button
              onClick={() => setPairingCode(null)}
              className="text-xs font-bold text-slate-300 hover:text-white underline"
            >
              I have entered it
            </button>
          </div>
        )}

        <div className="flex items-end gap-2 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="text-micro uppercase font-bold text-slate-500 tracking-wider block mb-1">
              Pair a phone
            </label>
            <input
              value={relayName}
              onChange={(e) => setRelayName(e.target.value)}
              placeholder="Counter phone"
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={pairPhone}
            disabled={pairing || relayName.trim().length < 2}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 disabled:opacity-40 text-white rounded-xl text-xs font-bold"
          >
            {pairing ? 'Pairing…' : 'Pair'}
          </button>
        </div>
      </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Notification Stream */}
        <div className="lg:col-span-2 space-y-4">
          <div className="bg-white rounded-3xl border-2 border-ink-900 shadow-card overflow-hidden">
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
                {notifications.map((n) => {
                  const isSecurityAlert = n.type === 'SECURITY_ALERT';
                  const delivery = describeDelivery(n);
                  const cost = smsCostLabel(n.sms);
                  return (
                    <div
                      key={n.id}
                      className={`p-4 transition-colors space-y-1 text-xs ${
                        isSecurityAlert ? 'bg-rose-50/70 hover:bg-rose-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`font-bold flex items-center gap-1.5 ${
                            isSecurityAlert ? 'text-rose-900' : 'text-slate-800'
                          }`}
                        >
                          {isSecurityAlert ? (
                            <ShieldAlert className="w-3.5 h-3.5 text-rose-600 shrink-0" aria-hidden="true" />
                          ) : (
                            <MessageSquare className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                          )}
                          {n.title}
                        </span>
                        <span className="text-micro text-slate-400 shrink-0">
                          {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <p className={`${isSecurityAlert ? 'text-rose-950' : 'text-slate-600'} text-xs leading-relaxed`}>
                        {n.message}
                      </p>
                      <div className="flex items-center justify-between text-micro text-slate-500 pt-1 gap-2 flex-wrap">
                        <span>
                          Customer: {n.customerName}
                          {n.deviceModel && n.deviceModel !== 'N/A' ? ` · ${n.deviceModel}` : ''} ({n.channel})
                        </span>
                        {/* The status as it is: only a sent message gets the green. */}
                        <span className="flex items-center gap-1.5 shrink-0">
                          {isStaff && n.customerId && !isSecurityAlert && (
                            <WhatsAppButton
                              customerId={n.customerId}
                              customerName={n.customerName}
                              kind={whatsappKindFor(n.type)}
                            />
                          )}
                          <span
                            className={`uppercase font-bold px-2 py-0.5 rounded-full ${
                              delivery.tone === 'sent'
                                ? 'bg-emerald-100 text-emerald-700'
                                : delivery.tone === 'failed'
                                  ? 'bg-rose-100 text-rose-700'
                                  : 'bg-amber-100 text-amber-800'
                            }`}
                          >
                            {delivery.label}
                          </span>
                          {delivery.via && <span className="font-semibold text-slate-600">{delivery.via}</span>}
                        </span>
                      </div>
                      {(cost || delivery.reason) && (
                        <div className="text-micro text-slate-500 space-y-0.5">
                          {cost && <p>{cost}</p>}
                          {delivery.reason && (
                            <p className={delivery.tone === 'failed' ? 'text-rose-700' : 'text-amber-800'}>
                              <span className="font-semibold">Reason:</span>{' '}
                              <span data-i18n-skip>{delivery.reason}</span>
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
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
          <div className="bg-white p-5 rounded-3xl border-2 border-ink-900 shadow-card space-y-3">
            <h2 className="text-xs font-bold text-slate-600 uppercase tracking-wider">
              Standard Message Templates
            </h2>
            <div className="space-y-3">
              {templates.map((t) => (
                <div key={t.id} className="p-3 bg-slate-50 border rounded-2xl text-xs space-y-1">
                  <span className="font-bold text-slate-800 block">{t.name}</span>
                  <p className="text-xs text-slate-600 font-mono leading-relaxed bg-white p-2 rounded-lg border">
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

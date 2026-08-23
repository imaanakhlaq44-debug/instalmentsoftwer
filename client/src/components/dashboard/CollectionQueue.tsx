import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Phone, ChevronRight, PartyPopper, Lock } from 'lucide-react';
import { money, overdueLabel } from '../../utils/format.js';
import { EmptyState, Rows } from '../ui/Card.js';

/**
 * Who to call today.
 *
 * The server has answered this question since the day `/dashboard/attention`
 * was written, and the old dashboard never asked it — a shop owner opened the
 * app to eight tiles of aggregates and still had to go hunting for names. This
 * panel is the reason the redesign exists, so it sits directly under the money
 * and above everything else.
 *
 * One row per *person*, not per installment. Kashif being three months behind is
 * one phone call, not three rows — so the arrears are summed and the row carries
 * the worst of them. The phone number is a real `tel:` link: on the counter phone
 * this dashboard is half-used from, chasing a payment is now one tap.
 */

export interface OverdueRow {
  installmentId: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId: string;
  deviceName: string;
  deviceStatus: string;
  amountOutstanding: number;
  daysOverdue: number;
}

interface Chase {
  customerId: string;
  customerName: string;
  customerPhone: string;
  deviceId: string;
  deviceName: string;
  deviceStatus: string;
  total: number;
  worstDays: number;
  count: number;
}

/** Collapses the installment rows into one line per customer, worst first. */
export function toChaseList(rows: OverdueRow[]): Chase[] {
  const byCustomer = new Map<string, Chase>();

  for (const r of rows) {
    const existing = byCustomer.get(r.customerId);
    if (existing) {
      existing.total += r.amountOutstanding;
      existing.count += 1;
      existing.worstDays = Math.max(existing.worstDays, r.daysOverdue);
      // Keep the device that is in the most trouble on the row.
      if (r.deviceStatus === 'LOCKED') {
        existing.deviceName = r.deviceName;
        existing.deviceStatus = r.deviceStatus;
      }
    } else {
      byCustomer.set(r.customerId, {
        customerId: r.customerId,
        customerName: r.customerName,
        customerPhone: r.customerPhone,
        deviceId: r.deviceId,
        deviceName: r.deviceName,
        deviceStatus: r.deviceStatus,
        total: r.amountOutstanding,
        worstDays: r.daysOverdue,
        count: 1,
      });
    }
  }

  return [...byCustomer.values()].sort(
    (a, b) => b.worstDays - a.worstDays || b.total - a.total
  );
}

/** Past a month late the row earns the critical tone; before that it is a nudge. */
const toneFor = (days: number) =>
  days >= 30
    ? 'bg-critical-50 text-critical-700 border-critical-200'
    : 'bg-caution-50 text-caution-700 border-caution-200';

export const CollectionQueue: React.FC<{ rows: OverdueRow[]; limit?: number }> = ({
  rows,
  limit = 6,
}) => {
  const navigate = useNavigate();
  const chases = toChaseList(rows);

  if (!chases.length) {
    return (
      <EmptyState
        icon={<PartyPopper className="h-6 w-6" aria-hidden="true" />}
        title="Nobody is behind today"
        body="Every active installment is paid up to date. This list fills itself as instalments fall due."
      />
    );
  }

  return (
    <Rows>
      {chases.slice(0, limit).map((c) => (
        <li key={c.customerId} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => navigate(`/customers/${c.customerId}`)}
                className="truncate text-body font-medium text-ink-900 hover:text-accent-700"
              >
                {c.customerName}
              </button>
              <span className={`status-pill shrink-0 ${toneFor(c.worstDays)}`}>
                {overdueLabel(c.worstDays)}
              </span>
              {/* A locked handset is the one fact on this row that must never be
                  the thing that gets truncated away, so it is a mark beside the
                  name rather than the tail of a sentence. */}
              {c.deviceStatus === 'LOCKED' && (
                <Lock
                  className="h-3.5 w-3.5 shrink-0 text-critical-600"
                  aria-label="Device is locked"
                />
              )}
            </div>
            <p className="mt-0.5 truncate text-caption text-ink-400">
              {c.deviceName}
              {c.count > 1 && ` · ${c.count} instalments`}
            </p>
          </div>

          <div className="shrink-0 text-right">
            <p className="text-body font-medium text-ink-900 tabular">{money(c.total)}</p>
            <p className="text-micro normal-case tracking-normal text-ink-400">outstanding</p>
          </div>

          <div className="flex items-center gap-1">
            <a
              href={`tel:${c.customerPhone.replace(/[^\d+]/g, '')}`}
              className="btn-ghost h-8 w-8 rounded-md p-0"
              title={`Call ${c.customerName} on ${c.customerPhone}`}
              aria-label={`Call ${c.customerName}`}
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
            </a>
            <button
              type="button"
              onClick={() => navigate(`/devices/${c.deviceId}`)}
              className="btn-ghost h-8 w-8 rounded-md p-0"
              title="Open device"
              aria-label={`Open ${c.deviceName}`}
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        </li>
      ))}
    </Rows>
  );
};

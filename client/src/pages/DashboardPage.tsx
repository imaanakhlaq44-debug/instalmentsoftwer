import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, QrCode, RefreshCw, ArrowRight, BadgeCheck } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { AddCustomerWizardModal } from '../components/modals/AddCustomerWizardModal.js';
import { Card, CardHeader, Skeleton } from '../components/ui/Card.js';
import { CollectionTrend, CollectionTrendLegend } from '../components/charts/CollectionTrend.js';
import { FleetBar, type FleetSegment } from '../components/dashboard/FleetBar.js';
import { CollectionQueue, type OverdueRow } from '../components/dashboard/CollectionQueue.js';
import { money, moneyShort, longDate, greeting, firstName } from '../utils/format.js';

/**
 * The dashboard is a morning briefing, not a wall of metrics.
 *
 * It answers three questions in the order a shop owner actually asks them:
 *
 *   1. Is my money alright?      — the band at the top: outstanding, at risk,
 *                                  collected this month against target.
 *   2. What do I do today?       — the collection queue: who to call, with the
 *                                  phone number as a link.
 *   3. How is the fleet?         — one part-to-whole bar, then the trend.
 *
 * The previous version opened with eight tiles in eight colours, none of which
 * outranked the others, and never showed a customer's name at all.
 *
 * One rule worth keeping: this page renders no invented figures. It used to seed
 * its state with plausible-looking demo numbers, so a failed request left a
 * dealer reading fiction. Now it holds nulls and shows skeletons.
 */

interface Stats {
  totalDevices: number;
  activeDevices: number;
  pendingDevices: number;
  lockedDevices: number;
  overdueDevices: number;
  inactiveDevices: number;
  totalCustomers: number;
  activePlans: number;
  outstandingAmount: number;
  overdueAmount: number;
  overdueInstallmentsCount: number;
  collectedThisMonth: number;
  pendingVerificationAmount: number;
  collectionRatePercentage: number;
}

export const DashboardPage: React.FC = () => {
  const { user, dealer, selectedDealerId, showToast, isStaff, isDealerAdmin } = useAuth();
  const navigate = useNavigate();

  const [stats, setStats] = useState<Stats | null>(null);
  const [charts, setCharts] = useState<any>(null);
  const [overdueRows, setOverdueRows] = useState<OverdueRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [evaluating, setEvaluating] = useState(false);
  const [showAddWizard, setShowAddWizard] = useState(false);

  const loadData = async () => {
    try {
      setLoading(true);
      const [statsData, chartsData] = await Promise.all([
        ApiService.getDashboardStats(selectedDealerId),
        ApiService.getDashboardCharts(selectedDealerId),
      ]);
      setStats(statsData);
      setCharts(chartsData);

      // Only staff may ask who is behind, so a customer never triggers a 403.
      if (isStaff) {
        const attention = await ApiService.getAttentionList(selectedDealerId);
        setOverdueRows(attention.overdueInstallments ?? []);
      }
    } catch (err: any) {
      showToast(err?.message || 'Could not load the dashboard', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId]);

  const handleRunOverdueEngine = async () => {
    try {
      setEvaluating(true);
      const res = await ApiService.evaluateOverdue();
      showToast(res.message || 'Overdue evaluation finished', 'success');
      await loadData();
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setEvaluating(false);
    }
  };

  const name = firstName(user?.name || dealer?.ownerName);
  const target = charts?.monthlyTrends?.find((m: any) => m.target > 0)?.target ?? 0;
  const collected = stats?.collectedThisMonth ?? 0;
  const targetPct = target > 0 ? Math.min(100, Math.round((collected / target) * 100)) : null;

  /**
   * The brand bars are scaled against the leading brand, not the whole fleet.
   * Against the fleet the longest bar reached a quarter of its track and every
   * brand looked identical; this panel is a ranking, so the leader sets the
   * scale and the differences become visible.
   */
  const brandLeader: number = Math.max(
    1,
    ...((charts?.brandDistribution ?? []) as { count: number }[]).map((b) => b.count)
  );

  const fleet: FleetSegment[] = [
    { key: 'active', label: 'Active', count: stats?.activeDevices ?? 0, status: 'ACTIVE', tone: 'positive' },
    { key: 'overdue', label: 'Overdue', count: stats?.overdueDevices ?? 0, status: 'OVERDUE', tone: 'caution' },
    { key: 'locked', label: 'Locked', count: stats?.lockedDevices ?? 0, status: 'LOCKED', tone: 'critical' },
    { key: 'pending', label: 'Awaiting QR', count: stats?.pendingDevices ?? 0, status: 'PENDING', tone: 'accent' },
    { key: 'inactive', label: 'Inactive', count: stats?.inactiveDevices ?? 0, status: 'INACTIVE', tone: 'neutral' },
  ];

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      {/* Dateline and greeting. A person is being spoken to, so the        */}
      {/* greeting is set in the serif and the date is quiet above it.      */}
      {/* ---------------------------------------------------------------- */}
      {/* Stacks until there is genuinely room for both. Side by side at 1040px
          the greeting was breaking across two lines to make space for three
          buttons, which is the layout apologising for itself. */}
      <header className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{longDate()}</p>
          <h1 className="mt-1 font-serif text-display text-ink-900">
            {greeting()}, {name}
          </h1>
          <p className="mt-1 text-body text-ink-500">
            {stats
              ? `${stats.activePlans} active plans · ${stats.totalCustomers} customers`
              : 'Loading your portfolio…'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDealerAdmin && (
            <button
              type="button"
              onClick={handleRunOverdueEngine}
              disabled={evaluating}
              className="btn-ghost"
              title="Re-check every active instalment against the grace period. This runs itself nightly."
            >
              <RefreshCw className={`h-4 w-4 ${evaluating ? 'animate-spin' : ''}`} aria-hidden="true" />
              {evaluating ? 'Checking…' : 'Re-check overdue'}
            </button>
          )}
          {isStaff && (
            <button type="button" onClick={() => navigate('/enrollment')} className="btn-secondary">
              <QrCode className="h-4 w-4" aria-hidden="true" /> Provision a handset
            </button>
          )}
          {isStaff && (
            <button type="button" onClick={() => setShowAddWizard(true)} className="btn-primary">
              <Plus className="h-4 w-4" aria-hidden="true" /> New financed sale
            </button>
          )}
        </div>
      </header>

      {/* ---------------------------------------------------------------- */}
      {/* The money. Three figures, one card, hairlines between them —      */}
      {/* they are three views of the same portfolio, not three tiles.      */}
      {/* ---------------------------------------------------------------- */}
      <Card flush>
        <div className="grid divide-y divide-paper-300 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          <div className="p-5">
            <p className="eyebrow">Outstanding</p>
            {loading && !stats ? (
              <Skeleton className="mt-2 h-9 w-40" />
            ) : (
              <p className="figure mt-1.5">{money(stats?.outstandingAmount)}</p>
            )}
            <p className="mt-1.5 text-caption text-ink-400">
              Financed balance still to be recovered
            </p>
          </div>

          <div className="p-5">
            <p className="eyebrow">At risk</p>
            {loading && !stats ? (
              <Skeleton className="mt-2 h-9 w-32" />
            ) : (
              <p className="figure mt-1.5">{money(stats?.overdueAmount)}</p>
            )}
            <p className="mt-1.5 text-caption">
              {stats?.overdueInstallmentsCount ? (
                <span className="text-critical-700">
                  {stats.overdueInstallmentsCount} instalments past due
                </span>
              ) : (
                <span className="text-positive-700">Nothing past due</span>
              )}
            </p>
          </div>

          <div className="p-5">
            <p className="eyebrow">Collected this month</p>
            {loading && !stats ? (
              <Skeleton className="mt-2 h-9 w-32" />
            ) : (
              <p className="figure mt-1.5">{money(collected)}</p>
            )}
            {targetPct !== null ? (
              <div className="mt-2.5">
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
                  <div
                    className="h-full rounded-full bg-accent-600 transition-[width] duration-500"
                    style={{ width: `${targetPct}%` }}
                  />
                </div>
                <p className="mt-1.5 text-caption text-ink-400 tabular">
                  {targetPct}% of {moneyShort(target)} expected this month
                </p>
              </div>
            ) : (
              <p className="mt-1.5 text-caption text-ink-400">No instalments fall due this month</p>
            )}
          </div>
        </div>
      </Card>

      {/* A customer has reported a transfer and is waiting on a human. This
          only appears when there is genuinely something to confirm. */}
      {isStaff && (stats?.pendingVerificationAmount ?? 0) > 0 && (
        <button
          type="button"
          onClick={() => navigate('/payments?status=PENDING')}
          className="flex w-full items-center gap-3 rounded-lg border border-accent-200 bg-accent-50 px-4 py-3 text-left transition-colors hover:bg-accent-100"
        >
          <BadgeCheck className="h-5 w-5 shrink-0 text-accent-700" aria-hidden="true" />
          <span className="flex-1 text-body text-accent-900">
            <strong className="font-medium">{money(stats?.pendingVerificationAmount)}</strong> in
            customer-reported payments is waiting for you to confirm it
          </span>
          <ArrowRight className="h-4 w-4 shrink-0 text-accent-700" aria-hidden="true" />
        </button>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* min-w-0: a grid item defaults to min-width:auto, so the widest row inside
            — a customer name, a pill and two buttons — was setting the column's
            width and pushing the whole page into a horizontal scroll on a phone. */}
        <div className="min-w-0 space-y-6 lg:col-span-2">
          {/* ------------------------------------------------------------ */}
          {/* Today's work. The whole point of the page.                    */}
          {/* ------------------------------------------------------------ */}
          {isStaff && (
            <Card>
              <CardHeader
                title="Who to chase today"
                hint="Worst arrears first, one line per customer"
                action={
                  <button
                    type="button"
                    onClick={() => navigate('/installments?status=OVERDUE')}
                    className="btn-ghost -mr-2 text-caption"
                  >
                    See all <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                }
              />
              <div className="mt-4">
                {overdueRows === null ? (
                  <div className="space-y-3">
                    {[0, 1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-12 w-full" />
                    ))}
                  </div>
                ) : (
                  <CollectionQueue rows={overdueRows} />
                )}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Collections"
              hint="Recovered against overdue exposure, last six months"
              action={<CollectionTrendLegend />}
            />
            <div className="mt-5">
              {charts?.monthlyTrends ? (
                <CollectionTrend data={charts.monthlyTrends} />
              ) : (
                <Skeleton className="h-52 w-full" />
              )}
            </div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader title="Fleet" hint="Every financed handset, by state" />
            <div className="mt-5">
              {stats ? (
                <FleetBar segments={fleet} total={stats.totalDevices} />
              ) : (
                <Skeleton className="h-32 w-full" />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Brands financed" />
            <div className="mt-4 space-y-2.5">
              {charts?.brandDistribution?.length ? (
                charts.brandDistribution.map((b: any) => {
                  const pct = Math.round((b.count / (brandLeader || 1)) * 100);
                  return (
                    <div key={b.name}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="text-caption text-ink-700">{b.name}</span>
                        <span className="text-caption text-ink-400 tabular">{b.count}</span>
                      </div>
                      {/* One hue, more-is-darker is unnecessary here: magnitude is
                          already carried by length, so the bar stays quiet. */}
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-paper-200">
                        <div
                          className="h-full rounded-full bg-accent-400"
                          style={{ width: `${Math.max(4, pct)}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <Skeleton className="h-24 w-full" />
              )}
            </div>
          </Card>
        </div>
      </div>

      {showAddWizard && (
        <AddCustomerWizardModal
          onClose={() => setShowAddWizard(false)}
          onSuccess={() => {
            setShowAddWizard(false);
            loadData();
          }}
        />
      )}
    </div>
  );
};

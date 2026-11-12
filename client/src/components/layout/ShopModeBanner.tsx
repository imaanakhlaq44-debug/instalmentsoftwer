import React, { useEffect, useState } from 'react';
import { Eye, PencilLine, Lock } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.js';
import { ApiService } from '../../services/api.js';

/**
 * Shown to a super admin who has opened one shop from the platform.
 *
 * The shop starts read-only, so browsing a shop's books can never lock a
 * customer's phone or record a payment by accident. Turning edit mode on is a
 * deliberate step, and while it is on the bar turns red and says plainly that
 * the changes are real and recorded under the admin's own name.
 */
export const ShopModeBanner: React.FC = () => {
  const { role, selectedDealerId, shopEditMode, setShopEditMode } = useAuth();
  const viewingShop = role === 'SUPER_ADMIN' && Boolean(selectedDealerId);

  const [shopName, setShopName] = useState<string | null>(null);
  useEffect(() => {
    if (!viewingShop) return;
    ApiService.getLicenses()
      .then((res) => setShopName((res.dealers ?? []).find((d: any) => d.dealerId === selectedDealerId)?.dealerName ?? null))
      .catch(() => setShopName(null));
  }, [viewingShop, selectedDealerId]);

  if (!viewingShop) return null;

  const turnOn = () => {
    const ok = window.confirm(
      `Turn on edit mode for ${shopName ?? 'this shop'}?\n\nAnything you do — sales, payments, locking or unlocking a phone, settings — will really happen in this shop and be recorded in its audit log under your name.`
    );
    if (ok) setShopEditMode(true);
  };

  if (shopEditMode) {
    return (
      <div role="alert" className="border-b-2 border-ink-900 bg-rose-600 text-white">
        <div className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
          <PencilLine className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-caption font-bold">
            <span className="font-extrabold uppercase tracking-[0.08em]">Edit mode on</span>
            <span className="mx-2 opacity-60">·</span>
            <span>Changes here are real and recorded under your name.</span>
            {shopName && <span className="ms-1 font-extrabold">({shopName})</span>}
          </p>
          <button
            type="button"
            onClick={() => setShopEditMode(false)}
            className="flex items-center gap-1.5 rounded-md border-2 border-ink-900 bg-white px-3 py-1 text-caption font-extrabold text-ink-900 shadow-[2px_2px_0_#0F1419] hover:bg-sun-100"
          >
            <Lock className="h-3.5 w-3.5" aria-hidden="true" />
            Back to view-only
          </button>
        </div>
      </div>
    );
  }

  return (
    <div role="status" className="border-b-2 border-ink-900 bg-sun-200 text-ink-900">
      <div className="mx-auto flex w-full max-w-[72rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <Eye className="h-5 w-5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-caption font-bold">
          <span className="font-extrabold uppercase tracking-[0.08em]">View only</span>
          <span className="mx-2 opacity-60">·</span>
          <span>You can see everything in this shop but cannot change anything.</span>
        </p>
        <button
          type="button"
          onClick={turnOn}
          className="flex items-center gap-1.5 rounded-md border-2 border-ink-900 bg-ink-900 px-3 py-1 text-caption font-extrabold text-white shadow-[2px_2px_0_#FFC83D] hover:bg-ink-700"
        >
          <PencilLine className="h-3.5 w-3.5" aria-hidden="true" />
          Turn on edit mode
        </button>
      </div>
    </div>
  );
};

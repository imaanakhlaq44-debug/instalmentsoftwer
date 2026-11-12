import React, { useEffect, useState } from 'react';
import { ApiService } from '../services/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Pagination } from '../components/ui/Pagination.js';
import { usePagination } from '../hooks/usePagination.js';
import { PHONE_BRANDS } from '../utils/brands.js';
import {
  HANDSET_TEST_STEPS, StepsState, StepResult, OverallResult,
  emptySteps, overallResultOf, RESULT_LABEL, RESULT_STYLE,
} from '../utils/handsetTest.js';

import { HandsetTestChecklist } from '../components/HandsetTestChecklist.js';

import { ClipboardCheck, RefreshCw, Check, X, Minus, Globe, Pencil, Trash2, Plus, Printer } from 'lucide-react';

interface FormState {
  brand: string;
  model: string;
  androidVersion: string;
  oemBuild: string;
  dpcVersion: string;
  notes: string;
  steps: StepsState;
}

const blankForm = (): FormState => ({
  brand: '',
  model: '',
  androidVersion: '',
  oemBuild: '',
  dpcVersion: '',
  notes: '',
  steps: emptySteps(),
});

const RESULT_OPTIONS: { value: StepResult; label: string; icon: typeof Check; on: string }[] = [
  { value: 'PASS', label: 'Pass', icon: Check, on: 'bg-emerald-600 text-white border-emerald-600' },
  { value: 'FAIL', label: 'Fail', icon: X, on: 'bg-red-600 text-white border-red-600' },
  { value: 'NOT_TESTED', label: 'Not tested', icon: Minus, on: 'bg-slate-600 text-white border-slate-600' },
];

const ResultBadge: React.FC<{ result: OverallResult }> = ({ result }) => (
  <span className={`inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-micro font-bold ${RESULT_STYLE[result]}`}>
    {RESULT_LABEL[result]}
  </span>
);

/**
 * Handset compatibility tests.
 *
 * Two halves: a checklist somebody fills in with the phone in their hand, and
 * the table of what has been tested so far. A shop sees its own records; the
 * platform sees every shop's and decides which appear on the public site.
 */
export const HandsetTestsPage: React.FC = () => {
  const { user, role, selectedDealerId, showToast } = useAuth();
  const isSuperAdmin = role === 'SUPER_ADMIN';

  const [rows, setRows] = useState<any[]>([]);
  const [facets, setFacets] = useState<{ brands: string[]; androidVersions: string[] }>({ brands: [], androidVersions: [] });
  const [loading, setLoading] = useState(true);
  const [brandFilter, setBrandFilter] = useState('');
  const [androidFilter, setAndroidFilter] = useState('');

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(blankForm);
  const [saving, setSaving] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [printOpen, setPrintOpen] = useState(false);

  const paged = usePagination([brandFilter, androidFilter, selectedDealerId], 25);

  const load = async () => {
    try {
      setLoading(true);
      const data = await ApiService.getHandsetTests({
        ...paged.params,
        brand: brandFilter || undefined,
        androidVersion: androidFilter || undefined,
        dealerId: selectedDealerId,
      });
      setRows(data.data);
      setFacets(data.facets);
      paged.setPagination(data.pagination);
    } catch (err: any) {
      showToast(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId, brandFilter, androidFilter, paged.page, paged.limit]);

  const setStep = (key: string, patch: Partial<{ result: StepResult; notes: string }>) =>
    setForm((f) => ({ ...f, steps: { ...f.steps, [key]: { ...f.steps[key], ...patch } } }));

  const startNew = () => {
    setEditingId(null);
    setForm(blankForm());
    setFormOpen(true);
  };

  const startEdit = (row: any) => {
    setEditingId(row.id);
    setForm({
      brand: row.brand,
      model: row.model,
      androidVersion: row.androidVersion,
      oemBuild: row.oemBuild ?? '',
      dpcVersion: row.dpcVersion,
      notes: row.notes ?? '',
      steps: Object.fromEntries(
        HANDSET_TEST_STEPS.map((s) => [
          s.key,
          { result: (row.steps?.[s.key]?.result ?? 'NOT_TESTED') as StepResult, notes: row.steps?.[s.key]?.notes ?? '' },
        ])
      ),
    });
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: Record<string, unknown> = {
      brand: form.brand.trim(),
      model: form.model.trim(),
      androidVersion: form.androidVersion.trim(),
      oemBuild: form.oemBuild.trim(),
      dpcVersion: form.dpcVersion.trim(),
      notes: form.notes.trim(),
      steps: Object.fromEntries(
        HANDSET_TEST_STEPS.map((s) => [s.key, { result: form.steps[s.key].result, notes: form.steps[s.key].notes.trim() }])
      ),
    };

    try {
      setSaving(true);
      if (editingId) {
        await ApiService.updateHandsetTest(editingId, payload);
        showToast('Phone test updated.', 'success');
      } else {
        // A super admin who has opened a shop files the record under that shop.
        if (isSuperAdmin && selectedDealerId) payload.dealerId = selectedDealerId;
        await ApiService.createHandsetTest(payload);
        showToast('Phone test saved.', 'success');
      }
      setFormOpen(false);
      setEditingId(null);
      setForm(blankForm());
      await load();
    } catch (err: any) {
      const first = err?.details?.[0]?.message;
      showToast(first || err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const togglePublish = async (row: any) => {
    try {
      await ApiService.publishHandsetTest(row.id, !row.published);
      showToast(row.published ? 'Removed from the website.' : 'Now showing on the website.', 'success');
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  const remove = async (row: any) => {
    if (!window.confirm(`Delete the test for ${row.brand} ${row.model}?`)) return;
    try {
      await ApiService.deleteHandsetTest(row.id);
      showToast('Phone test deleted.', 'success');
      await load();
    } catch (err: any) {
      showToast(err.message, 'error');
    }
  };

  /** Mirrors the server's rule, so no button is offered that it would refuse. */
  const canEdit = (row: any) =>
    isSuperAdmin || (!row.published && (role === 'DEALER_ADMIN' || row.testedById === user?.id));

  const overall = overallResultOf(form.steps);
  const brandOptions = [...new Set([...PHONE_BRANDS.map((b) => b.value), ...facets.brands])];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Lock app</p>
          <h1 className="mt-1 text-display text-ink-900">Phone tests</h1>
          <p className="mt-1 max-w-2xl text-body text-ink-500">
            Test the lock app on a real phone, step by step, and save what happened. This is how we know which phones the lock works on.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-secondary" onClick={() => setPrintOpen(true)}>
            <Printer className="w-4 h-4" /> Print checklist
          </button>
          {!formOpen && (
            <button type="button" className="btn-primary" onClick={startNew}>
              <Plus className="w-4 h-4" /> Test a phone
            </button>
          )}
        </div>
      </div>

      {printOpen && <HandsetTestChecklist onClose={() => setPrintOpen(false)} />}

      {formOpen && (
        <form onSubmit={submit} className="surface p-5 space-y-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-title font-semibold text-ink-900">{editingId ? 'Edit phone test' : 'New phone test'}</h2>
              <p className="text-caption text-ink-400 mt-0.5">
                Write down exactly what you saw. A step you did not try stays on "Not tested".
              </p>
            </div>
            <ResultBadge result={overall} />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <label className="block">
              <span className="field-label">Brand</span>
              <input
                className="input mt-1 w-full" list="handset-test-brands" required maxLength={60}
                value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })}
                placeholder="Samsung"
              />
              <datalist id="handset-test-brands">
                {brandOptions.map((b) => <option key={b} value={b} />)}
              </datalist>
            </label>
            <label className="block">
              <span className="field-label">Model</span>
              <input
                className="input mt-1 w-full" required maxLength={80}
                value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder="Galaxy A15"
              />
            </label>
            <label className="block">
              <span className="field-label">Android version</span>
              <input
                className="input mt-1 w-full" required inputMode="decimal" pattern="\d{1,2}(\.\d{1,2}){0,2}"
                value={form.androidVersion} onChange={(e) => setForm({ ...form, androidVersion: e.target.value })}
                placeholder="14" title="A number such as 13 or 8.1"
              />
            </label>
            <label className="block">
              <span className="field-label">Phone software (optional)</span>
              <input
                className="input mt-1 w-full" maxLength={120}
                value={form.oemBuild} onChange={(e) => setForm({ ...form, oemBuild: e.target.value })}
                placeholder="One UI 6.1 / HiOS 13 / MIUI 14"
              />
            </label>
            <label className="block">
              <span className="field-label">Lock app version</span>
              <input
                className="input mt-1 w-full" required pattern="v?\d+\.\d+(\.\d+)?"
                value={form.dpcVersion} onChange={(e) => setForm({ ...form, dpcVersion: e.target.value })}
                placeholder="1.5.1" title="Shown inside the lock app, for example 1.5.1"
              />
            </label>
          </div>

          <ol className="space-y-3">
            {HANDSET_TEST_STEPS.map((step, i) => {
              const value = form.steps[step.key];
              return (
                <li key={step.key} className="well p-4">
                  <div className="flex flex-col md:flex-row md:items-start gap-3 md:gap-6">
                    <div className="flex-1 min-w-0">
                      <p className="text-body font-semibold text-ink-900">
                        <span className="text-ink-400 mr-2">{i + 1}.</span>
                        <span>{step.title}</span>
                      </p>
                      <p className="mt-1 text-caption text-ink-500">{step.how}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5" role="radiogroup" aria-label={step.title}>
                      {RESULT_OPTIONS.map((opt) => {
                        const selected = value.result === opt.value;
                        return (
                          <button
                            key={opt.value} type="button" role="radio" aria-checked={selected}
                            onClick={() => setStep(step.key, { result: opt.value })}
                            className={`inline-flex items-center gap-1 rounded-xl border px-3 py-2 text-xs font-bold transition-colors ${
                              selected ? opt.on : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <opt.icon className="w-3.5 h-3.5" /> <span>{opt.label}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    className="input mt-3 w-full" maxLength={500}
                    value={value.notes} onChange={(e) => setStep(step.key, { notes: e.target.value })}
                    placeholder={value.result === 'FAIL' ? 'What went wrong?' : 'Note (optional)'}
                    aria-label={`Note for ${step.title}`}
                  />
                </li>
              );
            })}
          </ol>

          <label className="block">
            <span className="field-label">Anything else (optional)</span>
            <textarea
              className="input mt-1 w-full" rows={2} maxLength={1000}
              value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>

          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="btn-secondary" onClick={() => { setFormOpen(false); setEditingId(null); }} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : editingId ? 'Save changes' : 'Save phone test'}
            </button>
          </div>
        </form>
      )}

      <div className="surface p-4 flex flex-col sm:flex-row sm:items-end gap-3">
        <label className="block sm:w-56">
          <span className="field-label">Brand</span>
          <select className="input mt-1 w-full" value={brandFilter} onChange={(e) => setBrandFilter(e.target.value)}>
            <option value="">All brands</option>
            {facets.brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </label>
        <label className="block sm:w-56">
          <span className="field-label">Android version</span>
          <select className="input mt-1 w-full" value={androidFilter} onChange={(e) => setAndroidFilter(e.target.value)}>
            <option value="">All versions</option>
            {facets.androidVersions.map((v) => <option key={v} value={v}>{`Android ${v}`}</option>)}
          </select>
        </label>
      </div>

      <div className="surface overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500 flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading phone tests...
          </div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-slate-400">
            <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-slate-300" />
            <p className="text-xs">{brandFilter || androidFilter ? 'No phone tests match this filter.' : 'No phone has been tested yet.'}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/70 text-xs font-bold text-slate-600 uppercase tracking-wider">
                  <th className="py-3 px-4">Phone</th>
                  <th className="py-3 px-4">Android</th>
                  <th className="py-3 px-4">Lock app</th>
                  <th className="py-3 px-4">Result</th>
                  <th className="py-3 px-4">Tested by</th>
                  {isSuperAdmin && <th className="py-3 px-4">Shop</th>}
                  <th className="py-3 px-4">Website</th>
                  <th className="py-3 px-4"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {rows.map((r) => (
                  <React.Fragment key={r.id}>
                    <tr className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-4">
                        <button type="button" className="text-left" onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}>
                          <span className="font-bold text-slate-900" data-i18n-skip>{r.brand} {r.model}</span>
                          {r.oemBuild && <span className="block text-slate-400" data-i18n-skip>{r.oemBuild}</span>}
                        </button>
                      </td>
                      <td className="py-3.5 px-4 text-slate-700">{r.androidVersion}</td>
                      <td className="py-3.5 px-4 text-slate-700 font-mono">{`v${r.dpcVersion}`}</td>
                      <td className="py-3.5 px-4"><ResultBadge result={r.overallResult} /></td>
                      <td className="py-3.5 px-4 text-slate-600">
                        <span data-i18n-skip>{r.testedByName}</span>
                        <span className="block text-slate-400">{new Date(r.testedAt).toLocaleDateString()}</span>
                      </td>
                      {isSuperAdmin && (
                        <td className="py-3.5 px-4 text-slate-600">
                          {r.dealerName ? <span data-i18n-skip>{r.dealerName}</span> : 'Platform'}
                        </td>
                      )}
                      <td className="py-3.5 px-4">
                        {isSuperAdmin ? (
                          <button
                            type="button"
                            onClick={() => togglePublish(r)}
                            disabled={!r.published && r.overallResult === 'NOT_TESTED'}
                            className={`inline-flex items-center gap-1 rounded-xl border px-2.5 py-1.5 font-bold transition-colors disabled:opacity-40 ${
                              r.published
                                ? 'bg-emerald-600 text-white border-emerald-600 hover:bg-emerald-700'
                                : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            }`}
                          >
                            <Globe className="w-3.5 h-3.5" /> <span>{r.published ? 'On website' : 'Show on website'}</span>
                          </button>
                        ) : (
                          <span className={r.published ? 'font-bold text-emerald-700' : 'text-slate-400'}>
                            {r.published ? 'On website' : 'Not shown'}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 whitespace-nowrap text-right">
                        {canEdit(r) && (
                          <button type="button" className="btn-ghost p-1.5" onClick={() => startEdit(r)} aria-label="Edit" title="Edit">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {isSuperAdmin && (
                          <button type="button" className="btn-ghost p-1.5 text-red-600" onClick={() => remove(r)} aria-label="Delete" title="Delete">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                    {expandedId === r.id && (
                      <tr className="bg-slate-50/60">
                        <td colSpan={isSuperAdmin ? 8 : 7} className="py-3 px-4">
                          <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-1.5">
                            {HANDSET_TEST_STEPS.map((s) => {
                              const step = r.steps?.[s.key] ?? { result: 'NOT_TESTED' };
                              return (
                                <li key={s.key} className="flex items-start gap-2">
                                  <ResultBadge result={step.result} />
                                  <span className="text-slate-700">
                                    <span className="font-semibold">{s.title}</span>
                                    {step.notes && <span className="block text-slate-500" data-i18n-skip>{step.notes}</span>}
                                  </span>
                                </li>
                              );
                            })}
                          </ul>
                          {r.notes && <p className="mt-3 text-slate-600" data-i18n-skip>{r.notes}</p>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
            <Pagination
              pagination={paged.pagination}
              onPageChange={paged.setPage}
              onLimitChange={paged.setLimit}
              itemLabel="phone tests"
              disabled={loading}
            />
          </div>
        )}
      </div>
    </div>
  );
};

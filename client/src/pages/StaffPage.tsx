import React, { useEffect, useState } from 'react';
import { Eye, KeyRound, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../context/AuthContext.js';
import { ApiService } from '../services/api.js';
import { Card, CardHeader, Skeleton } from '../components/ui/Card.js';
import { relativeTime } from '../utils/format.js';
import type { UserRole } from '../types/index.js';

/**
 * The shop's team.
 *
 * The owner adds the people who work in the shop and chooses what each may do:
 * counter staff run sales and take payments; view-only staff can see which
 * phone is with whom and who is behind, but cannot change anything. The server
 * enforces both — this page only chooses.
 */

type StaffRole = Extract<UserRole, 'DEALER_STAFF' | 'DEALER_VIEWER'>;

interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string;
  role: UserRole;
  active: boolean;
  lastLoginAt?: string;
  mustChangePassword?: boolean;
}

export const ROLE_INFO: Record<StaffRole, { label: string; body: string }> = {
  DEALER_STAFF: {
    label: 'Counter staff',
    body: 'Makes new sales, adds customers and records payments. Cannot lock phones or delete anything.',
  },
  DEALER_VIEWER: {
    label: 'View only',
    body: 'Sees which phone is with whom, customers, instalments, payments and who is behind. Cannot change anything.',
  },
};

const TEAM_ROLES: UserRole[] = ['DEALER_ADMIN', 'DEALER_STAFF', 'DEALER_VIEWER'];

const roleLabel = (role: UserRole): string =>
  role === 'DEALER_ADMIN' ? 'Owner / admin' : ROLE_INFO[role as StaffRole]?.label ?? role;

/** A temporary password the owner reads out once: letters and digits, no look-alikes. */
export function makeTempPassword(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return Array.from(buf, (v) => set[v % set.length]).join('');
  };
  return `${pick(letters, 5)}${pick(digits, 4)}`;
}

const emptyForm = { name: '', phone: '', email: '', role: 'DEALER_VIEWER' as StaffRole };

export const StaffPage: React.FC = () => {
  const { user, role, selectedDealerId, showToast } = useAuth();

  const [team, setTeam] = useState<TeamMember[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState<string | null>(null);
  /** Shown once after an add or a reset, so the owner can pass it on. */
  const [handover, setHandover] = useState<{ name: string; email: string; password: string } | null>(null);

  const dealerId = role === 'SUPER_ADMIN' && selectedDealerId && selectedDealerId !== 'all' ? selectedDealerId : undefined;

  const load = async () => {
    setFailed(false);
    try {
      const users = (await ApiService.getUsers(dealerId)) as TeamMember[];
      setTeam(users.filter((u) => TEAM_ROLES.includes(u.role)));
    } catch {
      setFailed(true);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDealerId]);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    const password = makeTempPassword();
    setBusy('add');
    try {
      await ApiService.createUser({ ...form, password, ...(dealerId ? { dealerId } : {}) });
      setHandover({ name: form.name, email: form.email, password });
      setForm(emptyForm);
      setAdding(false);
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not add this person.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const changeRole = async (member: TeamMember, next: StaffRole) => {
    setBusy(member.id);
    try {
      await ApiService.updateUser(member.id, { role: next });
      showToast(`${member.name} is now ${ROLE_INFO[next].label}.`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not change access.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const setActive = async (member: TeamMember, active: boolean) => {
    setBusy(member.id);
    try {
      if (active) await ApiService.updateUser(member.id, { active: true });
      else await ApiService.deactivateUser(member.id);
      showToast(active ? `${member.name} can sign in again.` : `${member.name} can no longer sign in.`, 'success');
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not update this account.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const resetPassword = async (member: TeamMember) => {
    const password = makeTempPassword();
    setBusy(member.id);
    try {
      await ApiService.resetUserPassword(member.id, password);
      setHandover({ name: member.name, email: member.email, password });
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Could not reset the password.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Your shop</p>
          <h1 className="mt-1 text-display text-ink-900">Staff</h1>
          <p className="mt-1 text-body text-ink-500">
            Give the people who work with you their own sign-in, and choose what each one may do.
          </p>
        </div>
        {!adding && (
          <button type="button" className="btn-primary" onClick={() => setAdding(true)}>
            <UserPlus className="h-4 w-4" aria-hidden="true" /> Add staff
          </button>
        )}
      </header>

      {handover && (
        <Card>
          <CardHeader title="Give these sign-in details to the staff member" />
          <dl className="mt-4 grid gap-2 text-body sm:grid-cols-[max-content_1fr] sm:gap-x-4">
            <dt className="text-ink-500">Name</dt>
            <dd className="font-semibold text-ink-900" data-i18n-skip dir="auto">{handover.name}</dd>
            <dt className="text-ink-500">Email</dt>
            <dd className="font-semibold text-ink-900" data-i18n-skip>{handover.email}</dd>
            <dt className="text-ink-500">Temporary password</dt>
            <dd className="tabular text-lg font-bold tracking-wider text-ink-900" data-i18n-skip data-testid="temp-password">
              {handover.password}
            </dd>
          </dl>
          <p className="well mt-4 p-3 text-caption text-ink-700">
            This password is shown only once. They will be asked to choose their own password the first time they sign in.
          </p>
          <button type="button" className="btn-secondary mt-4" onClick={() => setHandover(null)}>
            Done
          </button>
        </Card>
      )}

      {adding && (
        <Card>
          <CardHeader title="Add a staff member" />
          <form className="mt-5 space-y-5" onSubmit={(e) => void add(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="field-label" htmlFor="st-name">Name</label>
                <input id="st-name" className="input" dir="auto" required minLength={2} maxLength={120}
                  value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="field-label" htmlFor="st-phone">Mobile number</label>
                <input id="st-phone" className="input" inputMode="tel" required placeholder="03XX-XXXXXXX"
                  value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="field-label" htmlFor="st-email">Email (used to sign in)</label>
                <input id="st-email" className="input" type="email" required maxLength={255}
                  value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>

            <fieldset>
              <legend className="field-label">What may they do?</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {(Object.keys(ROLE_INFO) as StaffRole[]).map((r) => (
                  <label
                    key={r}
                    className={`flex cursor-pointer items-start gap-3 rounded-md border-2 p-3 ${
                      form.role === r ? 'border-ink-900 bg-sun-100' : 'border-ink-200 bg-white'
                    }`}
                  >
                    <input type="radio" name="st-role" className="mt-1 accent-ink-900" checked={form.role === r}
                      onChange={() => setForm({ ...form, role: r })} />
                    <span>
                      <span className="block text-body font-bold text-ink-900">{ROLE_INFO[r].label}</span>
                      <span className="mt-0.5 block text-caption text-ink-600">{ROLE_INFO[r].body}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="flex flex-wrap gap-3">
              <button type="submit" className="btn-primary" disabled={busy === 'add'}>
                {busy === 'add' ? 'Adding…' : 'Add and make a password'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setAdding(false); setForm(emptyForm); }}>
                Cancel
              </button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Your team" hint="Only you can add staff, change what they may do, or switch them off" />
        <div className="mt-4">
          {failed ? (
            <div className="space-y-3">
              <p className="text-body text-ink-700">Could not load your staff.</p>
              <button type="button" className="btn-secondary" onClick={() => void load()}>Try again</button>
            </div>
          ) : team === null ? (
            <div className="space-y-3">
              {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
            </div>
          ) : team.length === 0 ? (
            <div className="flex items-center gap-3 text-body text-ink-500">
              <Users className="h-5 w-5" aria-hidden="true" /> No staff yet. Add the first one above.
            </div>
          ) : (
            <ul className="divide-y-2 divide-ink-100">
              {team.map((m) => {
                const isSelf = m.id === user?.id;
                const editable = !isSelf && (m.role === 'DEALER_STAFF' || m.role === 'DEALER_VIEWER');
                return (
                  <li key={m.id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between" data-testid="staff-row">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2 text-body font-bold text-ink-900">
                        <span data-i18n-skip dir="auto" className="truncate">{m.name}</span>
                        {isSelf && <span className="text-caption font-semibold text-ink-500">(you)</span>}
                        <span className={`status-pill ${!m.active ? 'status-inactive' : m.role === 'DEALER_VIEWER' ? 'status-pending' : 'status-active'}`}>
                          {m.role === 'DEALER_VIEWER' && <Eye className="h-3 w-3" aria-hidden="true" />}
                          {m.active ? roleLabel(m.role) : 'Switched off'}
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-caption text-ink-500" data-i18n-skip>
                        {m.email} · {m.phone}
                      </p>
                      <p className="mt-0.5 text-caption text-ink-400">
                        {m.lastLoginAt ? <>Last signed in {relativeTime(m.lastLoginAt)}</> : 'Has not signed in yet'}
                      </p>
                    </div>

                    {editable && (
                      <div className="flex flex-wrap items-center gap-2">
                        {m.active && (
                          <select
                            aria-label={`What ${m.name} may do`}
                            className="input w-auto py-1.5"
                            value={m.role}
                            disabled={busy === m.id}
                            onChange={(e) => void changeRole(m, e.target.value as StaffRole)}
                          >
                            <option value="DEALER_STAFF">{ROLE_INFO.DEALER_STAFF.label}</option>
                            <option value="DEALER_VIEWER">{ROLE_INFO.DEALER_VIEWER.label}</option>
                          </select>
                        )}
                        {m.active && (
                          <button type="button" className="btn-ghost text-caption" disabled={busy === m.id} onClick={() => void resetPassword(m)}>
                            <KeyRound className="h-3.5 w-3.5" aria-hidden="true" /> New password
                          </button>
                        )}
                        <button
                          type="button"
                          className={`btn-ghost text-caption ${m.active ? 'text-critical-700' : ''}`}
                          disabled={busy === m.id}
                          onClick={() => void setActive(m, !m.active)}
                        >
                          {m.active ? 'Switch off' : 'Switch on'}
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
};

export default StaffPage;

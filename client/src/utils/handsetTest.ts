/**
 * The handset compatibility checklist.
 *
 * The keys and their order mirror `HANDSET_TEST_STEPS` on the server. Each step
 * says what to do and what counts as a pass, because the person filling this in
 * is standing at a counter with a phone, not reading the DPC's source.
 */
export type StepResult = 'PASS' | 'FAIL' | 'NOT_TESTED';
export type OverallResult = 'PASS' | 'FAIL' | 'PARTIAL' | 'NOT_TESTED';

export interface StepDefinition {
  key: string;
  title: string;
  /** What to do, and what a pass looks like. */
  how: string;
}

export const HANDSET_TEST_STEPS: ReadonlyArray<StepDefinition> = [
  {
    key: 'QR_PROVISIONING',
    title: 'QR setup from factory reset',
    how: 'Factory reset the phone, tap the welcome screen six times and scan the QR from QR Enrollment. Pass if the app installs by itself and setup finishes.',
  },
  {
    key: 'ENROL',
    title: 'Enrol',
    how: 'Pass if the phone shows as enrolled on the Devices page within a minute.',
  },
  {
    key: 'LOCK',
    title: 'Lock',
    how: 'Press Lock on the dashboard. Pass if the lock screen appears and the phone cannot be used.',
  },
  {
    key: 'UNLOCK',
    title: 'Unlock',
    how: 'Press Unlock on the dashboard. Pass if the phone opens again and works normally.',
  },
  {
    key: 'LOCK_AFTER_REBOOT',
    title: 'Lock stays after restart',
    how: 'Lock the phone, then switch it off and on. Pass if it is still locked when it starts.',
  },
  {
    key: 'STAGED_RESTRICTIONS',
    title: 'Staged restrictions',
    how: 'Make an installment late so the warning stage starts. Pass if the phone shows each stage before the full lock.',
  },
  {
    key: 'OFFLINE_SELF_LOCK',
    title: 'Offline self-lock',
    how: 'With an installment overdue, keep the phone off Wi-Fi and mobile data past the offline limit. Pass if it locks itself.',
  },
  {
    key: 'FACTORY_RESET_PROTECTION',
    title: 'Factory-reset protection',
    how: 'Try to reset from Settings, then from recovery mode. Pass if reset is blocked, or the phone asks for the shop Google account afterwards.',
  },
  {
    key: 'RE_ENROL',
    title: 'Re-enrol',
    how: 'Use Re-enrol on the device page and scan the new QR. Pass if the same phone comes back under management without using a new lock.',
  },
];

export type StepsState = Record<string, { result: StepResult; notes: string }>;

export const emptySteps = (): StepsState =>
  Object.fromEntries(HANDSET_TEST_STEPS.map((s) => [s.key, { result: 'NOT_TESTED' as StepResult, notes: '' }]));

/** Same rule as the server: one failure fails the phone; only all-pass is a pass. */
export function overallResultOf(steps: StepsState): OverallResult {
  const results = HANDSET_TEST_STEPS.map((s) => steps[s.key]?.result ?? 'NOT_TESTED');
  if (results.includes('FAIL')) return 'FAIL';
  if (results.every((r) => r === 'PASS')) return 'PASS';
  if (results.every((r) => r === 'NOT_TESTED')) return 'NOT_TESTED';
  return 'PARTIAL';
}

export const RESULT_LABEL: Record<OverallResult, string> = {
  PASS: 'Pass',
  FAIL: 'Fail',
  PARTIAL: 'Partly tested',
  NOT_TESTED: 'Not tested',
};

export const RESULT_STYLE: Record<OverallResult, string> = {
  PASS: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  FAIL: 'bg-red-50 text-red-700 border-red-200',
  PARTIAL: 'bg-amber-50 text-amber-800 border-amber-200',
  NOT_TESTED: 'bg-slate-100 text-slate-600 border-slate-200',
};

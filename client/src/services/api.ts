const API_BASE = '/api';

export const TOKEN_STORAGE_KEY = 'emi_auth_token';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paged<T> {
  data: T[];
  pagination: Pagination;
}

export interface ApiErrorDetail {
  field: string;
  message: string;
}

/** An error carrying the server's status code and field-level validation detail. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: ApiErrorDetail[]
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Turns validation details into a `{ fieldName: message }` map for forms. */
  get fieldErrors(): Record<string, string> {
    const map: Record<string, string> = {};
    for (const d of this.details ?? []) {
      // "customer.phone" -> "phone", so nested schemas map onto flat form state.
      const key = d.field.includes('.') ? d.field.split('.').slice(-1)[0] : d.field;
      map[key] = d.message;
    }
    return map;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Registered by AuthContext. When any request comes back 401 the whole app
 * signs out immediately rather than leaving the user on a dead dashboard.
 */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null) {
  onUnauthorized = handler;
}

function buildQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export class ApiService {
  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });
    } catch {
      throw new ApiError('Cannot reach the server. Please check your connection and try again.', 0, 'NETWORK_ERROR');
    }

    if (res.status === 204) return undefined as T;

    const payload = await res.json().catch(() => null);

    if (!res.ok) {
      const message =
        payload?.error ||
        payload?.message ||
        `Request failed (${res.status} ${res.statusText})`;

      // Sign-in failures are the user typing a wrong password, not a dead
      // session — those must not trigger a global logout.
      if (res.status === 401 && !endpoint.startsWith('/auth/login')) {
        onUnauthorized?.();
      }

      throw new ApiError(message, res.status, payload?.code, payload?.details);
    }

    return payload as T;
  }

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  static login(email: string, password: string) {
    return this.request<any>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  static me() {
    return this.request<any>('/auth/me');
  }

  static logout() {
    return this.request<any>('/auth/logout', { method: 'POST', body: '{}' });
  }

  static changePassword(currentPassword: string, newPassword: string) {
    return this.request<any>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword }),
    });
  }

  static registerDealer(data: unknown) {
    return this.request<any>('/auth/register-dealer', { method: 'POST', body: JSON.stringify(data) });
  }

  /** Super-admin only: obtain a session as another user without altering their record. */
  static impersonate(userId: string) {
    return this.request<any>('/auth/impersonate', { method: 'POST', body: JSON.stringify({ userId }) });
  }

  // -------------------------------------------------------------------------
  // Dashboard
  // -------------------------------------------------------------------------

  static getDashboardStats(dealerId?: string) {
    return this.request<any>(`/dashboard/stats${buildQuery({ dealerId })}`);
  }

  static getDashboardCharts(dealerId?: string) {
    return this.request<any>(`/dashboard/charts${buildQuery({ dealerId })}`);
  }

  static getAttentionList(dealerId?: string) {
    return this.request<any>(`/dashboard/attention${buildQuery({ dealerId })}`);
  }

  // -------------------------------------------------------------------------
  // Devices
  // -------------------------------------------------------------------------

  static getDevices(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/devices${buildQuery(params)}`);
  }

  static getDevice(id: string) {
    return this.request<any>(`/devices/${id}`);
  }

  static lockDevice(id: string, data: { reason: string; lockMessage?: string }) {
    return this.request<any>(`/devices/${id}/lock`, { method: 'POST', body: JSON.stringify(data) });
  }

  static unlockDevice(id: string, data: { reason: string }) {
    return this.request<any>(`/devices/${id}/unlock`, { method: 'POST', body: JSON.stringify(data) });
  }

  static sendDeviceMessage(id: string, data: { title: string; message: string }) {
    return this.request<any>(`/devices/${id}/message`, { method: 'POST', body: JSON.stringify(data) });
  }

  static rebootDevice(id: string) {
    return this.request<any>(`/devices/${id}/reboot`, { method: 'POST', body: '{}' });
  }

  static updateDevice(id: string, data: Record<string, unknown>) {
    return this.request<any>(`/devices/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  static correctImei(id: string, data: { imei: string; reason: string }) {
    return this.request<any>(`/devices/${id}/correct-imei`, { method: 'POST', body: JSON.stringify(data) });
  }

  // -------------------------------------------------------------------------
  // Customers
  // -------------------------------------------------------------------------

  static getCustomers(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/customers${buildQuery(params)}`);
  }

  static getCustomer(id: string) {
    return this.request<any>(`/customers/${id}`);
  }

  static createCustomerWithDevice(data: unknown) {
    return this.request<any>('/customers', { method: 'POST', body: JSON.stringify(data) });
  }

  static updateCustomer(id: string, data: Record<string, unknown>) {
    return this.request<any>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  static deactivateCustomer(id: string) {
    return this.request<any>(`/customers/${id}`, { method: 'DELETE' });
  }

  // -------------------------------------------------------------------------
  // Installments
  // -------------------------------------------------------------------------

  static getInstallmentPlans(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/installments/plans${buildQuery(params)}`);
  }

  static getInstallmentPlan(id: string) {
    return this.request<any>(`/installments/plans/${id}`);
  }

  static getInstallments(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/installments${buildQuery(params)}`);
  }

  static evaluateOverdue(referenceDate?: string) {
    return this.request<any>('/installments/evaluate-overdue', {
      method: 'POST',
      body: JSON.stringify(referenceDate ? { referenceDate } : {}),
    });
  }

  static waiveLateFee(installmentId: string, reason: string) {
    return this.request<any>(`/installments/${installmentId}/waive-late-fee`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  static reschedulePlan(planId: string, data: Record<string, unknown>) {
    return this.request<any>(`/installments/plans/${planId}/reschedule`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  static getPayoffQuote(planId: string) {
    return this.request<any>(`/installments/plans/${planId}/payoff-quote`);
  }

  // -------------------------------------------------------------------------
  // Payments
  // -------------------------------------------------------------------------

  static getPayments(params: Record<string, unknown> = {}) {
    return this.request<Paged<any> & { totals: any }>(`/payments${buildQuery(params)}`);
  }

  static recordPayment(data: unknown) {
    return this.request<any>('/payments', { method: 'POST', body: JSON.stringify(data) });
  }

  /**
   * A customer reporting a transfer they have already made. It is recorded
   * unverified — nothing is applied until the shop confirms it.
   */
  static submitPayment(data: unknown) {
    return this.request<any>('/payments/submit', { method: 'POST', body: JSON.stringify(data) });
  }

  /** The queue of customer-reported payments waiting to be checked. */
  static getPendingSubmissions() {
    return this.request<{ data: any[]; count: number }>('/payments/pending-submissions');
  }

  static verifyPayment(paymentId: string) {
    return this.request<any>(`/payments/${paymentId}/verify`, { method: 'POST', body: '{}' });
  }

  static reversePayment(paymentId: string, reason: string) {
    return this.request<any>(`/payments/${paymentId}/reverse`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  static getReceipt(paymentId: string) {
    return this.request<any>(`/payments/${paymentId}/receipt`);
  }

  // -------------------------------------------------------------------------
  // Transactions
  // -------------------------------------------------------------------------

  static getTransactions(params: Record<string, unknown> = {}) {
    return this.request<Paged<any> & { totals: any }>(`/transactions${buildQuery(params)}`);
  }

  // -------------------------------------------------------------------------
  // Enrollment
  // -------------------------------------------------------------------------

  static getEnrollmentTokens(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/enrollment/tokens${buildQuery(params)}`);
  }

  static generateEnrollmentToken(data: unknown) {
    return this.request<any>('/enrollment/generate', { method: 'POST', body: JSON.stringify(data) });
  }

  static verifyEnrollmentToken(token: string, deviceId?: string) {
    return this.request<any>('/enrollment/verify', { method: 'POST', body: JSON.stringify({ token, deviceId }) });
  }

  static revokeEnrollmentToken(id: string) {
    return this.request<any>(`/enrollment/tokens/${id}/revoke`, { method: 'POST', body: '{}' });
  }

  // -------------------------------------------------------------------------
  // Licenses / Notifications / Audit
  // -------------------------------------------------------------------------

  static getLicenses(dealerId?: string) {
    return this.request<any[]>(`/licenses${buildQuery({ dealerId })}`);
  }

  static getNotifications(params: Record<string, unknown> = {}) {
    return this.request<
      Paged<any> & {
        counts: { queued: number; sent: number; failed: number };
        /** True only when a paired phone has actually been heard from recently. */
        deliveryEnabled: boolean;
        deliveryNote: string;
        relays: {
          id: string;
          name: string;
          lastSeenAt?: string;
          online: boolean;
          sentCount: number;
          failedCount: number;
        }[];
      }
    >(`/notifications${buildQuery(params)}`);
  }

  /** The financing agreement, rendered — clauses, snapshot, signature. */
  static getContract(id: string) {
    return this.request<any>(`/contracts/${id}`);
  }

  static getContractForDevice(deviceId: string) {
    return this.request<any>(`/contracts/device/${deviceId}`);
  }

  static signContract(id: string, data: unknown) {
    return this.request<any>(`/contracts/${id}/sign`, { method: 'POST', body: JSON.stringify(data) });
  }

  static voidContract(id: string, reason: string) {
    return this.request<any>(`/contracts/${id}/void`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  }

  static getNotificationTemplates() {
    return this.request<any[]>('/notifications/templates');
  }

  /**
   * Pairs a phone to send this dealership's SMS. The response carries the
   * pairing code, which the server will never send again.
   */
  static pairSmsRelay(data: unknown) {
    return this.request<any>('/notifications/relays', { method: 'POST', body: JSON.stringify(data) });
  }

  static revokeSmsRelay(id: string) {
    return this.request<any>(`/notifications/relays/${id}/revoke`, { method: 'POST', body: '{}' });
  }

  static sendNotification(data: unknown) {
    return this.request<any>('/notifications/send', { method: 'POST', body: JSON.stringify(data) });
  }

  static getAuditLogs(params: Record<string, unknown> = {}) {
    return this.request<Paged<any> & { facets: any }>(`/audit-logs${buildQuery(params)}`);
  }

  static getDeviceActionLogs(params: Record<string, unknown> = {}) {
    return this.request<Paged<any>>(`/audit-logs/device-actions${buildQuery(params)}`);
  }

  // -------------------------------------------------------------------------
  // Settings & staff
  // -------------------------------------------------------------------------

  static getSettings(dealerId?: string) {
    return this.request<any>(`/settings${buildQuery({ dealerId })}`);
  }

  static updatePolicy(data: Record<string, unknown>) {
    return this.request<any>('/settings/policy', { method: 'PUT', body: JSON.stringify(data) });
  }

  static updateProfile(data: Record<string, unknown>) {
    return this.request<any>('/settings/profile', { method: 'PUT', body: JSON.stringify(data) });
  }

  static getUsers(dealerId?: string) {
    return this.request<any[]>(`/users${buildQuery({ dealerId })}`);
  }

  static createUser(data: unknown) {
    return this.request<any>('/users', { method: 'POST', body: JSON.stringify(data) });
  }

  static updateUser(id: string, data: Record<string, unknown>) {
    return this.request<any>(`/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  static resetUserPassword(id: string, temporaryPassword: string) {
    return this.request<any>(`/users/${id}/reset-password`, {
      method: 'POST',
      body: JSON.stringify({ temporaryPassword }),
    });
  }

  static deactivateUser(id: string) {
    return this.request<any>(`/users/${id}`, { method: 'DELETE' });
  }

  // -------------------------------------------------------------------------
  // Simulator
  // -------------------------------------------------------------------------

  static getSimulatorDevices() {
    return this.request<any[]>('/simulator/devices');
  }

  static updateSimulatorState(data: { deviceId: string; action: string; payload?: unknown }) {
    return this.request<any>('/simulator/update-state', {
      method: 'POST',
      body: JSON.stringify({ ...data, payload: data.payload ?? {} }),
    });
  }
}

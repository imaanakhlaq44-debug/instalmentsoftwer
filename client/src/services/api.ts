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

type WriteGuard = (method: string, endpoint: string) => string | null;
let writeGuard: WriteGuard | null = null;

/**
 * Registered by AuthContext. Returns a message to refuse a write before it
 * leaves the browser — used to keep a super admin read-only inside a shop they
 * opened until they deliberately turn edit mode on. Server permissions are
 * unchanged; this guards against slips, not against a hostile client.
 */
export function setWriteGuard(guard: WriteGuard | null) {
  writeGuard = guard;
}

export const VIEW_ONLY_CODE = 'VIEW_ONLY';

function buildQuery(params: Record<string, unknown> = {}): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === 'ALL') continue;
    search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export type TestimonialStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'UNPUBLISHED' | 'WITHDRAWN';

export interface Testimonial {
  id: string;
  dealerId: string;
  quote: string;
  rating: number;
  displayName: string;
  city: string;
  language: 'en' | 'ur';
  status: TestimonialStatus;
  consentText: string;
  consentAt: string;
  consentByName: string;
  reviewedAt: string | null;
  reviewedByName: string | null;
  reviewNote: string | null;
  withdrawnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTestimonial extends Testimonial {
  dealerName: string;
  dealerCity: string;
  dealerActive: boolean;
}

export class ApiService {
  private static async request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(options.headers as Record<string, string>),
    };

    const method = (options.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD' && !endpoint.startsWith('/auth/')) {
      const refusal = writeGuard?.(method, endpoint);
      if (refusal) throw new ApiError(refusal, 403, VIEW_ONLY_CODE);
    }

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

  /** A wiped phone: back to PENDING so the shop can show a fresh QR. */
  static reEnrollDevice(id: string, data: { reason: string }) {
    return this.request<any>(`/devices/${id}/re-enroll`, { method: 'POST', body: JSON.stringify(data) });
  }

  /** Location for recovery: what is known, and whether it may be asked for. Logged on the server. */
  static getDeviceLocation(id: string) {
    return this.request<any>(`/devices/${id}/location`);
  }

  static requestDeviceLocation(id: string, data: { reason: string }) {
    return this.request<any>(`/devices/${id}/location-request`, { method: 'POST', body: JSON.stringify(data) });
  }

  /** Hands the phone back to its owner: no more lock, and the app can be removed. */
  static releaseDevice(id: string, data: { reason: string }) {
    return this.request<any>(`/devices/${id}/release`, { method: 'POST', body: JSON.stringify(data) });
  }

  static correctImei(id: string, data: { imei: string; reason: string }) {
    return this.request<any>(`/devices/${id}/correct-imei`, { method: 'POST', body: JSON.stringify(data) });
  }

  /** Acknowledge and clear a resolved security tamper alert on a device. */
  static clearTamperAlert(id: string, data: { reason: string }) {
    return this.request<any>(`/devices/${id}/clear-tamper`, { method: 'POST', body: JSON.stringify(data) });
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

  /** Whether this shop takes online payments, and through which gateway. Normally `enabled: false`. */
  static getGatewayOptions() {
    return this.request<{ enabled: boolean; providers: { id: string; label: string }[] }>('/payment-gateway/options');
  }

  /** Starts a hosted checkout. The reply says where to send the browser; nothing is paid yet. */
  static createGatewayCheckout(data: { planId: string; amount: number; provider?: string }) {
    return this.request<{
      reference: string;
      amount: number;
      redirect: { url: string; method: 'POST'; fields: Record<string, string> };
    }>('/payment-gateway/checkout', { method: 'POST', body: JSON.stringify(data) });
  }

  /** How a checkout ended, as the server recorded it — not as a URL claims it did. */
  static getGatewayCheckout(reference: string) {
    return this.request<{ reference: string; amount: number; status: string; paymentId?: string; receiptNumber?: string }>(
      `/payment-gateway/checkouts/${encodeURIComponent(reference)}`
    );
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

  static getEnrollmentReadiness(dealerId?: string) {
    return this.request<{ frpConfigured: boolean | null; frpAccountsCount: number; provisioningReady: boolean }>(
      `/enrollment/readiness${buildQuery({ dealerId })}`
    );
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

  /** The super admin's platform dashboard: shops, sales and the fleet. */
  static getPlatformOverview() {
    return this.request<any>('/platform/overview');
  }

  // -------------------------------------------------------------------------
  // Testimonials: a shop's feedback for the website
  // -------------------------------------------------------------------------

  /** The signed-in shop's own feedback, and the consent sentence to show. */
  static getMyTestimonial() {
    return this.request<{ testimonial: Testimonial | null; consentText: string }>('/testimonials/mine');
  }

  /** Submit or edit. `consent` must be true; the server refuses anything else. */
  static submitMyTestimonial(body: { quote: string; rating: number; displayName: string; city: string; consent: boolean }) {
    return this.request<{ testimonial: Testimonial }>('/testimonials/mine', { method: 'PUT', body: JSON.stringify(body) });
  }

  static withdrawMyTestimonial() {
    return this.request<{ testimonial: Testimonial }>('/testimonials/mine/withdraw', { method: 'POST' });
  }

  /** Super admin: every shop's feedback, for review. */
  static getTestimonials() {
    return this.request<{ testimonials: ReviewTestimonial[] }>('/testimonials');
  }

  /** Approves exactly the version the reviewer read (`seenUpdatedAt`). */
  static approveTestimonial(id: string, seenUpdatedAt: string) {
    return this.request<{ testimonial: Testimonial }>(`/testimonials/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ seenUpdatedAt }),
    });
  }

  static rejectTestimonial(id: string, note: string) {
    return this.request<{ testimonial: Testimonial }>(`/testimonials/${id}/reject`, { method: 'POST', body: JSON.stringify({ note }) });
  }

  static unpublishTestimonial(id: string, note: string) {
    return this.request<{ testimonial: Testimonial }>(`/testimonials/${id}/unpublish`, { method: 'POST', body: JSON.stringify({ note }) });
  }

  static getLicenses(dealerId?: string) {
    return this.request<{
      dealers: any[];
      packs: any[];
      catalogue: { size: number; unitPrice: number; totalPrice: number }[];
    }>(`/licenses${buildQuery({ dealerId })}`);
  }

  static getLicensePack(packId: string) {
    return this.request<any>(`/licenses/packs/${packId}`);
  }

  /** Super admin only — records a purchase and mints its locks. */
  static issueLicensePack(body: { dealerId: string; size: number; reference?: string }) {
    return this.request<any>('/licenses/packs', { method: 'POST', body: JSON.stringify(body) });
  }

  // -------------------------------------------------------------------------
  // Lock orders
  // -------------------------------------------------------------------------

  /** A shop owner's own orders; for a super admin, every shop's (or one status). */
  static getLockOrders(params: { status?: string; dealerId?: string } = {}) {
    return this.request<{
      orders: any[];
      paymentInstructions: string;
      maxPendingOrders: number;
    }>(`/lock-orders${buildQuery(params)}`);
  }

  /** Shop owner only — reports a transfer and asks for a pack. Issues nothing. */
  static submitLockOrder(body: {
    size: number;
    paymentMethod: string;
    transactionId: string;
    amountPaid: number;
    proofImage?: string;
    note?: string;
  }) {
    return this.request<any>('/lock-orders', { method: 'POST', body: JSON.stringify(body) });
  }

  static cancelLockOrder(orderId: string) {
    return this.request<any>(`/lock-orders/${orderId}/cancel`, { method: 'POST' });
  }

  static getLockOrderProof(orderId: string) {
    return this.request<{ proofImage: string }>(`/lock-orders/${orderId}/proof`);
  }

  /** Super admin only — confirms the payment and issues the pack, once. */
  static approveLockOrder(orderId: string) {
    return this.request<any>(`/lock-orders/${orderId}/approve`, { method: 'POST' });
  }

  /** Super admin only. */
  static rejectLockOrder(orderId: string, reason: string) {
    return this.request<any>(`/lock-orders/${orderId}/reject`, { method: 'POST', body: JSON.stringify({ reason }) });
  }

  /** Super admin only — where shops are told to send the money. */
  static saveLockPaymentInstructions(paymentInstructions: string) {
    return this.request<any>('/lock-orders/payment-instructions', {
      method: 'PUT',
      body: JSON.stringify({ paymentInstructions }),
    });
  }

  static getNotifications(params: Record<string, unknown> = {}) {
    return this.request<
      Paged<any> & {
        counts: { queued: number; sent: number; failed: number };
        /** True only when a paired phone has actually been heard from recently. */
        deliveryEnabled: boolean;
        deliveryNote: string;
        /** The channel this shop's SMS actually take right now. */
        smsChannel?: 'PHONE' | 'AGGREGATOR' | 'AGGREGATOR_THEN_PHONE';
        aggregator?: { configured: boolean; provider?: string; senderMask?: string };
        /** True only when WhatsApp Business Cloud API credentials are configured on the server. */
        whatsappCloudEnabled?: boolean;
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

  /**
   * The agreement as a PDF rendered by the server, with the Urdu shaped
   * properly. A plain link would not carry the bearer token, so the bytes are
   * fetched here and handed back for the page to save.
   */
  static async downloadContractPdf(id: string): Promise<{ blob: Blob; filename: string }> {
    const headers: Record<string, string> = {};
    const token = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (token) headers['Authorization'] = `Bearer ${token}`;

    let res: Response;
    try {
      res = await fetch(`${API_BASE}/contracts/${id}/pdf`, { headers });
    } catch {
      throw new ApiError('Cannot reach the server. Please check your connection and try again.', 0, 'NETWORK_ERROR');
    }

    if (!res.ok) {
      const payload = await res.json().catch(() => null);
      if (res.status === 401) onUnauthorized?.();
      throw new ApiError(
        payload?.error || payload?.message || `The PDF could not be downloaded (${res.status}).`,
        res.status,
        payload?.code
      );
    }

    const named = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '');
    return { blob: await res.blob(), filename: named?.[1] ?? `agreement-${id}.pdf` };
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

  /**
   * The WhatsApp message for one customer, written by the server from the
   * plan's figures, with its wa.me link. Fetching it records nothing.
   */
  static getWhatsAppMessage(params: Record<string, unknown>) {
    return this.request<{ message: string; url: string; phone: string; waNumber: string; language: string }>(
      `/notifications/whatsapp/message${buildQuery(params)}`
    );
  }

  /** Records that a staff member opened WhatsApp with that message. Opened — not sent. */
  static recordWhatsAppOpened(data: Record<string, unknown>) {
    return this.request<any>('/notifications/whatsapp/opened', { method: 'POST', body: JSON.stringify(data) });
  }

  static sendNotification(data: unknown) {
    return this.request<any>('/notifications/send', { method: 'POST', body: JSON.stringify(data) });
  }

  // -------------------------------------------------------------------------
  // Handset compatibility tests
  // -------------------------------------------------------------------------

  static getHandsetTests(params: Record<string, unknown> = {}) {
    return this.request<Paged<any> & { facets: { brands: string[]; androidVersions: string[] } }>(
      `/handset-tests${buildQuery(params)}`
    );
  }

  static createHandsetTest(data: Record<string, unknown>) {
    return this.request<any>('/handset-tests', { method: 'POST', body: JSON.stringify(data) });
  }

  static updateHandsetTest(id: string, data: Record<string, unknown>) {
    return this.request<any>(`/handset-tests/${id}`, { method: 'PATCH', body: JSON.stringify(data) });
  }

  static publishHandsetTest(id: string, published: boolean) {
    return this.request<any>(`/handset-tests/${id}/publish`, { method: 'PATCH', body: JSON.stringify({ published }) });
  }

  static deleteHandsetTest(id: string) {
    return this.request<any>(`/handset-tests/${id}`, { method: 'DELETE' });
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
}

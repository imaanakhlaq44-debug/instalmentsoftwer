import fs from 'fs';
import path from 'path';
import {
  Dealer,
  User,
  Customer,
  Device,
  EnrollmentToken,
  InstallmentPlan,
  Installment,
  Payment,
  Transaction,
  DeviceActionLog,
  AuditLog,
  LicenseKey,
  DevicePolicy,
  Notification,
  NotificationTemplate,
} from '../types/index.js';

export interface DatabaseStore {
  dealers: Dealer[];
  users: User[];
  customers: Customer[];
  devices: Device[];
  enrollmentTokens: EnrollmentToken[];
  installmentPlans: InstallmentPlan[];
  installments: Installment[];
  payments: Payment[];
  transactions: Transaction[];
  deviceActionLogs: DeviceActionLog[];
  auditLogs: AuditLog[];
  licenseKeys: LicenseKey[];
  devicePolicies: DevicePolicy[];
  notifications: Notification[];
  notificationTemplates: NotificationTemplate[];
}

// Overridable so a test run can point at a throwaway directory instead of the
// real server/data — otherwise the suite would overwrite live records.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const TEMP_FILE = path.join(DATA_DIR, 'store.json.tmp');
const BACKUP_FILE = path.join(DATA_DIR, 'store.backup.json');

/** Collections that benefit from an id index (frequent findById lookups). */
const INDEXED_COLLECTIONS: (keyof DatabaseStore)[] = [
  'dealers', 'users', 'customers', 'devices', 'installmentPlans',
  'installments', 'payments', 'enrollmentTokens', 'licenseKeys', 'devicePolicies',
];

function emptyStore(): DatabaseStore {
  return {
    dealers: [],
    users: [],
    customers: [],
    devices: [],
    enrollmentTokens: [],
    installmentPlans: [],
    installments: [],
    payments: [],
    transactions: [],
    deviceActionLogs: [],
    auditLogs: [],
    licenseKeys: [],
    devicePolicies: [],
    notifications: [],
    notificationTemplates: [],
  };
}

/**
 * File-backed in-memory store.
 *
 * Two properties matter here and neither was true of the original version:
 *
 *  1. **Crash safety.** Writes go to a temp file and are atomically renamed over
 *     the real one, with the previous version kept as a backup. A crash mid-write
 *     can no longer truncate the entire customer database.
 *
 *  2. **Write coalescing.** The original rewrote the whole file on every single
 *     insert/update. Creating one customer with a 12-month plan meant 15+ full
 *     file rewrites. Writes are now debounced and flushed on shutdown.
 *
 * This remains a stopgap. See `schema.sql` — the intended production target is
 * PostgreSQL, where concurrency and durability are the database's problem.
 */
class Database {
  private data: DatabaseStore;
  private indexes = new Map<keyof DatabaseStore, Map<string, { id: string }>>();
  private saveTimer: NodeJS.Timeout | null = null;
  private dirty = false;

  /** Debounce window for disk writes, in milliseconds. */
  private static readonly SAVE_DEBOUNCE_MS = 150;

  constructor() {
    this.data = this.loadData();
    this.rebuildAllIndexes();
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  private loadData(): DatabaseStore {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      if (fs.existsSync(DATA_FILE)) {
        const raw = fs.readFileSync(DATA_FILE, 'utf-8');
        return { ...emptyStore(), ...JSON.parse(raw) };
      }
    } catch (err) {
      console.error('[db] store.json is unreadable or corrupt:', err);

      // Fall back to the last known-good snapshot rather than silently starting
      // with an empty database and overwriting real records.
      try {
        if (fs.existsSync(BACKUP_FILE)) {
          const raw = fs.readFileSync(BACKUP_FILE, 'utf-8');
          console.warn('[db] Recovered from store.backup.json.');
          return { ...emptyStore(), ...JSON.parse(raw) };
        }
      } catch (backupErr) {
        console.error('[db] Backup is also unreadable:', backupErr);
      }

      throw new Error(
        'Database file is corrupt and no usable backup exists. Refusing to start with an empty store — ' +
          'inspect server/data/store.json manually.'
      );
    }

    return emptyStore();
  }

  /** Marks the store dirty and schedules a debounced write. */
  private scheduleSave(): void {
    this.dirty = true;
    if (this.saveTimer) return;

    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, Database.SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  /** Writes pending changes to disk immediately. Safe to call at any time. */
  public flush(): void {
    if (!this.dirty) return;

    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }

      const payload = JSON.stringify(this.data, null, 2);

      // Write to a temp file first, fsync it, then atomically rename into place.
      const fd = fs.openSync(TEMP_FILE, 'w');
      try {
        fs.writeFileSync(fd, payload, 'utf-8');
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }

      // Keep the previous good version before replacing it.
      if (fs.existsSync(DATA_FILE)) {
        fs.copyFileSync(DATA_FILE, BACKUP_FILE);
      }

      fs.renameSync(TEMP_FILE, DATA_FILE);
      this.dirty = false;
    } catch (err) {
      console.error('[db] Failed to persist store to disk:', err);
      // Leave `dirty` set so the next mutation retries the write.
    }
  }

  /** Legacy alias — some call sites still expect `save()`. */
  public save(): void {
    this.scheduleSave();
  }

  // -------------------------------------------------------------------------
  // Indexing
  // -------------------------------------------------------------------------

  private rebuildAllIndexes(): void {
    for (const collection of INDEXED_COLLECTIONS) {
      this.rebuildIndex(collection);
    }
  }

  private rebuildIndex(collection: keyof DatabaseStore): void {
    const map = new Map<string, { id: string }>();
    for (const item of this.data[collection] as unknown as { id: string }[]) {
      map.set(item.id, item);
    }
    this.indexes.set(collection, map);
  }

  private indexOf(collection: keyof DatabaseStore): Map<string, { id: string }> | undefined {
    return this.indexes.get(collection);
  }

  // -------------------------------------------------------------------------
  // Query helpers
  // -------------------------------------------------------------------------

  public getStore(): DatabaseStore {
    return this.data;
  }

  public reset(newStore?: DatabaseStore): void {
    this.data = newStore || emptyStore();
    this.rebuildAllIndexes();
    this.dirty = true;
    this.flush();
  }

  public findById<T extends { id: string }>(collection: keyof DatabaseStore, id: string): T | undefined {
    if (!id) return undefined;

    const index = this.indexOf(collection);
    if (index) return index.get(id) as T | undefined;

    const list = this.data[collection] as unknown as T[];
    return list.find((item) => item.id === id);
  }

  public find<T>(collection: keyof DatabaseStore, predicate?: (item: T) => boolean): T[] {
    const list = this.data[collection] as unknown as T[];
    if (!predicate) return [...list];
    return list.filter(predicate);
  }

  public findOne<T>(collection: keyof DatabaseStore, predicate: (item: T) => boolean): T | undefined {
    const list = this.data[collection] as unknown as T[];
    return list.find(predicate);
  }

  public count(collection: keyof DatabaseStore, predicate?: (item: never) => boolean): number {
    const list = this.data[collection] as unknown as never[];
    return predicate ? list.filter(predicate).length : list.length;
  }

  /**
   * Builds a Map keyed by one field, so callers can join two collections in a
   * single pass instead of running findById inside a loop (the N+1 pattern that
   * made the device list quadratic).
   */
  public indexBy<T>(collection: keyof DatabaseStore, key: (item: T) => string | undefined): Map<string, T> {
    const map = new Map<string, T>();
    for (const item of this.data[collection] as unknown as T[]) {
      const k = key(item);
      if (k !== undefined) map.set(k, item);
    }
    return map;
  }

  /** Like `indexBy` but keeps every match, for one-to-many joins. */
  public groupBy<T>(collection: keyof DatabaseStore, key: (item: T) => string | undefined): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of this.data[collection] as unknown as T[]) {
      const k = key(item);
      if (k === undefined) continue;
      const bucket = map.get(k);
      if (bucket) bucket.push(item);
      else map.set(k, [item]);
    }
    return map;
  }

  // -------------------------------------------------------------------------
  // Mutations
  // -------------------------------------------------------------------------

  public insert<T extends { id: string }>(collection: keyof DatabaseStore, item: T): T {
    const index = this.indexOf(collection);
    if (index?.has(item.id)) {
      throw new Error(`Duplicate id "${item.id}" in collection "${String(collection)}".`);
    }

    (this.data[collection] as unknown as T[]).push(item);
    index?.set(item.id, item);
    this.scheduleSave();
    return item;
  }

  public insertMany<T extends { id: string }>(collection: keyof DatabaseStore, items: T[]): T[] {
    for (const item of items) this.insert(collection, item);
    return items;
  }

  public update<T extends { id: string }>(
    collection: keyof DatabaseStore,
    id: string,
    updates: Partial<T>
  ): T | undefined {
    const list = this.data[collection] as unknown as T[];
    const idx = list.findIndex((item) => item.id === id);
    if (idx === -1) return undefined;

    const merged = { ...list[idx], ...updates } as T;

    // `{ field: undefined }` is used throughout the codebase to mean "clear this
    // field", and the spread above already produces that. Strip the keys so the
    // persisted JSON does not carry a pile of explicit nulls.
    for (const key of Object.keys(updates) as (keyof T)[]) {
      if (updates[key] === undefined) delete merged[key];
    }

    list[idx] = merged;
    this.indexOf(collection)?.set(id, merged as unknown as { id: string });
    this.scheduleSave();
    return merged;
  }

  public delete(collection: keyof DatabaseStore, id: string): boolean {
    const list = this.data[collection] as unknown as { id: string }[];
    const idx = list.findIndex((item) => item.id === id);
    if (idx === -1) return false;

    list.splice(idx, 1);
    this.indexOf(collection)?.delete(id);
    this.scheduleSave();
    return true;
  }

  /**
   * Runs a set of mutations and flushes once at the end. Note this is NOT a real
   * transaction — there is no rollback. It exists to make multi-write operations
   * (creating a customer plus a device plus 12 installments) hit the disk once.
   */
  public batch<T>(fn: () => T): T {
    const result = fn();
    this.flush();
    return result;
  }
}

export const db = new Database();

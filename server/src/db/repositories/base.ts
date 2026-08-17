import { prisma, Tx } from '../prisma.js';
import { toDomain, toDomainList, toUpdate, toRow } from '../mappers.js';

/**
 * Shared CRUD for every aggregate.
 *
 * Each repository is built from this and then adds the query methods its own
 * screens need — the ones that push filtering, sorting and pagination into SQL.
 * The generic half exists so fifteen aggregates do not repeat the same eight
 * methods; it is deliberately thin, and nothing here filters in JavaScript.
 *
 * Every method takes an optional transaction handle so a multi-table operation
 * (customer + device + plan + installments) commits or rolls back as a unit.
 */

/**
 * Prisma's generated delegates are structurally identical but nominally
 * distinct, and indexing the client by model name loses that typing. The public
 * signatures below restore it; this alias marks the one place where the
 * looseness is contained rather than spread through every call site.
 */
type Delegate = {
  findUnique(args: unknown): Promise<Record<string, unknown> | null>;
  findFirst(args: unknown): Promise<Record<string, unknown> | null>;
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  count(args?: unknown): Promise<number>;
  create(args: unknown): Promise<Record<string, unknown>>;
  createMany(args: unknown): Promise<{ count: number }>;
  update(args: unknown): Promise<Record<string, unknown>>;
  updateMany(args: unknown): Promise<{ count: number }>;
  delete(args: unknown): Promise<Record<string, unknown>>;
  deleteMany(args: unknown): Promise<{ count: number }>;
  aggregate(args: unknown): Promise<Record<string, unknown>>;
  groupBy(args: unknown): Promise<Record<string, unknown>[]>;
};

export type ModelName =
  | 'dealer' | 'user' | 'customer' | 'device' | 'enrollmentToken'
  | 'installmentPlan' | 'installment' | 'payment' | 'transaction'
  | 'deviceActionLog' | 'auditLog' | 'licenseKey' | 'devicePolicy'
  | 'notification' | 'notificationTemplate';

/** Resolves the delegate on either the shared client or an open transaction. */
export function delegate(model: ModelName, tx?: Tx): Delegate {
  return (tx ?? prisma)[model] as unknown as Delegate;
}

/** A page of rows plus the total the filter matched, both computed in SQL. */
export interface Page<T> {
  data: T[];
  total: number;
}

export interface PageArgs {
  page?: number;
  limit?: number;
}

/** Translates 1-based page/limit into Prisma's skip/take. */
export function toSkipTake(args: PageArgs): { skip: number; take: number } {
  const page = Math.max(1, Math.floor(args.page ?? 1));
  const limit = Math.max(1, Math.floor(args.limit ?? 50));
  return { skip: (page - 1) * limit, take: limit };
}

export interface BaseRepository<T extends { id: string }> {
  findById(id: string, tx?: Tx): Promise<T | undefined>;
  findMany(args?: { where?: unknown; orderBy?: unknown; skip?: number; take?: number }, tx?: Tx): Promise<T[]>;
  findFirst(where: unknown, tx?: Tx): Promise<T | undefined>;
  count(where?: unknown, tx?: Tx): Promise<number>;
  /** One page plus the matching total, in a single round trip. */
  paginate(
    args: { where?: unknown; orderBy?: unknown } & PageArgs,
    tx?: Tx
  ): Promise<Page<T>>;
  create(data: T, tx?: Tx): Promise<T>;
  createMany(data: T[], tx?: Tx): Promise<number>;
  /** Returns `undefined` when no row has that id, matching the old store. */
  update(id: string, updates: Partial<T>, tx?: Tx): Promise<T | undefined>;
  updateMany(where: unknown, updates: Partial<T>, tx?: Tx): Promise<number>;
  delete(id: string, tx?: Tx): Promise<boolean>;
}

/** Prisma's code for "the row this operation targeted does not exist". */
const RECORD_NOT_FOUND = 'P2025';

function isRecordNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === RECORD_NOT_FOUND;
}

export function makeRepository<T extends { id: string }>(model: ModelName): BaseRepository<T> {
  return {
    async findById(id, tx) {
      if (!id) return undefined;
      const row = await delegate(model, tx).findUnique({ where: { id } });
      return row ? toDomain<T>(row) : undefined;
    },

    async findMany(args = {}, tx) {
      const rows = await delegate(model, tx).findMany(args);
      return toDomainList<T>(rows);
    },

    async findFirst(where, tx) {
      const row = await delegate(model, tx).findFirst({ where });
      return row ? toDomain<T>(row) : undefined;
    },

    async count(where, tx) {
      return delegate(model, tx).count({ where });
    },

    async paginate({ where, orderBy, page, limit }, tx) {
      const { skip, take } = toSkipTake({ page, limit });
      const d = delegate(model, tx);

      // Both statements go to the database; the count reflects the whole
      // filtered set, which is what the CSV export and the page counter need.
      const [rows, total] = await Promise.all([
        d.findMany({ where, orderBy, skip, take }),
        d.count({ where }),
      ]);

      return { data: toDomainList<T>(rows), total };
    },

    async create(data, tx) {
      const row = await delegate(model, tx).create({ data: toRow(data as Record<string, unknown>) });
      return toDomain<T>(row);
    },

    async createMany(data, tx) {
      if (data.length === 0) return 0;
      const result = await delegate(model, tx).createMany({
        data: data.map((item) => toRow(item as Record<string, unknown>)),
      });
      return result.count;
    },

    async update(id, updates, tx) {
      try {
        const row = await delegate(model, tx).update({ where: { id }, data: toUpdate<T>(updates) });
        return toDomain<T>(row);
      } catch (err) {
        if (isRecordNotFound(err)) return undefined;
        throw err;
      }
    },

    async updateMany(where, updates, tx) {
      const result = await delegate(model, tx).updateMany({ where, data: toUpdate<T>(updates) });
      return result.count;
    },

    async delete(id, tx) {
      try {
        await delegate(model, tx).delete({ where: { id } });
        return true;
      } catch (err) {
        if (isRecordNotFound(err)) return false;
        throw err;
      }
    },
  };
}

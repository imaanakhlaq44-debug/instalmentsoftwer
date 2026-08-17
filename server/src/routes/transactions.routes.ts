import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/db.js';
import { Transaction, Customer } from '../types/index.js';
import { getAuthUser, resolveDealerScope } from '../middleware/auth.js';
import { validateQuery, getQuery } from '../middleware/validate.js';
import { paginationSchema, paginate } from '../utils/validators.js';

export const transactionsRouter = Router();

const listQuerySchema = paginationSchema.extend({
  type: z.string().trim().max(30).optional(),
  status: z.string().trim().max(20).optional(),
  customerId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

transactionsRouter.get('/', validateQuery(listQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  const customersById = db.indexBy<Customer>('customers', (c) => c.id);

  const txs = db.find<Transaction>('transactions', (t) => {
    if (scope !== null && t.dealerId !== scope) return false;
    if (user.role === 'CUSTOMER' && t.customerId !== user.customerId) return false;
    if (q.type && q.type !== 'ALL' && t.type !== q.type) return false;
    if (q.status && q.status !== 'ALL' && t.status !== q.status) return false;
    if (q.customerId && t.customerId !== q.customerId) return false;
    if (q.from && t.date < q.from) return false;
    if (q.to && t.date > `${q.to}T23:59:59.999Z`) return false;
    return true;
  });

  txs.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const page = paginate(txs, { page: q.page, limit: q.limit });

  const enriched = page.data.map((t) => {
    const customer = customersById.get(t.customerId);
    return {
      ...t,
      customerName: customer?.name ?? 'Unknown',
      customerPhone: customer?.phone ?? 'N/A',
    };
  });

  // Money in versus money out, so the ledger footer actually balances.
  const completed = txs.filter((t) => t.status === 'COMPLETED');
  const inflow = completed.filter((t) => t.amount > 0).reduce((s, t) => s + t.amount, 0);
  const outflow = completed.filter((t) => t.amount < 0).reduce((s, t) => s + Math.abs(t.amount), 0);

  res.json({
    ...page,
    data: enriched,
    totals: { count: txs.length, inflow, outflow, net: inflow - outflow },
  });
});

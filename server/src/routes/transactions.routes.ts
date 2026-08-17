import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy } from '../db/repositories/index.js';
import { Customer } from '../types/index.js';
import { getAuthUser, resolveDealerScope } from '../middleware/auth.js';
import { validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

export const transactionsRouter = Router();

const listQuerySchema = paginationSchema.extend({
  type: z.string().trim().max(30).optional(),
  status: z.string().trim().max(20).optional(),
  customerId: z.string().trim().max(64).optional(),
  from: z.string().trim().max(30).optional(),
  to: z.string().trim().max(30).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

transactionsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    const filters = {
      dealerId: scope,
      // A CUSTOMER login only ever sees its own ledger.
      customerId: user.role === 'CUSTOMER' ? user.customerId : q.customerId,
      type: q.type,
      status: q.status,
      from: q.from,
      to: q.to,
    };

    const where = repo.transactions.buildWhere(filters);

    const [page, totals] = await Promise.all([
      repo.transactions.list({ ...filters, page: q.page, limit: q.limit }),
      repo.transactions.totals(where),
    ]);

    // One query for the customers on this page, rather than a lookup per row.
    const customerIds = [...new Set(page.data.map((t) => t.customerId))];
    const customersById = indexBy<Customer>(await repo.customers.findByIds(customerIds), (c) => c.id);

    const enriched = page.data.map((t) => {
      const customer = customersById.get(t.customerId);
      return {
        ...t,
        customerName: customer?.name ?? 'Unknown',
        customerPhone: customer?.phone ?? 'N/A',
      };
    });

    res.json({
      ...pageEnvelope(enriched, page, q.limit),
      totals,
    });
  })
);

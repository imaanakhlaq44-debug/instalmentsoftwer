import { Router } from 'express';
import { z } from 'zod';

import { repo } from '../db/repositories/index.js';
import { ContractService } from '../services/ContractService.js';
import {
  requireDealerStaff, requireDealerAdmin, getAuthUser, resolveDealerScope,
  assertDealerAccess, clientIp, routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

export const contractsRouter = Router();

const listQuerySchema = paginationSchema.extend({
  status: z.enum(['ALL', 'DRAFT', 'SIGNED', 'VOID']).default('ALL'),
  customerId: z.string().trim().max(64).optional(),
});

contractsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    const page = await repo.contracts.list({
      dealerId: resolveDealerScope(req),
      // A CUSTOMER login only ever sees its own agreements.
      customerId: user.role === 'CUSTOMER' ? user.customerId : q.customerId,
      status: q.status,
      page: q.page,
      limit: q.limit,
    });

    const customers = await repo.customers.findByIds([...new Set(page.data.map((c) => c.customerId))]);
    const byId = new Map(customers.map((c) => [c.id, c]));

    // The list is a list. The signature image and the whole frozen snapshot are
    // several kilobytes each and belong on the document, not on a table row.
    const rows = page.data.map((contract) => ({
      id: contract.id,
      status: contract.status,
      customerId: contract.customerId,
      customerName: byId.get(contract.customerId)?.name ?? 'Unknown',
      deviceId: contract.deviceId,
      planId: contract.planId,
      termsVersion: contract.termsVersion,
      signedAt: contract.signedAt,
      signerName: contract.signerName,
      createdAt: contract.createdAt,
    }));

    res.json(pageEnvelope(rows, page, q.limit));
  })
);

/** The document itself, ready to render or print. */
contractsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const contract = await repo.contracts.findById(routeParam(req, 'id'));
    if (!contract) throw AppError.notFound('Contract');

    assertDealerAccess(req, contract.dealerId, 'contract');
    if (user.role === 'CUSTOMER' && contract.customerId !== user.customerId) {
      throw AppError.notFound('Contract');
    }

    res.json(await ContractService.render(contract.id));
  })
);

/** The agreement for one handset — what the device screen links to. */
contractsRouter.get(
  '/device/:deviceId',
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const contract = await repo.contracts.findByDevice(routeParam(req, 'deviceId'));
    if (!contract) throw AppError.notFound('Contract');

    assertDealerAccess(req, contract.dealerId, 'contract');
    if (user.role === 'CUSTOMER' && contract.customerId !== user.customerId) {
      throw AppError.notFound('Contract');
    }

    res.json(await ContractService.render(contract.id));
  })
);

const signSchema = z.object({
  signerName: z.string().trim().min(3, 'Enter the name of the person signing.').max(120),
  /**
   * The signature drawn on screen. Capped well above a normal scrawl but far
   * below anything that could be used to push a photograph into the database.
   */
  signatureImage: z
    .string()
    .trim()
    .startsWith('data:image/png;base64,', 'The signature must be drawn on screen.')
    .max(400_000, 'That signature image is too large.'),
  /** The customer has to tick the declaration; the server does not take it on trust. */
  declarationAccepted: z.literal(true, {
    message: 'The customer must accept the declaration before signing.',
  }),
});

/**
 * Records the signature.
 *
 * Counter staff can do this, because the customer is standing in front of them
 * and someone has to operate the screen. What staff cannot do is skip it: the
 * lock refuses to act on an unsigned agreement.
 */
contractsRouter.post(
  '/:id/sign',
  requireDealerStaff,
  validateBody(signSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof signSchema>;

    const contract = await repo.contracts.findById(routeParam(req, 'id'));
    if (!contract) throw AppError.notFound('Contract');
    assertDealerAccess(req, contract.dealerId, 'contract');

    const signed = await ContractService.sign({
      contractId: contract.id,
      signerName: body.signerName,
      signatureImage: body.signatureImage,
      actor: { userId: user.userId, userName: user.name, userRole: user.role },
      ipAddress: clientIp(req),
    });

    res.json({
      success: true,
      contract: { id: signed.id, status: signed.status, signedAt: signed.signedAt, signerName: signed.signerName },
      message: 'The agreement is signed. This device may now be managed under its terms.',
    });
  })
);

const voidSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason for voiding the agreement.').max(300),
});

/**
 * Voids an agreement — a sale cancelled, or a document signed in error.
 *
 * Dealer admin only, and it takes the device out of enforcement: a voided
 * agreement means nobody has consented to this handset being restricted.
 */
contractsRouter.post(
  '/:id/void',
  requireDealerAdmin,
  validateBody(voidSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const contract = await repo.contracts.findById(routeParam(req, 'id'));
    if (!contract) throw AppError.notFound('Contract');
    assertDealerAccess(req, contract.dealerId, 'contract');

    const voided = await ContractService.void({
      contractId: contract.id,
      reason: (req.body as z.infer<typeof voidSchema>).reason,
      actor: { userId: user.userId, userName: user.name, userRole: user.role },
      ipAddress: clientIp(req),
    });

    res.json({
      success: true,
      contract: { id: voided.id, status: voided.status, voidedAt: voided.voidedAt },
      message: 'The agreement is void. This device can no longer be restricted.',
    });
  })
);

import { Router } from 'express';
import { z } from 'zod';

import { repo, indexBy, dealerScope } from '../db/repositories/index.js';
import { Device, Customer } from '../types/index.js';
import { EnrollmentService } from '../services/EnrollmentService.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId,
  assertDealerAccess, clientIp,
  routeParam,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

export const enrollmentRouter = Router();

// Enrollment is a counter operation; customers have no business here.
enrollmentRouter.use(requireDealerStaff);

const listQuerySchema = paginationSchema.extend({
  status: z.string().trim().max(20).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

enrollmentRouter.get(
  '/tokens',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);
    const now = new Date();

    const where: Record<string, unknown> = { ...dealerScope(scope) };
    if (q.status && q.status !== 'ALL') where.status = q.status;

    const page = await repo.enrollmentTokens.paginate({
      where,
      orderBy: { createdAt: 'desc' },
      page: q.page,
      limit: q.limit,
    });

    const deviceIds = [...new Set(page.data.map((t) => t.deviceId).filter(Boolean))] as string[];
    const customerIds = [...new Set(page.data.map((t) => t.customerId).filter(Boolean))] as string[];

    const [deviceRows, customerRows] = await Promise.all([
      repo.devices.findByIds(deviceIds),
      repo.customers.findByIds(customerIds),
    ]);
    const devicesById = indexBy<Device>(deviceRows, (d) => d.id);
    const customersById = indexBy<Customer>(customerRows, (c) => c.id);

    const enriched = page.data.map((t) => {
      const device = t.deviceId ? devicesById.get(t.deviceId) : undefined;
      const customer = t.customerId ? customersById.get(t.customerId) : undefined;
      const expired = new Date(t.expiresAt) < now;

      return {
        ...t,
        // The token string is the credential. Once it has been used or has
        // expired there is no reason to keep echoing it back to the browser.
        token: t.status === 'WAITING' && !expired ? t.token : undefined,
        deviceInfo: device ? `${device.brand} ${device.model}` : 'Unassigned',
        deviceStatus: device?.status ?? 'N/A',
        customerName: customer?.name ?? 'Unassigned',
        isExpired: expired,
        minutesRemaining: expired ? 0 : Math.max(0, Math.round((new Date(t.expiresAt).getTime() - now.getTime()) / 60000)),
      };
    });

    res.json(pageEnvelope(enriched, page, q.limit));
  })
);

const generateSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  customerId: z.string().trim().max(64).optional(),
  qrType: z.enum(['STANDARD', 'PRO', 'LEGACY', 'QC']).default('STANDARD'),
  expiresInMinutes: z.number().int().min(5).max(1440).default(60),
});

enrollmentRouter.post(
  '/generate',
  validateBody(generateSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof generateSchema>;
    const dealerId = await resolveWritableDealerId(req, body.dealerId);

    if (body.deviceId) {
      const device = await repo.devices.findById(body.deviceId);
      if (!device) throw AppError.notFound('Device');
      assertDealerAccess(req, device.dealerId, 'device');
    }

    const token = await EnrollmentService.generateToken({
      dealerId,
      deviceId: body.deviceId,
      customerId: body.customerId,
      qrType: body.qrType,
      expiresInMinutes: body.expiresInMinutes,
      actor: { userId: user.userId, userName: user.name, userRole: user.role },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      success: true,
      token,
      qrPayloadString: await EnrollmentService.buildQrPayload(token),
    });
  })
);

const verifySchema = z.object({
  token: z.string().trim().min(8, 'Enrollment code is required.').max(120),
  deviceId: z.string().trim().max(64).optional(),
});

enrollmentRouter.post(
  '/verify',
  validateBody(verifySchema),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof verifySchema>;
    const result = await EnrollmentService.verifyAndEnroll({
      token: body.token,
      deviceId: body.deviceId,
      ipAddress: clientIp(req),
    });
    res.json(result);
  })
);

/** Invalidate a printed QR that should no longer work. */
enrollmentRouter.post(
  '/tokens/:id/revoke',
  asyncHandler(async (req, res) => {
    const token = await repo.enrollmentTokens.findById(routeParam(req, 'id'));
    if (!token) throw AppError.notFound('Enrollment token');
    assertDealerAccess(req, token.dealerId, 'enrollment token');

    if (token.status === 'ENROLLED') {
      throw AppError.badRequest('This token has already been used and cannot be revoked.');
    }

    await repo.enrollmentTokens.update(token.id, { status: 'EXPIRED' });
    res.json({ success: true, message: 'Enrollment code revoked.' });
  })
);

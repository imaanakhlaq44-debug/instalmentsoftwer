import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, indexBy } from '../db/repositories/index.js';
import { Customer, Device } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId,
  assertDealerAccess, clientIp,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, pageEnvelope } from '../utils/validators.js';

export const notificationsRouter = Router();

const listQuerySchema = paginationSchema.extend({
  type: z.string().trim().max(30).optional(),
  status: z.string().trim().max(20).optional(),
  customerId: z.string().trim().max(64).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

notificationsRouter.get(
  '/',
  validateQuery(listQuerySchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const scope = resolveDealerScope(req);
    const q = getQuery<z.infer<typeof listQuerySchema>>(req);

    const filters = {
      dealerId: scope,
      // A CUSTOMER login only ever sees messages addressed to them.
      customerId: user.role === 'CUSTOMER' ? user.customerId : q.customerId,
      type: q.type,
      status: q.status,
    };

    const [page, counts] = await Promise.all([
      repo.notifications.list({ ...filters, page: q.page, limit: q.limit }),
      repo.notifications.statusCounts(repo.notifications.buildWhere(filters)),
    ]);

    // Two queries for the rows on this page, instead of a lookup per row.
    const customerIds = [...new Set(page.data.map((n) => n.customerId).filter(Boolean))] as string[];
    const deviceIds = [...new Set(page.data.map((n) => n.deviceId).filter(Boolean))] as string[];

    const [customerRows, deviceRows] = await Promise.all([
      repo.customers.findByIds(customerIds),
      repo.devices.findByIds(deviceIds),
    ]);
    const customersById = indexBy<Customer>(customerRows, (c) => c.id);
    const devicesById = indexBy<Device>(deviceRows, (d) => d.id);

    const enriched = page.data.map((n) => {
      const customer = n.customerId ? customersById.get(n.customerId) : undefined;
      const device = n.deviceId ? devicesById.get(n.deviceId) : undefined;
      return {
        ...n,
        customerName: customer?.name ?? 'All Customers',
        customerPhone: customer?.phone ?? 'N/A',
        deviceModel: device ? `${device.brand} ${device.model}` : 'N/A',
      };
    });

    res.json({
      ...pageEnvelope(enriched, page, q.limit),
      counts,
      /**
       * Honesty flag for the UI: no SMS gateway is connected, so "QUEUED" means
       * the message exists in the database and nothing more. The dashboard must
       * not imply the customer received a text.
       */
      deliveryEnabled: false,
      deliveryNote:
        'No SMS/WhatsApp gateway is configured. Messages are queued in the system but are not delivered to customers yet.',
    });
  })
);

notificationsRouter.get(
  '/templates',
  requireDealerStaff,
  asyncHandler(async (_req, res) => {
    res.json(await repo.notificationTemplates.findMany());
  })
);

const sendSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  customerId: z.string().trim().max(64).optional(),
  deviceId: z.string().trim().max(64).optional(),
  type: z
    .enum(['PAYMENT_DUE', 'PAYMENT_OVERDUE', 'DEVICE_LOCKED', 'DEVICE_UNLOCKED', 'DEVICE_OFFLINE', 'ENROLLMENT_SUCCESS', 'SECURITY_ALERT'])
    .default('PAYMENT_DUE'),
  channel: z.enum(['IN_APP', 'SMS', 'EMAIL', 'PUSH']).default('SMS'),
  title: z.string().trim().min(2, 'Title is required.').max(120),
  message: z.string().trim().min(2, 'Message is required.').max(600),
});

notificationsRouter.post(
  '/send',
  requireDealerStaff,
  validateBody(sendSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof sendSchema>;
    const dealerId = await resolveWritableDealerId(req, body.dealerId);

    if (body.customerId) {
      const customer = await repo.customers.findById(body.customerId);
      if (!customer) throw AppError.notFound('Customer');
      assertDealerAccess(req, customer.dealerId, 'customer');
    }
    if (body.deviceId) {
      const device = await repo.devices.findById(body.deviceId);
      if (!device) throw AppError.notFound('Device');
      assertDealerAccess(req, device.dealerId, 'device');
    }

    const notification = await repo.notifications.create({
      id: `notif-${uuidv4().substring(0, 8)}`,
      dealerId,
      customerId: body.customerId,
      deviceId: body.deviceId,
      type: body.type,
      channel: body.channel,
      title: body.title,
      message: body.message,
      // QUEUED, not SENT. Nothing has left the building.
      status: 'QUEUED',
      createdAt: new Date().toISOString(),
    });

    await AuditService.log({
      dealerId,
      userId: user.userId,
      actorName: user.name,
      actorRole: user.role,
      action: 'NOTIFICATION_QUEUED',
      targetType: 'NOTIFICATION',
      targetId: notification.id,
      details: `${user.name} queued a ${body.channel} message: "${body.title}".`,
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      success: true,
      notification,
      message: 'Message queued. It will be delivered once an SMS gateway is connected.',
    });
  })
);

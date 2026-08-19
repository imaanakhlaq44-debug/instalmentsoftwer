import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { repo, indexBy } from '../db/repositories/index.js';
import { Customer, Device } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import { SmsRelayService } from '../services/SmsRelayService.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId,
  assertDealerAccess, clientIp, routeParam,
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

    /**
     * Honesty flag for the UI. Delivery is enabled only when a paired phone has
     * actually been heard from recently — not when one exists in the database.
     * A relay left switched off in a drawer must not make the dashboard imply
     * customers are being texted.
     */
    const delivery = await SmsRelayService.deliveryState(scope);

    res.json({
      ...pageEnvelope(enriched, page, q.limit),
      counts,
      deliveryEnabled: delivery.enabled,
      relays: delivery.relays,
      deliveryNote: delivery.enabled
        ? 'A paired phone is sending these messages from its own SIM. "SENT" means the SIM accepted the message, not that it was delivered.'
        : delivery.relays.length > 0
          ? 'A phone is paired but has not checked in recently. Messages stay queued until it does.'
          : 'No SMS gateway or paired phone is connected. Messages are queued in the system but are not delivered to customers yet.',
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

// ---------------------------------------------------------------------------
// PAIRED PHONES — the shop's own handset, standing in for an SMS gateway.
// ---------------------------------------------------------------------------

/** The phones currently able to send this dealership's messages. */
notificationsRouter.get(
  '/relays',
  requireDealerStaff,
  asyncHandler(async (req, res) => {
    res.json(await SmsRelayService.deliveryState(resolveDealerScope(req)));
  })
);

const pairSchema = z.object({
  dealerId: z.string().trim().max(64).optional(),
  name: z.string().trim().min(2, 'Give the phone a name.').max(80),
});

notificationsRouter.post(
  '/relays',
  requireDealerStaff,
  validateBody(pairSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const body = req.body as z.infer<typeof pairSchema>;
    const dealerId = await resolveWritableDealerId(req, body.dealerId);

    const { relay, token } = await SmsRelayService.pair({
      dealerId,
      name: body.name,
      actor: { userId: user.userId, userName: user.name, userRole: user.role },
      ipAddress: clientIp(req),
    });

    res.status(201).json({
      success: true,
      relay: { id: relay.id, name: relay.name, createdAt: relay.createdAt },
      /**
       * The only time this is ever transmitted. From here the phone holds it
       * and the server keeps nothing but its SHA-256 hash.
       */
      pairingCode: `${relay.id}.${token}`,
      message: 'Enter this code in the relay app on the phone. It is shown once and cannot be retrieved.',
    });
  })
);

notificationsRouter.post(
  '/relays/:id/revoke',
  requireDealerStaff,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const relay = await repo.smsRelays.findById(routeParam(req, 'id'));
    if (!relay) throw AppError.notFound('SMS relay');
    assertDealerAccess(req, relay.dealerId, 'SMS relay');

    const revoked = await SmsRelayService.revoke(
      relay.id,
      { userId: user.userId, userName: user.name, userRole: user.role },
      clientIp(req)
    );

    res.json({ success: true, relay: { id: revoked.id, name: revoked.name, revokedAt: revoked.revokedAt } });
  })
);

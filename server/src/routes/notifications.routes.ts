import { Router } from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

import { db } from '../db/db.js';
import { Notification, NotificationTemplate, Customer, Device } from '../types/index.js';
import { AuditService } from '../services/AuditService.js';
import {
  requireDealerStaff, getAuthUser, resolveDealerScope, resolveWritableDealerId,
  assertDealerAccess, clientIp,
} from '../middleware/auth.js';
import { validateBody, validateQuery, getQuery } from '../middleware/validate.js';
import { AppError } from '../utils/AppError.js';
import { paginationSchema, paginate } from '../utils/validators.js';

export const notificationsRouter = Router();

const listQuerySchema = paginationSchema.extend({
  type: z.string().trim().max(30).optional(),
  status: z.string().trim().max(20).optional(),
  customerId: z.string().trim().max(64).optional(),
  dealerId: z.string().trim().max(64).optional(),
});

notificationsRouter.get('/', validateQuery(listQuerySchema), (req, res) => {
  const user = getAuthUser(req);
  const scope = resolveDealerScope(req);
  const q = getQuery<z.infer<typeof listQuerySchema>>(req);

  const customersById = db.indexBy<Customer>('customers', (c) => c.id);
  const devicesById = db.indexBy<Device>('devices', (d) => d.id);

  const notifications = db.find<Notification>('notifications', (n) => {
    if (scope !== null && n.dealerId !== scope) return false;
    if (user.role === 'CUSTOMER' && n.customerId !== user.customerId) return false;
    if (q.type && q.type !== 'ALL' && n.type !== q.type) return false;
    if (q.status && q.status !== 'ALL' && n.status !== q.status) return false;
    if (q.customerId && n.customerId !== q.customerId) return false;
    return true;
  });

  notifications.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const page = paginate(notifications, { page: q.page, limit: q.limit });

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
    ...page,
    data: enriched,
    counts: {
      queued: notifications.filter((n) => n.status === 'QUEUED').length,
      sent: notifications.filter((n) => n.status === 'SENT').length,
      failed: notifications.filter((n) => n.status === 'FAILED').length,
    },
    /**
     * Honesty flag for the UI: no SMS gateway is connected, so "QUEUED" means
     * the message exists in the database and nothing more. The dashboard must
     * not imply the customer received a text.
     */
    deliveryEnabled: false,
    deliveryNote:
      'No SMS/WhatsApp gateway is configured. Messages are queued in the system but are not delivered to customers yet.',
  });
});

notificationsRouter.get('/templates', requireDealerStaff, (_req, res) => {
  res.json(db.find<NotificationTemplate>('notificationTemplates'));
});

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

notificationsRouter.post('/send', requireDealerStaff, validateBody(sendSchema), (req, res) => {
  const user = getAuthUser(req);
  const body = req.body as z.infer<typeof sendSchema>;
  const dealerId = resolveWritableDealerId(req, body.dealerId);

  if (body.customerId) {
    const customer = db.findById<Customer>('customers', body.customerId);
    if (!customer) throw AppError.notFound('Customer');
    assertDealerAccess(req, customer.dealerId, 'customer');
  }
  if (body.deviceId) {
    const device = db.findById<Device>('devices', body.deviceId);
    if (!device) throw AppError.notFound('Device');
    assertDealerAccess(req, device.dealerId, 'device');
  }

  const notification = db.insert<Notification>('notifications', {
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

  AuditService.log({
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
});

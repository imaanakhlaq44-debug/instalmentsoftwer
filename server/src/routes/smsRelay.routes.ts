import { Router } from 'express';
import { z } from 'zod';

import { SmsRelayService } from '../services/SmsRelayService.js';
import { requireRelay, getRelay } from '../middleware/relayAuth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AppError } from '../utils/AppError.js';

/**
 * The API a paired phone talks to.
 *
 * Deliberately a *pull*: the phone asks for work rather than the server pushing
 * to it. A handset on mobile data has no address anybody can reach, no open
 * port and no stable IP, so anything else would mean tunnels and static
 * addressing for what is a shop counter and a SIM card.
 *
 * Like the DPC API, it authenticates as a device and answers only about the one
 * dealership it was paired to.
 */
export const smsRelayRouter = Router();

const pollSchema = z.object({
  /** How many messages the phone is willing to take this round. */
  limit: z.number().int().min(1).max(20).default(10),
  batteryLevel: z.number().int().min(0).max(100).optional(),
  simCarrier: z.string().trim().max(40).optional(),
});

smsRelayRouter.post(
  '/poll',
  requireRelay,
  validateBody(pollSchema),
  asyncHandler(async (req, res) => {
    const relay = getRelay(req);
    const body = req.body as z.infer<typeof pollSchema>;

    const messages = await SmsRelayService.claim(relay, body.limit);

    res.json({
      messages,
      /**
       * The phone waits this long before asking again. It is the server's call,
       * not the app's, so the cadence can be changed without shipping a new
       * APK to a counter somewhere.
       */
      pollIntervalSeconds: messages.length > 0 ? 5 : 60,
    });
  })
);

const resultSchema = z.object({
  results: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(64),
        sent: z.boolean(),
        error: z.string().trim().max(300).optional(),
      })
    )
    .min(1)
    .max(20),
});

/**
 * What actually happened to each message.
 *
 * Nothing is SENT until this says so. A message the SIM refused goes back on
 * the queue with its reason recorded, because a payment reminder that silently
 * evaporated is how a customer ends up with a locked phone and no warning.
 */
smsRelayRouter.post(
  '/results',
  requireRelay,
  validateBody(resultSchema),
  asyncHandler(async (req, res) => {
    const relay = getRelay(req);
    const body = req.body as z.infer<typeof resultSchema>;

    const recorded: { id: string; status: string }[] = [];

    for (const result of body.results) {
      try {
        const notification = await SmsRelayService.report({
          relay,
          notificationId: result.id,
          sent: result.sent,
          error: result.error,
        });
        recorded.push({ id: result.id, status: notification.status });
      } catch (err) {
        // One unknown id in a batch must not discard the outcomes of the
        // messages that were genuinely sent alongside it.
        if (err instanceof AppError && (err.statusCode === 404 || err.statusCode === 403)) {
          recorded.push({ id: result.id, status: 'UNKNOWN' });
          continue;
        }
        throw err;
      }
    }

    res.json({ recorded });
  })
);

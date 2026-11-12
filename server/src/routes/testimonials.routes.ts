import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import { prisma, runInTransaction } from '../db/prisma.js';
import { requireRole, requireSuperAdmin, getAuthUser, clientIp, routeParam } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { AuditService } from '../services/AuditService.js';
import { AppError } from '../utils/AppError.js';

/**
 * Real testimonials: how a shop's own words reach the website.
 *
 * The marketing site shipped with sample quotes, and its build refuses to
 * publish them — printing words no shop said, under a shop's name, is a fake
 * review. This is the honest route. Three rules hold it together:
 *
 *  1. **Consent is explicit and recorded.** Nothing is stored unless the owner
 *     ticked the box; the sentence they agreed to, their name and the time are
 *     kept on the row.
 *  2. **The words stay the shop's.** The platform can approve, reject or
 *     unpublish. It has no way to edit a quote, a name or a city — not even a
 *     spelling. If something needs fixing the review note says so, the owner
 *     fixes it, and that edit is a new submission with a new consent.
 *  3. **Public means approved, and only that.** The unauthenticated endpoint
 *     reads five fields from approved rows of active shops. Withdrawing or
 *     unpublishing removes a quote from it at once.
 */

/** The sentence the owner agrees to. Stored with each submission as given. */
export const TESTIMONIAL_CONSENT_TEXT =
  'I allow Almas SDM to publish this feedback on its website with the name and city written above. I can withdraw it at any time.';

const QUOTE_MIN = 20;
const QUOTE_MAX = 600;

/** Collapses runs of whitespace; a quote is one paragraph on the site. */
const tidy = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Urdu script reads right-to-left in its own typeface; Roman Urdu and English do not. */
const languageOf = (quote: string): 'ur' | 'en' => (/[؀-ۿ]/.test(quote) ? 'ur' : 'en');

/** No markup and no links: this text is printed on a public page. */
const plainText = (label: string) => (value: string, ctx: z.RefinementCtx) => {
  if (/[<>]/.test(value) || /https?:\/\/|www\./i.test(value)) {
    ctx.addIssue({ code: 'custom', message: `${label} cannot contain links or HTML.` });
  }
};

const submitSchema = z.object({
  quote: z
    .string()
    .transform(tidy)
    .pipe(
      z
        .string()
        .min(QUOTE_MIN, `Please write at least ${QUOTE_MIN} characters.`)
        .max(QUOTE_MAX, `Please keep it under ${QUOTE_MAX} characters.`)
        .superRefine(plainText('Feedback'))
    ),
  rating: z.number().int().min(1, 'Rating is 1 to 5.').max(5, 'Rating is 1 to 5.'),
  displayName: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(2, 'Enter the name to show.').max(80).superRefine(plainText('Name'))),
  city: z
    .string()
    .transform(tidy)
    .pipe(z.string().min(2, 'Enter the city to show.').max(60).superRefine(plainText('City'))),
  // Must be literally `true`. A missing, false or truthy-looking value is not consent.
  consent: z.literal(true, { message: 'Tick the box to allow publication, or do not submit.' }),
});

const noteSchema = z.object({
  note: z.string().transform(tidy).pipe(z.string().min(3, 'Say why, so the shop knows.').max(300)),
});

const approveSchema = z.object({
  // When the reviewer loaded the row. If the shop has edited since, the
  // approval is refused: nobody approves words they have not read.
  seenUpdatedAt: z.string().datetime(),
});

type Row = NonNullable<Awaited<ReturnType<typeof prisma.testimonial.findUnique>>>;

/** What the shop itself and the reviewer see. Never served publicly. */
const present = (t: Row) => ({
  id: t.id,
  dealerId: t.dealerId,
  quote: t.quote,
  rating: t.rating,
  displayName: t.displayName,
  city: t.city,
  language: t.language,
  status: t.status,
  consentText: t.consentText,
  consentAt: t.consentAt.toISOString(),
  consentByName: t.consentByName,
  reviewedAt: t.reviewedAt?.toISOString() ?? null,
  reviewedByName: t.reviewedByName,
  reviewNote: t.reviewNote,
  withdrawnAt: t.withdrawnAt?.toISOString() ?? null,
  createdAt: t.createdAt.toISOString(),
  updatedAt: t.updatedAt.toISOString(),
});

// ---------------------------------------------------------------------------
// Public: what the website may print
// ---------------------------------------------------------------------------
export const publicTestimonialsRouter = Router();

publicTestimonialsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    // An explicit `select`, so a column added to the table later cannot leak
    // through here by default. No ids, no shop name, no contact details.
    const rows = await prisma.testimonial.findMany({
      where: { status: 'APPROVED', dealer: { active: true } },
      orderBy: [{ reviewedAt: 'desc' }, { id: 'asc' }],
      select: { quote: true, displayName: true, city: true, rating: true, language: true },
    });
    res.set('Cache-Control', 'public, max-age=300');
    res.json({ testimonials: rows });
  })
);

// ---------------------------------------------------------------------------
// Signed in: the shop's own feedback, and the platform's review queue
// ---------------------------------------------------------------------------
export const testimonialsRouter = Router();

/**
 * The owner speaks for the shop. Staff cannot put the shop's name on a public
 * page, and a super admin has no shop to speak for — which also means the
 * platform cannot write a testimonial on a shop's behalf.
 */
const requireShopOwner = requireRole('DEALER_ADMIN');

function ownDealerId(req: Parameters<typeof getAuthUser>[0]): string {
  const user = getAuthUser(req);
  if (!user.dealerId) throw AppError.forbidden('Your account is not linked to any dealer.');
  return user.dealerId;
}

testimonialsRouter.get(
  '/mine',
  requireShopOwner,
  asyncHandler(async (req, res) => {
    const row = await prisma.testimonial.findUnique({ where: { dealerId: ownDealerId(req) } });
    res.json({ testimonial: row ? present(row) : null, consentText: TESTIMONIAL_CONSENT_TEXT });
  })
);

/** Submit, or edit. Either way it goes (back) to review with a fresh consent. */
testimonialsRouter.put(
  '/mine',
  requireShopOwner,
  validateBody(submitSchema),
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const dealerId = ownDealerId(req);
    const { quote, rating, displayName, city } = req.body as z.infer<typeof submitSchema>;

    const content = {
      quote,
      rating,
      displayName,
      city,
      language: languageOf(quote),
      status: 'PENDING' as const,
      consentText: TESTIMONIAL_CONSENT_TEXT,
      consentAt: new Date(),
      consentByUserId: user.userId,
      consentByName: user.name,
      reviewedAt: null,
      reviewedByName: null,
      reviewNote: null,
      withdrawnAt: null,
    };

    const row = await runInTransaction(async (tx) => {
      const existing = await tx.testimonial.findUnique({ where: { dealerId } });
      const saved = existing
        ? await tx.testimonial.update({ where: { dealerId }, data: content })
        : await tx.testimonial.create({ data: { id: `tst-${uuidv4().substring(0, 8)}`, dealerId, ...content } });

      // The words themselves go in the trail: the row holds only the latest
      // version, and "what exactly did the shop consent to on that day" should
      // have an answer after an edit.
      await AuditService.log(
        {
          dealerId,
          userId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: existing ? 'TESTIMONIAL_RESUBMITTED' : 'TESTIMONIAL_SUBMITTED',
          targetType: 'Testimonial',
          targetId: saved.id,
          details: `Consented to publication as "${displayName}", ${city}. Rating ${rating}/5. Quote: ${quote}`.slice(0, 1000),
          ipAddress: clientIp(req),
        },
        tx
      );
      return saved;
    });

    res.status(200).json({ testimonial: present(row) });
  })
);

/** The shop takes its words back. Off the public endpoint immediately. */
testimonialsRouter.post(
  '/mine/withdraw',
  requireShopOwner,
  asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const dealerId = ownDealerId(req);

    const row = await runInTransaction(async (tx) => {
      const existing = await tx.testimonial.findUnique({ where: { dealerId } });
      if (!existing) throw AppError.notFound('Feedback');
      if (existing.status === 'WITHDRAWN') return existing;

      const saved = await tx.testimonial.update({
        where: { dealerId },
        data: { status: 'WITHDRAWN', withdrawnAt: new Date() },
      });
      await AuditService.log(
        {
          dealerId,
          userId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: 'TESTIMONIAL_WITHDRAWN',
          targetType: 'Testimonial',
          targetId: saved.id,
          details: `Withdrew consent to publish (was ${existing.status}).`,
          ipAddress: clientIp(req),
        },
        tx
      );
      return saved;
    });

    res.json({ testimonial: present(row) });
  })
);

/** The review queue: everything, newest change first, with whose it is. */
testimonialsRouter.get(
  '/',
  requireSuperAdmin,
  asyncHandler(async (_req, res) => {
    const rows = await prisma.testimonial.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { dealer: { select: { name: true, city: true, active: true } } },
    });
    res.json({
      testimonials: rows.map(({ dealer, ...t }) => ({
        ...present(t),
        dealerName: dealer.name,
        dealerCity: dealer.city,
        dealerActive: dealer.active,
      })),
    });
  })
);

type Decision = 'approve' | 'reject' | 'unpublish';

const DECISIONS: Record<
  Decision,
  { from: Row['status'][]; to: Row['status']; action: string; refusal: string }
> = {
  // A rejected or unpublished quote can be approved again as it stands: the
  // shop's consent to those exact words has not been taken back. A withdrawn
  // one never can — only the shop can bring it back, by submitting again.
  approve: {
    from: ['PENDING', 'REJECTED', 'UNPUBLISHED'],
    to: 'APPROVED',
    action: 'TESTIMONIAL_APPROVED',
    refusal: 'Only feedback the shop has not withdrawn can be approved.',
  },
  reject: {
    from: ['PENDING'],
    to: 'REJECTED',
    action: 'TESTIMONIAL_REJECTED',
    refusal: 'Only feedback waiting for review can be rejected.',
  },
  unpublish: {
    from: ['APPROVED'],
    to: 'UNPUBLISHED',
    action: 'TESTIMONIAL_UNPUBLISHED',
    refusal: 'Only published feedback can be unpublished.',
  },
};

function decide(decision: Decision) {
  const rule = DECISIONS[decision];
  return asyncHandler(async (req, res) => {
    const user = getAuthUser(req);
    const id = routeParam(req, 'id');
    const note: string | null = decision === 'approve' ? null : (req.body as z.infer<typeof noteSchema>).note;

    const row = await runInTransaction(async (tx) => {
      const existing = await tx.testimonial.findUnique({ where: { id } });
      if (!existing) throw AppError.notFound('Feedback');
      if (!rule.from.includes(existing.status)) throw AppError.conflict(rule.refusal);
      if (
        decision === 'approve' &&
        existing.updatedAt.getTime() !== new Date((req.body as z.infer<typeof approveSchema>).seenUpdatedAt).getTime()
      ) {
        throw AppError.conflict('The shop changed this feedback after you opened it. Read it again before approving.');
      }

      // Status and review fields only. There is deliberately no path from
      // here to the quote, the name or the city.
      // Conditional on the row still being exactly what was just read, so an
      // edit landing between the read and this write cannot be approved unseen.
      const { count } = await tx.testimonial.updateMany({
        where: { id, status: existing.status, updatedAt: existing.updatedAt },
        data: { status: rule.to, reviewedAt: new Date(), reviewedByName: user.name, reviewNote: note },
      });
      if (count !== 1) throw AppError.conflict('This feedback changed while you were deciding. Reload and read it again.');
      const saved = await tx.testimonial.findUniqueOrThrow({ where: { id } });
      await AuditService.log(
        {
          dealerId: existing.dealerId,
          userId: user.userId,
          actorName: user.name,
          actorRole: user.role,
          action: rule.action,
          targetType: 'Testimonial',
          targetId: id,
          details: `${existing.status} → ${rule.to}${note ? `. Note: ${note}` : ''}`,
          ipAddress: clientIp(req),
        },
        tx
      );
      return saved;
    });

    res.json({ testimonial: present(row) });
  });
}

testimonialsRouter.post('/:id/approve', requireSuperAdmin, validateBody(approveSchema), decide('approve'));
testimonialsRouter.post('/:id/reject', requireSuperAdmin, validateBody(noteSchema), decide('reject'));
testimonialsRouter.post('/:id/unpublish', requireSuperAdmin, validateBody(noteSchema), decide('unpublish'));

import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { v4 as uuidv4 } from 'uuid';

import { prisma } from '../db/prisma.js';
import { repo } from '../db/repositories/index.js';
import { config } from '../config.js';
import { AppError } from '../utils/AppError.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { AuditService } from './AuditService.js';
import { SmsAggregatorService } from './SmsAggregatorService.js';
import { EmailService } from './EmailService.js';

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** How long a code works. */
const CODE_TTL_MS = 15 * 60_000;
/** Wrong guesses before a code is dead. */
const MAX_ATTEMPTS = 5;
/** A new code is not sent sooner than this after the last one. */
const RESEND_COOLDOWN_MS = 60_000;
/** At most this many codes per account per hour, however they are asked for. */
const MAX_CODES_PER_HOUR = 5;

const BAD_CODE = 'The code is wrong or has expired. Request a new code and try again.';

/** The code is stored as an HMAC: a leaked table row does not give the code away. */
function hashCode(resetId: string, code: string): string {
  return createHmac('sha256', config.jwt.secret).update(`${resetId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  return left.length === right.length && timingSafeEqual(left, right);
}

export type ResetChannel = 'email' | 'sms';

export interface ResetRequestResult {
  /** False when this server can send neither email nor SMS. */
  available: boolean;
  /** How the reset goes out: a link by email, or else a code by SMS. */
  channel: ResetChannel | null;
}

/** How long an email link works. */
const LINK_TTL_MS = 30 * 60_000;

const BAD_LINK = 'This reset link is wrong, already used or expired. Ask for a new one.';

/**
 * "Forgot password", without anyone at the platform in the loop.
 *
 * A six-digit code goes by SMS to the mobile number on the account, straight
 * through the SMS gateway — never through the notification queue, where a
 * shop's paired counter phone could read it. The code proves the person
 * holds that phone; with it they choose a new password.
 *
 * Nothing in the replies says whether an email is registered: the same answer
 * comes back for an account that exists and one that does not. A super
 * admin's password is never reset this way.
 */
export class PasswordResetService {
  /** Whether codes can be sent from this server at all. */
  public static isAvailable(): boolean {
    return this.channel() !== null;
  }

  /** Email when a mailbox is set up (it needs nothing from the shop), else SMS. */
  public static channel(): ResetChannel | null {
    if (EmailService.isConfigured()) return 'email';
    if (SmsAggregatorService.isConfigured()) return 'sms';
    return null;
  }

  public static async request(email: string, ipAddress?: string): Promise<ResetRequestResult> {
    const channel = this.channel();
    if (!channel) return { available: false, channel: null };
    const done: ResetRequestResult = { available: true, channel };

    const user = await repo.users.findByEmail(email.trim());
    if (!user || !user.active || user.role === 'SUPER_ADMIN' || (channel === 'sms' && !user.phone)) {
      return done;
    }

    const hourAgo = new Date(Date.now() - 60 * 60_000);
    const recent = await prisma.passwordReset.findMany({
      where: { userId: user.id, createdAt: { gte: hourAgo } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    // Over the limit, nothing is sent — and nothing different is said, or the
    // answer would tell a stranger the account exists. The code already sent
    // is still good.
    const tooMany = recent.length >= MAX_CODES_PER_HOUR;
    const tooSoon = !!recent[0] && Date.now() - recent[0].createdAt.getTime() < RESEND_COOLDOWN_MS;
    if (tooMany || tooSoon) return done;

    const id = `pwr-${uuidv4()}`;
    // A link carries a long random token; an SMS carries a code a person types.
    const code = channel === 'email' ? randomBytes(32).toString('hex') : String(randomInt(0, 1_000_000)).padStart(6, '0');

    // A new code kills every earlier one.
    await prisma.$transaction([
      prisma.passwordReset.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      }),
      prisma.passwordReset.create({
        data: {
          id,
          userId: user.id,
          codeHash: hashCode(id, code),
          expiresAt: new Date(Date.now() + (channel === 'email' ? LINK_TTL_MS : CODE_TTL_MS)),
        },
      }),
    ]);

    if (channel === 'email') {
      const link = `${config.appPublicUrl}/reset-password?id=${encodeURIComponent(id)}&token=${code}`;
      const sent = await EmailService.sendNow({
        to: user.email,
        subject: 'Reset your Almas SDM password',
        text:
          `Assalam o Alaikum ${user.name},\n\n` +
          'Someone (hopefully you) asked to reset the password for your Almas SDM account.\n' +
          `Open this link to choose a new password. It works once, for 30 minutes:\n\n${link}\n\n` +
          'If you did not ask for this, ignore this email. Your password stays the same.\n\n' +
          'Aap ne password reset maanga tha to upar wala link kholein aur naya password banayein. ' +
          'Agar aap ne nahi maanga to is email ko ignore kar dein.\n\n— Almas SDM',
        html:
          `<p>Assalam o Alaikum ${escapeHtml(user.name)},</p>` +
          '<p>Someone (hopefully you) asked to reset the password for your Almas SDM account.</p>' +
          `<p><a href="${link}" style="display:inline-block;padding:12px 20px;background:#0F1419;color:#fff;text-decoration:none;border-radius:6px;font-weight:bold">Choose a new password</a></p>` +
          '<p>The link works once, for 30 minutes. If you did not ask for this, ignore this email — your password stays the same.</p>' +
          '<p>Aap ne password reset maanga tha to upar wala button dabayein aur naya password banayein. Agar aap ne nahi maanga to is email ko ignore kar dein.</p>' +
          '<p>— Almas SDM</p>',
      });

      if (!sent.accepted) {
        await prisma.passwordReset.update({ where: { id }, data: { usedAt: new Date() } });
        console.warn(`[password-reset] email for ${user.id} was not accepted: ${sent.reason}`);
        throw new AppError('The email could not be sent right now. Please try again in a few minutes.', 503);
      }

      await AuditService.log({
        dealerId: user.dealerId,
        userId: user.id,
        actorName: user.name,
        actorRole: user.role,
        action: 'PASSWORD_RESET_REQUESTED',
        targetType: 'USER',
        targetId: user.id,
        details: `A password-reset link was emailed to ${user.name}'s sign-in address.`,
        ipAddress,
      });
      return done;
    }

    const sent = await SmsAggregatorService.sendNow({
      to: user.phone,
      message:
        `Almas SDM password reset code: ${code}. Valid for 15 minutes. ` +
        'Do not share this code with anyone. If you did not ask for it, ignore this message.',
    });

    if (!sent.accepted) {
      // A code nobody received must not stay usable.
      await prisma.passwordReset.update({ where: { id }, data: { usedAt: new Date() } });
      console.warn(`[password-reset] SMS for ${user.id} was not accepted: ${sent.reason}`);
      throw new AppError('The code could not be sent right now. Please try again in a few minutes.', 503);
    }

    await AuditService.log({
      dealerId: user.dealerId,
      userId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'PASSWORD_RESET_REQUESTED',
      targetType: 'USER',
      targetId: user.id,
      details: `A password-reset code was sent by SMS to the mobile number on ${user.name}'s account.`,
      ipAddress,
    });

    return done;
  }

  /** A new password with the link from the email. */
  public static async confirmLink(params: {
    id: string;
    token: string;
    newPassword: string;
    ipAddress?: string;
  }): Promise<{ success: true; message: string; email: string }> {
    const reset = await prisma.passwordReset.findUnique({ where: { id: params.id } });
    if (!reset || reset.usedAt || reset.expiresAt.getTime() <= Date.now() || reset.attempts >= MAX_ATTEMPTS) {
      throw new AppError(BAD_LINK, 400);
    }
    if (!sameHash(reset.codeHash, hashCode(reset.id, params.token))) {
      const attempts = reset.attempts + 1;
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
      });
      throw new AppError(BAD_LINK, 400);
    }

    const user = await repo.users.findById(reset.userId);
    if (!user || !user.active || user.role === 'SUPER_ADMIN') throw new AppError(BAD_LINK, 400);

    const strength = validatePasswordStrength(params.newPassword);
    if (!strength.valid) throw new AppError(strength.errors.join(' '), 400);

    const { count } = await prisma.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new AppError(BAD_LINK, 400);

    await repo.users.update(user.id, {
      // Whoever was signed in with the old password is signed out.
      sessionVersion: (user.sessionVersion ?? 0) + 1,
      passwordHash: hashPassword(params.newPassword),
      passwordChangedAt: new Date().toISOString(),
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });

    await AuditService.log({
      dealerId: user.dealerId,
      userId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'PASSWORD_RESET_SELF',
      targetType: 'USER',
      targetId: user.id,
      details: `${user.name} reset their own password with a link sent by email.`,
      ipAddress: params.ipAddress,
    });

    return { success: true, message: 'Your password has been changed. You can sign in now.', email: user.email };
  }

  public static async confirm(params: {
    email: string;
    code: string;
    newPassword: string;
    ipAddress?: string;
  }): Promise<{ success: true; message: string }> {
    // With email on, rows hold link tokens: typed codes must not burn them.
    if (this.channel() !== 'sms') throw new AppError(BAD_CODE, 400);
    const user = await repo.users.findByEmail(params.email.trim());
    if (!user || !user.active || user.role === 'SUPER_ADMIN') throw new AppError(BAD_CODE, 400);

    const reset = await prisma.passwordReset.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!reset || reset.expiresAt.getTime() <= Date.now() || reset.attempts >= MAX_ATTEMPTS) {
      throw new AppError(BAD_CODE, 400);
    }

    const code = params.code.replace(/\D/g, '');
    if (!sameHash(reset.codeHash, hashCode(reset.id, code))) {
      const attempts = reset.attempts + 1;
      await prisma.passwordReset.update({
        where: { id: reset.id },
        data: { attempts, ...(attempts >= MAX_ATTEMPTS ? { usedAt: new Date() } : {}) },
      });
      throw new AppError(
        attempts >= MAX_ATTEMPTS ? 'Too many wrong codes. Request a new code.' : BAD_CODE,
        400
      );
    }

    // Checked only once the code is right, so a guesser learns nothing from it.
    const strength = validatePasswordStrength(params.newPassword);
    if (!strength.valid) throw new AppError(strength.errors.join(' '), 400);

    const nowIso = new Date().toISOString();
    // Spent first: two requests racing with the same code cannot both succeed.
    const { count } = await prisma.passwordReset.updateMany({
      where: { id: reset.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    if (count === 0) throw new AppError(BAD_CODE, 400);

    await repo.users.update(user.id, {
      passwordHash: hashPassword(params.newPassword),
      passwordChangedAt: nowIso,
      mustChangePassword: false,
      failedLoginAttempts: 0,
      lockedUntil: undefined,
    });

    await AuditService.log({
      dealerId: user.dealerId,
      userId: user.id,
      actorName: user.name,
      actorRole: user.role,
      action: 'PASSWORD_RESET_SELF',
      targetType: 'USER',
      targetId: user.id,
      details: `${user.name} reset their own password with a code sent by SMS.`,
      ipAddress: params.ipAddress,
    });

    return { success: true, message: 'Your password has been changed. You can sign in now.' };
  }
}

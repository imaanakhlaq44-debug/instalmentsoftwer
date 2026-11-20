import { z } from 'zod';
import { prisma, Tx } from '../db/prisma.js';

/**
 * The customer's photograph, taken at the counter.
 *
 * The browser shrinks it to a JPEG of well under 200 KB before sending, the
 * same way a payment screenshot is shrunk, so a whole photo fits in one JSON
 * body. Anything bigger, or anything that is not a JPEG, PNG or WebP image, is
 * refused here rather than stored.
 */
export const CUSTOMER_PHOTO_MAX_CHARS = 180_000;

export const customerPhotoSchema = z
  .string()
  .max(CUSTOMER_PHOTO_MAX_CHARS, 'That photo is too large. Please take it again.')
  .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/, 'The customer photo must be a JPEG, PNG or WebP image.');

export class CustomerPhotoService {
  /** Saves the photo, replacing any earlier one. */
  public static async save(
    params: { customerId: string; dealerId: string; image: string },
    tx?: Tx
  ): Promise<void> {
    const db = tx ?? prisma;
    const updatedAt = new Date();
    await db.customerPhoto.upsert({
      where: { customerId: params.customerId },
      create: { customerId: params.customerId, dealerId: params.dealerId, image: params.image, updatedAt },
      update: { image: params.image, updatedAt },
    });
  }

  public static async find(customerId: string): Promise<{ image: string; updatedAt: string } | null> {
    const row = await prisma.customerPhoto.findUnique({ where: { customerId } });
    return row ? { image: row.image, updatedAt: row.updatedAt.toISOString() } : null;
  }

  public static async has(customerId: string): Promise<boolean> {
    return (await prisma.customerPhoto.count({ where: { customerId } })) > 0;
  }

  /** True when there was a photo to remove. */
  public static async remove(customerId: string): Promise<boolean> {
    const { count } = await prisma.customerPhoto.deleteMany({ where: { customerId } });
    return count > 0;
  }
}

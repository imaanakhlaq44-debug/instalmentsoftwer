import { v4 as uuidv4 } from 'uuid';

import { repo } from '../db/repositories/index.js';
import { Tx } from '../db/prisma.js';
import { AuditLog, UserRole } from '../types/index.js';

export interface AuditEntry {
  dealerId?: string;
  userId: string;
  actorName: string;
  actorRole: UserRole;
  action: string;
  targetType: string;
  targetId: string;
  details: string;
  ipAddress?: string;
}

export class AuditService {
  /**
   * Records one entry in the immutable action trail.
   *
   * Pass the surrounding transaction when the audited operation runs in one:
   * the entry then commits or rolls back with the change it describes, so the
   * trail can never claim a payment was reversed when the reversal failed.
   */
  public static async log(params: AuditEntry, tx?: Tx): Promise<AuditLog> {
    return repo.auditLogs.create(
      {
        id: `alog-${uuidv4().substring(0, 8)}`,
        dealerId: params.dealerId,
        userId: params.userId,
        actorName: params.actorName,
        actorRole: params.actorRole,
        action: params.action,
        targetType: params.targetType,
        targetId: params.targetId,
        details: params.details,
        ipAddress: params.ipAddress || '127.0.0.1',
        createdAt: new Date().toISOString(),
      },
      tx
    );
  }
}

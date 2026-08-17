import { db } from '../db/db.js';
import { AuditLog, UserRole } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export class AuditService {
  public static log(params: {
    dealerId?: string;
    userId: string;
    actorName: string;
    actorRole: UserRole;
    action: string;
    targetType: string;
    targetId: string;
    details: string;
    ipAddress?: string;
  }): AuditLog {
    const auditLog: AuditLog = {
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
    };

    db.insert<AuditLog>('auditLogs', auditLog);
    return auditLog;
  }
}

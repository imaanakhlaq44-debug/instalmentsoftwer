import { db } from '../db/db.js';
import { Device, DeviceStatus, DeviceActionLog, UserRole } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from './AuditService.js';
import { AppError } from '../utils/AppError.js';
import { maskImei } from '../utils/mask.js';

export interface DeviceHealth {
  batteryLevel: number;
  isOnline: boolean;
  lastSeen: string;
  osVersion: string;
  securityPatch: string;
  simCarrier?: string;
  wifiSsid?: string;
}

export interface DeviceLocation {
  lat: number;
  lng: number;
  updatedAt: string;
}

export interface CommandResult {
  success: boolean;
  status: DeviceStatus;
  /** True when the device was offline and the command is waiting for reconnect. */
  queued: boolean;
  message: string;
}

export interface ActorContext {
  userId: string;
  userName: string;
  userRole?: UserRole;
  ipAddress?: string;
}

export interface IDeviceManagementService {
  registerDevice(deviceData: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Promise<Device>;
  enrollDevice(deviceId: string, token: string, ipAddress?: string): Promise<{ success: boolean; device: Device }>;
  getDeviceStatus(deviceId: string): Promise<DeviceStatus>;
  getDeviceHealth(deviceId: string): Promise<DeviceHealth>;
  getDeviceLocation(deviceId: string): Promise<DeviceLocation>;
  lockDevice(params: ActorContext & { deviceId: string; reason: string; lockMessage?: string }): Promise<CommandResult>;
  unlockDevice(params: ActorContext & { deviceId: string; reason: string }): Promise<CommandResult>;
  sendNotification(params: ActorContext & { deviceId: string; title: string; message: string }): Promise<{ success: boolean; queued: boolean; message: string }>;
  rebootDevice(params: ActorContext & { deviceId: string }): Promise<{ success: boolean; queued: boolean; message: string }>;
}

/**
 * Device lifecycle state machine.
 *
 * PENDING    → device record created, DPC not installed yet
 * ENROLLED   → DPC provisioned via QR, handshake complete
 * ACTIVE     → under management, payments current
 * OVERDUE    → payment past its grace date, not yet enforced
 * LOCK_PENDING   → lock command issued, waiting for the device to acknowledge
 * LOCKED     → device confirms it is in restricted mode
 * UNLOCK_PENDING → unlock issued, waiting for acknowledgement
 * INACTIVE   → contract closed or device retired
 * REMOVED    → management removed / device repossessed and released
 */
const VALID_TRANSITIONS: Record<DeviceStatus, DeviceStatus[]> = {
  PENDING: ['ENROLLED', 'INACTIVE', 'REMOVED'],
  // A freshly enrolled device becomes ACTIVE as soon as the handshake completes.
  ENROLLED: ['ACTIVE', 'OVERDUE', 'INACTIVE', 'REMOVED'],
  ACTIVE: ['OVERDUE', 'LOCK_PENDING', 'LOCKED', 'INACTIVE', 'REMOVED'],
  OVERDUE: ['ACTIVE', 'LOCK_PENDING', 'LOCKED', 'INACTIVE', 'REMOVED'],
  LOCK_PENDING: ['LOCKED', 'ACTIVE', 'OVERDUE', 'UNLOCK_PENDING', 'INACTIVE', 'REMOVED'],
  LOCKED: ['UNLOCK_PENDING', 'ACTIVE', 'INACTIVE', 'REMOVED'],
  UNLOCK_PENDING: ['ACTIVE', 'LOCKED', 'OVERDUE', 'INACTIVE', 'REMOVED'],
  INACTIVE: ['ACTIVE', 'PENDING', 'REMOVED'],
  REMOVED: [],
};

/** Statuses that mean "the device is currently restricted, or about to be". */
export const RESTRICTED_STATUSES: DeviceStatus[] = ['LOCK_PENDING', 'LOCKED'];

export class MockDeviceManagementService implements IDeviceManagementService {
  // -------------------------------------------------------------------------
  // Registration & enrollment
  // -------------------------------------------------------------------------

  async registerDevice(deviceData: Omit<Device, 'id' | 'createdAt' | 'updatedAt'>): Promise<Device> {
    if (db.findOne<Device>('devices', (d) => d.imei === deviceData.imei)) {
      throw AppError.conflict(`A device with IMEI ${maskImei(deviceData.imei)} is already registered.`);
    }

    const nowIso = new Date().toISOString();
    return db.insert<Device>('devices', {
      ...deviceData,
      id: `dev-${uuidv4().substring(0, 8)}`,
      status: 'PENDING',
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  }

  /**
   * Completes DPC provisioning.
   *
   * The previous implementation jumped straight from PENDING to ACTIVE, which
   * the state machine forbids — every QR enrollment threw "Invalid state
   * transition from PENDING to ACTIVE" and the whole feature was unusable.
   * The handshake now moves through ENROLLED as the state machine intends.
   */
  async enrollDevice(deviceId: string, token: string, ipAddress?: string): Promise<{ success: boolean; device: Device }> {
    const device = db.findById<Device>('devices', deviceId);
    if (!device) throw AppError.notFound('Device');

    if (device.status === 'ACTIVE') {
      return { success: true, device };
    }

    const nowIso = new Date().toISOString();

    // Step 1: PENDING -> ENROLLED (provisioning handshake accepted)
    if (device.status === 'PENDING') {
      this.validateTransition(device.status, 'ENROLLED');
      db.update<Device>('devices', deviceId, { status: 'ENROLLED', updatedAt: nowIso });
    }

    // Step 2: ENROLLED -> ACTIVE (device checked in and is under management)
    const midway = db.findById<Device>('devices', deviceId)!;
    this.validateTransition(midway.status, 'ACTIVE');

    const updated = db.update<Device>('devices', deviceId, {
      status: 'ACTIVE',
      isOnline: true,
      lastSeen: nowIso,
      updatedAt: nowIso,
    });
    if (!updated) throw new AppError('Failed to enroll device.', 500);

    this.recordAction({
      deviceId,
      dealerId: device.dealerId,
      userId: 'system',
      userName: 'Android Enrollment Client',
      action: 'ENROLL',
      oldStatus: device.status,
      newStatus: 'ACTIVE',
      reason: `Device provisioned via enrollment token ${token}.`,
      deviceAck: true,
      ipAddress,
    });

    return { success: true, device: updated };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  async getDeviceStatus(deviceId: string): Promise<DeviceStatus> {
    return this.requireDevice(deviceId).status;
  }

  async getDeviceHealth(deviceId: string): Promise<DeviceHealth> {
    const device = this.requireDevice(deviceId);
    return {
      batteryLevel: device.batteryLevel,
      isOnline: device.isOnline,
      lastSeen: device.lastSeen,
      osVersion: device.osVersion,
      securityPatch: device.securityPatch,
      simCarrier: device.simCarrier,
      wifiSsid: device.wifiSsid,
    };
  }

  async getDeviceLocation(deviceId: string): Promise<DeviceLocation> {
    const device = this.requireDevice(deviceId);
    return {
      lat: device.locationLat ?? 31.5204,
      lng: device.locationLng ?? 74.3587,
      updatedAt: device.lastSeen,
    };
  }

  // -------------------------------------------------------------------------
  // Enforcement
  // -------------------------------------------------------------------------

  /**
   * Issues a restricted-mode lock.
   *
   * An offline phone cannot be locked instantly — the DPC only applies the
   * policy when it next checks in. The device therefore moves to LOCK_PENDING
   * and settles into LOCKED once it acknowledges (see `acknowledgeCommand`).
   * The old code claimed an offline device was LOCKED, which would have shown
   * dealers a lock that had not actually taken effect.
   */
  async lockDevice(params: ActorContext & { deviceId: string; reason: string; lockMessage?: string }): Promise<CommandResult> {
    const device = this.requireDevice(params.deviceId);

    if (device.status === 'LOCKED') {
      return { success: true, status: 'LOCKED', queued: false, message: 'This device is already in restricted mode.' };
    }
    if (device.status === 'LOCK_PENDING') {
      return {
        success: true,
        status: 'LOCK_PENDING',
        queued: true,
        message: 'A lock command is already queued and will apply when the device reconnects.',
      };
    }
    if (device.status === 'REMOVED' || device.status === 'PENDING') {
      throw AppError.badRequest(
        `This device cannot be locked while its status is ${device.status}. It must be enrolled and active first.`
      );
    }

    const targetStatus: DeviceStatus = device.isOnline ? 'LOCKED' : 'LOCK_PENDING';
    this.validateTransition(device.status, targetStatus);

    const lockMessage =
      params.lockMessage?.trim() ||
      'DEVICE RESTRICTED: Your installment payment is overdue. Please contact your dealer to restore access.';

    const nowIso = new Date().toISOString();
    const updated = db.update<Device>('devices', params.deviceId, {
      status: targetStatus,
      lockReason: params.reason,
      lockMessage,
      pendingCommand: device.isOnline ? undefined : 'LOCK',
      pendingCommandAt: device.isOnline ? undefined : nowIso,
      updatedAt: nowIso,
    });
    if (!updated) throw new AppError('Failed to update device status.', 500);

    this.recordAction({
      deviceId: params.deviceId,
      dealerId: device.dealerId,
      userId: params.userId,
      userName: params.userName,
      action: 'LOCK',
      oldStatus: device.status,
      newStatus: targetStatus,
      reason: params.reason,
      commandPayload: JSON.stringify({ mode: 'REMOTE_LOCK', emergencyCallAllowed: true, message: lockMessage }),
      deviceAck: device.isOnline,
      ipAddress: params.ipAddress,
    });

    AuditService.log({
      dealerId: device.dealerId,
      userId: params.userId,
      actorName: params.userName,
      actorRole: params.userRole ?? 'DEALER_ADMIN',
      action: 'DEVICE_LOCKED',
      targetType: 'DEVICE',
      targetId: params.deviceId,
      details:
        `Restricted lock ${device.isOnline ? 'applied to' : 'queued for'} ${device.brand} ${device.model} ` +
        `(IMEI ${maskImei(device.imei)}). Reason: ${params.reason}`,
      ipAddress: params.ipAddress,
    });

    return {
      success: true,
      status: targetStatus,
      queued: !device.isOnline,
      message: device.isOnline
        ? 'Lock command dispatched and acknowledged by the device.'
        : 'Device is offline. The lock is queued and will apply the moment it reconnects.',
    };
  }

  async unlockDevice(params: ActorContext & { deviceId: string; reason: string }): Promise<CommandResult> {
    const device = this.requireDevice(params.deviceId);

    if (device.status === 'ACTIVE') {
      return { success: true, status: 'ACTIVE', queued: false, message: 'This device is already active.' };
    }
    if (device.status === 'UNLOCK_PENDING') {
      return {
        success: true,
        status: 'UNLOCK_PENDING',
        queued: true,
        message: 'An unlock command is already queued and will apply when the device reconnects.',
      };
    }

    const targetStatus: DeviceStatus = device.isOnline ? 'ACTIVE' : 'UNLOCK_PENDING';
    this.validateTransition(device.status, targetStatus);

    const nowIso = new Date().toISOString();
    const updated = db.update<Device>('devices', params.deviceId, {
      status: targetStatus,
      lockReason: device.isOnline ? undefined : device.lockReason,
      lockMessage: device.isOnline ? undefined : device.lockMessage,
      pendingCommand: device.isOnline ? undefined : 'UNLOCK',
      pendingCommandAt: device.isOnline ? undefined : nowIso,
      updatedAt: nowIso,
    });
    if (!updated) throw new AppError('Failed to unlock device.', 500);

    this.recordAction({
      deviceId: params.deviceId,
      dealerId: device.dealerId,
      userId: params.userId,
      userName: params.userName,
      action: 'UNLOCK',
      oldStatus: device.status,
      newStatus: targetStatus,
      reason: params.reason,
      commandPayload: JSON.stringify({ mode: 'RESTORE_ACTIVE' }),
      deviceAck: device.isOnline,
      ipAddress: params.ipAddress,
    });

    AuditService.log({
      dealerId: device.dealerId,
      userId: params.userId,
      actorName: params.userName,
      actorRole: params.userRole ?? 'DEALER_ADMIN',
      action: 'DEVICE_UNLOCKED',
      targetType: 'DEVICE',
      targetId: params.deviceId,
      details: `Access ${device.isOnline ? 'restored for' : 'restore queued for'} ${device.brand} ${device.model}. Reason: ${params.reason}`,
      ipAddress: params.ipAddress,
    });

    return {
      success: true,
      status: targetStatus,
      queued: !device.isOnline,
      message: device.isOnline
        ? 'Device unlocked successfully.'
        : 'Device is offline. The unlock is queued and will apply the moment it reconnects.',
    };
  }

  /**
   * Called when a device checks in (the simulator's "go online", or a real DPC
   * heartbeat). Applies whatever command was waiting for it.
   */
  async acknowledgeCommand(deviceId: string): Promise<{ applied: boolean; status: DeviceStatus; message: string }> {
    const device = this.requireDevice(deviceId);
    const nowIso = new Date().toISOString();

    if (!device.pendingCommand) {
      db.update<Device>('devices', deviceId, { lastSeen: nowIso, updatedAt: nowIso });
      return { applied: false, status: device.status, message: 'No pending commands for this device.' };
    }

    const isLock = device.pendingCommand === 'LOCK';
    const finalStatus: DeviceStatus = isLock ? 'LOCKED' : 'ACTIVE';
    this.validateTransition(device.status, finalStatus);

    db.update<Device>('devices', deviceId, {
      status: finalStatus,
      lockReason: isLock ? device.lockReason : undefined,
      lockMessage: isLock ? device.lockMessage : undefined,
      pendingCommand: undefined,
      pendingCommandAt: undefined,
      lastSeen: nowIso,
      updatedAt: nowIso,
    });

    this.recordAction({
      deviceId,
      dealerId: device.dealerId,
      userId: 'system',
      userName: 'Device DPC Client',
      action: isLock ? 'LOCK' : 'UNLOCK',
      oldStatus: device.status,
      newStatus: finalStatus,
      reason: `Device reconnected and applied the queued ${device.pendingCommand} command.`,
      deviceAck: true,
    });

    return {
      applied: true,
      status: finalStatus,
      message: isLock
        ? 'Device reconnected and the queued lock has been applied.'
        : 'Device reconnected and the queued unlock has been applied.',
    };
  }

  async sendNotification(
    params: ActorContext & { deviceId: string; title: string; message: string }
  ): Promise<{ success: boolean; queued: boolean; message: string }> {
    const device = this.requireDevice(params.deviceId);

    this.recordAction({
      deviceId: params.deviceId,
      dealerId: device.dealerId,
      userId: params.userId,
      userName: params.userName,
      action: 'SEND_MESSAGE',
      reason: `Push notification sent: "${params.title}"`,
      commandPayload: JSON.stringify({ title: params.title, message: params.message }),
      deviceAck: device.isOnline,
      ipAddress: params.ipAddress,
    });

    return {
      success: true,
      queued: !device.isOnline,
      message: device.isOnline
        ? 'Message delivered to the device.'
        : 'Device is offline. The message will be delivered on reconnect.',
    };
  }

  async rebootDevice(params: ActorContext & { deviceId: string }): Promise<{ success: boolean; queued: boolean; message: string }> {
    const device = this.requireDevice(params.deviceId);

    if (!device.isOnline) {
      throw AppError.badRequest('This device is offline and cannot be rebooted right now.');
    }

    this.recordAction({
      deviceId: params.deviceId,
      dealerId: device.dealerId,
      userId: params.userId,
      userName: params.userName,
      action: 'REBOOT',
      reason: 'Remote restart requested by dealer.',
      deviceAck: true,
      ipAddress: params.ipAddress,
    });

    return { success: true, queued: false, message: 'Reboot command sent to the device.' };
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private requireDevice(deviceId: string): Device {
    const device = db.findById<Device>('devices', deviceId);
    if (!device) throw AppError.notFound('Device');
    return device;
  }

  private validateTransition(current: DeviceStatus, target: DeviceStatus): void {
    const allowed = VALID_TRANSITIONS[current] ?? [];
    if (!allowed.includes(target)) {
      throw AppError.badRequest(
        `A device in "${current}" state cannot move to "${target}". Allowed next states: ${allowed.join(', ') || 'none'}.`
      );
    }
  }

  /** Public so routes can record non-command events (edits, corrections). */
  public recordAction(log: Omit<DeviceActionLog, 'id' | 'createdAt' | 'deviceAck' | 'ipAddress'> & { deviceAck?: boolean; ipAddress?: string }): void {
    db.insert<DeviceActionLog>('deviceActionLogs', {
      ...log,
      deviceAck: log.deviceAck ?? false,
      ipAddress: log.ipAddress || 'system',
      id: `dlog-${uuidv4().substring(0, 8)}`,
      createdAt: new Date().toISOString(),
    });
  }
}

// ---------------------------------------------------------------------------
// Pluggable adapters — not yet implemented. These deliberately throw rather than
// silently pretending to work, so a misconfigured deployment fails loudly.
// ---------------------------------------------------------------------------

const NOT_IMPLEMENTED = (vendor: string) => {
  throw new AppError(
    `The ${vendor} adapter is not implemented yet. The system is currently running the mock device service.`,
    501
  );
};

export class AndroidDPCService implements IDeviceManagementService {
  async registerDevice(): Promise<Device> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async enrollDevice(): Promise<{ success: boolean; device: Device }> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async getDeviceStatus(): Promise<DeviceStatus> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async getDeviceHealth(): Promise<DeviceHealth> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async getDeviceLocation(): Promise<DeviceLocation> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async lockDevice(): Promise<CommandResult> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async unlockDevice(): Promise<CommandResult> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async sendNotification(): Promise<{ success: boolean; queued: boolean; message: string }> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
  async rebootDevice(): Promise<{ success: boolean; queued: boolean; message: string }> { return NOT_IMPLEMENTED('Android Enterprise DPC'); }
}

export class SamsungKnoxService implements IDeviceManagementService {
  async registerDevice(): Promise<Device> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async enrollDevice(): Promise<{ success: boolean; device: Device }> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async getDeviceStatus(): Promise<DeviceStatus> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async getDeviceHealth(): Promise<DeviceHealth> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async getDeviceLocation(): Promise<DeviceLocation> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async lockDevice(): Promise<CommandResult> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async unlockDevice(): Promise<CommandResult> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async sendNotification(): Promise<{ success: boolean; queued: boolean; message: string }> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
  async rebootDevice(): Promise<{ success: boolean; queued: boolean; message: string }> { return NOT_IMPLEMENTED('Samsung Knox Guard'); }
}

export const deviceManagementService = new MockDeviceManagementService();

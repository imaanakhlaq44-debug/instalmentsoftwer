import {
  LayoutDashboard, Smartphone, Users, CalendarDays, CreditCard, QrCode,
  KeyRound, Bell, FileSpreadsheet, Settings, Activity, Radio,
} from 'lucide-react';
import { UserRole } from '../../types/index.js';

export interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutDashboard;
  /** Roles allowed to see this entry. Must mirror the route guards in App.tsx. */
  roles: UserRole[];
  /**
   * Which block of the sidebar this sits in. Twelve flat links is a wall; the
   * same twelve under four headings is a menu somebody can scan.
   */
  group: NavGroup;
  highlight?: boolean;
}

/** Rendered in this order, and only when the role can see something inside. */
export const NAV_GROUPS = ['Overview', 'Portfolio', 'Operations', 'Administration'] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

const ALL: UserRole[] = ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF', 'CUSTOMER'];
const STAFF: UserRole[] = ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_STAFF'];
const ADMIN: UserRole[] = ['SUPER_ADMIN', 'DEALER_ADMIN'];

/**
 * Single source of truth for navigation.
 *
 * The sidebar and the mobile bottom bar both read this list, so a role can
 * never be offered a link that the router will then refuse — which is what
 * happened when every menu item was hardcoded and visible to everyone.
 */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL, group: 'Overview' },
  { to: '/devices', label: 'Devices', icon: Smartphone, roles: ALL, group: 'Portfolio' },
  { to: '/simulator', label: 'Device Simulator', icon: Radio, roles: STAFF, group: 'Operations', highlight: true },
  { to: '/customers', label: 'Customers', icon: Users, roles: STAFF, group: 'Portfolio' },
  { to: '/installments', label: 'Installments', icon: CalendarDays, roles: ALL, group: 'Portfolio' },
  { to: '/payments', label: 'Payments', icon: CreditCard, roles: ALL, group: 'Portfolio' },
  { to: '/enrollment', label: 'QR Enrollment', icon: QrCode, roles: STAFF, group: 'Operations' },
  { to: '/transactions', label: 'Transactions', icon: FileSpreadsheet, roles: STAFF, group: 'Operations' },
  { to: '/licenses', label: 'Device Locks', icon: KeyRound, roles: ADMIN, group: 'Administration' },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL, group: 'Operations' },
  { to: '/audit-logs', label: 'Audit Logs', icon: Activity, roles: ADMIN, group: 'Administration' },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ADMIN, group: 'Administration' },
];

export function navItemsForRole(role: UserRole | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

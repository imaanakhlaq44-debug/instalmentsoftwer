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
  highlight?: boolean;
}

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
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, roles: ALL },
  { to: '/devices', label: 'Devices', icon: Smartphone, roles: ALL },
  { to: '/simulator', label: 'Device Simulator', icon: Radio, roles: STAFF, highlight: true },
  { to: '/customers', label: 'Customers', icon: Users, roles: STAFF },
  { to: '/installments', label: 'Installments', icon: CalendarDays, roles: ALL },
  { to: '/payments', label: 'Payments', icon: CreditCard, roles: ALL },
  { to: '/enrollment', label: 'QR Enrollment', icon: QrCode, roles: STAFF },
  { to: '/transactions', label: 'Transactions', icon: FileSpreadsheet, roles: STAFF },
  { to: '/licenses', label: 'License Keys', icon: KeyRound, roles: ADMIN },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL },
  { to: '/audit-logs', label: 'Audit Logs', icon: Activity, roles: ADMIN },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ADMIN },
];

export function navItemsForRole(role: UserRole | null): NavItem[] {
  if (!role) return [];
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

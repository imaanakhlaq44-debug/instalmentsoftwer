import {
  LayoutDashboard, Smartphone, Users, CalendarDays, CreditCard, QrCode,
  KeyRound, Bell, FileSpreadsheet, Settings, Activity, ClipboardList, Store, ShoppingCart, MessageSquareQuote,
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
export const NAV_GROUPS = ['Platform', 'Overview', 'Portfolio', 'Operations', 'Administration', 'Tools'] as const;
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
  { to: '/customers', label: 'Customers', icon: Users, roles: STAFF, group: 'Portfolio' },
  { to: '/installments', label: 'Installments', icon: CalendarDays, roles: ALL, group: 'Portfolio' },
  { to: '/payments', label: 'Payments', icon: CreditCard, roles: ALL, group: 'Portfolio' },
  { to: '/enrollment', label: 'QR Enrollment', icon: QrCode, roles: STAFF, group: 'Operations' },
  { to: '/transactions', label: 'Transactions', icon: FileSpreadsheet, roles: STAFF, group: 'Operations' },
  { to: '/licenses', label: 'Device Locks', icon: KeyRound, roles: ADMIN, group: 'Administration' },
  { to: '/buy-locks', label: 'Buy locks', icon: ShoppingCart, roles: ['DEALER_ADMIN'], group: 'Administration' },
  { to: '/notifications', label: 'Notifications', icon: Bell, roles: ALL, group: 'Operations' },
  { to: '/audit-logs', label: 'Audit Logs', icon: Activity, roles: ADMIN, group: 'Administration' },
  { to: '/settings', label: 'Settings', icon: Settings, roles: ADMIN, group: 'Administration' },
  // The owner's alone: it puts the shop's name on the public website.
  { to: '/feedback', label: 'Feedback', icon: MessageSquareQuote, roles: ['DEALER_ADMIN'], group: 'Administration' },
];

/**
 * The platform owner's own menu.
 *
 * A super admin looking at every shop at once is running the platform, not a
 * shop: their work is shops, the locks those shops order, and the money for
 * them. Customers, installments and QR codes belong to one shop, so they only
 * appear once a shop is opened (and then as that shop sees them).
 */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: LayoutDashboard, roles: ['SUPER_ADMIN'], group: 'Platform' },
  { to: '/orders', label: 'Lock orders', icon: ClipboardList, roles: ['SUPER_ADMIN'], group: 'Platform' },
  { to: '/shops', label: 'Shops', icon: Store, roles: ['SUPER_ADMIN'], group: 'Platform' },
  { to: '/licenses', label: 'Locks sold', icon: KeyRound, roles: ['SUPER_ADMIN'], group: 'Platform' },
  { to: '/shop-feedback', label: 'Shop feedback', icon: MessageSquareQuote, roles: ['SUPER_ADMIN'], group: 'Platform' },
  { to: '/audit-logs', label: 'Activity log', icon: Activity, roles: ['SUPER_ADMIN'], group: 'Tools' },
];

/**
 * What to show this person. A super admin sees the platform menu until they
 * open a shop; then they see that shop's menu, exactly as its owner does.
 */
export function navItemsForRole(role: UserRole | null, viewingShop = false): NavItem[] {
  if (!role) return [];
  if (role === 'SUPER_ADMIN' && !viewingShop) return PLATFORM_NAV_ITEMS;
  return NAV_ITEMS.filter((item) => item.roles.includes(role));
}

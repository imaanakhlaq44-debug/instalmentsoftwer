import { describe, it, expect } from 'vitest';
import { navItemsForRole } from './navItems.js';

const paths = (items: { to: string }[]) => items.map((i) => i.to);

describe('the menu for each role', () => {
  it('gives the platform admin a platform menu, not a shop menu', () => {
    const menu = paths(navItemsForRole('SUPER_ADMIN'));
    expect(menu).toEqual(['/', '/orders', '/shops', '/licenses', '/shop-feedback', '/audit-logs']);
    for (const shopOnly of ['/customers', '/installments', '/enrollment', '/payments', '/devices', '/settings']) {
      expect(menu).not.toContain(shopOnly);
    }
  });

  it('shows the shop menu once the platform admin opens a shop', () => {
    const menu = paths(navItemsForRole('SUPER_ADMIN', true));
    expect(menu).toContain('/customers');
    expect(menu).toContain('/enrollment');
    expect(menu).not.toContain('/orders');
    expect(menu).not.toContain('/simulator');
    // Even inside a shop, the platform cannot speak for it.
    expect(menu).not.toContain('/feedback');
  });

  it('offers feedback for the website to the shop owner only', () => {
    expect(paths(navItemsForRole('DEALER_ADMIN'))).toContain('/feedback');
    expect(paths(navItemsForRole('DEALER_ADMIN'))).not.toContain('/shop-feedback');
    for (const role of ['DEALER_STAFF', 'CUSTOMER'] as const) {
      expect(paths(navItemsForRole(role))).not.toContain('/feedback');
    }
  });

  it('keeps a shop owner on the shop menu, without platform pages', () => {
    const menu = paths(navItemsForRole('DEALER_ADMIN'));
    expect(menu).toContain('/devices');
    expect(menu).not.toContain('/orders');
    expect(menu).not.toContain('/shops');
    expect(menu).not.toContain('/simulator');
  });
});

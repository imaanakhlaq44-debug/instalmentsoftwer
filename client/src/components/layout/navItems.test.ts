import { describe, it, expect } from 'vitest';
import { navItemsForRole } from './navItems.js';

const paths = (items: { to: string }[]) => items.map((i) => i.to);

describe('the menu for each role', () => {
  it('gives the platform admin a platform menu, not a shop menu', () => {
    const menu = paths(navItemsForRole('SUPER_ADMIN'));
    expect(menu).toEqual(['/', '/orders', '/shops', '/licenses', '/handset-tests', '/audit-logs']);
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
  });

  it('keeps a shop owner on the shop menu, without platform pages', () => {
    const menu = paths(navItemsForRole('DEALER_ADMIN'));
    expect(menu).toContain('/devices');
    expect(menu).not.toContain('/orders');
    expect(menu).not.toContain('/shops');
    expect(menu).not.toContain('/simulator');
  });
});

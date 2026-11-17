import { it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { ShopAppDownloadPage } from './ShopAppDownloadPage.js';
import { mockApi, renderPage } from '../test/harness.js';
it('provides the real shop APK and explains same-account access', async () => {
  mockApi({ role: 'DEALER_ADMIN' }); renderPage(<ShopAppDownloadPage />);
  const link = await screen.findByRole('link', { name: 'Download Android app' });
  expect(link).toHaveAttribute('href', '/downloads/almas-sdm-shop-1.1.0.apk');
  expect(link).toHaveAttribute('download');
  expect(screen.getByText(/saved shop records stay in your online account/)).toBeInTheDocument();
});

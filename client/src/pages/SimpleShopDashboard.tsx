import { ShopKhataHome } from '../components/dashboard/ShopKhataHome.js';

/**
 * The website's shop dashboard: the same khata the shop app opens on, laid out
 * in two columns on a wide screen, so the app and the website read as one product.
 */
export function SimpleShopDashboard() {
  return <ShopKhataHome layout="web" />;
}

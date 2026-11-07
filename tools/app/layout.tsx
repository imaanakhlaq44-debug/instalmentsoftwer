import type { Metadata, Viewport } from 'next';
import './suite.css';
import { SITE_DESCRIPTION, SITE_URL } from '@/lib/site-data';


export const viewport: Viewport = { themeColor: '#FFF8E8', width: 'device-width', initialScale: 1 };

export const metadata: Metadata = {
  metadataBase: new URL(`${SITE_URL}/`),
  title: { default: 'Free Rent Calculators for US & UK Renters | RentWise', template: '%s | RentWise' },
  description: SITE_DESCRIPTION,
  applicationName: 'RentWise',
  authors: [{ name: 'RentWise by Almas SDM', url: `${SITE_URL}/` }],
  creator: 'Almas SDM',
  publisher: 'Almas SDM',
  icons: { icon: 'https://almassdm.pro/favicon.png', apple: 'https://almassdm.pro/favicon.png' },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, 'max-image-preview': 'large', 'max-snippet': -1, 'max-video-preview': -1 },
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en">
    <head>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700;800;900&display=swap" />
    </head>
    <body>{children}</body>
  </html>;
}

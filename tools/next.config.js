/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',
  trailingSlash: true,
  basePath: '/rentwise',
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};

module.exports = nextConfig;

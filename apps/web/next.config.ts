import type { NextConfig } from 'next';
import path from 'node:path';

/** Origin of the Krevia API (optional; defaults to the local API on port 4100). */
const API_URL = (process.env.API_URL || 'http://localhost:4100').replace(/\/+$/, '');
if (!/^https?:\/\/[^\s/]+$/.test(API_URL)) {
  throw new Error(
    `Invalid environment configuration:\n  - API_URL: must be an http(s) origin such as http://localhost:4100 (no path)\nSet it in apps/web/.env.local (see apps/web/.env.example).`,
  );
}

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig: NextConfig = {
  // Lets `pnpm ci` build without overwriting the .next folder of a running dev server.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, '../..'),
  async rewrites() {
    // Same-origin proxy: the browser only ever talks to the website origin.
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The TS compounds live in ../../src/compounds; let Next.js follow them.
  transpilePackages: [],
  experimental: {
    typedRoutes: false,
  },
};

export default nextConfig;

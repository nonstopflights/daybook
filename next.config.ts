import type {NextConfig} from 'next';
const config: NextConfig = {serverExternalPackages: ['pg'], poweredByHeader: false, devIndicators: false, turbopack: {root: process.cwd()}, outputFileTracingRoot: process.cwd()};
export default config;

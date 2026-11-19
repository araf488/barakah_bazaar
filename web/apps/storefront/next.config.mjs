import createNextIntlPlugin from 'next-intl/plugin';

/** Points next-intl at `i18n/request.ts`, its default location. */
const withNextIntl = createNextIntlPlugin();

/** @type {import('next').NextConfig} */
const nextConfig = {};

export default withNextIntl(nextConfig);

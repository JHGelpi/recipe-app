// Where the app finds its services. In the built app these are paths on the
// origin that served it, so the bundle contains no host name and no keys
// (CLAUDE.md rule 2). `pnpm dev:web` runs on a different origin and overrides
// them. Expo inlines EXPO_PUBLIC_* at build time; each must be referenced
// literally.
const origin = typeof window === 'undefined' ? 'http://localhost:8080' : window.location.origin;

function resolve(override: string | undefined, path: string): string {
  return override && override.length > 0 ? override : `${origin}${path}`;
}

export const config = {
  authUrl: resolve(process.env.EXPO_PUBLIC_AUTH_URL, '/auth'),
  apiUrl: resolve(process.env.EXPO_PUBLIC_API_URL, '/api'),
  powersyncUrl: resolve(process.env.EXPO_PUBLIC_POWERSYNC_URL, '/sync'),
  // Set by the proxy image build (deploy/proxy.Dockerfile); `dev` elsewhere.
  buildTime: process.env.EXPO_PUBLIC_BUILD_TIME || 'dev',
};

import { existsSync } from 'node:fs';
import { defineConfig } from '@playwright/test';

export const CHROMIUM_EXECUTABLE_CANDIDATES = [
  '/usr/bin/chromium',
  '/opt/ms-playwright/chromium-1255/chrome-linux64/chrome',
  '/usr/bin/google-chrome-stable',
] as const;

/**
 * Auto-detects an available Chromium executable in strict fallback priority order:
 * 1. `CHROMIUM_PATH` env var (trimmed; only if present on disk, otherwise falls through)
 * 2. `/usr/bin/chromium`
 * 3. `/opt/ms-playwright/chromium-1255/chrome-linux64/chrome`
 * 4. `/usr/bin/google-chrome-stable`
 * 5. `undefined` (Playwright built-in default resolution)
 */
export function resolveChromiumExecutablePath(
  envPath: string | undefined = process.env.CHROMIUM_PATH,
  exists: (p: string) => boolean = existsSync,
): string | undefined {
  const trimmedEnv = typeof envPath === 'string' ? envPath.trim() : '';
  if (trimmedEnv.length > 0 && exists(trimmedEnv)) {
    return trimmedEnv;
  }
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (exists(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

const usePreview = process.env.E2E_USE_PREVIEW === '1';
const isCI = Boolean(process.env.CI);
const chromiumPath = resolveChromiumExecutablePath();

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  forbidOnly: isCI,
  retries: isCI ? 1 : 0,
  workers: 1,
  outputDir: 'test-results/e2e',
  reporter: isCI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]] : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:4179',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    video: 'off',
    headless: true,
    launchOptions: {
      ...(chromiumPath !== undefined ? { executablePath: chromiumPath } : {}),
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-webgl',
        '--enable-unsafe-swiftshader',
        '--ignore-gpu-blocklist',
        '--mute-audio',
      ],
    },
  },
  projects: [
    {
      name: 'desktop',
      grepInvert: /@mobile-only/,
      use: {
        viewport: { width: 1366, height: 768 },
        deviceScaleFactor: 1,
        hasTouch: false,
        isMobile: false,
      },
    },
    {
      name: 'mobile',
      grep: /@mobile-only/,
      use: {
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        hasTouch: true,
        isMobile: true,
      },
    },
  ],
  webServer: {
    command: usePreview
      ? 'npx vite preview --host 127.0.0.1 --port 4179 --strictPort'
      : 'npx vite --host 127.0.0.1 --port 4179 --strictPort',
    url: 'http://127.0.0.1:4179',
    reuseExistingServer: !isCI,
    timeout: 60_000,
  },
});

import { defineConfig } from '@playwright/test';

const usePreview = process.env.E2E_USE_PREVIEW === '1';
const isCI = Boolean(process.env.CI);
const chromiumPath = process.env.CHROMIUM_PATH || '/usr/bin/chromium';

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
      executablePath: chromiumPath,
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

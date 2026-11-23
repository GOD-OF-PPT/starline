import { expect } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { DEV_JARGON_BLOCKLIST } from './contracts';
import type { StarlineInspectSnapshot } from './contracts';

export interface ZeroErrorMonitor {
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly failedHttpAssets: string[];
  assertClean: (inspectSnapshot?: StarlineInspectSnapshot | null) => void;
}

/**
 * Attaches console.error, pageerror, and HTTP >= 400 asset response monitors
 * enforced across every E2E test.
 */
export function attachZeroErrorMonitors(page: Page): ZeroErrorMonitor {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedHttpAssets: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('pageerror', (err) => {
    pageErrors.push(`${err.name}: ${err.message}`);
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedHttpAssets.push(`${res.status()} ${res.url()}`);
    }
  });

  return {
    consoleErrors,
    pageErrors,
    failedHttpAssets,
    assertClean(inspectSnapshot?: StarlineInspectSnapshot | null): void {
      expect(consoleErrors, `Unexpected console.error messages: ${consoleErrors.join(' | ')}`).toEqual([]);
      expect(pageErrors, `Unexpected uncaught pageerror exceptions: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(failedHttpAssets, `Failed HTTP asset requests: ${failedHttpAssets.join(' | ')}`).toEqual([]);
      if (inspectSnapshot) {
        expect(
          inspectSnapshot.failedAssets,
          `Phaser/app failedAssets non-empty: ${inspectSnapshot.failedAssets.join(', ')}`,
        ).toEqual([]);
      }
    },
  };
}

/**
 * Verifies `.app-shell.v2-shell` DOM attributes match `window.__STARLINE_INSPECT__()`.
 */
export async function assertRootSyncedWithInspect(
  page: Page,
  snapshot: StarlineInspectSnapshot,
): Promise<void> {
  const attrs = await page.locator('.app-shell.v2-shell').first().evaluate((el) => ({
    screen: el.getAttribute('data-screen'),
    phase: el.getAttribute('data-phase'),
    act: el.getAttribute('data-act'),
    sector: el.getAttribute('data-sector'),
  }));

  expect(attrs.screen, 'Root data-screen must match inspect.screen').toBe(snapshot.screen);
  expect(attrs.act, 'Root data-act must match inspect.campaignAct').toBe(snapshot.campaignAct);

  const expectedPhase = snapshot.phase ?? '';
  expect(attrs.phase ?? '', 'Root data-phase must match inspect.phase').toBe(expectedPhase);

  if (snapshot.activeRun) {
    expect(attrs.sector, 'Root data-sector must match activeRun.sectorId').toBe(
      snapshot.activeRun.sectorId,
    );
  }
}

/**
 * Verifies zero horizontal overflow at current or specified viewport width.
 */
export async function assertZeroHorizontalOverflow(
  page: Page,
  maxWidth?: number,
): Promise<void> {
  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  const limit = maxWidth ?? metrics.innerWidth;
  expect(
    metrics.scrollWidth,
    `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth}px > limit=${limit}px`,
  ).toBeLessThanOrEqual(limit);
}

/**
 * Verifies a primary CTA or key control is fully visible above the fold without scrolling.
 */
export async function assertAboveFold(
  locator: Locator,
  viewportHeight = 768,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'Target element must have a measurable bounding box').not.toBeNull();
  if (!box) return;
  expect(box.y, `Element top (${box.y}) must be >= 0`).toBeGreaterThanOrEqual(0);
  expect(
    box.y + box.height,
    `Element bottom (${box.y + box.height}) exceeds viewport fold (${viewportHeight})`,
  ).toBeLessThanOrEqual(viewportHeight);
}

/**
 * Verifies touch-target minimum size (`min(width, height) >= minPx`, default 44px).
 */
export async function assertTouchTargetMinSize(
  locator: Locator,
  minPx = 44,
): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, 'Touch target must have a measurable bounding box').not.toBeNull();
  if (!box) return;
  expect(box.width, `Touch target width (${box.width}px) < ${minPx}px`).toBeGreaterThanOrEqual(minPx);
  expect(box.height, `Touch target height (${box.height}px) < ${minPx}px`).toBeGreaterThanOrEqual(minPx);
}

/**
 * Verifies staging cards fit inside their staging container width and thumbnails stay <= 48x48.
 */
export async function assertStagingCardsBounded(page: Page): Promise<void> {
  const result = await page.evaluate(() => {
    const container = document.querySelector(
      '.staging-list, .v2-staging-list, [data-testid="staging-list"]',
    );
    if (!container) {
      return { foundContainer: false, violations: ['Staging container not found'] };
    }
    const containerRect = container.getBoundingClientRect();
    const cards = Array.from(
      container.querySelectorAll('.staging-card, .v2-staging-card, [data-testid^="staging-item"]'),
    );
    const violations: string[] = [];
    if (cards.length === 0) {
      violations.push('No staging cards found inside staging container');
    }
    for (const card of cards) {
      const rect = card.getBoundingClientRect();
      if (rect.right > containerRect.right + 2) {
        violations.push(
          `Staging card overflows container right edge (${Math.round(rect.right)} > ${Math.round(containerRect.right)})`,
        );
      }
      const thumb = card.querySelector('img, svg, .item-thumb, .staging-thumb');
      if (thumb) {
        const tRect = thumb.getBoundingClientRect();
        if (tRect.width > 48.5 || tRect.height > 48.5) {
          violations.push(
            `Staging thumbnail exceeds 48x48 (${Math.round(tRect.width)}x${Math.round(tRect.height)})`,
          );
        }
      }
    }
    return { foundContainer: true, violations };
  });

  expect(result.foundContainer, 'Staging container must be present').toBe(true);
  expect(result.violations, `Staging card bound violations: ${result.violations.join('; ')}`).toEqual([]);
}

/**
 * Verifies no internal engineering jargon leaks into visible UI copy.
 */
export async function assertNoDevJargon(page: Page): Promise<void> {
  const visibleText = await page.evaluate(() => document.body.innerText || '');
  const leaked = DEV_JARGON_BLOCKLIST.filter((term) => visibleText.includes(term));
  expect(leaked, `Internal dev jargon leaked into visible UI: ${leaked.join(', ')}`).toEqual([]);
}

function encodePngBytesToBase64(raw: unknown): string {
  // Playwright returns a Buffer (Uint8Array subclass) with fast native .toString('base64').
  // Verify the PNG base64 magic prefix ('iVBOR') so Uint8Array.prototype.toString() never slips through.
  if (raw && typeof (raw as { toString?: unknown }).toString === 'function') {
    const candidate = (raw as { toString: (encoding?: string) => string }).toString('base64');
    if (candidate.startsWith('iVBOR')) {
      return candidate;
    }
  }
  const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBufferLike);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

/**
 * Verifies the Phaser WebGL/2D canvas is mounted, non-zero sized, and renders
 * non-blank, non-monochrome pixels via Chromium's composited PNG screenshot
 * (works reliably even when WebGL uses `preserveDrawingBuffer: false`).
 */
export async function assertCanvasNonBlank(page: Page): Promise<void> {
  const canvas = page.locator('.scene-canvas-host canvas, canvas').first();
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box, 'Canvas must have visible bounding box').not.toBeNull();
  if (box) {
    expect(box.width, 'Canvas width must be > 0').toBeGreaterThan(0);
    expect(box.height, 'Canvas height must be > 0').toBeGreaterThan(0);
  }

  // Confirm non-zero intrinsic dimensions and allow 2 animation frames for WebGL submission
  const dims = await canvas.evaluate(
    (el) =>
      new Promise<{ width: number; height: number }>((resolve) => {
        const c = el as HTMLCanvasElement;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            resolve({ width: c.width, height: c.height });
          });
        });
      }),
  );
  expect(dims.width, 'Intrinsic canvas width must be > 0').toBeGreaterThan(0);
  expect(dims.height, 'Intrinsic canvas height must be > 0').toBeGreaterThan(0);

  const pngRaw: unknown = await canvas.screenshot({ type: 'png' });
  const pngDataUrl = `data:image/png;base64,${encodePngBytesToBase64(pngRaw)}`;

  const probe = await page.evaluate(async (dataUrl: string) => {
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = dataUrl;
    });
    if (!loaded || img.naturalWidth === 0 || img.naturalHeight === 0) {
      return {
        decoded: false,
        nonZeroPixels: 0,
        uniqueColors: 0,
        sampleSize: '0x0',
      };
    }

    const w = Math.min(img.naturalWidth, 128);
    const h = Math.min(img.naturalHeight, 128);
    const off = document.createElement('canvas');
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) {
      return {
        decoded: false,
        nonZeroPixels: 0,
        uniqueColors: 0,
        sampleSize: `${w}x${h}`,
      };
    }
    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;
    let nonZeroPixels = 0;
    const colorBuckets = new Set<number>();
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 0 && (r > 2 || g > 2 || b > 2)) {
        nonZeroPixels += 1;
      }
      if (colorBuckets.size < 256) {
        colorBuckets.add(((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3));
      }
    }
    return {
      decoded: true,
      nonZeroPixels,
      uniqueColors: colorBuckets.size,
      sampleSize: `${w}x${h}`,
    };
  }, pngDataUrl);

  expect(probe.decoded, `Failed to decode composited canvas PNG (${dims.width}x${dims.height})`).toBe(true);
  expect(
    probe.nonZeroPixels,
    `Canvas appears blank/black: nonZeroPixels=${probe.nonZeroPixels}, uniqueColors=${probe.uniqueColors} (${dims.width}x${dims.height}, sampled ${probe.sampleSize})`,
  ).toBeGreaterThan(10);
  expect(
    probe.uniqueColors,
    `Canvas appears flat/monochrome: uniqueColors=${probe.uniqueColors}, nonZeroPixels=${probe.nonZeroPixels} (${dims.width}x${dims.height})`,
  ).toBeGreaterThan(1);
}

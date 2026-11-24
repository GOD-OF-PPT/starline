#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from '@playwright/test';

const CHROMIUM_EXECUTABLE_CANDIDATES = [
  '/usr/bin/chromium',
  '/opt/ms-playwright/chromium-1255/chrome-linux64/chrome',
  '/usr/bin/google-chrome-stable',
];

const SWIFTSHADER_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-webgl',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--mute-audio',
];

const VIEWPORT_PRESETS = {
  desktop: {
    name: 'desktop',
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    hasTouch: false,
    isMobile: false,
  },
  mobile: {
    name: 'mobile',
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    hasTouch: true,
    isMobile: true,
  },
};

function resolveChromiumExecutablePath(envPath = process.env.CHROMIUM_PATH) {
  const trimmedEnv = typeof envPath === 'string' ? envPath.trim() : '';
  if (trimmedEnv.length > 0 && existsSync(trimmedEnv)) {
    return trimmedEnv;
  }
  for (const candidate of CHROMIUM_EXECUTABLE_CANDIDATES) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function parseArgs(argv) {
  const opts = {
    outDir: process.env.CAPTURE_OUT_DIR || 'output/first-voyage-capture',
    seed: Number(process.env.CAPTURE_SEED || '20261121') >>> 0,
    viewports: ['desktop', 'mobile'],
    reducedMotion: process.env.CAPTURE_REDUCED_MOTION === '1',
    preview: process.env.CAPTURE_USE_PREVIEW === '1',
    url: process.env.CAPTURE_URL || '',
    port: Number(process.env.CAPTURE_PORT || '4181'),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--out-dir' && argv[i + 1]) {
      opts.outDir = argv[++i];
    } else if (arg === '--seed' && argv[i + 1]) {
      opts.seed = Number(argv[++i]) >>> 0;
    } else if (arg === '--viewports' && argv[i + 1]) {
      opts.viewports = argv[++i]
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s in VIEWPORT_PRESETS);
    } else if (arg === '--reduced-motion') {
      opts.reducedMotion = true;
    } else if (arg === '--preview') {
      opts.preview = true;
    } else if (arg === '--url' && argv[i + 1]) {
      opts.url = argv[++i];
    } else if (arg === '--port' && argv[i + 1]) {
      opts.port = Number(argv[++i]);
    }
  }

  if (opts.viewports.length === 0) {
    opts.viewports = ['desktop', 'mobile'];
  }
  return opts;
}

function waitForServer(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          resolve();
        } else if (Date.now() < deadline) {
          setTimeout(attempt, 250);
        } else {
          reject(new Error(`Server at ${url} returned HTTP ${res.statusCode}`));
        }
      });
      req.on('error', () => {
        if (Date.now() < deadline) {
          setTimeout(attempt, 250);
        } else {
          reject(new Error(`Timed out waiting for server at ${url}`));
        }
      });
    };
    attempt();
  });
}

function startLocalServer(port, preview) {
  const args = preview
    ? ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : ['vite', '--host', '127.0.0.1', '--port', String(port), '--strictPort'];
  const child = spawn('npx', args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env },
  });
  return child;
}

async function readInspectSnapshot(page) {
  return page.evaluate(() => {
    if (typeof window.__STARLINE_INSPECT__ === 'function') {
      return window.__STARLINE_INSPECT__();
    }
    return null;
  });
}

async function waitForVisible(locator, timeout = 15_000) {
  await locator.first().waitFor({ state: 'visible', timeout });
}

async function isVisibleSafe(locator, timeout = 500) {
  try {
    await locator.first().waitFor({ state: 'visible', timeout });
    return true;
  } catch {
    return false;
  }
}

async function captureStep(page, dir, filename, steps) {
  const fullPath = path.join(dir, filename);
  await page.waitForTimeout(150);
  await page.screenshot({ path: fullPath, fullPage: false });
  const inspect = await readInspectSnapshot(page);
  steps.push({
    file: filename,
    path: fullPath,
    screen: inspect?.screen ?? null,
    phase: inspect?.phase ?? null,
    phaserScene: inspect?.phaserScene ?? null,
    layer: inspect?.activeRun?.layer ?? null,
    hp: inspect?.activeRun?.hp ?? null,
    fuel: inspect?.activeRun?.fuel ?? null,
    credits: inspect?.credits ?? null,
  });
}

async function runFirstVoyageCapture(browser, baseUrl, opts, preset) {
  const viewportDir = path.resolve(opts.outDir, preset.name);
  await mkdir(viewportDir, { recursive: true });

  const consoleErrors = [];
  const pageErrors = [];
  const steps = [];

  const context = await browser.newContext({
    viewport: preset.viewport,
    deviceScaleFactor: preset.deviceScaleFactor,
    hasTouch: preset.hasTouch,
    isMobile: preset.isMobile,
    reducedMotion: opts.reducedMotion ? 'reduce' : 'no-preference',
  });

  try {
    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => {
      pageErrors.push(String(err));
    });

    const targetUrl = `${baseUrl.replace(/\/$/, '')}/?seed=${opts.seed}`;

    // Clear storage cleanly before starting first voyage
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      window.localStorage.clear();
      window.sessionStorage.clear();
    });
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    // 01-base.png
    if (await isVisibleSafe(page.locator('[data-testid="title-screen"]'), 2_000)) {
      await page.locator('[data-testid="btn-enter-station"]').click();
    }
    await waitForVisible(page.locator('[data-testid="base-screen"]'));
    await captureStep(page, viewportDir, '01-base.png', steps);

    // 02-route.png
    await page.locator('[data-testid="btn-start-tutorial"]').click();
    await waitForVisible(page.locator('[data-testid="map-screen"]'));
    await captureStep(page, viewportDir, '02-route.png', steps);

    // 03-encounter.png
    await page.locator('[data-testid="map-node-L1A"]').click();
    await page.locator('[data-testid="btn-jump-node"]').click();
    await waitForVisible(page.locator('[data-testid="combat-screen"]'));
    await waitForVisible(page.locator('[data-testid="btn-start-combat"]'));
    await captureStep(page, viewportDir, '03-encounter.png', steps);

    // 04-combat.png
    await page.locator('[data-testid="btn-start-combat"]').click();
    await page.waitForFunction(
      () => {
        const snap =
          typeof window.__STARLINE_INSPECT__ === 'function' ? window.__STARLINE_INSPECT__() : null;
        if (snap?.activeRun?.combatWaitingDecision) return true;
        const bar = document.querySelector('[data-testid="combat-tactical-bar"]');
        const skip = document.querySelector('[data-testid="btn-combat-skip"]');
        return Boolean(bar || skip);
      },
      undefined,
      { timeout: 15_000 }
    );
    await captureStep(page, viewportDir, '04-combat.png', steps);

    // 05-reward.png
    const combatDeadline = Date.now() + 25_000;
    while (Date.now() < combatDeadline) {
      if (await isVisibleSafe(page.locator('[data-testid="reward-screen"]'), 300)) {
        break;
      }
      const snap = await readInspectSnapshot(page);
      if (snap?.activeRun?.combatWaitingDecision) {
        const orderBtn = page.locator('[data-testid^="tactical-order-"]:not([disabled])').first();
        if (await isVisibleSafe(orderBtn, 500)) {
          await orderBtn.click();
        }
      } else {
        const skipBtn = page.locator('[data-testid="btn-combat-skip"]:not([disabled])').first();
        if (await isVisibleSafe(skipBtn, 500)) {
          await skipBtn.click();
        }
      }
      await page.waitForTimeout(300);
    }
    await waitForVisible(page.locator('[data-testid="reward-screen"]'));
    await captureStep(page, viewportDir, '05-reward.png', steps);

    // 06-arrange.png
    const repairChoice = page.locator('button[data-pick-reward="repair"]').first();
    if (await isVisibleSafe(repairChoice, 1_000)) {
      await repairChoice.click();
    } else {
      await page.locator('button[data-pick-reward]').first().click();
    }
    const enteredArrange = await isVisibleSafe(page.locator('[data-testid="arrange-screen"]'), 5_000);
    if (!enteredArrange) {
      await waitForVisible(page.locator('[data-testid="map-screen"]'));
    }
    await captureStep(page, viewportDir, '06-arrange.png', steps);

    // 07-wreck.png
    if (await isVisibleSafe(page.locator('[data-testid="btn-leave-arrange"]'), 800)) {
      await page.locator('[data-testid="btn-leave-arrange"]').click();
    }
    await waitForVisible(page.locator('[data-testid="map-screen"]'));
    await page.locator('[data-testid="map-node-L2A"]').click();
    await page.locator('[data-testid="btn-jump-node"]').click();
    await waitForVisible(page.locator('[data-testid="wreck-screen"]'));
    await captureStep(page, viewportDir, '07-wreck.png', steps);

    // 08-reactor.png (cut L2A -> extract -> L3A reactor wreck -> cut -> extract -> arrange with reactor)
    await page.locator('[data-testid="wreck-cut-reactor"]').click();
    await page.locator('[data-testid="btn-wreck-extract"]').click();
    if (await isVisibleSafe(page.locator('[data-testid="arrange-screen"]'), 2_500)) {
      const leaveBtn = page.locator('[data-testid="btn-leave-arrange"]');
      if (await leaveBtn.isDisabled()) {
        const stagingCard = page.locator('.v2-staging-card').first();
        if (await isVisibleSafe(stagingCard, 800)) {
          await stagingCard.click();
          const autoPlace = page.locator('#btn-v2-autoplace');
          if (await isVisibleSafe(autoPlace, 800)) {
            await autoPlace.click();
          }
        }
      }
      await leaveBtn.click();
    }
    await waitForVisible(page.locator('[data-testid="map-screen"]'));
    await page.locator('[data-testid="map-node-L3A"]').click();
    await page.locator('[data-testid="btn-jump-node"]').click();
    await waitForVisible(page.locator('[data-testid="wreck-screen"]'));
    await page.locator('[data-testid="wreck-cut-reactor"]').click();
    await page.locator('[data-testid="btn-wreck-extract"]').click();
    await waitForVisible(page.locator('[data-testid="arrange-screen"]'));
    await captureStep(page, viewportDir, '08-reactor.png', steps);

    // 09-settlement.png (discard old_engine at (2,0), autoplace 2x3 reactor, confirm leave -> settlement)
    const oldEngineCell = page.locator('.cargo-cell[data-cx="2"][data-cy="0"]').first();
    await oldEngineCell.click();
    const discardBtn = page.locator('#btn-v2-discard');
    if (await isVisibleSafe(discardBtn, 1_500)) {
      await discardBtn.click();
    }
    const reactorStagingCard = page.locator('.v2-staging-card').first();
    if (await isVisibleSafe(reactorStagingCard, 1_500)) {
      await reactorStagingCard.click();
    }
    const autoPlaceBtn = page.locator('#btn-v2-autoplace');
    if (await isVisibleSafe(autoPlaceBtn, 1_500)) {
      await autoPlaceBtn.click();
    } else {
      await oldEngineCell.click();
    }

    await page.locator('[data-testid="btn-leave-arrange"]').click();
    if (await isVisibleSafe(page.locator('#v2-discard-ok'), 1_500)) {
      await page.locator('#v2-discard-ok').click();
    }
    if (await isVisibleSafe(page.locator('[data-testid="map-screen"]'), 2_000)) {
      await page.locator('[data-testid="btn-safe-return"]').click();
    }
    await waitForVisible(page.locator('[data-testid="settlement-screen"]'));
    await captureStep(page, viewportDir, '09-settlement.png', steps);

    // 10-return.png
    await page.locator('[data-testid="btn-confirm-settlement"]').click();
    await waitForVisible(page.locator('[data-testid="base-screen"]'));
    await page.waitForTimeout(300);
    await captureStep(page, viewportDir, '10-return.png', steps);

    const manifest = {
      viewport: preset.name,
      dimensions: preset.viewport,
      seed: opts.seed,
      reducedMotion: opts.reducedMotion,
      capturedAt: new Date().toISOString(),
      consoleErrors,
      pageErrors,
      errorCount: consoleErrors.length + pageErrors.length,
      steps,
    };
    await writeFile(
      path.join(viewportDir, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
      'utf8'
    );
    return manifest;
  } finally {
    await context.close();
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const executablePath = resolveChromiumExecutablePath();
  const baseUrl = opts.url || `http://127.0.0.1:${opts.port}`;

  let serverProc = null;
  let browser = null;

  try {
    if (!opts.url) {
      serverProc = startLocalServer(opts.port, opts.preview);
      await waitForServer(baseUrl);
    }

    browser = await chromium.launch({
      headless: true,
      ...(executablePath !== undefined ? { executablePath } : {}),
      args: SWIFTSHADER_LAUNCH_ARGS,
    });

    const summaries = [];
    for (const vpName of opts.viewports) {
      const preset = VIEWPORT_PRESETS[vpName];
      const summary = await runFirstVoyageCapture(browser, baseUrl, opts, preset);
      summaries.push(summary);
      console.log(
        `[capture-first-voyage] ${preset.name}: ${summary.steps.length}/10 screenshots captured (${summary.errorCount} errors)`
      );
    }

    const totalErrors = summaries.reduce((acc, s) => acc + s.errorCount, 0);
    if (totalErrors > 0) {
      process.exitCode = 1;
    }
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    if (serverProc && !serverProc.killed) {
      serverProc.kill('SIGTERM');
    }
  }
}

main().catch((err) => {
  console.error('[capture-first-voyage] Fatal error:', err);
  process.exit(1);
});

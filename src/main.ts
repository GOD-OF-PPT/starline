import './ui/styles.css';
import './v2/ui/styles/v3-layout.css';
import './v2/ui/styles/v3-campaign.css';
import './v2/ui/styles/v3-combat.css';
import './v2/ui/styles/v3-dismantle.css';
import './v2/ui/styles/v3-buildcraft.css';
import { soundEngine } from './audio/soundEngine';
import { AppController } from './ui/AppController';
import { hasOpenModal } from './ui/Modals';
import { V2AppController } from './v2/ui/V2AppController';

const MODE_STORAGE_KEY = 'starline_active_mode';

function resolveInitialMode(): 'v1' | 'v2' {
  const params = new URLSearchParams(window.location.search);
  const queryMode = params.get('mode');
  if (queryMode === 'v1') {
    try {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, 'v1');
    } catch {
      // ignore storage restrictions
    }
    return 'v1';
  }
  if (queryMode === 'v2') {
    try {
      window.sessionStorage.setItem(MODE_STORAGE_KEY, 'v2');
    } catch {
      // ignore storage restrictions
    }
    return 'v2';
  }
  try {
    if (window.sessionStorage.getItem(MODE_STORAGE_KEY) === 'v1') {
      return 'v1';
    }
  } catch {
    // ignore storage restrictions
  }
  return 'v2';
}

function navigateToMode(targetMode: 'v1' | 'v2'): void {
  try {
    window.sessionStorage.setItem(MODE_STORAGE_KEY, targetMode);
  } catch {
    // ignore
  }
  const url = new URL(window.location.href);
  if (targetMode === 'v1') {
    url.searchParams.set('mode', 'v1');
  } else {
    url.searchParams.delete('mode');
  }
  window.location.assign(url.toString());
}

const mount = document.getElementById('app');
if (!mount) {
  throw new Error('Root #app element missing');
}

const activeMode = resolveInitialMode();

if (activeMode === 'v1') {
  const v1App = new AppController(mount);
  v1App.init();

  // Read-only V1 telemetry shim without modifying legacy AppController.ts
  window.__STARLINE_INSPECT__ = () => ({
    mode: 'v1',
    schemaVersion: 1,
    screen: document.querySelector('.title-screen-backdrop') ? 'title' : 'base',
    phase: null,
    phaserScene: null,
    bgmTrack: soundEngine.getCurrentTrack(),
    campaignAct: 'prologue',
    unlockedSectors: ['near_orbit'],
    endingsUnlocked: [],
    credits: 0,
    salvageParts: 0,
    activeRun: null,
    failedAssets: [],
    modalOpen: hasOpenModal(),
  });

  // Lightweight non-intrusive return pill so players who roll back to V1 can jump back to V2 anytime
  const returnBtn = document.createElement('button');
  returnBtn.type = 'button';
  returnBtn.id = 'btn-return-to-v2';
  returnBtn.className = 'btn btn-sm btn-primary v1-return-v2-pill';
  returnBtn.textContent = '✦ 返回 V2 远航经营';
  returnBtn.addEventListener('click', () => navigateToMode('v2'));
  document.body.appendChild(returnBtn);
} else {
  const v2App = new V2AppController(mount, {
    onSwitchToV1: () => navigateToMode('v1'),
  });
  v2App.init();
}

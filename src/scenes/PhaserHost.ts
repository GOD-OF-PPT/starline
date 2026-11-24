import Phaser from 'phaser';
import type { BuildingId } from '../data/buildings';
import type { GameSettings } from '../domain/progression';
import {
  BaseScene,
  type BaseSceneState,
  type ReturnDockingPlayback,
  type V2BaseDioramaState,
} from './BaseScene';
import { CombatScene, type CombatScenePlayback } from './CombatScene';
import { V2CombatScene, type V2StagePlayback } from '../v2/scenes/V2CombatScene';

export type ActiveSceneMode = 'base' | 'combat' | 'v2_stage';

/**
 * Single authoritative lifecycle & viewport bridge between responsive DOM container
 * and Phaser scenes (F07 fix + V2 multi-unit combat & event backdrop support).
 */
export class PhaserHost {
  private readonly container: HTMLElement;
  private game: Phaser.Game;
  private baseScene: BaseScene;
  private combatScene: CombatScene;
  private v2CombatScene: V2CombatScene;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle: number | null = null;

  private currentMode: ActiveSceneMode | null = null;
  private activeV2StageKey: string | null = null;
  private pendingBase: BaseSceneState | null = null;
  private pendingV2Base: V2BaseDioramaState | null = null;
  private pendingCombat: CombatScenePlayback | null = null;
  private pendingV2Stage: V2StagePlayback | null = null;
  private buildingClickHandler: ((id: BuildingId) => void) | null = null;
  private berthClickHandler: (() => void) | null = null;
  private assetErrorHandler: ((failedKeys: string[]) => void) | null = null;
  private failedAssetKeys = new Set<string>();
  private ready = false;
  private lastW = 0;
  private lastH = 0;
  private lastBackingW = 0;
  private lastBackingH = 0;
  private lowQuality = false;
  private currentDpr = 1;

  private handleSceneAssetError = (key: string): void => {
    this.failedAssetKeys.add(key);
    this.assetErrorHandler?.([...this.failedAssetKeys]);
  };

  constructor(container: HTMLElement) {
    this.container = container;
    this.baseScene = new BaseScene();
    this.combatScene = new CombatScene();
    this.v2CombatScene = new V2CombatScene();

    const initRect = container.getBoundingClientRect();
    const initW = Math.max(200, Math.round(initRect.width) || 390);
    const initH = Math.max(120, Math.round(initRect.height) || 240);
    this.currentDpr = this.computeDpr();
    this.lastW = initW;
    this.lastH = initH;
    this.lastBackingW = Math.round(initW * this.currentDpr);
    this.lastBackingH = Math.round(initH * this.currentDpr);

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: this.lastBackingW,
      height: this.lastBackingH,
      backgroundColor: '#0B1320',
      render: {
        antialias: true,
        antialiasGL: true,
        pixelArt: false,
        roundPixels: false,
        mipmapFilter: 'LINEAR_MIPMAP_LINEAR',
      },
      scale: {
        mode: Phaser.Scale.NONE,
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      scene: [this.baseScene, this.combatScene, this.v2CombatScene],
    });
    this.game.registry.set('dpr', this.currentDpr);

    this.game.events.once(Phaser.Core.Events.READY, () => {
      this.ready = true;
      this.game.registry.set('dpr', this.currentDpr);
      this.syncSizeNow();
      const targetMode = this.currentMode;
      this.currentMode = null;
      if (targetMode === 'base' && this.pendingV2Base) {
        this.game.scene.start('BaseScene', {
          v2State: this.pendingV2Base,
          onBuildingClick: this.buildingClickHandler ?? undefined,
          onBerthClick: this.berthClickHandler ?? undefined,
          onAssetError: this.handleSceneAssetError,
        });
        this.currentMode = 'base';
      } else if (targetMode === 'base' && this.pendingBase) {
        this.game.scene.start('BaseScene', {
          state: this.pendingBase,
          onBuildingClick: this.buildingClickHandler ?? undefined,
          onBerthClick: this.berthClickHandler ?? undefined,
          onAssetError: this.handleSceneAssetError,
        });
        this.currentMode = 'base';
      } else if (targetMode === 'combat' && this.pendingCombat) {
        this.game.scene.stop('BaseScene');
        this.game.scene.start('CombatScene', {
          playback: this.pendingCombat,
          onAssetError: this.handleSceneAssetError,
        });
        this.currentMode = 'combat';
      } else if (targetMode === 'v2_stage' && this.pendingV2Stage) {
        this.game.scene.stop('BaseScene');
        this.v2CombatScene.setPlayback(this.pendingV2Stage);
        this.game.scene.start('V2CombatScene', {
          getLatestPlayback: () => this.pendingV2Stage,
          onAssetError: this.handleSceneAssetError,
        });
        this.currentMode = 'v2_stage';
      } else {
        this.game.scene.stop('BaseScene');
      }
      this.scheduleResize();
    });

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        this.scheduleResize();
      });
      this.resizeObserver.observe(container);
    }

    window.addEventListener('resize', this.handleWindowResize);
    window.addEventListener('orientationchange', this.handleWindowResize);
  }

  private computeDpr(): number {
    if (this.lowQuality || typeof window === 'undefined') return 1;
    const raw = window.devicePixelRatio || 1;
    return Math.min(2, Math.max(1, Math.round(raw * 2) / 2));
  }

  private handleWindowResize = (): void => {
    this.scheduleResize();
  };

  private enforceCanvasCss(): void {
    const canvas = this.game?.canvas;
    if (!canvas) return;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
  }

  private scheduleResize(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
    }
    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = null;
      this.syncSizeNow();
    });
  }

  private syncSizeNow(): void {
    if (!this.ready || !this.game?.scale) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 16 || h < 16) return;

    const dpr = this.computeDpr();
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    this.currentDpr = dpr;
    this.game.registry.set('dpr', dpr);

    const canvas = this.game.canvas;
    const renderer = this.game.renderer;
    const scaleMismatch = this.game.scale.width !== bw || this.game.scale.height !== bh;
    const canvasMismatch = Boolean(canvas && (canvas.width !== bw || canvas.height !== bh));
    const rendererMismatch = Boolean(
      renderer && (renderer.width !== bw || renderer.height !== bh)
    );

    if (
      bw !== this.lastBackingW ||
      bh !== this.lastBackingH ||
      w !== this.lastW ||
      h !== this.lastH ||
      scaleMismatch ||
      canvasMismatch ||
      rendererMismatch
    ) {
      this.lastW = w;
      this.lastH = h;
      this.lastBackingW = bw;
      this.lastBackingH = bh;
      this.game.scale.resize(bw, bh);
      if (renderer && (renderer.width !== bw || renderer.height !== bh)) {
        renderer.resize(bw, bh);
      }
    }

    // Re-enforce 100% CSS fill AFTER ScaleManager.resize so style.width/height never locks to stale px
    this.enforceCanvasCss();

    if (this.game.scene.isActive('BaseScene')) {
      this.baseScene.syncViewport(w, h, dpr);
    }
    if (this.game.scene.isActive('CombatScene')) {
      this.combatScene.syncViewport(w, h, dpr);
    }
    if (this.game.scene.isActive('V2CombatScene')) {
      this.v2CombatScene.syncViewport(w, h, dpr);
    }
  }

  getActiveSceneKey(): 'BaseScene' | 'CombatScene' | 'V2CombatScene' | null {
    if (!this.ready || !this.game?.scene) return null;
    if (this.game.scene.isActive('V2CombatScene')) return 'V2CombatScene';
    if (this.game.scene.isActive('CombatScene')) return 'CombatScene';
    if (this.game.scene.isActive('BaseScene')) return 'BaseScene';
    return null;
  }

  isV2StageMode(): boolean {
    if (this.currentMode !== 'v2_stage') return false;
    if (!this.ready) return true;
    return this.isSceneLiveOrStarting(this.v2CombatScene, 'V2CombatScene');
  }

  onBuildingClick(handler: (id: BuildingId) => void): void {
    this.buildingClickHandler = handler;
    this.baseScene.setClickHandler(handler);
  }

  onBerthClick(handler: () => void): void {
    this.berthClickHandler = handler;
    this.baseScene.setBerthClickHandler(handler);
  }

  onAssetLoadError(handler: (failedKeys: string[]) => void): void {
    this.assetErrorHandler = handler;
  }

  retryFailedAssets(): void {
    this.failedAssetKeys.clear();
    if (!this.ready) return;
    if (this.currentMode === 'base' && this.pendingV2Base) {
      this.game.scene.start('BaseScene', {
        v2State: this.pendingV2Base,
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    } else if (this.currentMode === 'base' && this.pendingBase) {
      this.game.scene.start('BaseScene', {
        state: this.pendingBase,
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    } else if (this.currentMode === 'combat' && this.pendingCombat) {
      this.game.scene.start('CombatScene', {
        playback: this.pendingCombat,
        onAssetError: this.handleSceneAssetError,
      });
    } else if (this.currentMode === 'v2_stage' && this.pendingV2Stage) {
      this.game.scene.start('V2CombatScene', {
        getLatestPlayback: () => this.pendingV2Stage,
        onAssetError: this.handleSceneAssetError,
      });
    }
    this.scheduleResize();
  }

  /** Legacy V1 base stage — preserved 100% intact for ?mode=v1 */
  showBase(state: BaseSceneState): void {
    this.activeV2StageKey = null;
    this.pendingBase = state;
    this.pendingV2Base = null;
    const switching = this.currentMode !== 'base';
    this.currentMode = 'base';
    if (!this.ready) return;

    this.baseScene.setState(state);

    if (switching || !this.isSceneLiveOrStarting(this.baseScene, 'BaseScene')) {
      if (this.isSceneLiveOrStarting(this.combatScene, 'CombatScene')) this.game.scene.stop('CombatScene');
      if (this.isSceneLiveOrStarting(this.v2CombatScene, 'V2CombatScene')) this.game.scene.stop('V2CombatScene');
      this.game.scene.start('BaseScene', {
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    }
    this.scheduleResize();
  }

  /** Native V2/V3 Orbital Station Diorama stage (Contract #4) */
  showV2Base(state: V2BaseDioramaState): void {
    this.activeV2StageKey = null;
    this.pendingV2Base = state;
    this.pendingBase = null;
    const switching = this.currentMode !== 'base';
    this.currentMode = 'base';
    if (!this.ready) return;

    this.baseScene.setV2StationState(state);

    if (switching || !this.isSceneLiveOrStarting(this.baseScene, 'BaseScene')) {
      if (this.isSceneLiveOrStarting(this.combatScene, 'CombatScene')) this.game.scene.stop('CombatScene');
      if (this.isSceneLiveOrStarting(this.v2CombatScene, 'V2CombatScene')) this.game.scene.stop('V2CombatScene');
      this.game.scene.start('BaseScene', {
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    }
    this.scheduleResize();
  }

  showCombat(playback: CombatScenePlayback): void {
    this.activeV2StageKey = null;
    this.pendingCombat = playback;
    const switching = this.currentMode !== 'combat';
    this.currentMode = 'combat';
    if (!this.ready) return;

    this.combatScene.setPlayback(playback);

    if (switching || !this.isSceneLiveOrStarting(this.combatScene, 'CombatScene')) {
      if (this.isSceneLiveOrStarting(this.baseScene, 'BaseScene')) this.game.scene.stop('BaseScene');
      if (this.isSceneLiveOrStarting(this.v2CombatScene, 'V2CombatScene')) this.game.scene.stop('V2CombatScene');
      this.game.scene.start('CombatScene', { onAssetError: this.handleSceneAssetError });
    }
    this.scheduleResize();
  }

  private isSceneLiveOrStarting(scene: Phaser.Scene, key: string): boolean {
    if (this.game.scene.isActive(key)) return true;
    const status = scene.sys?.settings?.status;
    return (
      status === Phaser.Scenes.INIT ||
      status === Phaser.Scenes.START ||
      status === Phaser.Scenes.LOADING ||
      status === Phaser.Scenes.CREATING ||
      status === Phaser.Scenes.RUNNING
    );
  }

  showV2Stage(playback: V2StagePlayback): void {
    const nextStaticKey = !playback.simulation ? (playback.playbackKey ?? null) : null;
    if (
      this.isV2StageMode() &&
      nextStaticKey !== null &&
      nextStaticKey === this.activeV2StageKey
    ) {
      this.pendingV2Stage = {
        ...(this.pendingV2Stage ?? playback),
        shipVisualSpec: playback.shipVisualSpec ?? null,
        settings: playback.settings,
        playbackKey: nextStaticKey,
      };
      this.updateV2ShipVisualSpec(playback.shipVisualSpec ?? null);
      this.updateCombatSettings(playback.settings);
      return;
    }

    this.activeV2StageKey = nextStaticKey;
    this.pendingV2Stage = playback;
    const switching = this.currentMode !== 'v2_stage';
    this.currentMode = 'v2_stage';
    if (!this.ready) return;

    const needStart =
      switching || !this.isSceneLiveOrStarting(this.v2CombatScene, 'V2CombatScene');
    if (needStart) {
      if (this.isSceneLiveOrStarting(this.baseScene, 'BaseScene')) {
        this.game.scene.stop('BaseScene');
      }
      if (this.isSceneLiveOrStarting(this.combatScene, 'CombatScene')) {
        this.game.scene.stop('CombatScene');
      }
      // Seed playback before start so mid-boot spec/settings patches apply even before init(),
      // without triggering a redundant applyPlayback() if the scene was externally active.
      if (!this.v2CombatScene.scene?.isActive()) {
        this.v2CombatScene.setPlayback(playback);
      }
      this.game.scene.start('V2CombatScene', {
        getLatestPlayback: () => this.pendingV2Stage,
        onAssetError: this.handleSceneAssetError,
      });
    } else {
      this.v2CombatScene.setPlayback(playback);
    }
    this.scheduleResize();
  }

  updateCombatSettings(settings: GameSettings): void {
    if (this.pendingV2Stage) {
      this.pendingV2Stage = { ...this.pendingV2Stage, settings };
    }
    if (this.lowQuality !== settings.lowQuality) {
      this.lowQuality = settings.lowQuality;
      this.scheduleResize();
    }
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.updateSettings(settings);
    }
    if (this.currentMode === 'v2_stage') {
      this.v2CombatScene.updateSettings(settings);
    }
  }

  setCombatPaused(paused: boolean): void {
    this.combatScene.setPaused(paused);
    this.v2CombatScene.setPaused(paused);
  }

  skipCombatPlayback(): void {
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.skipPlayback();
    }
    if (this.ready && this.game.scene.isActive('V2CombatScene')) {
      this.v2CombatScene.skipPlayback();
    }
  }

  updateV2ShipVisualSpec(spec: import('../v2/domain/shipVisualSpec').V2ShipVisualSpec | null): void {
    if (this.pendingV2Stage) {
      this.pendingV2Stage = { ...this.pendingV2Stage, shipVisualSpec: spec };
    }
    if (this.currentMode === 'v2_stage') {
      this.v2CombatScene.updateShipVisualSpec(spec);
    }
  }

  triggerV2WreckCutFx(normX: number, normY: number): void {
    if (this.ready && this.game.scene.isActive('V2CombatScene')) {
      this.v2CombatScene.triggerWreckCutFx(normX, normY);
    }
  }

  playBaseReturnDocking(playback: ReturnDockingPlayback): void {
    this.baseScene.startReturnDocking(playback);
  }

  skipBaseReturnDocking(): void {
    this.baseScene.skipReturnDocking();
  }

  resize(): void {
    this.syncSizeNow();
    this.scheduleResize();
  }

  destroy(): void {
    this.activeV2StageKey = null;
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.handleWindowResize);
    window.removeEventListener('orientationchange', this.handleWindowResize);
    this.game.destroy(true);
  }
}

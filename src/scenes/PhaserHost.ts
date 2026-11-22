import Phaser from 'phaser';
import type { BuildingId } from '../data/buildings';
import type { GameSettings } from '../domain/progression';
import { BaseScene, type BaseSceneState, type ReturnDockingPlayback } from './BaseScene';
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
  private pendingBase: BaseSceneState | null = null;
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
      this.enforceCanvasCss();
      const targetMode = this.currentMode;
      this.currentMode = null;
      if (targetMode === 'base' && this.pendingBase) {
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
        this.game.scene.start('V2CombatScene', {
          playback: this.pendingV2Stage,
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
    if (!this.game?.scale) return;
    const rect = this.container.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    if (w < 16 || h < 16) return;

    this.enforceCanvasCss();
    const dpr = this.computeDpr();
    const bw = Math.round(w * dpr);
    const bh = Math.round(h * dpr);
    this.currentDpr = dpr;
    this.game.registry.set('dpr', dpr);

    if (bw !== this.lastBackingW || bh !== this.lastBackingH || w !== this.lastW || h !== this.lastH) {
      this.lastW = w;
      this.lastH = h;
      this.lastBackingW = bw;
      this.lastBackingH = bh;
      this.game.scale.resize(bw, bh);
    }

    if (this.ready) {
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
    if (this.currentMode === 'base' && this.pendingBase) {
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
        playback: this.pendingV2Stage,
        onAssetError: this.handleSceneAssetError,
      });
    }
    this.scheduleResize();
  }

  showBase(state: BaseSceneState): void {
    this.pendingBase = state;
    const switching = this.currentMode !== 'base';
    this.currentMode = 'base';
    if (!this.ready) return;

    if (switching) {
      if (this.game.scene.isActive('CombatScene')) this.game.scene.stop('CombatScene');
      if (this.game.scene.isActive('V2CombatScene')) this.game.scene.stop('V2CombatScene');
      this.game.scene.start('BaseScene', {
        state,
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    } else if (this.game.scene.isActive('BaseScene')) {
      this.baseScene.setState(state);
    } else {
      this.game.scene.start('BaseScene', {
        state,
        onBuildingClick: this.buildingClickHandler ?? undefined,
        onBerthClick: this.berthClickHandler ?? undefined,
        onAssetError: this.handleSceneAssetError,
      });
    }
    this.scheduleResize();
  }

  showCombat(playback: CombatScenePlayback): void {
    this.pendingCombat = playback;
    const switching = this.currentMode !== 'combat';
    this.currentMode = 'combat';
    if (!this.ready) return;

    if (switching) {
      if (this.game.scene.isActive('BaseScene')) this.game.scene.stop('BaseScene');
      if (this.game.scene.isActive('V2CombatScene')) this.game.scene.stop('V2CombatScene');
      this.game.scene.start('CombatScene', { playback, onAssetError: this.handleSceneAssetError });
    } else if (this.game.scene.isActive('CombatScene')) {
      this.combatScene.setPlayback(playback);
    } else {
      this.game.scene.start('CombatScene', { playback, onAssetError: this.handleSceneAssetError });
    }
    this.scheduleResize();
  }

  showV2Stage(playback: V2StagePlayback): void {
    this.pendingV2Stage = playback;
    const switching = this.currentMode !== 'v2_stage';
    this.currentMode = 'v2_stage';
    if (!this.ready) return;

    if (switching) {
      if (this.game.scene.isActive('BaseScene')) this.game.scene.stop('BaseScene');
      if (this.game.scene.isActive('CombatScene')) this.game.scene.stop('CombatScene');
      this.game.scene.start('V2CombatScene', { playback, onAssetError: this.handleSceneAssetError });
    } else if (this.game.scene.isActive('V2CombatScene')) {
      this.v2CombatScene.setPlayback(playback);
    } else {
      this.game.scene.start('V2CombatScene', { playback, onAssetError: this.handleSceneAssetError });
    }
    this.scheduleResize();
  }

  updateCombatSettings(settings: GameSettings): void {
    if (this.lowQuality !== settings.lowQuality) {
      this.lowQuality = settings.lowQuality;
      this.scheduleResize();
    }
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.updateSettings(settings);
    }
    if (this.ready && this.game.scene.isActive('V2CombatScene')) {
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
    if (this.ready && this.game.scene.isActive('V2CombatScene')) {
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

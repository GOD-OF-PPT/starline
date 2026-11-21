import Phaser from 'phaser';
import type { BuildingId } from '../data/buildings';
import type { GameSettings } from '../domain/progression';
import { BaseScene, type BaseSceneState, type ReturnDockingPlayback } from './BaseScene';
import { CombatScene, type CombatScenePlayback } from './CombatScene';

export type ActiveSceneMode = 'base' | 'combat';

/**
 * Single authoritative lifecycle & viewport bridge between responsive DOM container
 * and Phaser scenes (F07 fix).
 * Uses Phaser.Scale.NONE + ResizeObserver so the canvas NEVER lags behind container
 * reflows or crops on orientation/viewport transitions.
 */
export class PhaserHost {
  private readonly container: HTMLElement;
  private game: Phaser.Game;
  private baseScene: BaseScene;
  private combatScene: CombatScene;
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle: number | null = null;

  private currentMode: ActiveSceneMode | null = null;
  private pendingBase: BaseSceneState | null = null;
  private pendingCombat: CombatScenePlayback | null = null;
  private buildingClickHandler: ((id: BuildingId) => void) | null = null;
  private ready = false;
  private lastW = 0;
  private lastH = 0;

  constructor(container: HTMLElement) {
    this.container = container;
    this.baseScene = new BaseScene();
    this.combatScene = new CombatScene();

    const initRect = container.getBoundingClientRect();
    const initW = Math.max(200, Math.round(initRect.width) || 390);
    const initH = Math.max(120, Math.round(initRect.height) || 240);
    this.lastW = initW;
    this.lastH = initH;

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: initW,
      height: initH,
      backgroundColor: '#111A29',
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
      scene: [this.baseScene, this.combatScene],
    });

    this.game.events.once(Phaser.Core.Events.READY, () => {
      this.ready = true;
      this.enforceCanvasCss();
      const targetMode = this.currentMode;
      this.currentMode = null;
      if (targetMode === 'base' && this.pendingBase) {
        this.game.scene.start('BaseScene', {
          state: this.pendingBase,
          onBuildingClick: this.buildingClickHandler ?? undefined,
        });
        this.currentMode = 'base';
      } else if (targetMode === 'combat' && this.pendingCombat) {
        this.game.scene.stop('BaseScene');
        this.game.scene.start('CombatScene', { playback: this.pendingCombat });
        this.currentMode = 'combat';
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

    if (w !== this.lastW || h !== this.lastH) {
      this.lastW = w;
      this.lastH = h;
      this.game.scale.resize(w, h);
    }

    if (this.ready) {
      if (this.game.scene.isActive('BaseScene')) {
        this.baseScene.syncViewport(w, h);
      }
      if (this.game.scene.isActive('CombatScene')) {
        this.combatScene.syncViewport(w, h);
      }
    }
  }

  onBuildingClick(handler: (id: BuildingId) => void): void {
    this.buildingClickHandler = handler;
    this.baseScene.setClickHandler(handler);
  }

  showBase(state: BaseSceneState): void {
    this.pendingBase = state;
    const switching = this.currentMode !== 'base';
    this.currentMode = 'base';
    if (!this.ready) return;

    if (switching) {
      if (this.game.scene.isActive('CombatScene')) {
        this.game.scene.stop('CombatScene');
      }
      this.game.scene.start('BaseScene', {
        state,
        onBuildingClick: this.buildingClickHandler ?? undefined,
      });
    } else if (this.game.scene.isActive('BaseScene')) {
      this.baseScene.setState(state);
    } else {
      this.game.scene.start('BaseScene', {
        state,
        onBuildingClick: this.buildingClickHandler ?? undefined,
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
      if (this.game.scene.isActive('BaseScene')) {
        this.game.scene.stop('BaseScene');
      }
      this.game.scene.start('CombatScene', { playback });
    } else if (this.game.scene.isActive('CombatScene')) {
      this.combatScene.setPlayback(playback);
    } else {
      this.game.scene.start('CombatScene', { playback });
    }
    this.scheduleResize();
  }

  updateCombatSettings(settings: GameSettings): void {
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.updateSettings(settings);
    }
  }

  setCombatPaused(paused: boolean): void {
    this.combatScene.setPaused(paused);
  }

  skipCombatPlayback(): void {
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.skipPlayback();
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

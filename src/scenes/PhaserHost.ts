import Phaser from 'phaser';
import type { BuildingId } from '../data/buildings';
import type { GameSettings } from '../domain/progression';
import { BaseScene, type BaseSceneState } from './BaseScene';
import { CombatScene, type CombatScenePlayback } from './CombatScene';

export type ActiveSceneMode = 'base' | 'combat';

export class PhaserHost {
  private game: Phaser.Game;
  private baseScene: BaseScene;
  private combatScene: CombatScene;
  private currentMode: ActiveSceneMode | null = null;
  private pendingBase: BaseSceneState | null = null;
  private pendingCombat: CombatScenePlayback | null = null;
  private buildingClickHandler: ((id: BuildingId) => void) | null = null;
  private ready = false;

  constructor(container: HTMLElement) {
    this.baseScene = new BaseScene();
    this.combatScene = new CombatScene();

    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: container,
      width: container.clientWidth || 390,
      height: container.clientHeight || 240,
      backgroundColor: '#111A29',
      antialias: true,
      pixelArt: false,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.NO_CENTER,
      },
      scene: [this.baseScene, this.combatScene],
    });

    this.game.events.once(Phaser.Core.Events.READY, () => {
      this.ready = true;
      this.game.scene.stop('BaseScene');
      this.game.scene.stop('CombatScene');
      if (this.currentMode === 'base' && this.pendingBase) {
        this.showBase(this.pendingBase);
      } else if (this.currentMode === 'combat' && this.pendingCombat) {
        this.showCombat(this.pendingCombat);
      }
    });
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
  }

  updateCombatSettings(settings: GameSettings): void {
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.updateSettings(settings);
    }
  }

  skipCombatPlayback(): void {
    if (this.ready && this.game.scene.isActive('CombatScene')) {
      this.combatScene.skipPlayback();
    }
  }

  resize(): void {
    if (!this.game?.scale) return;
    const parent = this.game.canvas?.parentElement;
    if (!parent) return;
    const w = Math.max(200, parent.clientWidth);
    const h = Math.max(120, parent.clientHeight);
    this.game.scale.resize(w, h);
  }

  destroy(): void {
    this.game.destroy(true);
  }
}

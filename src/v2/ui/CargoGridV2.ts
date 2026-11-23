import { getItemImageUrl } from '../../assets/itemArt';
import { soundEngine } from '../../audio/soundEngine';
import { hasOpenModal } from '../../ui/Modals';
import { V2_EQUIPMENT_DEFS, V2_MAX_BATTLE_SHIELD, V2_MAX_POST_WIN_REPAIR } from '../data/equipment';
import {
  V2_SHAPES,
  getV2OccupiedCells,
  getV2ShapeBounds,
  type V2GridCoord,
  type V2Rotation,
  type V2ShapeId,
} from '../data/shapes';
import { V2_SHIPS, isCellDisabledForShip } from '../data/ships';
import { calculateV2BuildStats, type V2AdjacencyLink } from '../domain/buildStatsV2';
import {
  discardV2Item,
  findFirstLegalV2Placement,
  findV2ItemAtCell,
  getV2BayOccupancy,
  getV2PlacedCells,
  moveV2PlacedItem,
  moveV2PlacedToStaging,
  placeV2FromStaging,
  rotateV2PlacedItem,
  rotateV2StagingItem,
  undoV2LastDiscard,
  validateV2Placement,
} from '../domain/inventoryV2';
import { getAnyV2ItemDef } from '../domain/itemCatalog';
import type { V2TacticalDelta } from '../domain/tacticalDelta';
import type {
  V2CargoBayState,
  V2ItemInstance,
  V2ItemOrigin,
  V2PlacedItem,
} from '../domain/types';

export interface CargoGridV2Callbacks {
  readonly onBayChange: (nextBay: V2CargoBayState) => void;
  /** Optional prepare-mode remove callback when user removes a slot back to the pool */
  readonly onPrepareRemoveItem?: (instanceId: string) => void;
  /** Optional authoritative tactical delta provider for the currently selected item */
  readonly getTacticalDelta?: (
    item: V2ItemInstance,
    zone: 'grid' | 'staging'
  ) => V2TacticalDelta | null;
  /** Optional external container for mounting the selected-item inspector (e.g. desktop left panel in ARRANGE) */
  readonly getInspectorHost?: () => HTMLElement | null;
}

interface SelectedRef {
  readonly zone: 'grid' | 'staging';
  readonly instanceId: string;
}

interface DragState {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly zone: 'grid' | 'staging';
  readonly item: V2ItemInstance;
  readonly rotation: V2Rotation;
  readonly originX?: number;
  readonly originY?: number;
  readonly startClientX: number;
  readonly startClientY: number;
  readonly grabOffsetCellX: number;
  readonly grabOffsetCellY: number;
  active: boolean;
  hoverOriginX: number | null;
  hoverOriginY: number | null;
  ghostEl: HTMLElement | null;
}

export function originTagText(origin: V2ItemOrigin): string {
  switch (origin) {
    case 'loan':
      return '借';
    case 'owned':
      return '自';
    case 'loot':
      return '拾';
    case 'mission':
      return '任';
  }
}

export function originFullLabel(origin: V2ItemOrigin): string {
  switch (origin) {
    case 'loan':
      return '借用 · 返航归还';
    case 'owned':
      return '自有 · 战败将损失';
    case 'loot':
      return '拾获 · 可出售/入库';
    case 'mission':
      return '任务物 · 仅限交付';
  }
}

function reasonToZh(reason?: 'out_of_bounds' | 'disabled_cell' | 'overlap'): string {
  switch (reason) {
    case 'out_of_bounds':
      return '越界：超出当前舰船舱格';
    case 'disabled_cell':
      return '不可用舱格：结构舱壁阻挡';
    case 'overlap':
      return '重叠：目标格已被占用';
    default:
      return '无法放置于此位置';
  }
}

export function renderV2MiniMaskHtml(shapeId: V2ShapeId, rotation: V2Rotation = 0): string {
  const cells = getV2OccupiedCells(shapeId, 0, 0, rotation);
  const bounds = getV2ShapeBounds(shapeId, rotation);
  const occupied = new Set(cells.map((c) => `${c.x},${c.y}`));
  const squares: string[] = [];
  for (let y = 0; y < bounds.height; y++) {
    for (let x = 0; x < bounds.width; x++) {
      squares.push(`<span class="mini-mask-cell ${occupied.has(`${x},${y}`) ? 'on' : ''}"></span>`);
    }
  }
  return `<span class="mini-mask" style="grid-template-columns:repeat(${bounds.width},8px);" aria-hidden="true">${squares.join(
    ''
  )}</span>`;
}

function computeSynergyColor(sourceKind: V2AdjacencyLink['sourceKind']): string {
  switch (sourceKind) {
    case 'battery':
      return '#62D6DF';
    case 'capacitor':
      return '#F6B852';
    case 'relay':
      return '#7AE582';
    case 'shield':
      return '#C084FC';
    default:
      return '#62D6DF';
  }
}

/**
 * Interactive Variable-Hull V2 Cargo Bay (4x4 Skiff/Cruiser & 5x4 Freighter with disabled bulkheads):
 * - Drag-and-drop (pointer + touch lift + ghost silhouette)
 * - Tap-to-select / tap-to-place / rotate / discard / undo
 * - Full WAI-ARIA keyboard roving tabindex (Arrows, Enter/Space, R, Delete, Escape),
 *   strictly isolated whenever any modal dialog is open!
 * - Explicit four-way origin markers (借/自/拾/任) + quality notches (non-color-only).
 */
export class CargoGridV2Component {
  private readonly root: HTMLElement;
  private readonly callbacks: CargoGridV2Callbacks;

  private bay: V2CargoBayState | null = null;
  private editable = false;
  private prepareMode = false;
  private selected: SelectedRef | null = null;
  private carrying = false;
  private focusedCell: V2GridCoord = { x: 0, y: 0 };
  private gridHasFocus = false;
  private drag: DragState | null = null;
  private lastSnappedId: string | null = null;
  private invalidToastText: string | null = null;
  private invalidToastTimer: number | null = null;
  private prevLinkCount = 0;
  private boardEl: HTMLElement | null = null;
  private lastExternalInspectorHost: HTMLElement | null = null;

  constructor(root: HTMLElement, callbacks: CargoGridV2Callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerCancel);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  destroy(): void {
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerCancel);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.clearDragGhost();
    if (this.lastExternalInspectorHost) {
      this.lastExternalInspectorHost.innerHTML = '';
      this.lastExternalInspectorHost = null;
    }
    if (this.invalidToastTimer !== null) {
      window.clearTimeout(this.invalidToastTimer);
      this.invalidToastTimer = null;
    }
  }

  render(
    bay: V2CargoBayState,
    editable: boolean,
    options?: { readonly prepareMode?: boolean; readonly restoreCellFocus?: boolean }
  ): void {
    const wasCellFocused =
      Boolean(options?.restoreCellFocus) ||
      (this.boardEl !== null && this.boardEl.contains(document.activeElement));

    this.bay = bay;
    this.editable = editable;
    this.prepareMode = Boolean(options?.prepareMode);

    const ship = V2_SHIPS[bay.shipId];
    // Keep focused cell within current ship bounds
    this.focusedCell = {
      x: Math.max(0, Math.min(ship.cols - 1, this.focusedCell.x)),
      y: Math.max(0, Math.min(ship.rows - 1, this.focusedCell.y)),
    };

    if (!editable) {
      this.carrying = false;
    }

    // Validate selection still exists
    if (this.selected) {
      const exists =
        this.selected.zone === 'grid'
          ? bay.placed.some((p) => p.item.instanceId === this.selected?.instanceId)
          : bay.staging.some((s) => s.item.instanceId === this.selected?.instanceId);
      if (!exists) {
        this.selected = null;
        this.carrying = false;
      }
    }

    // Auto-select first staging item when editable for 1-tap placement convenience
    if (editable && !this.selected && bay.staging.length > 0) {
      this.selected = { zone: 'staging', instanceId: bay.staging[0].item.instanceId };
    }

    const stats = calculateV2BuildStats(bay);
    const occ = getV2BayOccupancy(bay);
    if (stats.links.length > this.prevLinkCount && this.prevLinkCount >= 0 && this.lastSnappedId) {
      soundEngine.play('energyLink');
    }
    this.prevLinkCount = stats.links.length;

    this.root.innerHTML = '';

    // 1. Live V2 Build Stats Strip
    const heavySummary =
      stats.heavies.length > 0
        ? `重炮 ${stats.heavies.reduce((s, h) => s + h.baseDamage + h.firstShotBonus, 0)}爆发`
        : '';
    const hangarSummary =
      stats.hangars.length > 0
        ? `无人机 ${stats.hangars.reduce((s, h) => s + h.maxDrones, 0)}上限`
        : '';
    const flakSummary =
      stats.flaks.length > 0
        ? `近防 ${stats.flaks.reduce((s, f) => s + f.damagePerEnemy, 0)}×2`
        : '';
    const attackSubParts = [heavySummary, hangarSummary, flakSummary].filter(Boolean);
    const regularDps =
      stats.coreAttack + stats.lasers.reduce((sum, l) => sum + l.totalDamage, 0);

    const statsStrip = document.createElement('div');
    statsStrip.className = 'stats-strip v2-stats-strip';
    statsStrip.innerHTML = `
      <div class="stat-chip">
        <span class="k">常规/构筑火力</span>
        <span class="v num">${regularDps}</span>
        <span class="sub">${attackSubParts.length > 0 ? attackSubParts.join(' · ') : `舰核 ${stats.coreAttack}`}</span>
      </div>
      <div class="stat-chip">
        <span class="k">护盾/反击</span>
        <span class="v num">${stats.effectiveShield}</span>
        <span class="sub ${stats.shieldCapped ? 'cap' : ''}">${
      stats.bestActiveCounter
        ? `反击 ${Math.round(stats.bestActiveCounter.ratio * 100)}%`
        : stats.shieldCapped
        ? `已达上限 ${V2_MAX_BATTLE_SHIELD}`
        : `上限 ${V2_MAX_BATTLE_SHIELD}`
    }</span>
      </div>
      <div class="stat-chip">
        <span class="k">胜后维修</span>
        <span class="v num">+${stats.effectiveRepair}</span>
        <span class="sub ${stats.repairCapped ? 'cap' : ''}">${
      stats.repairCapped ? `已达上限 ${V2_MAX_POST_WIN_REPAIR}` : `上限 ${V2_MAX_POST_WIN_REPAIR}`
    }</span>
      </div>
      <div class="stat-chip">
        <span class="k">舱格/舱值</span>
        <span class="v num">${occ.occupiedCells}/${occ.totalCells}</span>
        <span class="sub">${
      stats.links.length > 0 ? `联动 ×${stats.links.length}` : `可售 ${stats.nonLoanBayValue}¤`
    }</span>
      </div>
    `;
    this.root.appendChild(statsStrip);

    // 2. Variable-Dimension Ship Hull Grid Board
    const board = document.createElement('div');
    board.className = 'cargo-board-outer v2-cargo-board';
    board.dataset.cols = String(ship.cols);
    board.dataset.rows = String(ship.rows);
    board.style.aspectRatio = `${ship.cols} / ${ship.rows}`;
    board.setAttribute('role', 'grid');
    board.setAttribute(
      'aria-label',
      `${ship.name} ${ship.cols}列${ship.rows}行船舱网格（${ship.validCellCount}格可用），方向键移动焦点，回车选取或放置，R键旋转`
    );
    this.boardEl = board;

    if (this.invalidToastText) {
      const toast = document.createElement('div');
      toast.className = 'drag-reason-toast';
      toast.setAttribute('role', 'alert');
      toast.textContent = this.invalidToastText;
      board.appendChild(toast);
    }

    // 2a. Background grid cells with disabled hull bulkheads & roving tabindex
    const cellsWrap = document.createElement('div');
    cellsWrap.className = 'cargo-grid-cells v2-grid-cells';
    cellsWrap.style.gridTemplateColumns = `repeat(${ship.cols}, 1fr)`;
    cellsWrap.style.gridTemplateRows = `repeat(${ship.rows}, 1fr)`;
    const preview = this.computeActivePreview();

    // Compute optional tactical delta & recommended optimal synergy spot once per render
    const selInfoForDelta = this.getSelectedItemInfo();
    const activeDelta =
      selInfoForDelta && this.callbacks.getTacticalDelta
        ? this.callbacks.getTacticalDelta(selInfoForDelta.item, selInfoForDelta.zone)
        : null;
    const recommendedCellSet = new Set<string>();
    if (editable && selInfoForDelta && activeDelta?.recommendedSpot) {
      const sDef = getAnyV2ItemDef(selInfoForDelta.item.definitionId);
      if (sDef) {
        const recCells = getV2OccupiedCells(
          sDef.shapeId,
          activeDelta.recommendedSpot.x,
          activeDelta.recommendedSpot.y,
          activeDelta.recommendedSpot.rotation
        );
        for (const rc of recCells) recommendedCellSet.add(`${rc.x},${rc.y}`);
      }
    }

    for (let y = 0; y < ship.rows; y++) {
      for (let x = 0; x < ship.cols; x++) {
        const cellEl = document.createElement('div');
        const disabled = isCellDisabledForShip(bay.shipId, x, y);
        const isRecommended = !disabled && !preview && recommendedCellSet.has(`${x},${y}`);
        cellEl.className = `cargo-cell${disabled ? ' v2-cell-disabled' : ''}${
          isRecommended ? ' cell-recommended' : ''
        }`;
        cellEl.dataset.cx = String(x);
        cellEl.dataset.cy = String(y);
        cellEl.setAttribute('role', 'gridcell');
        if (disabled) {
          cellEl.setAttribute('aria-disabled', 'true');
        }

        const isRoving = this.focusedCell.x === x && this.focusedCell.y === y;
        cellEl.tabIndex = isRoving ? 0 : -1;
        if (isRoving && this.gridHasFocus) {
          cellEl.classList.add('kb-focused');
        }

        const occupant = disabled ? undefined : findV2ItemAtCell(bay, x, y);
        const occName = disabled
          ? '不可用舱壁格'
          : occupant
          ? getAnyV2ItemDef(occupant.item.definitionId)?.name ?? occupant.item.definitionId
          : '空位';
        cellEl.setAttribute('aria-label', `第${y + 1}行第${x + 1}列 ${occName}`);

        if (disabled) {
          cellEl.innerHTML = `<span class="v2-bulkhead-mark" aria-hidden="true">✕</span>`;
        }

        cellEl.addEventListener('focus', () => {
          this.focusedCell = { x, y };
          if (!this.gridHasFocus) {
            this.gridHasFocus = true;
            this.updateCellVisualFocusAndPreview();
          }
        });
        cellEl.addEventListener('blur', () => {
          queueMicrotask(() => {
            if (this.boardEl && !this.boardEl.contains(document.activeElement)) {
              this.gridHasFocus = false;
              this.boardEl
                .querySelectorAll('.kb-focused')
                .forEach((el) => el.classList.remove('kb-focused'));
            }
          });
        });

        if (preview) {
          const inCells = preview.cells.some((c) => c.x === x && c.y === y);
          const inConflicts = preview.conflictCells.some((c) => c.x === x && c.y === y);
          if (preview.valid && inCells) {
            cellEl.classList.add('preview-valid');
            cellEl.innerHTML = `<span class="cargo-cell-mark">✓</span>`;
          } else if (!preview.valid && (inConflicts || inCells)) {
            cellEl.classList.add('preview-invalid');
            if (inConflicts && !disabled) {
              cellEl.innerHTML = `<span class="cargo-cell-mark">✕</span>`;
            }
          }
        }
        cellsWrap.appendChild(cellEl);
      }
    }
    board.appendChild(cellsWrap);

    // 2b. Placed Items Visual Layer
    const itemLayer = document.createElement('div');
    itemLayer.className = 'cargo-item-layer';

    const boostedIds = new Set<string>();
    for (const lnk of stats.links) {
      boostedIds.add(lnk.sourceInstanceId);
      boostedIds.add(lnk.targetInstanceId);
    }

    for (const placed of bay.placed) {
      const def = getAnyV2ItemDef(placed.item.definitionId);
      if (!def) continue;
      const bounds = getV2ShapeBounds(def.shapeId, placed.rotation);
      const isSelected =
        this.selected?.zone === 'grid' && this.selected.instanceId === placed.item.instanceId;
      const isDraggingThis =
        this.drag?.active &&
        this.drag.zone === 'grid' &&
        this.drag.item.instanceId === placed.item.instanceId;
      const isBoosted = boostedIds.has(placed.item.instanceId);

      const tile = document.createElement('div');
      tile.className = `placed-item v2-placed-item origin-${placed.item.origin} ${
        placed.item.category === 'equipment'
          ? placed.item.quality === 'improved'
            ? 'quality-improved'
            : 'quality-common'
          : placed.item.category === 'mission'
          ? 'cat-mission'
          : 'cat-cargo'
      } ${isSelected ? 'selected' : ''} ${isDraggingThis ? 'dragging-source' : ''} ${
        this.lastSnappedId === placed.item.instanceId ? 'just-snapped' : ''
      } ${isBoosted ? 'synergy-active' : ''}`;

      tile.style.left = `${(placed.x / ship.cols) * 100}%`;
      tile.style.top = `${(placed.y / ship.rows) * 100}%`;
      tile.style.width = `${(bounds.width / ship.cols) * 100}%`;
      tile.style.height = `${(bounds.height / ship.rows) * 100}%`;

      // Draw exact sub-cell backplates so L3 / T4 transparent cutouts stay transparent!
      const localCells = getV2OccupiedCells(def.shapeId, 0, 0, placed.rotation);
      for (const lc of localCells) {
        const sub = document.createElement('div');
        sub.className = 'placed-subcell';
        sub.style.left = `${(lc.x / bounds.width) * 100}%`;
        sub.style.top = `${(lc.y / bounds.height) * 100}%`;
        sub.style.width = `${(1 / bounds.width) * 100}%`;
        sub.style.height = `${(1 / bounds.height) * 100}%`;
        tile.appendChild(sub);
      }

      // Rotated hand-painted sprite (V2Rotation is 0|1|2|3 -> *90 deg!)
      const spriteWrap = document.createElement('div');
      spriteWrap.className = 'placed-sprite-wrap';
      const baseBounds = getV2ShapeBounds(def.shapeId, 0);
      const isSwapped = placed.rotation === 1 || placed.rotation === 3;
      const img = document.createElement('img');
      img.className = 'placed-sprite-img';
      img.src = getItemImageUrl(placed.item.definitionId);
      img.alt = def.name;
      img.draggable = false;
      if (isSwapped) {
        img.style.width = `${(baseBounds.width / bounds.width) * 100}%`;
        img.style.height = `${(baseBounds.height / bounds.height) * 100}%`;
      } else {
        img.style.width = '100%';
        img.style.height = '100%';
      }
      img.style.transform = `translate(-50%, -50%) rotate(${placed.rotation * 90}deg)`;
      spriteWrap.appendChild(img);
      tile.appendChild(spriteWrap);

      // Explicit Origin Badge (借/自/拾/任) top-left — never color-only!
      const originPill = document.createElement('span');
      originPill.className = `v2-origin-badge origin-${placed.item.origin}`;
      originPill.textContent = originTagText(placed.item.origin);
      originPill.title = originFullLabel(placed.item.origin);
      tile.appendChild(originPill);

      // Quality notch badge top-right for equipment (良 / 普)
      if (placed.item.category === 'equipment') {
        const qPill = document.createElement('span');
        qPill.className = `v2-quality-notch ${
          placed.item.quality === 'improved' ? 'improved' : 'common'
        }`;
        qPill.textContent = placed.item.quality === 'improved' ? '良' : '普';
        tile.appendChild(qPill);
      }

      // Compact name / synergy badge bottom
      const labelEl = document.createElement('span');
      labelEl.className = 'placed-label';
      labelEl.textContent =
        placed.item.category === 'cargo' && placed.item.fixedValue > 0
          ? `${placed.item.fixedValue}¤`
          : placed.item.category === 'mission'
          ? '任务'
          : def.name.slice(0, 4);
      tile.appendChild(labelEl);

      itemLayer.appendChild(tile);
    }
    board.appendChild(itemLayer);

    // 2c. Uncluttered Synergy Indicator Layer:
    // - Always shows subtle glowing connector pins right on the shared orthogonal seam (zero art obstruction!)
    // - Illuminates full energy conduit beam + bonus pill ONLY when a linked item is selected, dragged, or just snapped!
    if (stats.links.length > 0) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('class', 'synergy-overlay-svg');
      svg.setAttribute('viewBox', `0 0 ${ship.cols * 100} ${ship.rows * 100}`);
      svg.setAttribute('preserveAspectRatio', 'none');

      const centerOf = (instanceId: string): { x: number; y: number } | null => {
        const p = bay.placed.find((item) => item.item.instanceId === instanceId);
        if (!p) return null;
        const cells = getV2PlacedCells(p);
        if (cells.length === 0) return null;
        const avgX = cells.reduce((acc, c) => acc + c.x + 0.5, 0) / cells.length;
        const avgY = cells.reduce((acc, c) => acc + c.y + 0.5, 0) / cells.length;
        return { x: avgX * 100, y: avgY * 100 };
      };

      const seamMidpointOf = (idA: string, idB: string): { x: number; y: number } | null => {
        const pA = bay.placed.find((item) => item.item.instanceId === idA);
        const pB = bay.placed.find((item) => item.item.instanceId === idB);
        if (!pA || !pB) return null;
        const cellsA = getV2PlacedCells(pA);
        const cellsB = getV2PlacedCells(pB);
        for (const a of cellsA) {
          for (const b of cellsB) {
            if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1) {
              return { x: ((a.x + b.x) * 0.5 + 0.5) * 100, y: ((a.y + b.y) * 0.5 + 0.5) * 100 };
            }
          }
        }
        return null;
      };

      const focusIds = new Set<string>();
      if (this.selected?.zone === 'grid') focusIds.add(this.selected.instanceId);
      if (this.drag?.active) focusIds.add(this.drag.item.instanceId);
      if (this.lastSnappedId) focusIds.add(this.lastSnappedId);

      for (const lnk of stats.links) {
        const p1 = centerOf(lnk.sourceInstanceId);
        const p2 = centerOf(lnk.targetInstanceId);
        const seam = seamMidpointOf(lnk.sourceInstanceId, lnk.targetInstanceId);
        if (!p1 || !p2) continue;
        const col = computeSynergyColor(lnk.sourceKind);
        const highlighted =
          focusIds.has(lnk.sourceInstanceId) || focusIds.has(lnk.targetInstanceId);

        if (highlighted) {
          const glow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          glow.setAttribute('x1', String(p1.x));
          glow.setAttribute('y1', String(p1.y));
          glow.setAttribute('x2', String(p2.x));
          glow.setAttribute('y2', String(p2.y));
          glow.setAttribute('stroke', col);
          glow.setAttribute('stroke-width', '10');
          glow.setAttribute('stroke-linecap', 'round');
          glow.setAttribute('opacity', '0.26');
          svg.appendChild(glow);

          const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          line.setAttribute('x1', String(p1.x));
          line.setAttribute('y1', String(p1.y));
          line.setAttribute('x2', String(p2.x));
          line.setAttribute('y2', String(p2.y));
          line.setAttribute('stroke', col);
          line.setAttribute('stroke-width', '4.5');
          line.setAttribute('stroke-linecap', 'round');
          line.setAttribute('stroke-dasharray', '10 6');
          line.setAttribute('opacity', '0.95');
          svg.appendChild(line);

          const midX = seam ? seam.x : (p1.x + p2.x) * 0.5;
          const midY = seam ? seam.y : (p1.y + p2.y) * 0.5;
          const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
          const pillW = Math.max(46, lnk.label.length * 16 + 16);
          pill.setAttribute('x', String(midX - pillW * 0.5));
          pill.setAttribute('y', String(midY - 14));
          pill.setAttribute('width', String(pillW));
          pill.setAttribute('height', '28');
          pill.setAttribute('rx', '14');
          pill.setAttribute('fill', '#0D1726');
          pill.setAttribute('stroke', col);
          pill.setAttribute('stroke-width', '2.5');
          svg.appendChild(pill);

          const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
          txt.setAttribute('x', String(midX));
          txt.setAttribute('y', String(midY + 6));
          txt.setAttribute('text-anchor', 'middle');
          txt.setAttribute('fill', col);
          txt.setAttribute('font-size', '16');
          txt.setAttribute('font-weight', '700');
          txt.textContent = lnk.label;
          svg.appendChild(txt);
        } else if (seam) {
          // Subtle connector pin right at the shared seam so module art stays 100% clean!
          const pinHalo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          pinHalo.setAttribute('cx', String(seam.x));
          pinHalo.setAttribute('cy', String(seam.y));
          pinHalo.setAttribute('r', '10');
          pinHalo.setAttribute('fill', col);
          pinHalo.setAttribute('opacity', '0.28');
          svg.appendChild(pinHalo);

          const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          pin.setAttribute('cx', String(seam.x));
          pin.setAttribute('cy', String(seam.y));
          pin.setAttribute('r', '5.5');
          pin.setAttribute('fill', col);
          pin.setAttribute('stroke', '#0D1726');
          pin.setAttribute('stroke-width', '2.2');
          svg.appendChild(pin);
        }
      }
      board.appendChild(svg);
    }

    // 2d. Board pointerdown hit-test strictly by cell coordinates (cutouts click through!)
    board.addEventListener('pointerdown', (e) => {
      if (hasOpenModal()) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      const cell = this.clientPointToCell(e.clientX, e.clientY);
      if (!cell) return;
      this.focusedCell = cell;

      if (isCellDisabledForShip(bay.shipId, cell.x, cell.y)) {
        this.showInvalidReason('disabled_cell');
        return;
      }

      const occupant = findV2ItemAtCell(bay, cell.x, cell.y);

      if (!this.editable) {
        if (occupant) {
          this.selected = { zone: 'grid', instanceId: occupant.item.instanceId };
          this.render(bay, this.editable, { prepareMode: this.prepareMode });
        }
        return;
      }

      if (occupant) {
        const isSameSelected =
          this.selected?.zone === 'grid' && this.selected.instanceId === occupant.item.instanceId;
        this.selected = { zone: 'grid', instanceId: occupant.item.instanceId };
        this.carrying = false;
        this.drag = {
          pointerId: e.pointerId,
          pointerType: e.pointerType,
          zone: 'grid',
          item: occupant.item,
          rotation: occupant.rotation,
          originX: occupant.x,
          originY: occupant.y,
          startClientX: e.clientX,
          startClientY: e.clientY,
          grabOffsetCellX: cell.x - occupant.x,
          grabOffsetCellY: cell.y - occupant.y,
          active: false,
          hoverOriginX: occupant.x,
          hoverOriginY: occupant.y,
          ghostEl: null,
        };
        if (!isSameSelected) {
          soundEngine.play('click');
        }
        this.render(bay, this.editable, { prepareMode: this.prepareMode });
        return;
      }

      // Clicked empty valid cell while an item is selected -> try placing/moving immediately!
      if (this.selected) {
        this.tryPlaceSelectedAt(cell.x, cell.y);
      }
    });

    this.root.appendChild(board);

    // 3. Staging Tray (in Run mode when staging or discard undo exists)
    if (!this.prepareMode && (bay.staging.length > 0 || bay.discardedThisArrange.length > 0)) {
      const stagingBox = document.createElement('div');
      stagingBox.className = 'staging-box v2-staging-box';
      const head = document.createElement('div');
      head.className = 'staging-head';
      head.innerHTML = `
        <span class="staging-title">暂存区 (${bay.staging.length}) ${
        bay.staging.length > 0 ? '<span class="v2-warn-pill">需清空才可离开</span>' : ''
      }</span>
        <div class="staging-head-actions">
          ${
            editable && bay.discardedThisArrange.length > 0
              ? `<button type="button" class="btn btn-sm btn-ghost" id="btn-v2-undo-discard">↩ 撤回舍弃 (${bay.discardedThisArrange.length})</button>`
              : ''
          }
        </div>
      `;
      stagingBox.appendChild(head);

      if (bay.staging.length > 0) {
        const list = document.createElement('div');
        list.className = 'staging-list';
        for (const st of bay.staging) {
          const def = getAnyV2ItemDef(st.item.definitionId);
          if (!def) continue;
          const isSelected =
            this.selected?.zone === 'staging' && this.selected.instanceId === st.item.instanceId;
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = `staging-item-card v2-staging-card origin-${st.item.origin} ${
            isSelected ? 'selected' : ''
          }`;
          chip.dataset.stagingId = st.item.instanceId;
          chip.innerHTML = `
            <span class="v2-origin-badge origin-${st.item.origin}">${originTagText(st.item.origin)}</span>
            <img class="staging-thumb" src="${getItemImageUrl(st.item.definitionId)}" alt="${def.name}" draggable="false" />
            <span class="staging-meta">
              <span class="staging-name">${def.name}${
            st.item.category === 'equipment'
              ? ` <small class="v2-q-tag">${st.item.quality === 'improved' ? '优良' : '普通'}</small>`
              : ''
          }</span>
              <span class="staging-sub">${renderV2MiniMaskHtml(def.shapeId, st.rotation)} ${
            V2_SHAPES[def.shapeId].label
          }${st.item.fixedValue > 0 ? ` · ${st.item.fixedValue}¤` : ''}</span>
            </span>
          `;

          chip.addEventListener('pointerdown', (ev) => {
            if (!this.editable || hasOpenModal()) return;
            if (ev.button !== 0 && ev.pointerType === 'mouse') return;
            this.selected = { zone: 'staging', instanceId: st.item.instanceId };
            this.carrying = false;
            this.drag = {
              pointerId: ev.pointerId,
              pointerType: ev.pointerType,
              zone: 'staging',
              item: st.item,
              rotation: st.rotation,
              startClientX: ev.clientX,
              startClientY: ev.clientY,
              grabOffsetCellX: 0,
              grabOffsetCellY: 0,
              active: false,
              hoverOriginX: null,
              hoverOriginY: null,
              ghostEl: null,
            };
          });

          chip.addEventListener('click', () => {
            this.selected = { zone: 'staging', instanceId: st.item.instanceId };
            this.carrying = false;
            soundEngine.play('click');
            this.render(bay, this.editable, { prepareMode: this.prepareMode });
          });

          list.appendChild(chip);
        }
        stagingBox.appendChild(list);
      }

      stagingBox.querySelector('#btn-v2-undo-discard')?.addEventListener('click', () => {
        if (!this.editable || !this.bay) return;
        const res = undoV2LastDiscard(this.bay);
        if (res.ok) {
          soundEngine.play('click');
          this.callbacks.onBayChange(res.bay);
        }
      });

      this.root.appendChild(stagingBox);
    }

    // 4. Compact Selected Item Action & Tactical Delta Inspector Strip
    this.renderSelectedInspector(editable, activeDelta);

    // Restore keyboard focus to the active cell when re-rendered via keyboard navigation
    if (wasCellFocused && this.gridHasFocus) {
      const targetCell = board.querySelector<HTMLElement>(
        `.cargo-cell[data-cx="${this.focusedCell.x}"][data-cy="${this.focusedCell.y}"]`
      );
      targetCell?.focus({ preventScroll: true });
    }
  }

  private mountInspectorBox(box: HTMLElement): void {
    const externalHost = this.callbacks.getInspectorHost?.() ?? null;
    if (this.lastExternalInspectorHost && this.lastExternalInspectorHost !== externalHost) {
      this.lastExternalInspectorHost.innerHTML = '';
    }
    this.lastExternalInspectorHost = externalHost;
    if (externalHost) {
      externalHost.innerHTML = '';
      externalHost.appendChild(box);
    } else {
      this.root.appendChild(box);
    }
  }

  private renderSelectedInspector(editable: boolean, delta: V2TacticalDelta | null): void {
    const sel = this.getSelectedItemInfo();
    const box = document.createElement('div');
    box.className = 'inspector-bar v2-inspector-bar';

    if (!sel) {
      box.innerHTML = `<div class="inspector-empty">${
        editable
          ? this.prepareMode
            ? '点选舱内设备微调位置与旋转，或从左侧选件装入船舱（快捷键：方向键 / 回车 / R）。'
            : '点选或拖拽整理船舱（快捷键：方向键移格 · 回车拿放 · R 旋转 · Del 舍弃）。'
          : '点击任意已装设备查看联动与战力变化。'
      }</div>`;
      this.mountInspectorBox(box);
      return;
    }

    const def = getAnyV2ItemDef(sel.item.definitionId);
    if (!def) {
      if (this.lastExternalInspectorHost) {
        this.lastExternalInspectorHost.innerHTML = '';
      }
      return;
    }
    const eqDef = sel.item.category === 'equipment' ? V2_EQUIPMENT_DEFS[sel.item.definitionId] : undefined;

    const deltaHtml = delta
      ? `<div class="v2-delta-strip ${delta.positiveImpact ? 'positive' : ''}">
          <div class="v2-delta-row"><span class="v2-delta-k">联动</span><span>${delta.synergyLine}</span></div>
          <div class="v2-delta-row"><span class="v2-delta-k">收益</span><strong>${delta.combatDeltaLine}</strong></div>
          <div class="v2-delta-row"><span class="v2-delta-k">舱位</span><span>${delta.spaceLine}</span></div>
        </div>`
      : `<div class="inspector-desc">${def.summary}${
          sel.item.fixedValue > 0 ? ` · 回收估价 <strong>${sel.item.fixedValue}¤</strong>` : ''
        }</div>`;

    box.innerHTML = `
      <div class="inspector-main">
        <img class="inspector-thumb" src="${getItemImageUrl(sel.item.definitionId)}" alt="${def.name}" />
        <div class="inspector-text">
          <div class="inspector-title-row">
            <strong>${def.name}</strong>
            <span class="v2-origin-chip origin-${sel.item.origin}">${originFullLabel(sel.item.origin)}</span>
            ${
              eqDef
                ? `<span class="v2-quality-chip ${eqDef.quality}">${
                    eqDef.quality === 'improved' ? '优良' : '普通'
                  }</span>`
                : ''
            }
          </div>
          ${deltaHtml}
        </div>
      </div>
      ${
        editable
          ? `<div class="inspector-actions">
              <button type="button" class="btn btn-sm btn-secondary" id="btn-v2-rotate">↻ 旋转 (R)</button>
              ${
                sel.zone === 'staging'
                  ? `<button type="button" class="btn btn-sm btn-primary" id="btn-v2-autoplace">${
                      delta?.recommendedSpot ? '↓ 装入推荐位' : '↓ 放入船舱'
                    }</button>`
                  : this.prepareMode
                  ? this.callbacks.onPrepareRemoveItem
                    ? `<button type="button" class="btn btn-sm btn-danger" id="btn-v2-prep-remove">✕ 移出配装</button>`
                    : `<span class="v2-origin-chip origin-loan" style="align-self:center;">试航整套锁定 · 可拖动/旋转</span>`
                  : `<button type="button" class="btn btn-sm btn-ghost" id="btn-v2-to-staging">↑ 移至暂存</button>`
              }
              ${
                !this.prepareMode
                  ? `<button type="button" class="btn btn-sm btn-danger" id="btn-v2-discard">✕ 舍弃</button>`
                  : ''
              }
            </div>`
          : ''
      }
    `;

    if (editable) {
      box.querySelector('#btn-v2-rotate')?.addEventListener('click', () => {
        this.rotateSelected();
      });
      box.querySelector('#btn-v2-autoplace')?.addEventListener('click', () => {
        if (!this.bay || sel.zone !== 'staging') return;
        const spot =
          delta?.recommendedSpot ?? findFirstLegalV2Placement(this.bay, sel.item.definitionId);
        if (!spot) {
          this.showInvalidReason('overlap');
          return;
        }
        const res = placeV2FromStaging(
          this.bay,
          sel.item.instanceId,
          spot.x,
          spot.y,
          spot.rotation
        );
        if (res.ok) {
          this.lastSnappedId = sel.item.instanceId;
          this.selected = { zone: 'grid', instanceId: sel.item.instanceId };
          soundEngine.play('place');
          this.callbacks.onBayChange(res.bay);
        }
      });
      box.querySelector('#btn-v2-to-staging')?.addEventListener('click', () => {
        if (!this.bay || sel.zone !== 'grid') return;
        const res = moveV2PlacedToStaging(this.bay, sel.item.instanceId);
        if (res.ok) {
          this.selected = { zone: 'staging', instanceId: sel.item.instanceId };
          soundEngine.play('click');
          this.callbacks.onBayChange(res.bay);
        }
      });
      box.querySelector('#btn-v2-prep-remove')?.addEventListener('click', () => {
        if (sel.zone !== 'grid') return;
        this.selected = null;
        soundEngine.play('click');
        this.callbacks.onPrepareRemoveItem?.(sel.item.instanceId);
      });
      box.querySelector('#btn-v2-discard')?.addEventListener('click', () => {
        this.discardSelected();
      });
    }

    this.mountInspectorBox(box);
  }

  private getSelectedItemInfo(): {
    readonly zone: 'grid' | 'staging';
    readonly item: V2ItemInstance;
    readonly rotation: V2Rotation;
    readonly placed?: V2PlacedItem;
  } | null {
    if (!this.bay || !this.selected) return null;
    if (this.selected.zone === 'grid') {
      const p = this.bay.placed.find((item) => item.item.instanceId === this.selected?.instanceId);
      if (!p) return null;
      return { zone: 'grid', item: p.item, rotation: p.rotation, placed: p };
    }
    const s = this.bay.staging.find((item) => item.item.instanceId === this.selected?.instanceId);
    if (!s) return null;
    return { zone: 'staging', item: s.item, rotation: s.rotation };
  }

  private rotateSelected(): void {
    if (!this.bay || !this.editable) return;
    const sel = this.getSelectedItemInfo();
    if (!sel) return;
    if (sel.zone === 'staging') {
      const next = rotateV2StagingItem(this.bay, sel.item.instanceId);
      soundEngine.play('rotate');
      this.callbacks.onBayChange(next);
      return;
    }
    const res = rotateV2PlacedItem(this.bay, sel.item.instanceId);
    if (res.ok) {
      this.lastSnappedId = sel.item.instanceId;
      soundEngine.play('rotate');
      this.callbacks.onBayChange(res.bay);
    } else {
      this.showInvalidReason('overlap');
    }
  }

  private discardSelected(): void {
    if (!this.bay || !this.editable || this.prepareMode) return;
    const sel = this.getSelectedItemInfo();
    if (!sel) return;
    const res = discardV2Item(this.bay, sel.item.instanceId);
    if (res.ok) {
      this.selected = null;
      this.carrying = false;
      soundEngine.play('click');
      this.callbacks.onBayChange(res.bay);
    }
  }

  private tryPlaceSelectedAt(x: number, y: number): boolean {
    if (!this.bay || !this.editable) return false;
    const sel = this.getSelectedItemInfo();
    if (!sel) return false;
    if (sel.zone === 'staging') {
      const check = validateV2Placement(this.bay, sel.item.definitionId, x, y, sel.rotation);
      if (!check.valid) {
        this.showInvalidReason(check.reason);
        return false;
      }
      const res = placeV2FromStaging(this.bay, sel.item.instanceId, x, y, sel.rotation);
      if (!res.ok) return false;
      this.lastSnappedId = sel.item.instanceId;
      this.selected = { zone: 'grid', instanceId: sel.item.instanceId };
      this.carrying = false;
      soundEngine.play('place');
      this.callbacks.onBayChange(res.bay);
      return true;
    }

    const check = validateV2Placement(
      this.bay,
      sel.item.definitionId,
      x,
      y,
      sel.rotation,
      sel.item.instanceId
    );
    if (!check.valid) {
      this.showInvalidReason(check.reason);
      return false;
    }
    const res = moveV2PlacedItem(this.bay, sel.item.instanceId, x, y, sel.rotation);
    if (!res.ok) return false;
    this.lastSnappedId = sel.item.instanceId;
    this.carrying = false;
    soundEngine.play('place');
    this.callbacks.onBayChange(res.bay);
    return true;
  }

  private computeActivePreview(): {
    readonly valid: boolean;
    readonly cells: readonly V2GridCoord[];
    readonly conflictCells: readonly V2GridCoord[];
  } | null {
    if (!this.bay || !this.editable) return null;
    if (this.drag?.active && this.drag.hoverOriginX !== null && this.drag.hoverOriginY !== null) {
      return validateV2Placement(
        this.bay,
        this.drag.item.definitionId,
        this.drag.hoverOriginX,
        this.drag.hoverOriginY,
        this.drag.rotation,
        this.drag.zone === 'grid' ? this.drag.item.instanceId : undefined
      );
    }
    if (this.carrying && this.gridHasFocus) {
      const sel = this.getSelectedItemInfo();
      if (sel) {
        return validateV2Placement(
          this.bay,
          sel.item.definitionId,
          this.focusedCell.x,
          this.focusedCell.y,
          sel.rotation,
          sel.zone === 'grid' ? sel.item.instanceId : undefined
        );
      }
    }
    return null;
  }

  private updateCellVisualFocusAndPreview(): void {
    if (!this.boardEl || !this.bay) return;
    const preview = this.computeActivePreview();
    this.boardEl.querySelectorAll<HTMLElement>('.cargo-cell').forEach((cellEl) => {
      const cx = Number(cellEl.dataset.cx);
      const cy = Number(cellEl.dataset.cy);
      const isRoving = this.focusedCell.x === cx && this.focusedCell.y === cy;
      cellEl.tabIndex = isRoving ? 0 : -1;
      cellEl.classList.toggle('kb-focused', isRoving && this.gridHasFocus);
      cellEl.classList.remove('preview-valid', 'preview-invalid');
      const disabled = isCellDisabledForShip(this.bay!.shipId, cx, cy);
      if (preview) {
        const inCells = preview.cells.some((c) => c.x === cx && c.y === cy);
        const inConf = preview.conflictCells.some((c) => c.x === cx && c.y === cy);
        if (preview.valid && inCells) {
          cellEl.classList.add('preview-valid');
        } else if (!preview.valid && (inConf || inCells)) {
          cellEl.classList.add('preview-invalid');
        }
      }
      if (!disabled && !cellEl.classList.contains('preview-valid') && !cellEl.classList.contains('preview-invalid')) {
        cellEl.innerHTML = '';
      }
    });
  }

  private clientPointToCell(clientX: number, clientY: number): V2GridCoord | null {
    if (!this.boardEl || !this.bay) return null;
    const rect = this.boardEl.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const ship = V2_SHIPS[this.bay.shipId];
    const x = Math.min(ship.cols - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * ship.cols)));
    const y = Math.min(ship.rows - 1, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * ship.rows)));
    return { x, y };
  }

  private showInvalidReason(reason?: 'out_of_bounds' | 'disabled_cell' | 'overlap'): void {
    this.invalidToastText = reasonToZh(reason);
    soundEngine.play('invalid');
    if (this.invalidToastTimer !== null) {
      window.clearTimeout(this.invalidToastTimer);
    }
    this.invalidToastTimer = window.setTimeout(() => {
      this.invalidToastText = null;
      this.invalidToastTimer = null;
      if (this.bay) {
        this.render(this.bay, this.editable, { prepareMode: this.prepareMode });
      }
    }, 1500);
    if (this.bay) {
      this.render(this.bay, this.editable, { prepareMode: this.prepareMode });
    }
  }

  private ensureDragGhost(drag: DragState): HTMLElement {
    if (drag.ghostEl) return drag.ghostEl;
    const def = getAnyV2ItemDef(drag.item.definitionId);
    const bounds = def ? getV2ShapeBounds(def.shapeId, drag.rotation) : { width: 1, height: 1 };
    const cellPx = this.boardEl && this.bay
      ? this.boardEl.getBoundingClientRect().width / V2_SHIPS[this.bay.shipId].cols
      : 64;
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${bounds.width * cellPx}px`;
    ghost.style.height = `${bounds.height * cellPx}px`;
    const img = document.createElement('img');
    img.src = getItemImageUrl(drag.item.definitionId);
    img.style.width = '100%';
    img.style.height = '100%';
    img.style.objectFit = 'contain';
    img.style.transform = `rotate(${drag.rotation * 90}deg)`;
    ghost.appendChild(img);
    document.body.appendChild(ghost);
    drag.ghostEl = ghost;
    return ghost;
  }

  private clearDragGhost(): void {
    if (this.drag?.ghostEl) {
      this.drag.ghostEl.remove();
      this.drag.ghostEl = null;
    }
  }

  private handleWindowPointerMove = (e: PointerEvent): void => {
    if (!this.drag || !this.bay || e.pointerId !== this.drag.pointerId) return;
    const dist = Math.hypot(e.clientX - this.drag.startClientX, e.clientY - this.drag.startClientY);
    if (!this.drag.active && dist >= 8) {
      this.drag.active = true;
    }
    if (!this.drag.active) return;

    const liftY = this.drag.pointerType === 'touch' ? 48 : 0;
    const ghost = this.ensureDragGhost(this.drag);
    ghost.style.left = `${e.clientX}px`;
    ghost.style.top = `${e.clientY - liftY}px`;

    const hoverCell = this.clientPointToCell(e.clientX, e.clientY - liftY);
    if (hoverCell) {
      this.drag.hoverOriginX = hoverCell.x - this.drag.grabOffsetCellX;
      this.drag.hoverOriginY = hoverCell.y - this.drag.grabOffsetCellY;
    } else {
      this.drag.hoverOriginX = null;
      this.drag.hoverOriginY = null;
    }
    this.updateCellVisualFocusAndPreview();
  };

  private handleWindowPointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.clearDragGhost();
    this.drag = null;

    if (!drag.active || !this.bay || !this.editable) return;

    if (drag.hoverOriginX !== null && drag.hoverOriginY !== null) {
      const ok = this.tryPlaceSelectedAt(drag.hoverOriginX, drag.hoverOriginY);
      if (!ok) {
        this.render(this.bay, this.editable, { prepareMode: this.prepareMode });
      }
    } else {
      this.render(this.bay, this.editable, { prepareMode: this.prepareMode });
    }
  };

  private handleWindowPointerCancel = (): void => {
    if (!this.drag) return;
    this.clearDragGhost();
    this.drag = null;
    if (this.bay) {
      this.render(this.bay, this.editable, { prepareMode: this.prepareMode });
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Strictly isolated when ANY modal is open or grid is hidden/read-only (AC17/F01)!
    if (hasOpenModal() || !this.bay || !this.editable) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    const ship = V2_SHIPS[this.bay.shipId];

    // Grid navigation when focus is on grid
    if (this.gridHasFocus) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.focusedCell = { x: (this.focusedCell.x + 1) % ship.cols, y: this.focusedCell.y };
        this.render(this.bay, this.editable, {
          prepareMode: this.prepareMode,
          restoreCellFocus: true,
        });
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.focusedCell = {
          x: (this.focusedCell.x + ship.cols - 1) % ship.cols,
          y: this.focusedCell.y,
        };
        this.render(this.bay, this.editable, {
          prepareMode: this.prepareMode,
          restoreCellFocus: true,
        });
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.focusedCell = { x: this.focusedCell.x, y: (this.focusedCell.y + 1) % ship.rows };
        this.render(this.bay, this.editable, {
          prepareMode: this.prepareMode,
          restoreCellFocus: true,
        });
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.focusedCell = {
          x: this.focusedCell.x,
          y: (this.focusedCell.y + ship.rows - 1) % ship.rows,
        };
        this.render(this.bay, this.editable, {
          prepareMode: this.prepareMode,
          restoreCellFocus: true,
        });
        return;
      }
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (isCellDisabledForShip(this.bay.shipId, this.focusedCell.x, this.focusedCell.y)) {
          this.showInvalidReason('disabled_cell');
          return;
        }
        if (this.carrying && this.selected) {
          this.tryPlaceSelectedAt(this.focusedCell.x, this.focusedCell.y);
          return;
        }
        const occ = findV2ItemAtCell(this.bay, this.focusedCell.x, this.focusedCell.y);
        if (occ) {
          this.selected = { zone: 'grid', instanceId: occ.item.instanceId };
          this.carrying = true;
          soundEngine.play('click');
          this.render(this.bay, this.editable, {
            prepareMode: this.prepareMode,
            restoreCellFocus: true,
          });
        } else if (this.selected) {
          this.tryPlaceSelectedAt(this.focusedCell.x, this.focusedCell.y);
        }
        return;
      }
    }

    if (e.key === 'r' || e.key === 'R') {
      if (this.selected) {
        e.preventDefault();
        this.rotateSelected();
      }
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (this.selected && this.gridHasFocus) {
        e.preventDefault();
        if (this.prepareMode) {
          if (!this.callbacks.onPrepareRemoveItem) return;
          const sel = this.getSelectedItemInfo();
          if (sel && sel.zone === 'grid') {
            this.selected = null;
            this.callbacks.onPrepareRemoveItem(sel.item.instanceId);
          }
        } else {
          this.discardSelected();
        }
      }
    } else if (e.key === 'Escape') {
      if (this.carrying || this.selected) {
        e.preventDefault();
        this.carrying = false;
        this.selected = null;
        this.render(this.bay, this.editable, {
          prepareMode: this.prepareMode,
          restoreCellFocus: this.gridHasFocus,
        });
      }
    }
  };
}

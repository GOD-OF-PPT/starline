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
import { V2_SHIPS, isCellDisabledForShip, isCellPowerCellForShip } from '../data/ships';
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
import {
  computeV2BayHash,
  computeV2ItemSacrificePreview,
  getV2ThreatTierMeta,
  summarizeV2MissionSacrificeOptions,
  type V2TacticalDelta,
} from '../domain/tacticalDelta';
import type {
  V2CargoBayState,
  V2ItemInstance,
  V2ItemOrigin,
  V2PlacedItem,
} from '../domain/types';
import { svgIcon } from './icons';

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
  /** Optional T01 playtest telemetry hook reporting pointer drag drop outcomes */
  readonly onDragAttempt?: (attempt: {
    readonly zone: 'grid' | 'staging';
    readonly itemDefId: string;
    readonly success: boolean;
    readonly reason?: 'out_of_bounds' | 'disabled_cell' | 'overlap' | 'outside_board';
  }) => void;
}

interface SelectedRef {
  readonly zone: 'grid' | 'staging';
  readonly instanceId: string;
}

interface DragSourceRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
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
  readonly grabOffsetPxX: number;
  readonly grabOffsetPxY: number;
  readonly sourceRect: DragSourceRect | null;
  active: boolean;
  hoverOriginX: number | null;
  hoverOriginY: number | null;
  lastValidHoverKey: string | null;
  ghostEl: HTMLElement | null;
}

export function isHeavyPlacementItem(
  item: Pick<V2ItemInstance, 'definitionId' | 'category'>
): boolean {
  const def = getAnyV2ItemDef(item.definitionId);
  const cellCount = def ? V2_SHAPES[def.shapeId].cells.length : 1;
  const eqKind =
    item.category === 'equipment' ? V2_EQUIPMENT_DEFS[item.definitionId]?.kind : undefined;
  return (
    cellCount >= 4 ||
    item.category === 'mission' ||
    eqKind === 'heavy' ||
    eqKind === 'salvo_pod' ||
    eqKind === 'overdrive_core'
  );
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
    case 'overdrive_core':
      return '#FB7185';
    case 'coolant_vent':
      return '#7DD3FC';
    case 'cargo_amp':
      return '#FBBF24';
    default:
      return '#62D6DF';
  }
}

type IdleHandle = { readonly kind: 'ric' | 'timeout'; readonly id: number };

interface IdleSchedulerHost {
  requestIdleCallback?: (cb: () => void, opts?: { readonly timeout?: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
}

/**
 * Interactive Variable-Hull V2 Cargo Bay (4x4 Skiff/Cruiser & 5x4 Freighter with disabled bulkheads):
 * - Persistent sub-containers (stats, board, cells, items, synergySvg, staging, inspector) with dirty diffing
 * - Drag-and-drop (pointer + touch lift + ghost silhouette)
 * - Tap-to-select / tap-to-place / rotate / discard / undo
 * - Full WAI-ARIA keyboard roving tabindex (Arrows, Enter/Space, R, Delete, Escape),
 *   strictly isolated whenever any modal dialog is open!
 * - Idle-scheduled tactical delta updates with stale-bayHash discard guard
 * - Explicit four-way origin markers (借/自/拾/任) + quality notches (non-color-only).
 */
export class CargoGridV2Component {
  private readonly root: HTMLElement;
  private callbacks: CargoGridV2Callbacks;

  private bay: V2CargoBayState | null = null;
  private editable = false;
  private prepareMode = false;
  private selected: SelectedRef | null = null;
  private carrying = false;
  private focusedCell: V2GridCoord = { x: 0, y: 0 };
  private gridHasFocus = false;
  private drag: DragState | null = null;
  private lastSnappedId: string | null = null;
  private pendingSnapFeedback = false;
  private renderedShipId: V2CargoBayState['shipId'] | null = null;
  private cellsShipId: V2CargoBayState['shipId'] | null = null;
  private invalidToastText: string | null = null;
  private invalidToastTimer: ReturnType<typeof globalThis.setTimeout> | null = null;
  private prevLinkCount = 0;
  private prevLinkSignatures = new Set<string>();
  private showItemDetailsDrawer = false;
  private showRecommendHint = false;
  private readonly springBackCleanups = new Set<() => void>();
  private readonly previewPartnerIds = new Set<string>();

  // Persistent sub-containers created once in ensureContainers()
  private containersReady = false;
  private statsEl: HTMLElement | null = null;
  private boardEl: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private cellsWrapEl: HTMLElement | null = null;
  private itemLayerEl: HTMLElement | null = null;
  private synergySvgEl: SVGSVGElement | null = null;
  private stagingEl: HTMLElement | null = null;
  private inspectorEl: HTMLElement | null = null;
  private lastExternalInspectorHost: HTMLElement | null = null;

  private readonly cellElements = new Map<string, HTMLElement>();
  private readonly placedTileElements = new Map<string, HTMLElement>();
  private readonly stagingChipElements = new Map<string, HTMLButtonElement>();
  private readonly recommendedCellKeys = new Set<string>();

  // Dirty tracking & cached stats / delta
  private lastBayCombatHash = '';
  private lastPlacedUiHash = '';
  private lastStagingUiHash = '';
  private lastSynergyRenderKey = '';
  private lastInspectorStateKey = '';
  private renderedSelectedKey = 'none';
  private lastSelectedItemMetaKey = 'none';
  private lastRenderedEditable: boolean | null = null;
  private lastRenderedPrepareMode: boolean | null = null;
  private callbacksDirty = false;
  private lastStats: ReturnType<typeof calculateV2BuildStats> | null = null;

  private activeDelta: V2TacticalDelta | null = null;
  private activeDeltaKey: string | null = null;
  private deltaJobToken = 0;
  private pendingDeltaHandle: IdleHandle | null = null;
  private destroyed = false;

  constructor(root: HTMLElement, callbacks: CargoGridV2Callbacks) {
    this.root = root;
    this.callbacks = callbacks;
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', this.handleWindowPointerDown, true);
      window.addEventListener('pointermove', this.handleWindowPointerMove);
      window.addEventListener('pointerup', this.handleWindowPointerUp);
      window.addEventListener('pointercancel', this.handleWindowPointerCancel);
      window.addEventListener('blur', this.handleWindowBlur);
      window.addEventListener('keydown', this.handleKeyDown);
    }
  }

  setCallbacks(callbacks: CargoGridV2Callbacks): void {
    this.callbacks = callbacks;
    this.callbacksDirty = true;
  }

  getRoot(): HTMLElement {
    return this.root;
  }

  getUiStateSnapshot(): {
    readonly selected: { readonly zone: 'grid' | 'staging'; readonly instanceId: string } | null;
    readonly focusedCell: V2GridCoord;
    readonly prevLinkCount: number;
    readonly lastSnappedId: string | null;
    readonly carrying: boolean;
  } {
    return {
      selected: this.selected ? { ...this.selected } : null,
      focusedCell: { ...this.focusedCell },
      prevLinkCount: this.prevLinkCount,
      lastSnappedId: this.lastSnappedId,
      carrying: this.carrying,
    };
  }

  private clearInvalidToast(): void {
    this.invalidToastText = null;
    if (this.invalidToastTimer !== null) {
      globalThis.clearTimeout(this.invalidToastTimer);
      this.invalidToastTimer = null;
    }
    this.renderToast();
  }

  private scheduleIdle(fn: () => void): IdleHandle {
    const win = (typeof window !== 'undefined' ? window : undefined) as IdleSchedulerHost | undefined;
    const glob = globalThis as unknown as IdleSchedulerHost;
    const ric =
      typeof win?.requestIdleCallback === 'function'
        ? win.requestIdleCallback.bind(win)
        : typeof glob.requestIdleCallback === 'function'
        ? glob.requestIdleCallback.bind(glob)
        : null;
    if (ric) {
      return { kind: 'ric', id: ric(() => fn(), { timeout: 120 }) };
    }
    return { kind: 'timeout', id: globalThis.setTimeout(fn, 0) as unknown as number };
  }

  private cancelPendingDeltaJob(): void {
    this.deltaJobToken += 1;
    if (!this.pendingDeltaHandle) return;
    const handle = this.pendingDeltaHandle;
    this.pendingDeltaHandle = null;
    if (handle.kind === 'ric') {
      const win = (typeof window !== 'undefined' ? window : undefined) as IdleSchedulerHost | undefined;
      const glob = globalThis as unknown as IdleSchedulerHost;
      const cancelRic =
        typeof win?.cancelIdleCallback === 'function'
          ? win.cancelIdleCallback.bind(win)
          : typeof glob.cancelIdleCallback === 'function'
          ? glob.cancelIdleCallback.bind(glob)
          : null;
      cancelRic?.(handle.id);
    } else {
      globalThis.clearTimeout(handle.id);
    }
  }

  private flushSpringBackCleanups(): void {
    if (this.springBackCleanups.size === 0) return;
    const fns = [...this.springBackCleanups];
    this.springBackCleanups.clear();
    for (const fn of fns) {
      fn();
    }
  }

  destroy(): void {
    this.destroyed = true;
    if (typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.handleWindowPointerDown, true);
      window.removeEventListener('pointermove', this.handleWindowPointerMove);
      window.removeEventListener('pointerup', this.handleWindowPointerUp);
      window.removeEventListener('pointercancel', this.handleWindowPointerCancel);
      window.removeEventListener('blur', this.handleWindowBlur);
      window.removeEventListener('keydown', this.handleKeyDown);
    }
    this.boardEl?.removeEventListener('pointerdown', this.handleBoardPointerDown);
    this.stagingEl?.removeEventListener('pointerdown', this.handleStagingPointerDown);
    this.stagingEl?.removeEventListener('click', this.handleStagingClick);
    this.inspectorEl?.removeEventListener('click', this.handleInspectorClick);
    this.cancelPendingDeltaJob();
    this.clearDragGhost();
    this.flushSpringBackCleanups();
    this.previewPartnerIds.clear();
    this.drag = null;
    this.clearInvalidToast();
    if (this.inspectorEl?.parentNode) {
      this.inspectorEl.parentNode.removeChild(this.inspectorEl);
    }
    if (this.lastExternalInspectorHost) {
      this.lastExternalInspectorHost.innerHTML = '';
      this.lastExternalInspectorHost = null;
    }
    this.cellElements.clear();
    this.placedTileElements.clear();
    this.stagingChipElements.clear();
    this.recommendedCellKeys.clear();
    this.statsEl = null;
    this.boardEl = null;
    this.toastEl = null;
    this.cellsWrapEl = null;
    this.itemLayerEl = null;
    this.synergySvgEl = null;
    this.stagingEl = null;
    this.inspectorEl = null;
    this.containersReady = false;
  }

  private ensureContainers(): void {
    if (this.containersReady) return;
    this.root.innerHTML = '';

    const statsEl = document.createElement('div');
    statsEl.className = 'stats-strip v2-stats-strip';
    statsEl.dataset.cargoSlot = 'stats';

    const boardEl = document.createElement('div');
    boardEl.className = 'cargo-board-outer v2-cargo-board';
    boardEl.dataset.cargoSlot = 'board';
    boardEl.setAttribute('role', 'grid');

    const cellsWrapEl = document.createElement('div');
    cellsWrapEl.className = 'cargo-grid-cells v2-grid-cells';
    cellsWrapEl.dataset.cargoSlot = 'cells';

    const itemLayerEl = document.createElement('div');
    itemLayerEl.className = 'cargo-item-layer';
    itemLayerEl.dataset.cargoSlot = 'items';

    const synergySvgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    synergySvgEl.setAttribute('class', 'synergy-overlay-svg');
    synergySvgEl.setAttribute('data-cargo-slot', 'synergy');
    synergySvgEl.setAttribute('preserveAspectRatio', 'none');
    synergySvgEl.style.display = 'none';

    boardEl.appendChild(cellsWrapEl);
    boardEl.appendChild(itemLayerEl);
    boardEl.appendChild(synergySvgEl);

    const stagingEl = document.createElement('div');
    stagingEl.className = 'staging-box v2-staging-box';
    stagingEl.dataset.cargoSlot = 'staging';
    stagingEl.style.display = 'none';

    const inspectorEl = document.createElement('div');
    inspectorEl.className = 'inspector-bar v2-inspector-bar';
    inspectorEl.dataset.cargoSlot = 'inspector';

    this.root.appendChild(statsEl);
    this.root.appendChild(boardEl);
    this.root.appendChild(stagingEl);
    this.root.appendChild(inspectorEl);

    boardEl.addEventListener('pointerdown', this.handleBoardPointerDown);
    stagingEl.addEventListener('pointerdown', this.handleStagingPointerDown);
    stagingEl.addEventListener('click', this.handleStagingClick);
    inspectorEl.addEventListener('click', this.handleInspectorClick);

    this.statsEl = statsEl;
    this.boardEl = boardEl;
    this.cellsWrapEl = cellsWrapEl;
    this.itemLayerEl = itemLayerEl;
    this.synergySvgEl = synergySvgEl;
    this.stagingEl = stagingEl;
    this.inspectorEl = inspectorEl;
    this.containersReady = true;
  }

  private ensureBoardCells(shipId: V2CargoBayState['shipId']): void {
    if (!this.boardEl || !this.cellsWrapEl || !this.synergySvgEl) return;
    if (this.cellsShipId === shipId) return;
    this.cellsShipId = shipId;

    const ship = V2_SHIPS[shipId];
    this.boardEl.dataset.cols = String(ship.cols);
    this.boardEl.dataset.rows = String(ship.rows);
    this.boardEl.style.aspectRatio = `${ship.cols} / ${ship.rows}`;
    this.boardEl.setAttribute(
      'aria-label',
      `${ship.name} ${ship.cols}列${ship.rows}行船舱网格（${ship.validCellCount}格可用），方向键移动焦点，回车选取或放置，R键旋转`
    );

    this.cellsWrapEl.style.gridTemplateColumns = `repeat(${ship.cols}, 1fr)`;
    this.cellsWrapEl.style.gridTemplateRows = `repeat(${ship.rows}, 1fr)`;
    this.synergySvgEl.setAttribute('viewBox', `0 0 ${ship.cols * 100} ${ship.rows * 100}`);

    this.cellsWrapEl.innerHTML = '';
    this.cellElements.clear();

    for (let y = 0; y < ship.rows; y++) {
      for (let x = 0; x < ship.cols; x++) {
        const cellEl = document.createElement('div');
        const disabled = isCellDisabledForShip(shipId, x, y);
        const isPowerCell = !disabled && isCellPowerCellForShip(shipId, x, y);
        cellEl.className = `cargo-cell${disabled ? ' v2-cell-disabled' : ''}${
          isPowerCell ? ' v3-power-cell' : ''
        }`;
        cellEl.dataset.cx = String(x);
        cellEl.dataset.cy = String(y);
        if (isPowerCell) {
          cellEl.dataset.powerCell = 'true';
          cellEl.title = '船体供能格：装备覆盖此格即可获得超导强化';
        }
        cellEl.setAttribute('role', 'gridcell');
        if (disabled) {
          cellEl.setAttribute('aria-disabled', 'true');
          cellEl.innerHTML = `<span class="v2-bulkhead-mark" aria-hidden="true">✕</span>`;
          cellEl.dataset.markState = 'bulkhead';
        } else if (isPowerCell) {
          cellEl.innerHTML = `<span class="v3-power-cell-mark" aria-hidden="true">⚡</span>`;
          cellEl.dataset.markState = 'power';
        } else {
          cellEl.dataset.markState = 'empty';
        }

        const isRoving = this.focusedCell.x === x && this.focusedCell.y === y;
        cellEl.tabIndex = isRoving ? 0 : -1;

        cellEl.addEventListener('focus', () => {
          if (this.destroyed) return;
          const changed = !this.gridHasFocus || this.focusedCell.x !== x || this.focusedCell.y !== y;
          this.focusedCell = { x, y };
          this.gridHasFocus = true;
          if (changed) {
            this.updateCellVisualFocusAndPreview();
          }
        });
        cellEl.addEventListener('blur', () => {
          queueMicrotask(() => {
            if (this.destroyed) return;
            if (this.boardEl && !this.boardEl.contains(document.activeElement)) {
              this.gridHasFocus = false;
              this.updateCellVisualFocusAndPreview();
            }
          });
        });

        this.cellsWrapEl.appendChild(cellEl);
        this.cellElements.set(`${x},${y}`, cellEl);
      }
    }
  }

  private updateCellAriaLabels(bay: V2CargoBayState): void {
    const ship = V2_SHIPS[bay.shipId];
    for (let y = 0; y < ship.rows; y++) {
      for (let x = 0; x < ship.cols; x++) {
        const cellEl = this.cellElements.get(`${x},${y}`);
        if (!cellEl) continue;
        const disabled = isCellDisabledForShip(bay.shipId, x, y);
        const isPowerCell = !disabled && isCellPowerCellForShip(bay.shipId, x, y);
        const occupant = disabled ? undefined : findV2ItemAtCell(bay, x, y);
        const occName = disabled
          ? '不可用舱壁格'
          : occupant
          ? getAnyV2ItemDef(occupant.item.definitionId)?.name ?? occupant.item.definitionId
          : isPowerCell
          ? '空位（供能格）'
          : '空位';
        cellEl.setAttribute('aria-label', `第${y + 1}行第${x + 1}列 ${occName}`);
      }
    }
  }

  private renderToast(): void {
    if (!this.boardEl) return;
    if (!this.invalidToastText) {
      if (this.toastEl) {
        this.toastEl.remove();
        this.toastEl = null;
      }
      return;
    }
    if (!this.toastEl) {
      const toast = document.createElement('div');
      toast.className = 'drag-reason-toast';
      toast.setAttribute('role', 'alert');
      this.toastEl = toast;
      if (this.cellsWrapEl && this.cellsWrapEl.parentNode === this.boardEl) {
        this.boardEl.insertBefore(toast, this.cellsWrapEl);
      } else {
        this.boardEl.appendChild(toast);
      }
    }
    if (this.toastEl.textContent !== this.invalidToastText) {
      this.toastEl.textContent = this.invalidToastText;
    }
  }

  public collapseDetailsDrawer(): void {
    if (!this.showItemDetailsDrawer) return;
    this.showItemDetailsDrawer = false;
    if (!this.destroyed && this.bay) {
      this.renderSelectedInspector(this.editable, this.activeDelta);
    }
  }

  render(
    bay: V2CargoBayState,
    editable: boolean,
    options?: { readonly prepareMode?: boolean; readonly restoreCellFocus?: boolean }
  ): void {
    if (this.destroyed) return;
    this.ensureContainers();

    const wasCellFocused =
      Boolean(options?.restoreCellFocus) ||
      (this.boardEl !== null && this.boardEl.contains(document.activeElement));

    const nextPrepareMode = Boolean(options?.prepareMode);
    const isFirstRender = this.bay === null;
    const shipChanged = this.renderedShipId !== null && this.renderedShipId !== bay.shipId;
    const modeChanged = !isFirstRender && this.prepareMode !== nextPrepareMode;
    const editableDisabled = !isFirstRender && this.editable && !editable;
    const editableChanged = this.lastRenderedEditable !== editable;
    const prepareModeChanged = this.lastRenderedPrepareMode !== nextPrepareMode;
    const callbacksWereDirty = this.callbacksDirty;
    this.callbacksDirty = false;

    if (shipChanged || modeChanged) {
      this.clearDragGhost();
      this.flushSpringBackCleanups();
      this.drag = null;
      this.carrying = false;
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
      this.clearInvalidToast();
      this.cancelPendingDeltaJob();
      this.activeDelta = null;
      this.activeDeltaKey = null;
      this.recommendedCellKeys.clear();
      this.showRecommendHint = false;
      this.showItemDetailsDrawer = false;
      if (modeChanged) {
        this.selected = null;
      }
    } else if (editableDisabled) {
      this.clearDragGhost();
      this.flushSpringBackCleanups();
      this.drag = null;
      this.carrying = false;
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
    }

    this.bay = bay;
    this.editable = editable;
    this.prepareMode = nextPrepareMode;
    this.renderedShipId = bay.shipId;

    const ship = V2_SHIPS[bay.shipId];
    this.focusedCell = {
      x: Math.max(0, Math.min(ship.cols - 1, this.focusedCell.x)),
      y: Math.max(0, Math.min(ship.rows - 1, this.focusedCell.y)),
    };

    if (!editable) {
      this.carrying = false;
    }

    // Validate active/pending drag & selection still exist with matching identity & transform in updated bay
    let dragCancelledInRender = false;
    if (this.drag) {
      const dragValid =
        this.drag.zone === 'grid'
          ? bay.placed.some(
              (p) =>
                p.item.instanceId === this.drag?.item.instanceId &&
                p.item.definitionId === this.drag.item.definitionId &&
                p.rotation === this.drag.rotation &&
                p.x === this.drag.originX &&
                p.y === this.drag.originY
            )
          : bay.staging.some(
              (s) =>
                s.item.instanceId === this.drag?.item.instanceId &&
                s.item.definitionId === this.drag.item.definitionId &&
                s.rotation === this.drag.rotation
            );
      if (!dragValid) {
        this.clearDragGhost();
        this.flushSpringBackCleanups();
        this.drag = null;
        dragCancelledInRender = true;
      }
    }
    if (this.selected) {
      const exists =
        this.selected.zone === 'grid'
          ? bay.placed.some((p) => p.item.instanceId === this.selected?.instanceId)
          : bay.staging.some((s) => s.item.instanceId === this.selected?.instanceId);
      if (!exists) {
        this.selected = null;
        this.carrying = false;
        this.showItemDetailsDrawer = false;
      }
    }

    if (this.lastSnappedId && !bay.placed.some((p) => p.item.instanceId === this.lastSnappedId)) {
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
    }

    // Auto-select first staging item when editable for 1-tap placement convenience
    if (editable && !this.selected && bay.staging.length > 0) {
      this.showItemDetailsDrawer = false;
      this.selected = { zone: 'staging', instanceId: bay.staging[0].item.instanceId };
    }

    const bayCombatHash = computeV2BayHash(bay);
    const placedUiHash = `${bayCombatHash}|${bay.placed.map((p) => p.item.fixedValue).join(',')}`;
    const stagingUiHash = `${bay.staging
      .map(
        (s) =>
          `${s.item.instanceId}:${s.item.definitionId}:${s.item.origin}:${s.item.quality}:${s.item.fixedValue}:${s.rotation}`
      )
      .join(';')}|d=${bay.discardedThisArrange.length}|e=${editable ? 1 : 0}|pm=${nextPrepareMode ? 1 : 0}`;
    const selKey = this.selected ? `${this.selected.zone}:${this.selected.instanceId}` : 'none';
    const selectedItemMetaKey = this.computeSelectedItemMetaKey();

    const bayCombatChanged = isFirstRender || bayCombatHash !== this.lastBayCombatHash;
    const placedUiChanged = isFirstRender || shipChanged || placedUiHash !== this.lastPlacedUiHash;
    const stagingUiChanged = isFirstRender || stagingUiHash !== this.lastStagingUiHash;
    const selectionChanged = selKey !== this.renderedSelectedKey;
    const selectedItemMetaChanged = selectedItemMetaKey !== this.lastSelectedItemMetaKey;

    const stats =
      placedUiChanged || !this.lastStats ? calculateV2BuildStats(bay) : this.lastStats;
    this.lastStats = stats;

    const nextLinkSignatures = new Set(
      stats.links.map((l) => `${l.sourceInstanceId}->${l.targetInstanceId}:${l.sourceKind}`)
    );
    const forceSnapReplay = this.pendingSnapFeedback;
    if (isFirstRender || shipChanged || modeChanged) {
      this.prevLinkCount = stats.links.length;
      this.prevLinkSignatures = nextLinkSignatures;
      this.pendingSnapFeedback = false;
    } else {
      let formedNewLink = stats.links.length > this.prevLinkCount;
      if (!formedNewLink) {
        for (const sig of nextLinkSignatures) {
          if (!this.prevLinkSignatures.has(sig)) {
            formedNewLink = true;
            break;
          }
        }
      }
      if (this.pendingSnapFeedback && this.lastSnappedId && formedNewLink) {
        soundEngine.play('energyLink');
      }
      this.prevLinkCount = stats.links.length;
      this.prevLinkSignatures = nextLinkSignatures;
      this.pendingSnapFeedback = false;
    }

    this.ensureBoardCells(bay.shipId);

    if (placedUiChanged) {
      this.renderStatsStrip(bay, stats);
      this.updateCellAriaLabels(bay);
      this.renderPlacedItems(bay, stats);
    } else if (forceSnapReplay) {
      this.renderPlacedItems(bay, stats);
    }

    if (stagingUiChanged) {
      this.renderStagingTray(bay, editable);
    }

    if (!placedUiChanged && !forceSnapReplay) {
      this.updateSelectionAndDragClasses();
    } else if (!stagingUiChanged) {
      this.updateSelectionAndDragClasses();
    }

    this.lastBayCombatHash = bayCombatHash;
    this.lastPlacedUiHash = placedUiHash;
    this.lastStagingUiHash = stagingUiHash;
    this.renderedSelectedKey = selKey;
    this.lastSelectedItemMetaKey = selectedItemMetaKey;
    this.lastRenderedEditable = editable;
    this.lastRenderedPrepareMode = nextPrepareMode;

    this.renderSynergySvg(bay, stats);
    this.renderToast();

    this.syncInspectorHost();

    const currentDeltaKey = `${bayCombatHash}|${selectedItemMetaKey}`;
    const deltaInputChanged =
      bayCombatChanged ||
      selectionChanged ||
      selectedItemMetaChanged ||
      callbacksWereDirty ||
      editableChanged ||
      prepareModeChanged ||
      shipChanged;

    if (bayCombatChanged) {
      this.cancelPendingDeltaJob();
      this.activeDelta = null;
      this.activeDeltaKey = null;
      this.recommendedCellKeys.clear();
    }

    if (!this.selected || !this.callbacks.getTacticalDelta) {
      this.cancelPendingDeltaJob();
      this.activeDelta = null;
      this.activeDeltaKey = null;
      this.recommendedCellKeys.clear();
      this.renderSelectedInspector(editable, null);
    } else if (deltaInputChanged) {
      if (!callbacksWereDirty && this.activeDeltaKey === currentDeltaKey && this.activeDelta !== null) {
        this.updateRecommendedCells(this.activeDelta);
        this.renderSelectedInspector(editable, this.activeDelta);
      } else {
        this.cancelPendingDeltaJob();
        this.activeDelta = null;
        this.activeDeltaKey = null;
        this.recommendedCellKeys.clear();
        this.renderSelectedInspector(editable, null);
        this.scheduleTacticalDeltaUpdate();
      }
    }

    if (dragCancelledInRender) {
      this.rescheduleDeltaIfIdle();
    }

    this.updateCellVisualFocusAndPreview();

    if (wasCellFocused && this.gridHasFocus) {
      const targetCell = this.cellElements.get(`${this.focusedCell.x},${this.focusedCell.y}`);
      if (targetCell && document.activeElement !== targetCell) {
        targetCell.focus({ preventScroll: true });
      }
    }
  }

  private renderStatsStrip(
    bay: V2CargoBayState,
    stats: ReturnType<typeof calculateV2BuildStats>
  ): void {
    if (!this.statsEl) return;
    const occ = getV2BayOccupancy(bay);
    const heavySummary =
      stats.heavies.length > 0
        ? `重炮 ${stats.heavies.reduce((s, h) => s + h.baseDamage + h.firstShotBonus, 0)}爆发`
        : '';
    const hangarSummary =
      stats.hangars.length > 0
        ? `无人机 ${stats.hangars.reduce((s, h) => s + h.maxDrones, 0)}上限`
        : '';
    const salvoSummary =
      stats.salvos.length > 0
        ? `导弹 ${stats.salvos.reduce((s, sv) => s + sv.missiles, 0)}发`
        : '';
    const empSummary =
      stats.empJammers.length > 0
        ? `EMP削盾${stats.empJammers.reduce((s, e) => s + e.shieldShred, 0)}`
        : '';
    const flakSummary =
      stats.flaks.length > 0
        ? `近防 ${stats.flaks.reduce((s, f) => s + f.damagePerEnemy, 0)}×2`
        : '';
    const attackSubParts = [heavySummary, salvoSummary, hangarSummary, empSummary, flakSummary].filter(Boolean);
    const regularDps =
      stats.coreAttack +
      stats.lasers.reduce((sum, l) => sum + l.totalDamage, 0) +
      stats.empJammers.reduce((sum, e) => sum + e.damage, 0) +
      stats.salvageGrapples.reduce((sum, g) => sum + g.damage, 0);

    const attackTitle = `常规火力 ${regularDps}（${
      attackSubParts.length > 0 ? attackSubParts.join(' · ') : `舰核 ${stats.coreAttack}`
    }）`;
    const shieldDetail = stats.bestActiveCounter
      ? `反击 ${Math.round(stats.bestActiveCounter.ratio * 100)}%`
      : stats.endOfRoundShieldRegen > 0
      ? `每轮回盾 +${stats.endOfRoundShieldRegen}`
      : stats.shieldCapped
      ? `已达上限 ${V2_MAX_BATTLE_SHIELD}`
      : `上限 ${V2_MAX_BATTLE_SHIELD}`;
    const shieldTitle = `护盾 ${stats.effectiveShield}（${shieldDetail}）`;
    const repairTitle = `胜后维修 +${stats.effectiveRepair}（${
      stats.repairCapped ? `已达上限 ${V2_MAX_POST_WIN_REPAIR}` : `上限 ${V2_MAX_POST_WIN_REPAIR}`
    }）`;
    const capDetail =
      stats.powerCellBoostedIds.length > 0
        ? `供能×${stats.powerCellBoostedIds.length}${stats.links.length > 0 ? ` · 联动×${stats.links.length}` : ''}`
        : stats.links.length > 0
        ? `联动×${stats.links.length}`
        : `可售 ${stats.nonLoanBayValue}¤`;
    const capTitle = `舱格 ${occ.occupiedCells}/${occ.totalCells}（${capDetail}）`;
    const linkBadge =
      stats.links.length > 0 || stats.powerCellBoostedIds.length > 0
        ? `<span class="v3-stat-link-tag" title="${capDetail}">${svgIcon('bolt', 11)}${
            stats.links.length + stats.powerCellBoostedIds.length
          }</span>`
        : '';

    this.statsEl.innerHTML = `
      <div class="v3-compact-stats-row" data-testid="cargo-compact-stats" role="list" aria-label="船舱构筑遥测">
        <span class="v3-stat-cell" role="listitem" data-stat="attack" title="${attackTitle}" aria-label="${attackTitle}">
          ${svgIcon('cannon', 13)}
          <span class="v3-stat-k">火</span>
          <strong class="v3-stat-v num">${regularDps}</strong>
          ${attackSubParts.length > 0 ? `<span class="v3-stat-mini">+</span>` : ''}
        </span>
        <span class="v3-stat-cell ${stats.shieldCapped ? 'is-cap' : ''}" role="listitem" data-stat="shield" title="${shieldTitle}" aria-label="${shieldTitle}">
          ${svgIcon('shield', 13)}
          <span class="v3-stat-k">盾</span>
          <strong class="v3-stat-v num">${stats.effectiveShield}</strong>
        </span>
        <span class="v3-stat-cell ${stats.repairCapped ? 'is-cap' : ''}" role="listitem" data-stat="repair" title="${repairTitle}" aria-label="${repairTitle}">
          ${svgIcon('wrench', 13)}
          <span class="v3-stat-k">修</span>
          <strong class="v3-stat-v num">+${stats.effectiveRepair}</strong>
        </span>
        <span class="v3-stat-cell" role="listitem" data-stat="capacity" title="${capTitle}" aria-label="${capTitle}">
          ${svgIcon('grid', 13)}
          <span class="v3-stat-k">舱</span>
          <strong class="v3-stat-v num">${occ.occupiedCells}/${occ.totalCells}</strong>
          ${linkBadge}
        </span>
      </div>
    `;
  }

  private renderPlacedItems(
    bay: V2CargoBayState,
    stats: ReturnType<typeof calculateV2BuildStats>
  ): void {
    if (!this.itemLayerEl) return;
    const ship = V2_SHIPS[bay.shipId];
    this.itemLayerEl.innerHTML = '';
    this.placedTileElements.clear();

    const boostedIds = new Set<string>();
    for (const lnk of stats.links) {
      boostedIds.add(lnk.sourceInstanceId);
      boostedIds.add(lnk.targetInstanceId);
    }
    const powerBoostedSet = new Set(stats.powerCellBoostedIds);

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
      const isPowerBoosted = powerBoostedSet.has(placed.item.instanceId);

      const tile = document.createElement('div');
      tile.dataset.instanceId = placed.item.instanceId;
      tile.className = `placed-item v2-placed-item origin-${placed.item.origin} ${
        placed.item.category === 'equipment'
          ? placed.item.quality === 'improved'
            ? 'quality-improved'
            : 'quality-common'
          : placed.item.category === 'mission'
          ? 'cat-mission'
          : placed.item.category === 'gadget'
          ? 'cat-gadget'
          : 'cat-cargo'
      } ${isSelected ? 'selected' : ''} ${isDraggingThis ? 'dragging-source' : ''} ${
        this.lastSnappedId === placed.item.instanceId ? 'just-snapped' : ''
      } ${isBoosted ? 'synergy-active' : ''} ${isPowerBoosted ? 'power-cell-boosted' : ''}`;
      if (isPowerBoosted) {
        tile.dataset.powerBoosted = 'true';
      }

      tile.style.left = `${(placed.x / ship.cols) * 100}%`;
      tile.style.top = `${(placed.y / ship.rows) * 100}%`;
      tile.style.width = `${(bounds.width / ship.cols) * 100}%`;
      tile.style.height = `${(bounds.height / ship.rows) * 100}%`;

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

      const originPill = document.createElement('span');
      originPill.className = `v2-origin-badge origin-${placed.item.origin}`;
      originPill.textContent = originTagText(placed.item.origin);
      originPill.title = originFullLabel(placed.item.origin);
      tile.appendChild(originPill);

      if (placed.item.category === 'equipment') {
        const qPill = document.createElement('span');
        qPill.className = `v2-quality-notch ${
          placed.item.quality === 'improved' ? 'improved' : 'common'
        }`;
        qPill.textContent = isPowerBoosted
          ? `⚡${placed.item.quality === 'improved' ? '良' : '普'}`
          : placed.item.quality === 'improved'
          ? '良'
          : '普';
        tile.appendChild(qPill);
      } else if (placed.item.category === 'gadget') {
        const gPill = document.createElement('span');
        gPill.className = 'v2-quality-notch gadget';
        gPill.textContent = '耗';
        tile.appendChild(gPill);
      }

      const labelEl = document.createElement('span');
      labelEl.className = 'placed-label';
      labelEl.textContent =
        placed.item.category === 'cargo' && placed.item.fixedValue > 0
          ? `${placed.item.fixedValue}¤`
          : placed.item.category === 'mission'
          ? '任务'
          : placed.item.category === 'gadget'
          ? def.shortName
          : def.name.slice(0, 4);
      tile.appendChild(labelEl);

      this.itemLayerEl.appendChild(tile);
      this.placedTileElements.set(placed.item.instanceId, tile);
    }
  }

  private computeProspectiveHoverSynergy(): {
    readonly bay: V2CargoBayState;
    readonly stats: ReturnType<typeof calculateV2BuildStats>;
    readonly activeItemId: string;
    readonly hoverKey: string;
  } | null {
    if (!this.bay || !this.editable) return null;
    let candidateItem: V2ItemInstance | null = null;
    let candidateZone: 'grid' | 'staging' = 'grid';
    let candidateX: number | null = null;
    let candidateY: number | null = null;
    let candidateRot: V2Rotation = 0;

    if (this.drag?.active && this.drag.hoverOriginX !== null && this.drag.hoverOriginY !== null) {
      candidateItem = this.drag.item;
      candidateZone = this.drag.zone;
      candidateX = this.drag.hoverOriginX;
      candidateY = this.drag.hoverOriginY;
      candidateRot = this.drag.rotation;
    } else if (this.carrying && this.gridHasFocus) {
      const sel = this.getSelectedItemInfo();
      if (sel) {
        candidateItem = sel.item;
        candidateZone = sel.zone;
        candidateX = this.focusedCell.x;
        candidateY = this.focusedCell.y;
        candidateRot = sel.rotation;
      }
    }

    if (!candidateItem || candidateX === null || candidateY === null) return null;

    const chk = validateV2Placement(
      this.bay,
      candidateItem.definitionId,
      candidateX,
      candidateY,
      candidateRot,
      candidateZone === 'grid' ? candidateItem.instanceId : undefined
    );
    if (!chk.valid) return null;

    const nextPlaced: V2PlacedItem[] =
      candidateZone === 'grid'
        ? this.bay.placed.map((p) =>
            p.item.instanceId === candidateItem!.instanceId
              ? { ...p, x: candidateX!, y: candidateY!, rotation: candidateRot }
              : p
          )
        : [
            ...this.bay.placed,
            {
              item: { ...candidateItem, location: 'bay' },
              x: candidateX,
              y: candidateY,
              rotation: candidateRot,
            },
          ];

    const prospectiveBay: V2CargoBayState = { ...this.bay, placed: nextPlaced };
    // S07: Strictly fast pure calculateV2BuildStats ONLY — ZERO simulateV2Combat calls during drag/hover!
    const stats = calculateV2BuildStats(prospectiveBay);
    return {
      bay: prospectiveBay,
      stats,
      activeItemId: candidateItem.instanceId,
      hoverKey: `${candidateItem.instanceId}@${candidateX},${candidateY},${candidateRot}`,
    };
  }

  private renderSynergySvg(
    bay: V2CargoBayState | null = this.bay,
    stats: ReturnType<typeof calculateV2BuildStats> | null = this.lastStats
  ): void {
    const svg = this.synergySvgEl;
    if (!svg || !bay || !stats) return;

    const prospective = this.computeProspectiveHoverSynergy();
    const effectiveBay = prospective ? prospective.bay : bay;
    const effectiveStats = prospective ? prospective.stats : stats;
    const previewItemId = prospective ? prospective.activeItemId : null;

    // Update live hover partner highlights on placed tiles
    this.previewPartnerIds.clear();
    if (previewItemId) {
      for (const lnk of effectiveStats.links) {
        if (lnk.sourceInstanceId === previewItemId) {
          this.previewPartnerIds.add(lnk.targetInstanceId);
        } else if (lnk.targetInstanceId === previewItemId) {
          this.previewPartnerIds.add(lnk.sourceInstanceId);
        }
      }
    }
    this.placedTileElements.forEach((tile, instanceId) => {
      tile.classList.toggle('synergy-preview-partner', this.previewPartnerIds.has(instanceId));
    });

    if (effectiveStats.links.length === 0) {
      if (this.lastSynergyRenderKey !== 'empty') {
        svg.innerHTML = '';
        svg.style.display = 'none';
        this.lastSynergyRenderKey = 'empty';
      }
      return;
    }

    const focusIds = new Set<string>();
    if (this.selected?.zone === 'grid') focusIds.add(this.selected.instanceId);
    if (this.drag?.active) focusIds.add(this.drag.item.instanceId);
    if (previewItemId) focusIds.add(previewItemId);
    if (this.lastSnappedId) focusIds.add(this.lastSnappedId);

    const renderKey = `${this.lastBayCombatHash}|${prospective?.hoverKey ?? 'base'}|${[...focusIds]
      .sort()
      .join(',')}|${effectiveStats.links.length}`;
    if (renderKey === this.lastSynergyRenderKey) return;
    this.lastSynergyRenderKey = renderKey;

    const ship = V2_SHIPS[effectiveBay.shipId];
    svg.setAttribute('viewBox', `0 0 ${ship.cols * 100} ${ship.rows * 100}`);
    svg.style.display = '';
    svg.innerHTML = '';

    const centerOf = (instanceId: string): { x: number; y: number } | null => {
      const p = effectiveBay.placed.find((item) => item.item.instanceId === instanceId);
      if (!p) return null;
      const cells = getV2PlacedCells(p);
      if (cells.length === 0) return null;
      const avgX = cells.reduce((acc, c) => acc + c.x + 0.5, 0) / cells.length;
      const avgY = cells.reduce((acc, c) => acc + c.y + 0.5, 0) / cells.length;
      return { x: avgX * 100, y: avgY * 100 };
    };

    const seamMidpointOf = (idA: string, idB: string): { x: number; y: number } | null => {
      const pA = effectiveBay.placed.find((item) => item.item.instanceId === idA);
      const pB = effectiveBay.placed.find((item) => item.item.instanceId === idB);
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

    for (const lnk of effectiveStats.links) {
      const p1 = centerOf(lnk.sourceInstanceId);
      const p2 = centerOf(lnk.targetInstanceId);
      const seam = seamMidpointOf(lnk.sourceInstanceId, lnk.targetInstanceId);
      if (!p1 || !p2) continue;
      const col = computeSynergyColor(lnk.sourceKind);
      const isPreviewLink =
        previewItemId !== null &&
        (lnk.sourceInstanceId === previewItemId || lnk.targetInstanceId === previewItemId);
      const highlighted =
        isPreviewLink || focusIds.has(lnk.sourceInstanceId) || focusIds.has(lnk.targetInstanceId);

      if (highlighted) {
        const glow = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        glow.setAttribute('x1', String(p1.x));
        glow.setAttribute('y1', String(p1.y));
        glow.setAttribute('x2', String(p2.x));
        glow.setAttribute('y2', String(p2.y));
        glow.setAttribute('stroke', col);
        glow.setAttribute('stroke-width', isPreviewLink ? '12' : '10');
        glow.setAttribute('stroke-linecap', 'round');
        glow.setAttribute('opacity', isPreviewLink ? '0.38' : '0.26');
        svg.appendChild(glow);

        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('class', isPreviewLink ? 'energy-link-line is-preview' : 'energy-link-line');
        if (isPreviewLink) {
          line.setAttribute('data-link-preview', 'true');
        }
        if (typeof line.style?.setProperty === 'function') {
          line.style.setProperty('--link-color', col);
        } else {
          line.setAttribute('style', `--link-color:${col};`);
        }
        line.setAttribute('x1', String(p1.x));
        line.setAttribute('y1', String(p1.y));
        line.setAttribute('x2', String(p2.x));
        line.setAttribute('y2', String(p2.y));
        line.setAttribute('stroke', col);
        line.setAttribute('stroke-width', isPreviewLink ? '5' : '4.5');
        line.setAttribute('stroke-linecap', 'round');
        line.setAttribute('stroke-dasharray', '10 6');
        line.setAttribute('opacity', '0.96');
        svg.appendChild(line);

        const midX = seam ? seam.x : (p1.x + p2.x) * 0.5;
        const midY = seam ? seam.y : (p1.y + p2.y) * 0.5;
        const pill = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        const pillW = Math.max(46, lnk.label.length * 16 + 16);
        pill.setAttribute('x', String(midX - pillW * 0.5));
        pill.setAttribute('y', String(midY - 14));
        pill.setAttribute('width', String(pillW));
        pill.setAttribute('height', '28');
        pill.setAttribute('rx', '2');
        pill.setAttribute('fill', '#0D1726');
        pill.setAttribute('stroke', col);
        pill.setAttribute('stroke-width', '2.5');
        if (isPreviewLink) {
          pill.setAttribute('data-link-preview', 'true');
        }
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
  }

  private renderStagingTray(bay: V2CargoBayState, editable: boolean): void {
    if (!this.stagingEl) return;
    if (this.prepareMode || (bay.staging.length === 0 && bay.discardedThisArrange.length === 0)) {
      this.stagingEl.style.display = 'none';
      this.stagingEl.innerHTML = '';
      this.stagingChipElements.clear();
      return;
    }

    this.stagingEl.style.display = '';
    this.stagingEl.innerHTML = '';
    this.stagingChipElements.clear();

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
    this.stagingEl.appendChild(head);

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
        list.appendChild(chip);
        this.stagingChipElements.set(st.item.instanceId, chip);
      }
      this.stagingEl.appendChild(list);
    }
  }

  private updateSelectionAndDragClasses(): void {
    this.placedTileElements.forEach((tile, instanceId) => {
      const isSelected = this.selected?.zone === 'grid' && this.selected.instanceId === instanceId;
      const isDraggingThis = Boolean(
        this.drag?.active && this.drag.zone === 'grid' && this.drag.item.instanceId === instanceId
      );
      const isSnapped = this.lastSnappedId === instanceId;
      tile.classList.toggle('selected', isSelected);
      tile.classList.toggle('dragging-source', isDraggingThis);
      tile.classList.toggle('just-snapped', isSnapped);
    });
    this.stagingChipElements.forEach((chip, instanceId) => {
      const isSelected = this.selected?.zone === 'staging' && this.selected.instanceId === instanceId;
      chip.classList.toggle('selected', isSelected);
    });
  }

  private updateRecommendedCells(delta: V2TacticalDelta | null): void {
    this.recommendedCellKeys.clear();
    // S07: recommendedSpot is strictly OPT-IN (OFF by default until player enables 推荐提示)
    if (!this.editable || !this.showRecommendHint || !delta?.recommendedSpot) return;
    const sel = this.getSelectedItemInfo();
    if (!sel) return;
    const sDef = getAnyV2ItemDef(sel.item.definitionId);
    if (!sDef) return;
    const recCells = getV2OccupiedCells(
      sDef.shapeId,
      delta.recommendedSpot.x,
      delta.recommendedSpot.y,
      delta.recommendedSpot.rotation
    );
    for (const rc of recCells) {
      this.recommendedCellKeys.add(`${rc.x},${rc.y}`);
    }
  }

  private computeSelectedItemMetaKey(): string {
    const sel = this.getSelectedItemInfo();
    if (!sel) return 'none';
    return `${sel.zone}:${sel.item.instanceId}:${sel.item.definitionId}:${sel.item.category}:${sel.item.quality}:${sel.item.origin}:${sel.item.fixedValue}`;
  }

  private scheduleTacticalDeltaUpdate(): void {
    if (this.drag) return;
    const sel = this.getSelectedItemInfo();
    const provider = this.callbacks.getTacticalDelta;
    if (!this.bay || !sel || !provider) return;

    this.cancelPendingDeltaJob();
    const token = this.deltaJobToken;
    const expectedBayHash = this.lastBayCombatHash;
    const expectedSelZone = sel.zone;
    const expectedSelId = sel.item.instanceId;
    const expectedSelItem = sel.item;
    const expectedSelMetaKey = this.computeSelectedItemMetaKey();
    const expectedDeltaKey = `${expectedBayHash}|${expectedSelMetaKey}`;

    let jobRan = false;
    const runJob = (): void => {
      if (this.destroyed || token !== this.deltaJobToken) return;
      if (this.drag) {
        this.pendingDeltaHandle = null;
        return;
      }
      jobRan = true;
      this.pendingDeltaHandle = null;
      if (!this.bay || this.lastBayCombatHash !== expectedBayHash) return;
      if (
        !this.selected ||
        this.selected.zone !== expectedSelZone ||
        this.selected.instanceId !== expectedSelId ||
        this.computeSelectedItemMetaKey() !== expectedSelMetaKey
      ) {
        return;
      }
      const delta = provider(expectedSelItem, expectedSelZone);
      if (
        this.destroyed ||
        token !== this.deltaJobToken ||
        !this.bay ||
        this.lastBayCombatHash !== expectedBayHash ||
        !this.selected ||
        this.selected.zone !== expectedSelZone ||
        this.selected.instanceId !== expectedSelId ||
        this.computeSelectedItemMetaKey() !== expectedSelMetaKey
      ) {
        return;
      }
      this.activeDelta = delta;
      this.activeDeltaKey = expectedDeltaKey;
      this.updateRecommendedCells(delta);
      this.renderSelectedInspector(this.editable, delta);
      this.updateCellVisualFocusAndPreview();
    };

    const handle = this.scheduleIdle(runJob);
    if (!jobRan && !this.destroyed && token === this.deltaJobToken) {
      this.pendingDeltaHandle = handle;
    }
  }

  private selectItem(
    nextSel: SelectedRef | null,
    opts?: { readonly playSfx?: boolean; readonly clearSnap?: boolean }
  ): void {
    if (!this.bay) return;
    const nextKey = nextSel ? `${nextSel.zone}:${nextSel.instanceId}` : 'none';
    if (nextKey === this.renderedSelectedKey) return;

    this.selected = nextSel;
    this.showItemDetailsDrawer = false;
    this.renderedSelectedKey = nextKey;
    this.lastSelectedItemMetaKey = this.computeSelectedItemMetaKey();
    if (opts?.clearSnap !== false) {
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
    }
    if (opts?.playSfx) {
      soundEngine.play(this.editable ? 'pickup' : 'click');
    }

    this.updateSelectionAndDragClasses();
    this.renderSynergySvg();

    this.cancelPendingDeltaJob();
    this.activeDelta = null;
    this.activeDeltaKey = null;
    this.recommendedCellKeys.clear();
    this.syncInspectorHost();
    this.renderSelectedInspector(this.editable, null);
    if (nextSel && this.callbacks.getTacticalDelta) {
      this.scheduleTacticalDeltaUpdate();
    }
    this.updateCellVisualFocusAndPreview();
  }

  private syncInspectorHost(): void {
    if (!this.inspectorEl) return;
    const externalHost = this.callbacks.getInspectorHost?.() ?? null;
    if (this.lastExternalInspectorHost && this.lastExternalInspectorHost !== externalHost) {
      if (this.inspectorEl.parentNode === this.lastExternalInspectorHost) {
        this.lastExternalInspectorHost.removeChild(this.inspectorEl);
      }
      this.lastExternalInspectorHost.innerHTML = '';
    }
    this.lastExternalInspectorHost = externalHost;
    if (externalHost) {
      if (this.inspectorEl.parentNode !== externalHost) {
        externalHost.innerHTML = '';
        externalHost.appendChild(this.inspectorEl);
      }
    } else if (this.inspectorEl.parentNode !== this.root) {
      this.root.appendChild(this.inspectorEl);
    }
  }

  private renderSelectedInspector(editable: boolean, delta: V2TacticalDelta | null): void {
    if (!this.inspectorEl) return;
    const box = this.inspectorEl;
    const sel = this.getSelectedItemInfo();

    if (!sel) {
      const emptyKey = `empty|e=${editable ? 1 : 0}|pm=${this.prepareMode ? 1 : 0}`;
      if (this.lastInspectorStateKey === emptyKey) return;
      this.lastInspectorStateKey = emptyKey;
      box.style.display = '';
      box.innerHTML = `<div class="inspector-empty">${
        editable
          ? this.prepareMode
            ? '点选舱内设备微调位置与旋转，或从左侧选件装入船舱（快捷键：方向键 / 回车 / R）。'
            : '点选或拖拽整理船舱（快捷键：方向键移格 · 回车拿放 · R 旋转 · Del 舍弃）。'
          : '点击任意已装设备查看联动与战力变化。'
      }</div>`;
      return;
    }

    const def = getAnyV2ItemDef(sel.item.definitionId);
    if (!def) {
      this.lastInspectorStateKey = 'missing_def';
      box.innerHTML = '';
      box.style.display = 'none';
      return;
    }

    const isSelectedPowerBoosted =
      sel.zone === 'grid' &&
      this.lastStats !== null &&
      this.lastStats.powerCellBoostedIds.includes(sel.item.instanceId);
    const hasPrepareRemove = Boolean(this.callbacks.onPrepareRemoveItem);
    let sacrificeText = '';
    if (editable && !this.prepareMode && this.bay) {
      if (sel.zone === 'grid' && sel.item.category !== 'mission') {
        const pv = computeV2ItemSacrificePreview(this.bay, sel.item.instanceId);
        if (pv) {
          sacrificeText = `若舍弃，将损失：${pv.fullLabel}`;
        }
      } else if (
        sel.zone === 'staging' &&
        (sel.item.category === 'mission' || sel.item.origin === 'mission')
      ) {
        const missionSummary = summarizeV2MissionSacrificeOptions(this.bay);
        if (missionSummary?.needsSpace && missionSummary.summaryText) {
          sacrificeText = `腾舱${missionSummary.summaryText}`;
        }
      }
    }

    const deltaKeyPart = delta
      ? `${delta.positiveImpact ? 1 : 0}|${delta.synergyLine}|${delta.qualitativeDeltaLine ?? delta.combatDeltaLine}|${
          delta.trendDirection ?? ''
        }|${delta.afterThreat ?? ''}|${delta.detailSummary ?? ''}|${delta.spaceLine}|${
          delta.recommendedSpot
            ? `${delta.recommendedSpot.x},${delta.recommendedSpot.y},${delta.recommendedSpot.rotation}`
            : ''
        }`
      : 'pending';
    const stateKey = `sel|${sel.zone}:${sel.item.instanceId}:${sel.item.definitionId}:${sel.item.category}:${
      sel.item.quality
    }:${sel.item.origin}:${sel.item.fixedValue}|e=${editable ? 1 : 0}|pm=${
      this.prepareMode ? 1 : 0
    }|pr=${hasPrepareRemove ? 1 : 0}|pb=${isSelectedPowerBoosted ? 1 : 0}|idw=${
      this.showItemDetailsDrawer ? 1 : 0
    }|rh=${this.showRecommendHint ? 1 : 0}|d=${deltaKeyPart}|sac=${sacrificeText}`;
    if (this.lastInspectorStateKey === stateKey) return;
    this.lastInspectorStateKey = stateKey;
    box.style.display = '';

    const eqDef = sel.item.category === 'equipment' ? V2_EQUIPMENT_DEFS[sel.item.definitionId] : undefined;

    const layer1SynergyLine = delta
      ? this.showRecommendHint
        ? delta.synergyLine
        : delta.synergyLine
            .replace('推荐格位可触发联动', '贴邻配对可触发联动')
            .replace('移至高亮位即可激活联动！', '拖至正交相邻格即可激活联动')
      : '';
    const layer1DeltaLine = delta ? delta.qualitativeDeltaLine ?? delta.combatDeltaLine : '';
    const trendBadgeHtml =
      delta?.trendDirection
        ? `<span class="v3-trend-badge trend-${delta.trendDirection}" data-trend="${delta.trendDirection}">${
            delta.trendDirection === 'up' ? '↑ 提升' : delta.trendDirection === 'down' ? '↓ 下降' : '= 持平'
          }</span>`
        : '';
    const afterThreatMeta = delta?.afterThreat ? getV2ThreatTierMeta(delta.afterThreat) : null;
    const afterThreatHtml = afterThreatMeta
      ? `<span class="v3-threat-pill threat-${afterThreatMeta.tier}" data-threat-tier="${afterThreatMeta.tier}">${afterThreatMeta.symbol} ${afterThreatMeta.label}</span>`
      : '';
    const itemDetailsToggleHtml = delta?.detailSummary
      ? `<div class="v3-item-details-wrap">
          <button type="button" class="btn btn-sm btn-ghost v3-item-details-toggle" id="btn-v2-delta-details" data-testid="btn-toggle-item-details" aria-expanded="${
            this.showItemDetailsDrawer ? 'true' : 'false'
          }">${this.showItemDetailsDrawer ? '收起推演明细' : '明细（不干预结果）'}</button>
          ${
            this.showItemDetailsDrawer
              ? `<div class="v3-item-details-drawer" data-testid="item-details-drawer">${delta.detailSummary}</div>`
              : ''
          }
        </div>`
      : '';

    const deltaHtml = delta
      ? `<div class="v2-delta-strip ${delta.positiveImpact ? 'positive' : ''}" data-testid="tactical-delta">
          <div class="v2-delta-row"><span class="v2-delta-k">联动</span><span>${layer1SynergyLine}</span></div>
          <div class="v2-delta-row"><span class="v2-delta-k">趋势</span><span class="v3-delta-qual-wrap">${trendBadgeHtml}${afterThreatHtml}<strong>${layer1DeltaLine}</strong></span></div>
          <div class="v2-delta-row"><span class="v2-delta-k">舱位</span><span>${delta.spaceLine}</span></div>
          ${itemDetailsToggleHtml}
        </div>`
      : `<div class="inspector-desc">${def.summary}${
          sel.item.fixedValue > 0 ? ` · 回收估价 <strong>${sel.item.fixedValue}¤</strong>` : ''
        }</div>`;

    const sacrificeHtml = sacrificeText
      ? `<div class="v2-sacrifice-preview" data-testid="sacrifice-preview">${sacrificeText}</div>`
      : '';

    const showOptInRecommendedBtn = Boolean(this.showRecommendHint && delta?.recommendedSpot);

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
                : sel.item.category === 'gadget'
                ? `<span class="v2-quality-chip common">一次性装置</span>`
                : ''
            }
            ${
              isSelectedPowerBoosted
                ? `<span class="v3-power-boost-chip">⚡ 供能格强化</span>`
                : ''
            }
          </div>
          ${deltaHtml}
          ${sacrificeHtml}
        </div>
      </div>
      ${
        editable
          ? `<div class="inspector-actions">
              <button type="button" class="btn btn-sm btn-secondary" id="btn-v2-rotate">↻ 旋转 (R)</button>
              <button type="button" class="btn btn-sm ${
                this.showRecommendHint ? 'btn-secondary active' : 'btn-ghost'
              }" id="btn-v2-toggle-recommend" data-testid="btn-toggle-recommend-hint" aria-pressed="${
                this.showRecommendHint ? 'true' : 'false'
              }">${this.showRecommendHint ? '✦ 隐藏推荐' : '✦ 推荐提示'}</button>
              ${
                sel.zone === 'staging'
                  ? `<button type="button" class="btn btn-sm btn-primary" id="btn-v2-autoplace" ${
                      showOptInRecommendedBtn ? 'data-testid="btn-install-recommended"' : ''
                    }>${showOptInRecommendedBtn ? '↓ 装入推荐位' : '↓ 放入船舱'}</button>`
                  : showOptInRecommendedBtn
                  ? `<button type="button" class="btn btn-sm btn-primary" id="btn-v2-apply-recommended" data-testid="btn-install-recommended">↓ 装入推荐位</button>`
                  : ''
              }
              ${
                sel.zone === 'grid'
                  ? this.prepareMode
                    ? hasPrepareRemove
                      ? `<button type="button" class="btn btn-sm btn-danger" id="btn-v2-prep-remove">✕ 移出配装</button>`
                      : `<span class="v2-origin-chip origin-loan" style="align-self:center;">全息模板锁定 · 可拖动/旋转</span>`
                    : `<button type="button" class="btn btn-sm btn-ghost" id="btn-v2-to-staging">↑ 移至暂存</button>`
                  : ''
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
      this.pendingSnapFeedback = true;
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
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
      this.selected = null;
      this.carrying = false;
      soundEngine.play('clampPop');
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
      this.pendingSnapFeedback = true;
      this.selected = { zone: 'grid', instanceId: sel.item.instanceId };
      this.carrying = false;
      soundEngine.play(isHeavyPlacementItem(sel.item) ? 'placeHeavy' : 'place');
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
    this.pendingSnapFeedback = true;
    this.carrying = false;
    soundEngine.play(isHeavyPlacementItem(sel.item) ? 'placeHeavy' : 'place');
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
    const hasPreview = preview !== null;
    this.cellElements.forEach((cellEl) => {
      const cx = Number(cellEl.dataset.cx);
      const cy = Number(cellEl.dataset.cy);
      const isRoving = this.focusedCell.x === cx && this.focusedCell.y === cy;
      const nextTabIndex = isRoving ? 0 : -1;
      if (cellEl.tabIndex !== nextTabIndex) {
        cellEl.tabIndex = nextTabIndex;
      }
      cellEl.classList.toggle('kb-focused', isRoving && this.gridHasFocus);

      const disabled = isCellDisabledForShip(this.bay!.shipId, cx, cy);
      const isPowerCell = !disabled && isCellPowerCellForShip(this.bay!.shipId, cx, cy);
      const isRecommended =
        !disabled && !hasPreview && this.editable && this.recommendedCellKeys.has(`${cx},${cy}`);
      cellEl.classList.toggle('cell-recommended', isRecommended);

      let nextPreviewValid = false;
      let nextPreviewInvalid = false;
      let desiredMark: 'bulkhead' | 'power' | 'valid' | 'invalid' | 'empty' = disabled
        ? 'bulkhead'
        : isPowerCell
        ? 'power'
        : 'empty';

      if (preview) {
        const inCells = preview.cells.some((c) => c.x === cx && c.y === cy);
        const inConf = preview.conflictCells.some((c) => c.x === cx && c.y === cy);
        if (preview.valid && inCells) {
          nextPreviewValid = true;
          desiredMark = 'valid';
        } else if (!preview.valid && (inConf || inCells)) {
          nextPreviewInvalid = true;
          if (inConf && !disabled) {
            desiredMark = 'invalid';
          }
        }
      }

      cellEl.classList.toggle('preview-valid', nextPreviewValid);
      cellEl.classList.toggle('preview-invalid', nextPreviewInvalid);

      if (cellEl.dataset.markState !== desiredMark) {
        cellEl.dataset.markState = desiredMark;
        if (desiredMark === 'bulkhead') {
          cellEl.innerHTML = `<span class="v2-bulkhead-mark" aria-hidden="true">✕</span>`;
        } else if (desiredMark === 'power') {
          cellEl.innerHTML = `<span class="v3-power-cell-mark" aria-hidden="true">⚡</span>`;
        } else if (desiredMark === 'valid') {
          cellEl.innerHTML = `<span class="cargo-cell-mark">✓</span>`;
        } else if (desiredMark === 'invalid') {
          cellEl.innerHTML = `<span class="cargo-cell-mark">✕</span>`;
        } else {
          cellEl.innerHTML = '';
        }
      }
    });
  }

  private moveKeyboardFocus(dx: number, dy: number): void {
    if (!this.bay) return;
    const ship = V2_SHIPS[this.bay.shipId];
    this.focusedCell = {
      x: (this.focusedCell.x + dx + ship.cols) % ship.cols,
      y: (this.focusedCell.y + dy + ship.rows) % ship.rows,
    };
    this.updateCellVisualFocusAndPreview();
    if (this.carrying) {
      const pv = this.computeActivePreview();
      if (pv?.valid) {
        soundEngine.play('hoverValid');
      }
      this.renderSynergySvg();
    }
    const targetCell = this.cellElements.get(`${this.focusedCell.x},${this.focusedCell.y}`);
    if (targetCell && document.activeElement !== targetCell) {
      targetCell.focus({ preventScroll: true });
    }
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
    if (this.destroyed) return;
    this.invalidToastText = reasonToZh(reason);
    soundEngine.play('invalid');
    if (this.invalidToastTimer !== null) {
      globalThis.clearTimeout(this.invalidToastTimer);
    }
    this.invalidToastTimer = globalThis.setTimeout(() => {
      if (this.destroyed) return;
      this.invalidToastText = null;
      this.invalidToastTimer = null;
      this.renderToast();
    }, 1500);
    this.renderToast();
  }

  private getBoardCellMetrics(): {
    readonly rect: DOMRect | null;
    readonly cellW: number;
    readonly cellH: number;
  } {
    if (this.boardEl && this.bay) {
      const rect = this.boardEl.getBoundingClientRect();
      const ship = V2_SHIPS[this.bay.shipId];
      if (rect.width > 0 && rect.height > 0) {
        return { rect, cellW: rect.width / ship.cols, cellH: rect.height / ship.rows };
      }
    }
    return { rect: null, cellW: 64, cellH: 64 };
  }

  private ensureDragGhost(drag: DragState): HTMLElement {
    if (drag.ghostEl) return drag.ghostEl;
    const def = getAnyV2ItemDef(drag.item.definitionId);
    const shapeId = def?.shapeId ?? '1x1';
    const bounds = getV2ShapeBounds(shapeId, drag.rotation);
    const occupied = getV2OccupiedCells(shapeId, 0, 0, drag.rotation);
    const { cellW, cellH } = this.getBoardCellMetrics();
    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost v2-drag-ghost';
    ghost.dataset.shapeId = shapeId;
    ghost.dataset.rotation = String(drag.rotation);
    ghost.style.width = `${bounds.width * cellW}px`;
    ghost.style.height = `${bounds.height * cellH}px`;

    // S07: Render occupied-cell-only subcells so L3/T4 shapes preserve transparent cutouts!
    for (const c of occupied) {
      const sub = document.createElement('div');
      sub.className = 'drag-ghost-subcell';
      sub.dataset.subX = String(c.x);
      sub.dataset.subY = String(c.y);
      sub.style.left = `${(c.x / bounds.width) * 100}%`;
      sub.style.top = `${(c.y / bounds.height) * 100}%`;
      sub.style.width = `${(1 / bounds.width) * 100}%`;
      sub.style.height = `${(1 / bounds.height) * 100}%`;
      ghost.appendChild(sub);
    }

    const baseBounds = getV2ShapeBounds(shapeId, 0);
    const isSwapped = drag.rotation === 1 || drag.rotation === 3;
    const spriteWrap = document.createElement('div');
    spriteWrap.className = 'placed-sprite-wrap drag-ghost-sprite-wrap';
    const img = document.createElement('img');
    img.className = 'placed-sprite';
    img.src = getItemImageUrl(drag.item.definitionId);
    img.alt = '';
    img.draggable = false;
    if (isSwapped) {
      img.style.width = `${(baseBounds.width / bounds.width) * 100}%`;
      img.style.height = `${(baseBounds.height / bounds.height) * 100}%`;
      img.style.transform = `translate(-50%, -50%) rotate(${drag.rotation * 90}deg)`;
    } else {
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.transform = `translate(-50%, -50%) rotate(${drag.rotation * 90}deg)`;
    }
    spriteWrap.appendChild(img);
    ghost.appendChild(spriteWrap);

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

  private rescheduleDeltaIfIdle(): void {
    if (this.bay && this.selected && !this.activeDelta && !this.pendingDeltaHandle) {
      this.scheduleTacticalDeltaUpdate();
    }
  }

  public cancelActiveDrag(rescheduleDelta = true): void {
    this.flushSpringBackCleanups();
    if (this.destroyed || !this.drag) return;
    const wasActive = this.drag.active;
    this.clearDragGhost();
    this.drag = null;
    if (wasActive && this.bay) {
      this.updateSelectionAndDragClasses();
      this.updateCellVisualFocusAndPreview();
      this.renderSynergySvg();
    }
    if (rescheduleDelta) {
      this.rescheduleDeltaIfIdle();
    }
  }

  private containsTarget(container: HTMLElement | null, target: unknown): boolean {
    if (!container || !target) return false;
    if (container === target) return true;
    if (typeof container.contains === 'function') {
      try {
        if (container.contains(target as Node)) return true;
      } catch {
        // Fallback to parent chain traversal for lightweight DOM stubs
      }
    }
    let cur = target as { parentElement?: unknown; parentNode?: unknown } | null;
    while (cur) {
      if (cur === container) return true;
      cur = (cur.parentElement ?? cur.parentNode ?? null) as {
        parentElement?: unknown;
        parentNode?: unknown;
      } | null;
    }
    return false;
  }

  private handleWindowPointerDown = (e: PointerEvent): void => {
    if (this.destroyed || !this.drag) return;
    if (e.button !== undefined && e.button !== 0 && e.pointerType === 'mouse') return;
    const pointerId = e.pointerId ?? 0;
    if (pointerId !== this.drag.pointerId) return;
    if (this.containsTarget(this.boardEl, e.target) || this.containsTarget(this.stagingEl, e.target)) {
      return; // board/staging handlers recover with rescheduleDelta=false to preserve D8.4 0-sim gap
    }
    this.cancelActiveDrag(true);
  };

  private launchInvalidSpringBack(drag: DragState, isInvalidDrop: boolean): void {
    const ghost = drag.ghostEl;
    drag.ghostEl = null;
    const reducedMotion =
      typeof document !== 'undefined' && document.body.classList.contains('reduced-motion');

    if (!ghost) return;
    if (reducedMotion || !drag.sourceRect) {
      ghost.remove();
      return;
    }

    ghost.classList.remove('is-valid');
    ghost.classList.add('is-spring-back');
    if (isInvalidDrop) {
      ghost.classList.add('is-invalid');
    }
    ghost.dataset.springBack = 'true';
    ghost.style.left = `${drag.sourceRect.left}px`;
    ghost.style.top = `${drag.sourceRect.top}px`;
    ghost.style.opacity = '0.2';
    ghost.style.transform = 'scale(0.94)';

    const sourceEl =
      isInvalidDrop
        ? drag.zone === 'grid'
          ? this.placedTileElements.get(drag.item.instanceId) ?? null
          : this.stagingChipElements.get(drag.item.instanceId) ?? null
        : null;
    if (sourceEl) {
      sourceEl.classList.add('invalid-shake');
    }

    let cleaned = false;
    let timerId: ReturnType<typeof globalThis.setTimeout> | null = null;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      if (timerId !== null) {
        globalThis.clearTimeout(timerId);
        timerId = null;
      }
      ghost.remove();
      sourceEl?.classList.remove('invalid-shake');
      this.springBackCleanups.delete(cleanup);
    };

    timerId = globalThis.setTimeout(cleanup, 240);
    this.springBackCleanups.add(cleanup);
  }

  private handleBoardPointerDown = (e: PointerEvent): void => {
    if (this.destroyed || !this.bay || hasOpenModal()) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const pointerId = e.pointerId ?? 0;
    let recoveredDrag = false;
    if (this.drag) {
      if (pointerId !== this.drag.pointerId) return;
      this.cancelActiveDrag(false);
      recoveredDrag = true;
    }
    const cell = this.clientPointToCell(e.clientX, e.clientY);
    if (!cell) {
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }
    this.focusedCell = cell;

    if (isCellDisabledForShip(this.bay.shipId, cell.x, cell.y)) {
      this.showInvalidReason('disabled_cell');
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }

    const occupant = findV2ItemAtCell(this.bay, cell.x, cell.y);

    if (!this.editable) {
      if (occupant) {
        this.selectItem({ zone: 'grid', instanceId: occupant.item.instanceId }, { playSfx: false });
      }
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }

    if (occupant) {
      const isSameSelected =
        this.selected?.zone === 'grid' && this.selected.instanceId === occupant.item.instanceId;
      this.carrying = false;
      const def = getAnyV2ItemDef(occupant.item.definitionId);
      const bounds = getV2ShapeBounds(def?.shapeId ?? '1x1', occupant.rotation);
      const { rect, cellW, cellH } = this.getBoardCellMetrics();
      const tileW = bounds.width * cellW;
      const tileH = bounds.height * cellH;
      const tileLeft = rect ? rect.left + occupant.x * cellW : e.clientX - (cell.x - occupant.x + 0.5) * cellW;
      const tileTop = rect ? rect.top + occupant.y * cellH : e.clientY - (cell.y - occupant.y + 0.5) * cellH;
      const grabOffsetPxX = Math.max(0, Math.min(tileW, e.clientX - tileLeft));
      const grabOffsetPxY = Math.max(0, Math.min(tileH, e.clientY - tileTop));
      this.drag = {
        pointerId,
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
        grabOffsetPxX,
        grabOffsetPxY,
        sourceRect: { left: tileLeft, top: tileTop, width: tileW, height: tileH },
        active: false,
        hoverOriginX: occupant.x,
        hoverOriginY: occupant.y,
        lastValidHoverKey: null,
        ghostEl: null,
      };
      this.selectItem(
        { zone: 'grid', instanceId: occupant.item.instanceId },
        { playSfx: !isSameSelected }
      );
      return;
    }

    if (this.selected) {
      this.tryPlaceSelectedAt(cell.x, cell.y);
    }
    if (recoveredDrag) {
      this.rescheduleDeltaIfIdle();
    }
  };

  private handleStagingPointerDown = (ev: PointerEvent): void => {
    if (this.destroyed || !this.editable || !this.bay || hasOpenModal()) return;
    if (ev.button !== 0 && ev.pointerType === 'mouse') return;
    const pointerId = ev.pointerId ?? 0;
    let recoveredDrag = false;
    if (this.drag) {
      if (pointerId !== this.drag.pointerId) return;
      this.cancelActiveDrag(false);
      recoveredDrag = true;
    }
    const target = ev.target as HTMLElement | null;
    const chip = target?.closest<HTMLButtonElement>('[data-staging-id]');
    if (!chip) {
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }
    const stagingId = chip.dataset.stagingId;
    if (!stagingId) {
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }
    const st = this.bay.staging.find((item) => item.item.instanceId === stagingId);
    if (!st) {
      if (recoveredDrag) this.rescheduleDeltaIfIdle();
      return;
    }

    const def = getAnyV2ItemDef(st.item.definitionId);
    const bounds = getV2ShapeBounds(def?.shapeId ?? '1x1', st.rotation);
    const { cellW, cellH } = this.getBoardCellMetrics();
    const ghostW = bounds.width * cellW;
    const ghostH = bounds.height * cellH;
    const chipRect = chip.getBoundingClientRect();
    const sourceRect: DragSourceRect | null =
      chipRect.width > 0 && chipRect.height > 0
        ? { left: chipRect.left, top: chipRect.top, width: ghostW, height: ghostH }
        : { left: ev.clientX - ghostW * 0.5, top: ev.clientY - ghostH * 0.5, width: ghostW, height: ghostH };

    this.carrying = false;
    this.drag = {
      pointerId,
      pointerType: ev.pointerType,
      zone: 'staging',
      item: st.item,
      rotation: st.rotation,
      startClientX: ev.clientX,
      startClientY: ev.clientY,
      grabOffsetCellX: 0,
      grabOffsetCellY: 0,
      grabOffsetPxX: ghostW * 0.5,
      grabOffsetPxY: ghostH * 0.5,
      sourceRect,
      active: false,
      hoverOriginX: null,
      hoverOriginY: null,
      lastValidHoverKey: null,
      ghostEl: null,
    };
    this.selectItem({ zone: 'staging', instanceId: st.item.instanceId }, { playSfx: false });
  };

  private handleStagingClick = (ev: MouseEvent): void => {
    if (this.destroyed || !this.bay || this.drag) return;
    const target = ev.target as HTMLElement | null;
    const undoBtn = target?.closest<HTMLButtonElement>('#btn-v2-undo-discard');
    if (undoBtn) {
      if (!this.editable) return;
      const res = undoV2LastDiscard(this.bay);
      if (res.ok) {
        this.lastSnappedId = null;
        this.pendingSnapFeedback = false;
        soundEngine.play('pickup');
        this.callbacks.onBayChange(res.bay);
      }
      return;
    }

    const chip = target?.closest<HTMLButtonElement>('[data-staging-id]');
    if (!chip) return;
    const stagingId = chip.dataset.stagingId;
    if (!stagingId) return;
    const st = this.bay.staging.find((item) => item.item.instanceId === stagingId);
    if (!st) return;

    this.carrying = false;
    soundEngine.play('pickup');
    this.selectItem({ zone: 'staging', instanceId: st.item.instanceId }, { playSfx: false });
  };

  private handleInspectorClick = (ev: MouseEvent): void => {
    if (this.destroyed || !this.bay || this.drag) return;
    const target = ev.target as HTMLElement | null;
    const btn = target?.closest<HTMLButtonElement>('button[id]');
    if (!btn) return;
    const sel = this.getSelectedItemInfo();
    if (!sel) return;

    // S06: On-demand item details drawer works in both editable and read-only bays
    if (btn.id === 'btn-v2-delta-details') {
      this.showItemDetailsDrawer = !this.showItemDetailsDrawer;
      soundEngine.play('click');
      this.renderSelectedInspector(this.editable, this.activeDelta);
      return;
    }

    if (!this.editable) return;

    if (btn.id === 'btn-v2-toggle-recommend') {
      this.showRecommendHint = !this.showRecommendHint;
      soundEngine.play('click');
      this.updateRecommendedCells(this.activeDelta);
      this.renderSelectedInspector(this.editable, this.activeDelta);
      this.updateCellVisualFocusAndPreview();
      return;
    }
    if (btn.id === 'btn-v2-rotate') {
      this.rotateSelected();
      return;
    }
    if (btn.id === 'btn-v2-autoplace') {
      if (sel.zone !== 'staging') return;
      const spot =
        (this.showRecommendHint ? this.activeDelta?.recommendedSpot : null) ??
        findFirstLegalV2Placement(this.bay, sel.item.definitionId);
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
        this.pendingSnapFeedback = true;
        this.selected = { zone: 'grid', instanceId: sel.item.instanceId };
        soundEngine.play(isHeavyPlacementItem(sel.item) ? 'placeHeavy' : 'place');
        this.callbacks.onBayChange(res.bay);
      }
      return;
    }
    if (btn.id === 'btn-v2-apply-recommended') {
      if (sel.zone !== 'grid' || !this.showRecommendHint || !this.activeDelta?.recommendedSpot) return;
      const spot = this.activeDelta.recommendedSpot;
      const res = moveV2PlacedItem(this.bay, sel.item.instanceId, spot.x, spot.y, spot.rotation);
      if (res.ok) {
        this.lastSnappedId = sel.item.instanceId;
        this.pendingSnapFeedback = true;
        soundEngine.play(isHeavyPlacementItem(sel.item) ? 'placeHeavy' : 'place');
        this.callbacks.onBayChange(res.bay);
      } else {
        this.showInvalidReason('overlap');
      }
      return;
    }
    if (btn.id === 'btn-v2-to-staging') {
      if (sel.zone !== 'grid') return;
      const res = moveV2PlacedToStaging(this.bay, sel.item.instanceId);
      if (res.ok) {
        this.lastSnappedId = null;
        this.pendingSnapFeedback = false;
        this.selected = { zone: 'staging', instanceId: sel.item.instanceId };
        soundEngine.play('pickup');
        this.callbacks.onBayChange(res.bay);
      }
      return;
    }
    if (btn.id === 'btn-v2-prep-remove') {
      if (sel.zone !== 'grid') return;
      this.lastSnappedId = null;
      this.pendingSnapFeedback = false;
      this.selected = null;
      soundEngine.play('pickup');
      this.callbacks.onPrepareRemoveItem?.(sel.item.instanceId);
      return;
    }
    if (btn.id === 'btn-v2-discard') {
      this.discardSelected();
    }
  };

  private handleWindowPointerMove = (e: PointerEvent): void => {
    if (this.destroyed || !this.drag) return;
    if (hasOpenModal()) {
      this.cancelActiveDrag(true);
      return;
    }
    const pointerId = e.pointerId ?? 0;
    if (!this.bay || pointerId !== this.drag.pointerId) return;
    const dist = Math.hypot(e.clientX - this.drag.startClientX, e.clientY - this.drag.startClientY);
    let justActivated = false;
    if (!this.drag.active && dist >= 8) {
      this.drag.active = true;
      justActivated = true;
      this.cancelPendingDeltaJob();
      soundEngine.play('pickup');
    }
    if (!this.drag.active) return;

    const { rect, cellW, cellH } = this.getBoardCellMetrics();
    const liftY = this.drag.pointerType === 'touch' ? Math.max(56, Math.round(cellH * 0.85)) : 0;
    const ghost = this.ensureDragGhost(this.drag);
    const ghostLeft = e.clientX - this.drag.grabOffsetPxX;
    const ghostTop = e.clientY - liftY - this.drag.grabOffsetPxY;
    ghost.style.left = `${ghostLeft}px`;
    ghost.style.top = `${ghostTop}px`;
    ghost.classList.toggle('is-touch-lifted', this.drag.pointerType === 'touch');

    const hoverCell = this.clientPointToCell(e.clientX, e.clientY - liftY);
    if (hoverCell && rect && rect.width > 0 && rect.height > 0) {
      this.drag.hoverOriginX = Math.round((ghostLeft - rect.left) / cellW);
      this.drag.hoverOriginY = Math.round((ghostTop - rect.top) / cellH);
    } else if (hoverCell) {
      this.drag.hoverOriginX = hoverCell.x - this.drag.grabOffsetCellX;
      this.drag.hoverOriginY = hoverCell.y - this.drag.grabOffsetCellY;
    } else {
      this.drag.hoverOriginX = null;
      this.drag.hoverOriginY = null;
    }

    const preview = this.computeActivePreview();
    ghost.classList.toggle('is-valid', Boolean(preview?.valid));
    ghost.classList.toggle('is-invalid', Boolean(preview && !preview.valid));
    ghost.dataset.valid = preview ? (preview.valid ? 'true' : 'false') : 'none';

    if (preview?.valid && this.drag.hoverOriginX !== null && this.drag.hoverOriginY !== null) {
      const hoverKey = `${this.drag.hoverOriginX},${this.drag.hoverOriginY},${this.drag.rotation}`;
      if (hoverKey !== this.drag.lastValidHoverKey) {
        this.drag.lastValidHoverKey = hoverKey;
        soundEngine.play('hoverValid');
      }
    } else {
      this.drag.lastValidHoverKey = null;
    }

    if (justActivated) {
      this.updateSelectionAndDragClasses();
    }
    this.updateCellVisualFocusAndPreview();
    this.renderSynergySvg();
  };

  private handleWindowPointerUp = (e: PointerEvent): void => {
    if (this.destroyed || !this.drag) return;
    if (hasOpenModal()) {
      this.cancelActiveDrag(true);
      return;
    }
    const pointerId = e.pointerId ?? 0;
    if (pointerId !== this.drag.pointerId) return;
    const drag = this.drag;
    this.drag = null;

    if (!drag.active || !this.bay || !this.editable) {
      if (drag.ghostEl) {
        drag.ghostEl.remove();
        drag.ghostEl = null;
      }
      this.rescheduleDeltaIfIdle();
      return;
    }

    if (drag.hoverOriginX !== null && drag.hoverOriginY !== null) {
      const preCheck = validateV2Placement(
        this.bay,
        drag.item.definitionId,
        drag.hoverOriginX,
        drag.hoverOriginY,
        drag.rotation,
        drag.zone === 'grid' ? drag.item.instanceId : undefined
      );
      const ok = this.tryPlaceSelectedAt(drag.hoverOriginX, drag.hoverOriginY);
      this.callbacks.onDragAttempt?.({
        zone: drag.zone,
        itemDefId: drag.item.definitionId,
        success: ok,
        reason: ok ? undefined : preCheck.reason ?? 'overlap',
      });
      if (ok) {
        if (drag.ghostEl) {
          drag.ghostEl.remove();
          drag.ghostEl = null;
        }
        if (this.pendingSnapFeedback) {
          this.pendingSnapFeedback = false;
          this.updateSelectionAndDragClasses();
          this.updateCellVisualFocusAndPreview();
          this.renderSynergySvg();
        }
        this.rescheduleDeltaIfIdle();
      } else {
        this.launchInvalidSpringBack(drag, true);
        this.updateSelectionAndDragClasses();
        this.updateCellVisualFocusAndPreview();
        this.renderSynergySvg();
        this.rescheduleDeltaIfIdle();
      }
    } else {
      this.callbacks.onDragAttempt?.({
        zone: drag.zone,
        itemDefId: drag.item.definitionId,
        success: false,
        reason: 'outside_board',
      });
      this.launchInvalidSpringBack(drag, false);
      this.updateSelectionAndDragClasses();
      this.updateCellVisualFocusAndPreview();
      this.renderSynergySvg();
      this.rescheduleDeltaIfIdle();
    }
  };

  private handleWindowPointerCancel = (e?: PointerEvent): void => {
    if (this.destroyed || !this.drag) return;
    if (e && e.pointerId !== undefined && e.pointerId !== this.drag.pointerId) return;
    this.cancelActiveDrag(true);
  };

  private handleWindowBlur = (): void => {
    if (this.destroyed) return;
    this.cancelActiveDrag(true);
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    // Strictly isolated when ANY modal is open or grid is hidden/read-only (AC17/F01)!
    if (this.destroyed || hasOpenModal() || !this.bay || !this.editable) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    if (this.drag && e.key !== 'Escape') return;

    // Grid navigation when focus is on grid (zero DOM rebuilds & zero simulateV2Combat calls!)
    if (this.gridHasFocus) {
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        this.moveKeyboardFocus(1, 0);
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        this.moveKeyboardFocus(-1, 0);
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        this.moveKeyboardFocus(0, 1);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.moveKeyboardFocus(0, -1);
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
          this.carrying = true;
          this.selectItem({ zone: 'grid', instanceId: occ.item.instanceId }, { playSfx: false });
          soundEngine.play('pickup');
          this.updateCellVisualFocusAndPreview();
          this.renderSynergySvg();
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
            this.lastSnappedId = null;
            this.pendingSnapFeedback = false;
            this.selected = null;
            soundEngine.play('pickup');
            this.callbacks.onPrepareRemoveItem(sel.item.instanceId);
          }
        } else {
          this.discardSelected();
        }
      }
    } else if (e.key === 'Escape') {
      if (this.drag || this.carrying || this.selected) {
        e.preventDefault();
        const hadActiveDrag = Boolean(this.drag?.active);
        if (this.drag) {
          this.clearDragGhost();
          this.drag = null;
        }
        this.carrying = false;
        const hadSelection = this.selected !== null;
        this.selectItem(null, { playSfx: false, clearSnap: true });
        if (hadActiveDrag && !hadSelection) {
          this.updateSelectionAndDragClasses();
          this.renderSynergySvg();
        }
        this.updateCellVisualFocusAndPreview();
      }
    }
  };
}

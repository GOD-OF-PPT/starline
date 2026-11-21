import { getItemImageUrl } from '../assets/itemArt';
import { soundEngine } from '../audio/soundEngine';
import { getItemDef } from '../data/items';
import {
  GRID_SIZE,
  SHAPES,
  getOccupiedCells,
  getShapeBounds,
  type GridCoord,
  type Rotation,
} from '../data/shapes';
import { calculateBuildStats } from '../domain/buildStats';
import {
  checkPlacement,
  discardItem,
  findItemAtCell,
  getPlacedItemCells,
  movePlacedItem,
  movePlacedToStaging,
  placeFromStaging,
  rotatePlacedItemInPlace,
  rotateStagingItem,
  undoDiscard,
  type CargoBayState,
  type ItemInstance,
  type PlacementFailureReason,
} from '../domain/inventory';
import { hasOpenModal } from './Modals';

export interface CargoGridCallbacks {
  readonly onBayChange: (nextBay: CargoBayState) => void;
}

interface SelectedRef {
  readonly zone: 'grid' | 'staging';
  readonly instanceId: string;
}

interface DragState {
  readonly pointerId: number;
  readonly pointerType: string;
  readonly zone: 'grid' | 'staging';
  readonly item: ItemInstance;
  readonly rotation: Rotation;
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

function reasonToZh(reason?: PlacementFailureReason): string {
  switch (reason) {
    case 'out_of_bounds':
      return '越界：超出 4×4 船舱';
    case 'overlap':
      return '重叠：格子已被占用';
    case 'locked':
      return '当前阶段禁止修改船舱';
    default:
      return '无法放置';
  }
}

/**
 * Interactive 4x4 Cargo Bay supporting BOTH drag-and-drop (with touch finger lift & ghost outline)
 * AND tap-to-select / tap-to-place / rotate / discard / undo.
 * Hit testing strictly uses occupied cell masks (L3/T4 transparent cutouts NEVER block clicks!).
 */
export class CargoGridComponent {
  private readonly root: HTMLElement;
  private readonly callbacks: CargoGridCallbacks;

  private bay: CargoBayState | null = null;
  private editable = false;
  private selected: SelectedRef | null = null;
  private drag: DragState | null = null;
  private lastSnappedId: string | null = null;
  private invalidToastText: string | null = null;
  private invalidToastTimer: number | null = null;
  private prevLinkCount = 0;

  private boardEl: HTMLElement | null = null;

  constructor(root: HTMLElement, callbacks: CargoGridCallbacks) {
    this.root = root;
    this.callbacks = callbacks;
    window.addEventListener('pointermove', this.handleWindowPointerMove);
    window.addEventListener('pointerup', this.handleWindowPointerUp);
    window.addEventListener('pointercancel', this.handleWindowPointerCancel);
    window.addEventListener('keydown', this.handleKeyDown);
  }

  render(bay: CargoBayState, editable: boolean): void {
    this.bay = bay;
    this.editable = editable;

    // Validate selection still exists
    if (this.selected) {
      const exists =
        this.selected.zone === 'grid'
          ? bay.placed.some((p) => p.item.instanceId === this.selected?.instanceId)
          : bay.staging.some((s) => s.item.instanceId === this.selected?.instanceId);
      if (!exists) {
        this.selected = null;
      }
    }

    // Auto-select first staging item in ARRANGE mode if nothing is selected for instant 1-tap placement
    if (editable && !this.selected && bay.staging.length > 0) {
      this.selected = { zone: 'staging', instanceId: bay.staging[0].item.instanceId };
    }

    const stats = calculateBuildStats(bay);
    if (stats.links.length > this.prevLinkCount && this.prevLinkCount >= 0 && this.lastSnappedId) {
      soundEngine.play('energyLink');
    }
    this.prevLinkCount = stats.links.length;

    this.root.innerHTML = '';

    // 1. Live Stats Strip
    const statsStrip = document.createElement('div');
    statsStrip.className = 'stats-strip';
    statsStrip.innerHTML = `
      <div class="stat-chip">
        <span class="k">总攻击</span>
        <span class="v">${stats.totalAttack}</span>
        <span class="sub">${stats.batteryBonusAttack > 0 ? `电池 +${stats.batteryBonusAttack}` : `基础 ${stats.baseAttack}`}</span>
      </div>
      <div class="stat-chip">
        <span class="k">每战护盾</span>
        <span class="v">${stats.effectiveShield}</span>
        <span class="sub ${stats.shieldCapped ? 'cap' : ''}">${
      stats.shieldOverflow > 0
        ? `已达上限 (+${stats.shieldOverflow}溢出)`
        : stats.shieldCapped
        ? '已达上限'
        : '上限 18'
    }</span>
      </div>
      <div class="stat-chip">
        <span class="k">胜后维修</span>
        <span class="v">+${stats.effectiveRepair}</span>
        <span class="sub ${stats.repairCapped ? 'cap' : ''}">${
      stats.repairOverflow > 0
        ? `已达上限 (+${stats.repairOverflow}溢出)`
        : stats.repairCapped
        ? '已达上限'
        : '上限 4'
    }</span>
      </div>
      <div class="stat-chip">
        <span class="k">舱内估值</span>
        <span class="v">${stats.totalBayValue}</span>
        <span class="sub">${stats.occupiedCellCount}/16 格</span>
      </div>
    `;
    this.root.appendChild(statsStrip);

    // 2. 4x4 Grid Board
    const board = document.createElement('div');
    board.className = 'cargo-board-outer';
    board.setAttribute('role', 'grid');
    board.setAttribute('aria-label', '4乘4船舱拼装网格');
    this.boardEl = board;

    if (this.invalidToastText) {
      const toast = document.createElement('div');
      toast.className = 'drag-reason-toast';
      toast.textContent = this.invalidToastText;
      board.appendChild(toast);
    }

    // 2a. Background 16 cells
    const cellsWrap = document.createElement('div');
    cellsWrap.className = 'cargo-grid-cells';
    const preview = this.computeDragPreview();

    for (let y = 0; y < GRID_SIZE; y++) {
      for (let x = 0; x < GRID_SIZE; x++) {
        const cellEl = document.createElement('div');
        cellEl.className = 'cargo-cell';
        cellEl.dataset.cx = String(x);
        cellEl.dataset.cy = String(y);

        if (preview) {
          const inCells = preview.cells.some((c) => c.x === x && c.y === y);
          const inConflicts = preview.conflictCells.some((c) => c.x === x && c.y === y);
          if (preview.valid && inCells) {
            cellEl.classList.add('preview-valid');
            cellEl.innerHTML = `<span class="cargo-cell-mark">✓</span>`;
          } else if (!preview.valid && (inConflicts || inCells)) {
            cellEl.classList.add('preview-invalid');
            if (inConflicts) {
              cellEl.innerHTML = `<span class="cargo-cell-mark">✕</span>`;
            }
          }
        }
        cellsWrap.appendChild(cellEl);
      }
    }
    board.appendChild(cellsWrap);

    // 2b. Placed Items visual layer
    const itemLayer = document.createElement('div');
    itemLayer.className = 'cargo-item-layer';

    const laserBonusMap = new Map<string, number>();
    for (const lb of stats.laserBreakdowns) {
      laserBonusMap.set(lb.instanceId, lb.totalAttack);
    }

    for (const placed of bay.placed) {
      const def = getItemDef(placed.item.defId);
      const shape = SHAPES[def.shapeId];
      const bounds = getShapeBounds(def.shapeId, placed.rotation);
      const cells = getPlacedItemCells(placed);
      const isSelected =
        this.selected?.zone === 'grid' && this.selected.instanceId === placed.item.instanceId;
      const isDraggingThis =
        this.drag?.active && this.drag.item.instanceId === placed.item.instanceId;

      const node = document.createElement('div');
      node.className = 'placed-item-node';
      if (isDraggingThis) node.classList.add('dragging-origin');
      if (this.lastSnappedId === placed.item.instanceId) node.classList.add('snap-pop');

      node.style.left = `${(placed.x / GRID_SIZE) * 100}%`;
      node.style.top = `${(placed.y / GRID_SIZE) * 100}%`;
      node.style.width = `${(bounds.width / GRID_SIZE) * 100}%`;
      node.style.height = `${(bounds.height / GRID_SIZE) * 100}%`;

      // Canonical sprite rotated around its exact geometric center
      const imgWrap = document.createElement('div');
      imgWrap.className = 'placed-item-img-wrap';
      const wPct = (shape.canonicalWidth / bounds.width) * 100;
      const hPct = (shape.canonicalHeight / bounds.height) * 100;
      imgWrap.style.width = `${wPct}%`;
      imgWrap.style.height = `${hPct}%`;
      imgWrap.style.transform = `translate(-50%, -50%) rotate(${placed.rotation * 90}deg)`;

      const img = document.createElement('img');
      img.src = getItemImageUrl(placed.item.defId);
      img.alt = def.name;
      img.draggable = false;
      imgWrap.appendChild(img);
      node.appendChild(imgWrap);

      // Selection outlines strictly on occupied cells (never highlighting transparent L/T cutouts!)
      if (isSelected) {
        for (const c of cells) {
          const relX = c.x - placed.x;
          const relY = c.y - placed.y;
          const outline = document.createElement('div');
          outline.className = 'item-cell-outline selected';
          outline.style.left = `${(relX / bounds.width) * 100}%`;
          outline.style.top = `${(relY / bounds.height) * 100}%`;
          outline.style.width = `${(1 / bounds.width) * 100}%`;
          outline.style.height = `${(1 / bounds.height) * 100}%`;
          node.appendChild(outline);
        }
      }

      // Upright quality / borrowed / stat badges placed on first & last occupied cells
      const firstCell = cells[0];
      const lastCell = cells[cells.length - 1];

      if (def.category === 'equipment') {
        const qBadge = document.createElement('div');
        qBadge.className = 'item-upright-badge badge-top-left';
        qBadge.style.left = `calc(${((firstCell.x - placed.x) / bounds.width) * 100}% + 3px)`;
        qBadge.style.top = `calc(${((firstCell.y - placed.y) / bounds.height) * 100}% + 3px)`;
        const notchHtml =
          def.quality === 'improved'
            ? `<span class="quality-notches"><span class="quality-notch improved"></span><span class="quality-notch improved"></span></span>`
            : `<span class="quality-notches"><span class="quality-notch"></span></span>`;
        qBadge.innerHTML = placed.item.isBorrowed ? `${notchHtml}借` : notchHtml;
        node.appendChild(qBadge);

        const valBadge = document.createElement('div');
        valBadge.className = 'item-upright-badge badge-bottom-right badge-energy';
        valBadge.style.left = 'auto';
        valBadge.style.top = 'auto';
        valBadge.style.right = `calc(${
          ((bounds.width - 1 - (lastCell.x - placed.x)) / bounds.width) * 100
        }% + 3px)`;
        valBadge.style.bottom = `calc(${
          ((bounds.height - 1 - (lastCell.y - placed.y)) / bounds.height) * 100
        }% + 3px)`;

        if (def.kind === 'laser') {
          valBadge.textContent = `攻${laserBonusMap.get(placed.item.instanceId) ?? def.attackBonus}`;
        } else if (def.kind === 'battery') {
          valBadge.textContent = `+${def.adjacentLaserBonus}`;
        } else if (def.kind === 'shield') {
          valBadge.textContent = `盾${def.shieldBonus}`;
        } else {
          valBadge.textContent = `修${def.postVictoryRepair}`;
        }
        node.appendChild(valBadge);
      } else {
        const valBadge = document.createElement('div');
        valBadge.className = 'item-upright-badge badge-bottom-right badge-amber';
        valBadge.style.right = `calc(${
          ((bounds.width - 1 - (lastCell.x - placed.x)) / bounds.width) * 100
        }% + 3px)`;
        valBadge.style.bottom = `calc(${
          ((bounds.height - 1 - (lastCell.y - placed.y)) / bounds.height) * 100
        }% + 3px)`;
        valBadge.textContent = `${placed.item.value}¤`;
        node.appendChild(valBadge);

        if (def.isCollectible) {
          const cBadge = document.createElement('div');
          cBadge.className = 'item-upright-badge badge-top-left badge-amber';
          cBadge.style.left = `calc(${((firstCell.x - placed.x) / bounds.width) * 100}% + 3px)`;
          cBadge.style.top = `calc(${((firstCell.y - placed.y) / bounds.height) * 100}% + 3px)`;
          cBadge.textContent = '藏';
          node.appendChild(cBadge);
        }
      }

      itemLayer.appendChild(node);
    }
    board.appendChild(itemLayer);

    // 2c. Energy Adjacency Links SVG Overlay (only winning effective link per cannon!)
    if (stats.links.length > 0) {
      const svgNS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('class', 'energy-links-svg');
      svg.setAttribute('viewBox', '0 0 400 400');

      for (const link of stats.links) {
        const x1 = (link.batteryCell.x + 0.5) * 100;
        const y1 = (link.batteryCell.y + 0.5) * 100;
        const x2 = (link.laserCell.x + 0.5) * 100;
        const y2 = (link.laserCell.y + 0.5) * 100;
        const mx = (x1 + x2) / 2;
        const my = (y1 + y2) / 2;

        const line = document.createElementNS(svgNS, 'line');
        line.setAttribute('x1', String(x1));
        line.setAttribute('y1', String(y1));
        line.setAttribute('x2', String(x2));
        line.setAttribute('y2', String(y2));
        line.setAttribute('class', 'energy-link-line');
        svg.appendChild(line);

        const dot1 = document.createElementNS(svgNS, 'circle');
        dot1.setAttribute('cx', String(x1));
        dot1.setAttribute('cy', String(y1));
        dot1.setAttribute('r', '5');
        dot1.setAttribute('fill', '#62D6DF');
        svg.appendChild(dot1);

        const pill = document.createElementNS(svgNS, 'rect');
        pill.setAttribute('x', String(mx - 17));
        pill.setAttribute('y', String(my - 11));
        pill.setAttribute('width', '34');
        pill.setAttribute('height', '22');
        pill.setAttribute('rx', '6');
        pill.setAttribute('fill', '#111A29');
        pill.setAttribute('stroke', '#62D6DF');
        pill.setAttribute('stroke-width', '2');
        svg.appendChild(pill);

        const txt = document.createElementNS(svgNS, 'text');
        txt.setAttribute('x', String(mx));
        txt.setAttribute('y', String(my + 4));
        txt.setAttribute('text-anchor', 'middle');
        txt.setAttribute('fill', '#62D6DF');
        txt.setAttribute('font-size', '13');
        txt.setAttribute('font-weight', '700');
        txt.textContent = `+${link.bonus}`;
        svg.appendChild(txt);
      }

      board.appendChild(svg);
    }

    // Board pointerdown listener (mask-based hit detection!)
    board.addEventListener('pointerdown', this.handleBoardPointerDown);
    this.root.appendChild(board);

    // 3. Staging & Discard Undo Area (shown during ARRANGE or if staging non-empty)
    if (editable || bay.staging.length > 0) {
      this.renderStagingAndUndo(bay, editable);
    }

    // 4. Selected Item Inspector
    this.renderInspector(bay, editable);

    this.lastSnappedId = null;
  }

  private renderStagingAndUndo(bay: CargoBayState, editable: boolean): void {
    const wrap = document.createElement('div');
    wrap.className = `staging-bar ${bay.staging.length > 0 ? 'has-items' : ''}`;

    const head = document.createElement('div');
    head.className = 'panel-header';
    head.innerHTML = `
      <span style="font-size:13px;font-weight:700;color:${
        bay.staging.length > 0 ? 'var(--accent-action)' : 'var(--text-secondary)'
      }">
        暂存区 ${bay.staging.length > 0 ? `(${bay.staging.length} 件待放入或舍弃)` : '(空 · 可将舱内物品暂移此处腾位)'}
      </span>
    `;

    if (editable && bay.discardedThisArrange.length > 0) {
      const undoBtn = document.createElement('button');
      undoBtn.type = 'button';
      undoBtn.className = 'btn btn-compact';
      undoBtn.textContent = `撤销舍弃 (${bay.discardedThisArrange.length})`;
      undoBtn.onclick = () => {
        const res = undoDiscard(bay);
        if (res.ok) {
          soundEngine.play('click');
          this.callbacks.onBayChange(res.bay);
        }
      };
      head.appendChild(undoBtn);
    }

    wrap.appendChild(head);

    if (bay.staging.length > 0) {
      const list = document.createElement('div');
      list.className = 'staging-items';

      for (const st of bay.staging) {
        const def = getItemDef(st.item.defId);
        const shape = SHAPES[def.shapeId];
        const isSel =
          this.selected?.zone === 'staging' && this.selected.instanceId === st.item.instanceId;

        const chip = document.createElement('div');
        chip.className = `staging-chip ${isSel ? 'selected' : ''}`;
        chip.innerHTML = `
          <img src="${getItemImageUrl(st.item.defId)}" alt="${def.name}" style="transform: rotate(${
            st.rotation * 90
          }deg)" />
          <div style="display:flex;flex-direction:column;gap:2px;">
            <span style="font-size:13px;font-weight:700;">${def.name} ${
              def.category === 'equipment' ? `(${def.qualityLabel})` : ''
            }</span>
            <span style="font-size:12px;color:var(--text-secondary);">
              ${shape.label} · ${
                def.category === 'equipment' ? def.summary : `估值 ${st.item.value} 信用点`
              }
            </span>
          </div>
        `;

        chip.addEventListener('pointerdown', (e) => {
          if (!editable) return;
          e.preventDefault();
          soundEngine.unlock();
          this.selected = { zone: 'staging', instanceId: st.item.instanceId };
          this.drag = {
            pointerId: e.pointerId,
            pointerType: e.pointerType,
            zone: 'staging',
            item: st.item,
            rotation: st.rotation,
            startClientX: e.clientX,
            startClientY: e.clientY,
            grabOffsetCellX: 0,
            grabOffsetCellY: 0,
            active: false,
            hoverOriginX: null,
            hoverOriginY: null,
            ghostEl: null,
          };
          this.render(bay, editable);
        });

        list.appendChild(chip);
      }

      wrap.appendChild(list);
    }

    this.root.appendChild(wrap);
  }

  private renderInspector(bay: CargoBayState, editable: boolean): void {
    const card = document.createElement('div');
    card.className = 'inspector-card';

    if (!this.selected) {
      card.innerHTML = `
        <div style="font-size:13px;color:var(--text-secondary);">
          ${
            editable
              ? '点选或拖拽任意物品摆放至 4×4 船舱。选中后点击空位可直接放置，按 R 或点击旋转调整方向。'
              : '点击船舱内任意物品查看详细属性与占格说明（当前阶段已锁定布局）。'
          }
        </div>
      `;
      this.root.appendChild(card);
      return;
    }

    const foundPlaced =
      this.selected.zone === 'grid'
        ? bay.placed.find((p) => p.item.instanceId === this.selected?.instanceId)
        : null;
    const foundStaging =
      this.selected.zone === 'staging'
        ? bay.staging.find((s) => s.item.instanceId === this.selected?.instanceId)
        : null;

    const item = foundPlaced?.item ?? foundStaging?.item;
    if (!item) return;

    const def = getItemDef(item.defId);
    const shape = SHAPES[def.shapeId];
    const perCell = Math.round(item.value / shape.cells.length);

    const tags: string[] = [
      `<span class="tag">${shape.label}</span>`,
      def.category === 'equipment'
        ? `<span class="tag ${def.quality === 'improved' ? 'tag-energy' : ''}">${
            def.quality === 'improved' ? '‖ 优良' : '| 普通'
          }</span>`
        : `<span class="tag tag-amber">估值 ${item.value} · 每格 ${perCell}</span>`,
    ];

    if (item.isBorrowed) {
      tags.push(`<span class="tag">借用 · 不可出售</span>`);
    } else if (def.category === 'equipment') {
      tags.push(`<span class="tag">返航回收 ${item.value}</span>`);
    }
    if (def.category === 'cargo' && def.isCollectible) {
      tags.push(`<span class="tag tag-amber">返航可留作收藏</span>`);
    }

    const top = document.createElement('div');
    top.className = 'inspector-top';
    top.innerHTML = `
      <div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:4px;">
          <strong style="font-size:15px;">${def.name}</strong>
          ${tags.join('')}
        </div>
        <div style="font-size:13px;color:var(--text-secondary);">${def.detail}</div>
      </div>
    `;
    card.appendChild(top);

    if (editable) {
      const actions = document.createElement('div');
      actions.className = 'inspector-actions';

      const rotateBtn = document.createElement('button');
      rotateBtn.type = 'button';
      rotateBtn.className = 'btn btn-energy btn-compact';
      rotateBtn.textContent = '旋转 90° (R)';
      rotateBtn.onclick = () => this.rotateSelected();
      actions.appendChild(rotateBtn);

      if (this.selected.zone === 'grid') {
        const toStageBtn = document.createElement('button');
        toStageBtn.type = 'button';
        toStageBtn.className = 'btn btn-compact';
        toStageBtn.textContent = '移至暂存区';
        toStageBtn.onclick = () => {
          const res = movePlacedToStaging(bay, item.instanceId);
          if (res.ok) {
            soundEngine.play('click');
            this.selected = { zone: 'staging', instanceId: item.instanceId };
            this.callbacks.onBayChange(res.bay);
          }
        };
        actions.appendChild(toStageBtn);
      }

      const discardBtn = document.createElement('button');
      discardBtn.type = 'button';
      discardBtn.className = 'btn btn-danger btn-compact';
      discardBtn.textContent = '舍弃（可撤销）';
      discardBtn.onclick = () => {
        const res = discardItem(bay, item.instanceId);
        if (res.ok) {
          soundEngine.play('click');
          this.selected = null;
          this.callbacks.onBayChange(res.bay);
        }
      };
      actions.appendChild(discardBtn);

      card.appendChild(actions);
    }

    this.root.appendChild(card);
  }

  private getCellFromPoint(clientX: number, clientY: number): GridCoord | null {
    if (!this.boardEl) return null;
    const rect = this.boardEl.getBoundingClientRect();
    if (
      clientX < rect.left ||
      clientX > rect.right ||
      clientY < rect.top ||
      clientY > rect.bottom
    ) {
      return null;
    }
    const cx = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((clientX - rect.left) / rect.width) * GRID_SIZE)));
    const cy = Math.min(GRID_SIZE - 1, Math.max(0, Math.floor(((clientY - rect.top) / rect.height) * GRID_SIZE)));
    return { x: cx, y: cy };
  }

  private handleBoardPointerDown = (e: PointerEvent): void => {
    if (!this.bay) return;
    soundEngine.unlock();
    const cell = this.getCellFromPoint(e.clientX, e.clientY);
    if (!cell) return;

    const hitItem = findItemAtCell(this.bay, cell.x, cell.y);

    // If not editable, only allow selecting to inspect
    if (!this.editable) {
      this.selected = hitItem ? { zone: 'grid', instanceId: hitItem.item.instanceId } : null;
      soundEngine.play('click');
      this.render(this.bay, this.editable);
      return;
    }

    // If user tapped an empty cell while an item is selected -> tap-to-place!
    if (!hitItem && this.selected) {
      this.tryTapPlace(cell.x, cell.y);
      return;
    }

    // If user tapped an occupied cell
    if (hitItem) {
      e.preventDefault();
      this.drag = {
        pointerId: e.pointerId,
        pointerType: e.pointerType,
        zone: 'grid',
        item: hitItem.item,
        rotation: hitItem.rotation,
        originX: hitItem.x,
        originY: hitItem.y,
        startClientX: e.clientX,
        startClientY: e.clientY,
        grabOffsetCellX: cell.x - hitItem.x,
        grabOffsetCellY: cell.y - hitItem.y,
        active: false,
        hoverOriginX: hitItem.x,
        hoverOriginY: hitItem.y,
        ghostEl: null,
      };
    }
  };

  private handleWindowPointerMove = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId || !this.bay || !this.editable) return;

    const dx = e.clientX - this.drag.startClientX;
    const dy = e.clientY - this.drag.startClientY;

    if (!this.drag.active) {
      if (Math.hypot(dx, dy) < 8) return;
      this.drag.active = true;
      this.selected = { zone: this.drag.zone, instanceId: this.drag.item.instanceId };
      this.createDragGhost(this.drag);
    }

    const liftY = this.drag.pointerType === 'touch' ? 44 : 0;
    const effectiveY = e.clientY - liftY;
    this.updateDragGhostPosition(e.clientX, effectiveY);

    const cell = this.getCellFromPoint(e.clientX, effectiveY);
    const nextOriginX = cell ? cell.x - this.drag.grabOffsetCellX : null;
    const nextOriginY = cell ? cell.y - this.drag.grabOffsetCellY : null;

    if (nextOriginX !== this.drag.hoverOriginX || nextOriginY !== this.drag.hoverOriginY) {
      this.drag.hoverOriginX = nextOriginX;
      this.drag.hoverOriginY = nextOriginY;
      this.render(this.bay, this.editable);
    }
  };

  private handleWindowPointerUp = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId || !this.bay) return;
    const d = this.drag;
    this.cleanupDragGhost();
    this.drag = null;

    if (!d.active) {
      // It was a tap on an item!
      if (d.zone === 'grid') {
        if (this.selected?.zone === 'grid' && this.selected.instanceId === d.item.instanceId) {
          // Tapping already-selected grid item rotates it in place!
          this.rotateSelected();
        } else {
          this.selected = { zone: 'grid', instanceId: d.item.instanceId };
          soundEngine.play('click');
          this.render(this.bay, this.editable);
        }
      }
      return;
    }

    // Complete drag drop
    if (d.hoverOriginX !== null && d.hoverOriginY !== null) {
      const res =
        d.zone === 'staging'
          ? placeFromStaging(this.bay, d.item.instanceId, d.hoverOriginX, d.hoverOriginY, d.rotation)
          : movePlacedItem(this.bay, d.item.instanceId, d.hoverOriginX, d.hoverOriginY, d.rotation);

      if (res.ok) {
        this.lastSnappedId = d.item.instanceId;
        this.selected = { zone: 'grid', instanceId: d.item.instanceId };
        soundEngine.play('place');
        this.callbacks.onBayChange(res.bay);
        return;
      } else {
        this.showInvalidReason(reasonToZh(res.reason));
        soundEngine.play('invalid');
      }
    }

    // Invalid or outside drop -> cleanly returns to legal origin (zero duplication!)
    this.render(this.bay, this.editable);
  };

  private handleWindowPointerCancel = (e: PointerEvent): void => {
    if (!this.drag || e.pointerId !== this.drag.pointerId) return;
    this.cleanupDragGhost();
    this.drag = null;
    if (this.bay) {
      this.render(this.bay, this.editable);
    }
  };

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (hasOpenModal()) return;
    if (!this.editable || !this.bay || !this.selected) return;
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      this.rotateSelected();
    } else if (e.key === 'Escape') {
      this.selected = null;
      this.render(this.bay, this.editable);
    }
  };

  private tryTapPlace(cellX: number, cellY: number): void {
    if (!this.bay || !this.selected || !this.editable) return;

    const isStaging = this.selected.zone === 'staging';
    const entry = isStaging
      ? this.bay.staging.find((s) => s.item.instanceId === this.selected?.instanceId)
      : this.bay.placed.find((p) => p.item.instanceId === this.selected?.instanceId);
    if (!entry) return;

    const def = getItemDef(entry.item.defId);
    const bounds = getShapeBounds(def.shapeId, entry.rotation);
    // Clamp origin slightly if tapping right/bottom edge so placing multi-cell items feels effortless
    const preferredOrigins: GridCoord[] = [
      { x: cellX, y: cellY },
      { x: Math.min(cellX, GRID_SIZE - bounds.width), y: Math.min(cellY, GRID_SIZE - bounds.height) },
    ];

    let lastReason: PlacementFailureReason | undefined;
    for (const orig of preferredOrigins) {
      const res = isStaging
        ? placeFromStaging(this.bay, entry.item.instanceId, orig.x, orig.y, entry.rotation)
        : movePlacedItem(this.bay, entry.item.instanceId, orig.x, orig.y, entry.rotation);
      if (res.ok) {
        this.lastSnappedId = entry.item.instanceId;
        this.selected = { zone: 'grid', instanceId: entry.item.instanceId };
        soundEngine.play('place');
        this.callbacks.onBayChange(res.bay);
        return;
      }
      lastReason = res.reason;
    }

    this.showInvalidReason(reasonToZh(lastReason));
    soundEngine.play('invalid');
    this.render(this.bay, this.editable);
  }

  private rotateSelected(): void {
    if (!this.bay || !this.selected || !this.editable) return;
    if (this.selected.zone === 'staging') {
      const res = rotateStagingItem(this.bay, this.selected.instanceId);
      if (res.ok) {
        soundEngine.play('rotate');
        this.callbacks.onBayChange(res.bay);
      }
    } else {
      const res = rotatePlacedItemInPlace(this.bay, this.selected.instanceId);
      if (res.ok) {
        this.lastSnappedId = this.selected.instanceId;
        soundEngine.play('rotate');
        this.callbacks.onBayChange(res.bay);
      } else {
        this.showInvalidReason(`旋转空间不足：${reasonToZh(res.reason)}`);
        soundEngine.play('invalid');
        this.render(this.bay, this.editable);
      }
    }
  }

  private computeDragPreview(): {
    valid: boolean;
    cells: readonly GridCoord[];
    conflictCells: readonly GridCoord[];
  } | null {
    if (!this.drag?.active || !this.bay) return null;
    if (this.drag.hoverOriginX === null || this.drag.hoverOriginY === null) return null;
    const ignoreId = this.drag.zone === 'grid' ? this.drag.item.instanceId : undefined;
    const check = checkPlacement(
      this.bay,
      this.drag.item.defId,
      this.drag.hoverOriginX,
      this.drag.hoverOriginY,
      this.drag.rotation,
      ignoreId,
      !this.editable
    );
    return check;
  }

  private createDragGhost(drag: DragState): void {
    this.cleanupDragGhost();
    const cellPx = this.boardEl ? this.boardEl.clientWidth / GRID_SIZE : 82;
    const def = getItemDef(drag.item.defId);
    const shape = SHAPES[def.shapeId];
    const bounds = getShapeBounds(def.shapeId, drag.rotation);

    const ghost = document.createElement('div');
    ghost.className = 'drag-ghost';
    ghost.style.width = `${bounds.width * cellPx}px`;
    ghost.style.height = `${bounds.height * cellPx}px`;

    const imgWrap = document.createElement('div');
    imgWrap.className = 'placed-item-img-wrap';
    imgWrap.style.width = `${shape.canonicalWidth * cellPx}px`;
    imgWrap.style.height = `${shape.canonicalHeight * cellPx}px`;
    imgWrap.style.transform = `translate(-50%, -50%) rotate(${drag.rotation * 90}deg)`;

    const img = document.createElement('img');
    img.src = getItemImageUrl(drag.item.defId);
    imgWrap.appendChild(img);
    ghost.appendChild(imgWrap);

    document.body.appendChild(ghost);
    drag.ghostEl = ghost;
  }

  private updateDragGhostPosition(clientX: number, effectiveY: number): void {
    if (!this.drag?.ghostEl) return;
    const cellPx = this.boardEl ? this.boardEl.clientWidth / GRID_SIZE : 82;
    const left = clientX - (this.drag.grabOffsetCellX + 0.5) * cellPx;
    const top = effectiveY - (this.drag.grabOffsetCellY + 0.5) * cellPx;
    this.drag.ghostEl.style.left = `${left}px`;
    this.drag.ghostEl.style.top = `${top}px`;
  }

  private cleanupDragGhost(): void {
    if (this.drag?.ghostEl) {
      this.drag.ghostEl.remove();
      this.drag.ghostEl = null;
    }
  }

  private showInvalidReason(text: string): void {
    this.invalidToastText = text;
    if (this.invalidToastTimer !== null) {
      window.clearTimeout(this.invalidToastTimer);
    }
    this.invalidToastTimer = window.setTimeout(() => {
      this.invalidToastText = null;
      this.invalidToastTimer = null;
      if (this.bay) this.render(this.bay, this.editable);
    }, 1500);
  }

  destroy(): void {
    this.cleanupDragGhost();
    window.removeEventListener('pointermove', this.handleWindowPointerMove);
    window.removeEventListener('pointerup', this.handleWindowPointerUp);
    window.removeEventListener('pointercancel', this.handleWindowPointerCancel);
    window.removeEventListener('keydown', this.handleKeyDown);
  }
}

/**
 * Helper to render a compact visual shape mask diagram for reward & codex cards.
 */
export function renderMiniMaskHtml(defId: string): string {
  const def = getItemDef(defId);
  const shape = SHAPES[def.shapeId];
  const cells = getOccupiedCells(def.shapeId, 0, 0, 0);
  const filled = new Set(cells.map((c) => `${c.x},${c.y}`));
  let html = `<div class="mini-mask" style="grid-template-columns:repeat(${shape.canonicalWidth},8px);">`;
  for (let y = 0; y < shape.canonicalHeight; y++) {
    for (let x = 0; x < shape.canonicalWidth; x++) {
      html += `<span class="mini-mask-cell ${filled.has(`${x},${y}`) ? 'filled' : ''}"></span>`;
    }
  }
  html += `</div>`;
  return html;
}

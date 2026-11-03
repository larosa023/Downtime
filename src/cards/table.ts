import { Card, cardName, isRed, rankLabel, suitSvg } from "./deck";
import { motionEnabled } from "../core/settings";

export type PileKind = "stock" | "waste" | "foundation" | "tableau" | "cell";

export interface Pile {
  id: string;
  kind: PileKind;
  cards: Card[];
}

export interface Slot {
  x: number;
  y: number;
  /** none: stacked; down: cascade downward; waste: last N fanned right */
  fan: "none" | "down" | "waste";
  /** Max height the cascade may use before it compresses. */
  maxH?: number;
  /** Faint mark drawn in the empty slot. */
  mark?: string;
  /** Stacking base for piles that overlap each other. */
  z?: number;
  /** Draw no outline when the pile is empty. */
  ghost?: boolean;
}

export interface TableLayout {
  cardW: number;
  slots: Record<string, Slot>;
}

export interface TableRules {
  piles(): Pile[];
  layout(width: number, height: number): TableLayout;
  canPick(pile: Pile, index: number): boolean;
  canDrop(from: Pile, index: number, to: Pile): boolean;
  drop(from: Pile, index: number, to: Pile): void;
  /** Click without dragging. index is -1 for an empty pile. */
  tap(pile: Pile, index: number): void;
  wasteFan?(): number;
}

interface Pos {
  x: number;
  y: number;
  z: number;
}

const CARD_RATIO = 1.4;
const DRAG_THRESHOLD = 5;

export class CardTable {
  readonly el: HTMLDivElement;
  private cardEls = new Map<number, HTMLDivElement>();
  private slotEls = new Map<string, HTMLDivElement>();
  private where = new Map<number, { pile: Pile; index: number }>();
  private lastPile = new Map<number, string>();
  private positions = new Map<number, Pos>();
  private layoutCache: TableLayout | null = null;
  private resizeObs: ResizeObserver;
  private flyTimers = new Map<number, number>();
  private drag: {
    pile: Pile;
    index: number;
    startX: number;
    startY: number;
    active: boolean;
    cards: Card[];
    target: Pile | null;
    pointerId: number;
  } | null = null;
  private highlighted: HTMLElement | null = null;

  constructor(parent: HTMLElement, private rules: TableRules) {
    this.el = document.createElement("div");
    this.el.className = "table";
    parent.appendChild(this.el);
    this.el.addEventListener("pointerdown", this.onDown);
    this.el.addEventListener("contextmenu", (e) => e.preventDefault());
    this.resizeObs = new ResizeObserver(() => this.render({ instant: true, relayout: true }));
    this.resizeObs.observe(this.el);
  }

  get cardW() {
    return this.layoutCache?.cardW ?? 80;
  }
  get cardH() {
    return this.cardW * CARD_RATIO;
  }

  destroy() {
    this.resizeObs.disconnect();
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.flyTimers.forEach((t) => clearTimeout(t));
    this.el.remove();
  }

  /** Remove all card elements, e.g. before a fresh deal. */
  clear() {
    this.cardEls.forEach((el) => el.remove());
    this.cardEls.clear();
    this.lastPile.clear();
    this.positions.clear();
  }

  // ---------- rendering ----------

  render(opts: { instant?: boolean; deal?: { from: string }; relayout?: boolean } = {}) {
    if (this.drag?.active && !opts.relayout) this.cancelDrag();
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    if (w === 0 || h === 0) return;
    if (!this.layoutCache || opts.relayout || opts.deal) this.layoutCache = this.rules.layout(w, h);
    const layout = this.layoutCache;
    const cw = layout.cardW;
    const ch = cw * CARD_RATIO;
    this.el.style.setProperty("--cw", `${cw}px`);
    this.el.style.setProperty("--ch", `${ch}px`);

    const animate = !opts.instant && motionEnabled();
    this.el.classList.toggle("instant", !animate);

    const piles = this.rules.piles();
    const seen = new Set<number>();
    this.where.clear();

    // Slots
    const liveSlots = new Set<string>();
    for (const pile of piles) {
      const slot = layout.slots[pile.id];
      if (!slot) continue;
      liveSlots.add(pile.id);
      let sEl = this.slotEls.get(pile.id);
      if (!sEl) {
        sEl = document.createElement("div");
        sEl.className = `slot slot-${pile.kind}`;
        sEl.dataset.pile = pile.id;
        this.el.appendChild(sEl);
        this.slotEls.set(pile.id, sEl);
      }
      sEl.style.transform = `translate3d(${slot.x}px, ${slot.y}px, 0)`;
      sEl.innerHTML = slot.mark ? `<span class="slot-mark">${slot.mark}</span>` : "";
      sEl.classList.toggle("slot-empty", pile.cards.length === 0);
      sEl.classList.toggle("slot-ghost", !!slot.ghost);
    }
    for (const [id, el] of this.slotEls) {
      if (!liveSlots.has(id)) {
        el.remove();
        this.slotEls.delete(id);
      }
    }

    // Cards
    let dealOrder = 0;
    const dealFrom = opts.deal ? layout.slots[opts.deal.from] : null;
    for (const pile of piles) {
      const slot = layout.slots[pile.id];
      if (!slot) continue;
      const offsets = this.offsets(pile, slot, ch);
      pile.cards.forEach((card, i) => {
        seen.add(card.id);
        this.where.set(card.id, { pile, index: i });
        let el = this.cardEls.get(card.id);
        const fresh = !el;
        if (!el) {
          el = this.makeCard(card);
          this.cardEls.set(card.id, el);
          this.el.appendChild(el);
        }
        const pos: Pos = { x: slot.x + offsets[i].x, y: slot.y + offsets[i].y, z: (slot.z ?? 0) + i + 1 };
        this.positions.set(card.id, pos);
        el.classList.toggle("down", !card.up);
        el.setAttribute("aria-label", card.up ? cardName(card) : "Face-down card");

        const prev = this.lastPile.get(card.id);
        const moved = prev !== undefined && prev !== pile.id;
        this.lastPile.set(card.id, pile.id);
        el.classList.toggle("buried", slot.fan === "none" && i < pile.cards.length - 2);

        if (dealFrom && animate) {
          // Start every card at the stock, then fly out in order.
          el.style.transition = "none";
          el.style.transform = `translate3d(${dealFrom.x}px, ${dealFrom.y}px, 0)`;
          el.style.zIndex = String(2000 + dealOrder);
          el.classList.add("down");
          void el.offsetWidth;
          const delay = dealOrder * 16;
          el.style.transition = "";
          el.style.transitionDelay = `${delay}ms`;
          el.classList.toggle("down", !card.up);
          this.setFlying(card.id, el, 2000 + dealOrder, delay + 420);
          dealOrder++;
        } else {
          el.style.transitionDelay = "";
          if ((moved || fresh) && animate) this.setFlying(card.id, el, 1000 + i, 380);
          else if (!this.flyTimers.has(card.id)) el.style.zIndex = String(pos.z);
        }
        el.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
      });
    }

    for (const [id, el] of this.cardEls) {
      if (!seen.has(id)) {
        el.remove();
        this.cardEls.delete(id);
        this.lastPile.delete(id);
      }
    }
  }

  private setFlying(id: number, el: HTMLDivElement, z: number, ms: number) {
    el.style.zIndex = String(z);
    const old = this.flyTimers.get(id);
    if (old) clearTimeout(old);
    this.flyTimers.set(
      id,
      window.setTimeout(() => {
        this.flyTimers.delete(id);
        const p = this.positions.get(id);
        if (p && !el.classList.contains("dragging")) el.style.zIndex = String(p.z);
      }, ms),
    );
  }

  private offsets(pile: Pile, slot: Slot, ch: number): { x: number; y: number }[] {
    const n = pile.cards.length;
    const out: { x: number; y: number }[] = [];
    if (slot.fan === "down") {
      let down = ch * 0.1;
      let up = ch * 0.27;
      if (slot.maxH && n > 1) {
        const downs = pile.cards.slice(0, -1).filter((c) => !c.up).length;
        const ups = n - 1 - downs;
        const need = downs * down + ups * up;
        const room = slot.maxH - ch;
        if (need > room && need > 0) {
          const k = Math.max(room / need, 0.2);
          down *= k;
          up *= k;
        }
      }
      let y = 0;
      for (let i = 0; i < n; i++) {
        out.push({ x: 0, y });
        y += pile.cards[i].up ? up : down;
      }
    } else if (slot.fan === "waste") {
      const show = this.rules.wasteFan?.() ?? 1;
      const step = this.cardW * 0.24;
      const firstFanned = Math.max(0, n - show);
      for (let i = 0; i < n; i++) out.push({ x: i < firstFanned ? 0 : (i - firstFanned) * step, y: 0 });
    } else {
      // A subtle stack depth for tall stacks.
      for (let i = 0; i < n; i++) {
        const d = Math.floor(i / 8) * 0.6;
        out.push({ x: -d, y: -d });
      }
    }
    return out;
  }

  private makeCard(card: Card): HTMLDivElement {
    const el = document.createElement("div");
    el.className = "card";
    el.dataset.id = String(card.id);
    const color = isRed(card.suit) ? "red" : "black";
    const r = rankLabel(card.rank);
    const face = card.rank > 10;
    const center = face
      ? `<div class="court"><span class="court-letter">${r}</span>${suitSvg(card.suit, "court-suit")}</div>`
      : card.rank === 1
        ? suitSvg(card.suit, "pip pip-ace")
        : suitSvg(card.suit, "pip");
    el.innerHTML = `
      <div class="card-inner">
        <div class="card-face ${color}">
          <div class="idx tl"><span>${r}</span>${suitSvg(card.suit)}</div>
          ${center}
          <div class="idx br"><span>${r}</span>${suitSvg(card.suit)}</div>
        </div>
        <div class="card-back"></div>
      </div>`;
    return el;
  }

  /** Briefly shake a card to say "can't go there". */
  nudge(card: Card) {
    const el = this.cardEls.get(card.id);
    if (!el || !motionEnabled()) return;
    el.classList.remove("nudge");
    void el.offsetWidth;
    el.classList.add("nudge");
  }

  /** Flash cards, used for hints. */
  flash(cards: Card[]) {
    for (const c of cards) {
      const el = this.cardEls.get(c.id);
      if (!el) continue;
      el.classList.remove("hint");
      void el.offsetWidth;
      el.classList.add("hint");
      setTimeout(() => el.classList.remove("hint"), 1300);
    }
  }

  // ---------- input ----------

  private locateTarget(e: PointerEvent): { pile: Pile; index: number } | null {
    const t = e.target as HTMLElement;
    const cardEl = t.closest<HTMLElement>(".card");
    if (cardEl) {
      const loc = this.where.get(Number(cardEl.dataset.id));
      if (loc) return loc;
    }
    const slotEl = t.closest<HTMLElement>(".slot");
    if (slotEl) {
      const pile = this.rules.piles().find((p) => p.id === slotEl.dataset.pile);
      if (pile) return { pile, index: pile.cards.length ? pile.cards.length - 1 : -1 };
    }
    return null;
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    const loc = this.locateTarget(e);
    if (!loc) return;
    e.preventDefault();
    this.drag = {
      pile: loc.pile,
      index: loc.index,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      cards: loc.index >= 0 ? loc.pile.cards.slice(loc.index) : [],
      target: null,
      pointerId: e.pointerId,
    };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
  };

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      if (d.index < 0 || !this.rules.canPick(d.pile, d.index)) return;
      d.active = true;
      this.el.classList.add("is-dragging");
      d.cards.forEach((c, i) => {
        const el = this.cardEls.get(c.id)!;
        el.classList.add("dragging");
        el.style.zIndex = String(5000 + i);
      });
    }
    d.cards.forEach((c) => {
      const el = this.cardEls.get(c.id)!;
      const p = this.positions.get(c.id)!;
      el.style.transform = `translate3d(${p.x + dx}px, ${p.y + dy}px, 0)`;
    });
    this.updateTarget(dx, dy);
  };

  private updateTarget(dx: number, dy: number) {
    const d = this.drag!;
    const head = this.positions.get(d.cards[0].id)!;
    const cw = this.cardW;
    const ch = this.cardH;
    const box = { x: head.x + dx, y: head.y + dy, w: cw, h: ch };
    let best: Pile | null = null;
    let bestArea = 0;
    for (const pile of this.rules.piles()) {
      if (pile === d.pile) continue;
      const r = this.pileRect(pile);
      if (!r) continue;
      const ix = Math.max(0, Math.min(box.x + box.w, r.x + r.w) - Math.max(box.x, r.x));
      const iy = Math.max(0, Math.min(box.y + box.h, r.y + r.h) - Math.max(box.y, r.y));
      const area = ix * iy;
      if (area > bestArea && this.rules.canDrop(d.pile, d.index, pile)) {
        best = pile;
        bestArea = area;
      }
    }
    d.target = best;
    this.setHighlight(best);
  }

  private setHighlight(pile: Pile | null) {
    this.highlighted?.classList.remove("drop-target");
    this.highlighted = null;
    if (!pile) return;
    const top = pile.cards[pile.cards.length - 1];
    const el = top ? this.cardEls.get(top.id) : this.slotEls.get(pile.id);
    if (el) {
      el.classList.add("drop-target");
      this.highlighted = el;
    }
  }

  /** Bounding box of a pile in table coordinates. */
  pileRect(pile: Pile): { x: number; y: number; w: number; h: number } | null {
    const slot = this.layoutCache?.slots[pile.id];
    if (!slot) return null;
    const cw = this.cardW;
    const ch = this.cardH;
    let w = cw;
    let h = ch;
    const last = pile.cards[pile.cards.length - 1];
    if (last) {
      const p = this.positions.get(last.id);
      if (p) {
        w = Math.max(cw, p.x - slot.x + cw);
        h = Math.max(ch, p.y - slot.y + ch);
      }
    }
    return { x: slot.x, y: slot.y, w, h };
  }

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    this.drag = null;
    this.setHighlight(null);
    this.el.classList.remove("is-dragging");
    if (!d.active) {
      if (e.type === "pointerup") this.rules.tap(d.pile, d.index);
      return;
    }
    d.cards.forEach((c) => this.cardEls.get(c.id)?.classList.remove("dragging"));
    if (d.target) {
      this.rules.drop(d.pile, d.index, d.target);
    } else {
      // Snap back.
      d.cards.forEach((c, i) => {
        const el = this.cardEls.get(c.id);
        if (el) this.setFlying(c.id, el, 1000 + i, 320);
      });
      this.render();
    }
  };

  private cancelDrag() {
    const d = this.drag;
    if (!d) return;
    d.cards.forEach((c) => this.cardEls.get(c.id)?.classList.remove("dragging"));
    this.drag = null;
    this.setHighlight(null);
    this.el.classList.remove("is-dragging");
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
  }

  /** Positions of a card's element, for effects. */
  cardPos(card: Card) {
    return this.positions.get(card.id);
  }

  cardEl(card: Card) {
    return this.cardEls.get(card.id);
  }
}

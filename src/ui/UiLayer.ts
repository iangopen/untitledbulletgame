import { VIEW } from '../render/theme';
import { UI_CSS } from './styles';
import { h } from './dom';

/**
 * HTML UI layer: a div positioned exactly over the canvas, holding a 1280x720 root that is scaled
 * to the canvas's displayed size. Menu, roster, pause, results and HUD text live here as real DOM,
 * so the browser rasterises text at the true device pixel ratio.
 *
 * Rules:
 * - The layer only renders and forwards input. Each scene owns its state and re-renders on change.
 * - Mouse input never takes focus (mousedown is prevented) and never scrolls the page (wheel is
 *   prevented), so keyboard play is unaffected by clicking the UI.
 * - Geometry: the overlay copies the canvas's on-page rect (watched with ResizeObserver), so UI and
 *   canvas stay aligned at any window size or pixel ratio.
 * - Hover selects only after the mouse moves: when a screen appears (or `disarmHover()` is called),
 *   mouseenter / mouseover are swallowed until a mousemove with real movement; then the elements
 *   under the cursor get their mouseenter once. An idle cursor never steals the selection.
 * - Under-layer: a second, identical root BELOW the canvas, for HUD text that bullets pass over (the
 *   battle HUD). The battle camera clears transparent, so the text shows through wherever nothing is
 *   drawn and bullets are always drawn on top of it. It takes no mouse input (the canvas covers it).
 */
class UiLayer {
  private host: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private underlay: HTMLElement | null = null;
  private underRoot: HTMLElement | null = null;
  private screen: HTMLElement | null = null;
  private under: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  /** False from show() / disarmHover() until the mouse really moves (see the rules above). */
  hoverArmed = false;
  /** Last cursor position seen by any mousemove (null until the first one in this page). */
  private lastPos: { x: number; y: number } | null = null;

  /** Scale from layout px to CSS px (exposed for tests and diagnostics). */
  scale = 1;

  init(host: HTMLElement): void {
    if (this.host) return;
    this.host = host;
    host.style.position = 'relative';
    const style = h('style');
    style.textContent = UI_CSS;
    document.head.appendChild(style);
    this.overlay = h('div');
    this.overlay.id = 'ui-overlay';
    this.root = h('div');
    this.root.id = 'ui-root';
    this.overlay.appendChild(this.root);
    host.appendChild(this.overlay);
    this.underlay = h('div');
    this.underlay.id = 'ui-underlay';
    this.underRoot = h('div');
    this.underRoot.id = 'ui-under-root';
    this.underlay.appendChild(this.underRoot);
    host.insertBefore(this.underlay, host.firstChild);

    // Clicking UI must not move focus or select text; the wheel must not scroll the page.
    this.overlay.addEventListener('mousedown', (e) => e.preventDefault());
    this.overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hover after move: swallow enter/over while disarmed (capture runs before the targets' handlers).
    const gate = (e: Event) => {
      if (!this.hoverArmed) e.stopPropagation();
    };
    this.overlay.addEventListener('mouseenter', gate, true);
    this.overlay.addEventListener('mouseover', gate, true);
    window.addEventListener('mousemove', (e) => this.onMove(e), true);

    const sync = () => this.sync();
    window.addEventListener('resize', sync);
    window.addEventListener('game-refit', sync);
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(host);
    this.sync();
  }

  /** Track the game canvas: the overlay copies its on-page rect, so they can never disagree. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    // Stack the canvas above the under-layer (and below the overlay).
    canvas.style.position = 'relative';
    canvas.style.zIndex = '1';
    if ('ResizeObserver' in window) new ResizeObserver(() => this.sync()).observe(canvas);
    this.sync();
  }

  /** Re-fit the overlay to the canvas rect (or, before the canvas exists, the largest centered 16:9 box). */
  sync(): void {
    if (!this.host || !this.overlay || !this.root) return;
    let left: number;
    let top: number;
    let w: number;
    let hgt: number;
    if (this.canvas) {
      const hr = this.host.getBoundingClientRect();
      const cr = this.canvas.getBoundingClientRect();
      left = cr.left - hr.left;
      top = cr.top - hr.top;
      w = cr.width;
      hgt = cr.height;
    } else {
      const hw = this.host.clientWidth;
      const hh = this.host.clientHeight;
      w = Math.min(hw, (hh * VIEW.width) / VIEW.height);
      hgt = (w * VIEW.height) / VIEW.width;
      left = (hw - w) / 2;
      top = (hh - hgt) / 2;
    }
    const rect = { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hgt}px` };
    Object.assign(this.overlay.style, rect);
    this.scale = w / VIEW.width;
    this.root.style.transform = `scale(${this.scale}, ${hgt / VIEW.height})`;
    if (this.underlay && this.underRoot) {
      Object.assign(this.underlay.style, rect);
      this.underRoot.style.transform = this.root.style.transform;
    }
  }

  /** Replace the current screen (and its optional under-layer part, drawn below the canvas); they fade in. */
  show(screen: HTMLElement, under?: HTMLElement): void {
    if (!this.root) return;
    this.clear();
    for (const [el, root] of [[screen, this.root], [under, this.underRoot]] as const) {
      if (!el || !root) continue;
      el.classList.add('screen');
      root.appendChild(el);
      void el.offsetWidth; // commit opacity 0 before transitioning
      el.classList.add('shown');
    }
    this.screen = screen;
    this.under = under ?? null;
    this.hoverArmed = false;
  }

  /** Hover stops selecting until the mouse moves again (called when a screen or overlay menu appears). */
  disarmHover(): void {
    this.hoverArmed = false;
  }

  private onMove(e: MouseEvent): void {
    const prev = this.lastPos;
    this.lastPos = { x: e.clientX, y: e.clientY };
    if (this.hoverArmed) return;
    // Real movement only: Chrome fires synthetic mousemoves at the current position after layout
    // changes. movementX/Y alone is not enough (the first event in a new page reports 0 even when
    // the cursor moved), so a change of position also counts.
    const moved = e.movementX !== 0 || e.movementY !== 0 || (prev !== null && (prev.x !== e.clientX || prev.y !== e.clientY));
    if (!moved) return;
    this.hoverArmed = true;
    // The elements already under the cursor were 'entered' while disarmed: give them mouseenter now.
    const chain: Element[] = [];
    for (let el = document.elementFromPoint(e.clientX, e.clientY); el && el !== this.overlay; el = el.parentElement) chain.push(el);
    if (!chain.length || !this.overlay?.contains(chain[0]!)) return;
    for (const el of chain.reverse()) el.dispatchEvent(new MouseEvent('mouseenter', { clientX: e.clientX, clientY: e.clientY }));
  }

  /** Fade the current screen out (scene transitions call this alongside the camera fade). */
  fadeOut(): void {
    for (const el of [this.screen, this.under]) {
      el?.classList.remove('shown');
      el?.classList.add('leaving');
    }
  }

  /** Remove `screen` if it is the one shown (or whatever is shown, when omitted), with its under part. */
  clear(screen?: HTMLElement): void {
    if (!this.screen || (screen && screen !== this.screen)) return;
    this.screen.remove();
    this.under?.remove();
    this.screen = null;
    this.under = null;
  }

  /** Show or hide the current screen's under-layer part (e.g. while another scene draws over it). */
  setUnderVisible(v: boolean): void {
    if (this.under) this.under.style.visibility = v ? '' : 'hidden';
  }

  get current(): HTMLElement | null {
    return this.screen;
  }
}

export const ui = new UiLayer();

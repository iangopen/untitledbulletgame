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
 */
class UiLayer {
  private host: HTMLElement | null = null;
  private overlay: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private screen: HTMLElement | null = null;
  private canvas: HTMLCanvasElement | null = null;

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

    // Clicking UI must not move focus or select text; the wheel must not scroll the page.
    this.overlay.addEventListener('mousedown', (e) => e.preventDefault());
    this.overlay.addEventListener('wheel', (e) => e.preventDefault(), { passive: false });
    this.overlay.addEventListener('contextmenu', (e) => e.preventDefault());

    const sync = () => this.sync();
    window.addEventListener('resize', sync);
    window.addEventListener('game-refit', sync);
    if ('ResizeObserver' in window) new ResizeObserver(sync).observe(host);
    this.sync();
  }

  /** Track the game canvas: the overlay copies its on-page rect, so they can never disagree. */
  attachCanvas(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
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
    Object.assign(this.overlay.style, { left: `${left}px`, top: `${top}px`, width: `${w}px`, height: `${hgt}px` });
    this.scale = w / VIEW.width;
    this.root.style.transform = `scale(${this.scale}, ${hgt / VIEW.height})`;
  }

  /** Replace the current screen; it fades in. */
  show(screen: HTMLElement): void {
    if (!this.root) return;
    this.clear();
    screen.classList.add('screen');
    this.root.appendChild(screen);
    this.screen = screen;
    void screen.offsetWidth; // commit opacity 0 before transitioning
    screen.classList.add('shown');
  }

  /** Fade the current screen out (scene transitions call this alongside the camera fade). */
  fadeOut(): void {
    this.screen?.classList.remove('shown');
  }

  /** Remove `screen` if it is the one shown (or whatever is shown, when omitted). */
  clear(screen?: HTMLElement): void {
    if (!this.screen || (screen && screen !== this.screen)) return;
    this.screen.remove();
    this.screen = null;
  }

  get current(): HTMLElement | null {
    return this.screen;
  }
}

export const ui = new UiLayer();

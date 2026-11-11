import type Phaser from 'phaser';
import { FrameStats } from '../render/frameStats';
import { fonts, toCss, theme } from '../render/theme';
import { frameLimiter } from '../render/frameLimiter';

/**
 * Performance overlay, toggled with F3 in every build (Ian reads it on his own machine).
 * Shows FPS, display frame interval, sim steps per frame, CPU frame time with a recent-history
 * graph, active bullets and devicePixelRatio. Frame time = Phaser's step + render submission
 * (CPU side; GPU time is not visible to the page, but it shows up as a longer frame interval).
 *
 * Fed by Phaser game events plus two values the battle reports (`steps`, `bullets`).
 */
const GRAPH_FRAMES = 120;
const GRAPH_W = 240;
const GRAPH_H = 48;
/** Graph full scale, ms. The guide lines mark 8.3 ms (120 Hz) and 16.7 ms (60 Hz). */
const GRAPH_MAX_MS = 20;

class PerfOverlay {
  readonly stats = new FrameStats(600);
  /** Fixed steps run this frame; set by the scene's FixedLoop. */
  steps = 0;
  /** Active bullets; set by scenes that have a World (-1 = none). */
  bullets = -1;
  visible = false;
  private el: HTMLElement | null = null;
  private text: HTMLElement | null = null;
  private graph: HTMLCanvasElement | null = null;
  private frameStart = 0;
  private lastStart = 0;
  private lastPaint = 0;
  private readonly recent: number[] = [];
  private canvas: HTMLCanvasElement | null = null;

  install(game: Phaser.Game): void {
    this.canvas = game.canvas;
    game.events.on('prestep', () => {
      const now = performance.now();
      this.frameStart = now;
      this.steps = 0;
    });
    game.events.on('postrender', () => {
      const now = performance.now();
      const interval = this.lastStart === 0 ? 0 : this.frameStart - this.lastStart;
      this.lastStart = this.frameStart;
      if (interval > 0 && interval < 1000) this.stats.push({ interval, work: now - this.frameStart, steps: this.steps });
      if (this.visible && now - this.lastPaint > 100) {
        this.lastPaint = now;
        this.paint();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F3') return;
      e.preventDefault(); // F3 is "find" in some browsers
      this.toggle();
    });
    // Debug/measurement access in every build.
    (window as unknown as Record<string, unknown>).__perf = this;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  /** Settings "Show FPS" keeps it on; F3 still toggles it for the session. */
  setVisible(v: boolean): void {
    if (v === this.visible) return;
    this.visible = v;
    if (this.visible) {
      this.ensureDom();
      this.stats.clear();
      this.el!.style.display = '';
    } else if (this.el) {
      this.el.style.display = 'none';
    }
  }

  private ensureDom(): void {
    if (this.el) return;
    const el = document.createElement('div');
    el.id = 'perf-overlay';
    Object.assign(el.style, {
      position: 'fixed', top: '8px', left: '8px', zIndex: '1000', pointerEvents: 'none',
      font: `12px/1.45 ${fonts.mono}`, color: toCss(theme.text), background: 'rgba(8,8,13,0.82)',
      padding: '8px 10px', whiteSpace: 'pre',
    } satisfies Partial<CSSStyleDeclaration>);
    this.text = document.createElement('div');
    this.graph = document.createElement('canvas');
    this.graph.style.width = `${GRAPH_W}px`;
    this.graph.style.height = `${GRAPH_H}px`;
    this.graph.style.display = 'block';
    this.graph.style.marginTop = '6px';
    el.append(this.text, this.graph);
    document.body.appendChild(el);
    this.el = el;
  }

  private paint(): void {
    const s = this.stats.summary();
    const [s0, s1, s2, s3] = s.stepHist;
    const pct = (k: number) => (s.frames ? Math.round((k / s.frames) * 100) : 0);
    this.text!.textContent =
      `fps ${s.fps.toFixed(0)}   interval ${s.intervalMedian.toFixed(2)} ms\n` +
      `steps/frame  0:${pct(s0)}%  1:${pct(s1)}%  2:${pct(s2)}%  3+:${pct(s3)}%\n` +
      `frame ms  med ${s.workMedian.toFixed(2)}  p99 ${s.workP99.toFixed(2)}  max ${s.workMax.toFixed(2)}\n` +
      `dropped ${s.dropped}/${s.frames}   bullets ${this.bullets < 0 ? '-' : this.bullets}   dpr ${window.devicePixelRatio}
` +
      `display ${frameLimiter.measured ? `${frameLimiter.hz} Hz` : 'measuring'}   draw every ${frameLimiter.divisor}   ` +
      `canvas ${this.canvas?.width ?? 0}x${this.canvas?.height ?? 0}`;
    this.drawGraph();
  }

  private drawGraph(): void {
    const c = this.graph!;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(GRAPH_W * dpr);
    const h = Math.round(GRAPH_H * dpr);
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, w, h);
    const y = (ms: number) => h - (Math.min(ms, GRAPH_MAX_MS) / GRAPH_MAX_MS) * h;
    g.fillStyle = toCss(theme.rule);
    g.fillRect(0, Math.round(y(1000 / 60)), w, 1);
    g.fillRect(0, Math.round(y(1000 / 120)), w, 1);
    const data = this.stats.recentWork(GRAPH_FRAMES, this.recent);
    const bw = w / GRAPH_FRAMES;
    for (let i = 0; i < data.length; i++) {
      const v = data[i]!;
      g.fillStyle = toCss(v > 1000 / 60 ? theme.wallDamaging : theme.hitboxOutline);
      const top = y(v);
      g.fillRect(Math.floor(i * bw), top, Math.max(1, Math.floor(bw)), h - top);
    }
  }
}

export const perfOverlay = new PerfOverlay();

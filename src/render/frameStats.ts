/**
 * Rolling per-frame statistics for the performance overlay (F3). Pure: no Phaser, no DOM.
 * One sample per rendered frame: the interval since the previous frame, the CPU time the frame
 * took (Phaser step + render submission), and how many fixed simulation steps it ran.
 */
export interface FrameSample {
  /** ms since the previous frame started (display frame interval). */
  interval: number;
  /** ms of CPU work this frame (update + render submission). */
  work: number;
  /** Fixed 60 Hz steps run this frame. */
  steps: number;
}

export interface FrameSummary {
  frames: number;
  fps: number;
  intervalMedian: number;
  workMedian: number;
  workP99: number;
  workMax: number;
  /** Frames whose interval was over 1.5x the median interval (a missed vsync). */
  dropped: number;
  /** Count of frames that ran 0, 1, 2 and 3+ steps. */
  stepHist: [number, number, number, number];
}

export class FrameStats {
  readonly capacity: number;
  private readonly interval: Float64Array;
  private readonly work: Float64Array;
  private readonly steps: Uint8Array;
  private next = 0;
  count = 0;

  constructor(capacity = 600) {
    this.capacity = capacity;
    this.interval = new Float64Array(capacity);
    this.work = new Float64Array(capacity);
    this.steps = new Uint8Array(capacity);
  }

  push(s: FrameSample): void {
    this.interval[this.next] = s.interval;
    this.work[this.next] = s.work;
    this.steps[this.next] = Math.min(255, s.steps);
    this.next = (this.next + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;
  }

  clear(): void {
    this.next = 0;
    this.count = 0;
  }

  /** Most recent `n` work times, oldest first (for the graph). */
  recentWork(n: number, out: number[] = []): number[] {
    out.length = 0;
    const k = Math.min(n, this.count);
    for (let i = k; i > 0; i--) out.push(this.work[(this.next - i + this.capacity) % this.capacity]!);
    return out;
  }

  summary(): FrameSummary {
    const n = this.count;
    const iv: number[] = [];
    const wk: number[] = [];
    const hist: [number, number, number, number] = [0, 0, 0, 0];
    for (let i = 0; i < n; i++) {
      iv.push(this.interval[i]!);
      wk.push(this.work[i]!);
      hist[Math.min(3, this.steps[i]!)]!++;
    }
    const intervalMedian = percentile(iv, 0.5);
    let dropped = 0;
    for (const v of iv) if (v > intervalMedian * 1.5) dropped++;
    const sum = iv.reduce((a, b) => a + b, 0);
    return {
      frames: n,
      fps: sum > 0 ? (n * 1000) / sum : 0,
      intervalMedian,
      workMedian: percentile(wk, 0.5),
      workP99: percentile(wk, 0.99),
      workMax: wk.length ? Math.max(...wk) : 0,
      dropped,
      stepHist: hist,
    };
  }
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
}

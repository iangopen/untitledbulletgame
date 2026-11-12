import { toCss } from '../render/theme';

/** Create an element with optional class list and text. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export type Anchor = 'center' | 'left' | 'right';

/**
 * Place an element in the 1280x720 layout. The point (x, y) is the element's vertical middle and,
 * depending on `anchor`, its horizontal center, left edge or right edge (same as the old Phaser origins).
 */
export function at<T extends HTMLElement | SVGElement>(el: T, x: number, y: number, anchor: Anchor = 'center'): T {
  el.classList.add('abs', `a-${anchor}`);
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  return el;
}

export type ShapeKind = 'triangle' | 'circle' | 'square' | 'snowman' | 'shield' | 'golem';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** Flat shape (or thin outline) as inline SVG, so it is vector-sharp at any scaling. r = circumradius. */
export function shape(kind: ShapeKind, color: number, r: number, outline = false, strokeWidth = 2): SVGSVGElement {
  const pad = outline ? strokeWidth : 0;
  const size = r * 2 + pad * 2;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', `${-r - pad} ${-r - pad} ${size} ${size}`);
  let node: SVGElement;
  if (kind === 'snowman') {
    // Three stacked circles, small on top, filling the 2r height.
    node = document.createElementNS(SVG_NS, 'g');
    for (const [cy, cr] of [[0.59, 0.41], [-0.15, 0.33], [-0.74, 0.26]] as const) {
      const c = document.createElementNS(SVG_NS, 'circle');
      c.setAttribute('cy', String(cy * r));
      c.setAttribute('r', String(cr * r));
      node.appendChild(c);
    }
  } else if (kind === 'shield') {
    // Heater shield: flat top, straight sides, curved point at the bottom.
    node = document.createElementNS(SVG_NS, 'path');
    const w = r * 0.82;
    node.setAttribute('d', `M ${-w} ${-r * 0.85} L ${w} ${-r * 0.85} L ${w} ${r * 0.05} Q ${w} ${r * 0.7} 0 ${r} Q ${-w} ${r * 0.7} ${-w} ${r * 0.05} Z`);
  } else if (kind === 'golem') {
    // Stone golem: a blocky head on broad shoulders with two heavy fists (flat rocky blocks).
    node = document.createElementNS(SVG_NS, 'path');
    const k = r;
    const rect = (x: number, y: number, w: number, hh: number) => `M ${x * k} ${y * k} h ${w * k} v ${hh * k} h ${-w * k} Z `;
    node.setAttribute('d', rect(-0.3, -0.95, 0.6, 0.45) + rect(-0.62, -0.42, 1.24, 0.82) + rect(-0.98, -0.3, 0.3, 0.9) + rect(0.68, -0.3, 0.3, 0.9) + rect(-0.5, 0.48, 0.38, 0.47) + rect(0.12, 0.48, 0.38, 0.47));
  } else if (kind === 'circle') {
    node = document.createElementNS(SVG_NS, 'circle');
    node.setAttribute('r', String(r));
  } else {
    const n = kind === 'triangle' ? 3 : 4;
    const start = kind === 'square' ? -Math.PI / 4 : -Math.PI / 2;
    const pts = Array.from({ length: n }, (_, i) => {
      const a = start + (i / n) * Math.PI * 2;
      return `${(Math.cos(a) * r).toFixed(3)},${(Math.sin(a) * r).toFixed(3)}`;
    }).join(' ');
    node = document.createElementNS(SVG_NS, 'polygon');
    node.setAttribute('points', pts);
  }
  if (outline) {
    node.setAttribute('fill', 'none');
    node.setAttribute('stroke', toCss(color));
    node.setAttribute('stroke-width', String(strokeWidth));
  } else {
    node.setAttribute('fill', toCss(color));
  }
  svg.appendChild(node);
  return svg;
}

/** Restart a one-shot CSS animation class (pop, nudge). */
export function replay(el: Element, cls: 'pop' | 'nudge'): void {
  el.classList.remove('pop', 'nudge');
  void (el as HTMLElement).offsetWidth; // reflow so the animation restarts
  el.classList.add(cls);
}

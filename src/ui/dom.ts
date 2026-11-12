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

export type ShapeKind = 'triangle' | 'circle' | 'square' | 'snowman' | 'shield' | 'golem' | 'flame' | 'rose' | 'bolt' | 'dagger';

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * A small line icon for an ability (loadout picker), drawn in currentColor so it follows the
 * option's dim / bright state. Unknown ids (and none) get a slashed circle.
 */
export function abilityIcon(id: string | null, size = 22): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('viewBox', '-12 -12 24 24');
  const paths: Record<string, string> = {
    dash: 'M -10 0 H 6 M 1 -6 L 8 0 L 1 6 M -10 -5 H -4 M -10 5 H -4',
    shield: 'M 0 -10 A 10 10 0 1 1 -0.01 -10 M -4 -2 A 5 5 0 0 1 2 -5',
    slow: 'M -7 -10 H 7 M -7 10 H 7 M -6 -10 L 6 10 M 6 -10 L -6 10',
    blink: 'M -10 4 A 2 2 0 1 0 -6 4 A 2 2 0 1 0 -10 4 M -3 0 H 1 M 4 -4 A 5 5 0 1 1 3.99 -4',
    thickSkin: 'M 0 9 L -9 0 A 4.5 4.5 0 0 1 0 -6 A 4.5 4.5 0 0 1 9 0 Z',
    afterglow: 'M 4 0 A 4 4 0 1 1 3.99 0 M 0 -11 V -7 M 0 7 V 11 M -11 0 H -7 M 7 0 H 11 M -8 -8 L -5 -5 M 5 5 L 8 8 M 8 -8 L 5 -5 M -5 5 L -8 8',
    quickCharge: 'M 2 -11 L -6 2 H 0 L -2 11 L 6 -2 H 0 Z',
    steady: 'M -10 -5 H 10 M -10 0 H 10 M -10 5 H 10',
    none: 'M 8 0 A 8 8 0 1 1 7.99 0 M -6 6 L 6 -6',
  };
  const p = document.createElementNS(SVG_NS, 'path');
  p.setAttribute('d', paths[id ?? 'none'] ?? paths.none!);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', 'currentColor');
  p.setAttribute('stroke-width', '1.8');
  p.setAttribute('stroke-linejoin', 'round');
  p.setAttribute('stroke-linecap', 'round');
  svg.append(p);
  return svg;
}

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
  } else if (kind === 'flame') {
    // Teardrop flame: a round base rising to a pointed tip that leans slightly.
    node = document.createElementNS(SVG_NS, 'path');
    const k = r;
    node.setAttribute('d', `M ${0.12 * k} ${-k} C ${0.35 * k} ${-0.45 * k} ${0.78 * k} ${-0.1 * k} ${0.7 * k} ${0.35 * k} A ${0.7 * k} ${0.62 * k} 0 0 1 ${-0.7 * k} ${0.35 * k} C ${-0.72 * k} ${-0.05 * k} ${-0.3 * k} ${-0.4 * k} ${0.12 * k} ${-k} Z`);
  } else if (kind === 'dagger') {
    // A dagger, point up: a long double-edged blade, a crossguard, a grip and a pommel.
    node = document.createElementNS(SVG_NS, 'path');
    const k = r;
    node.setAttribute('d', `M 0 ${-k} L ${0.17 * k} ${-0.62 * k} L ${0.14 * k} ${0.22 * k} L ${0.5 * k} ${0.22 * k} L ${0.5 * k} ${0.36 * k} L ${0.1 * k} ${0.36 * k} L ${0.1 * k} ${0.74 * k} L ${0.2 * k} ${0.82 * k} L 0 ${k} L ${-0.2 * k} ${0.82 * k} L ${-0.1 * k} ${0.74 * k} L ${-0.1 * k} ${0.36 * k} L ${-0.5 * k} ${0.36 * k} L ${-0.5 * k} ${0.22 * k} L ${-0.14 * k} ${0.22 * k} L ${-0.17 * k} ${-0.62 * k} Z`);
  } else if (kind === 'bolt') {
    // A lightning bolt: a slanted zigzag with a pointed bottom.
    node = document.createElementNS(SVG_NS, 'path');
    const k = r;
    node.setAttribute('d', `M ${0.25 * k} ${-k} L ${-0.55 * k} ${0.12 * k} L ${-0.05 * k} ${0.12 * k} L ${-0.3 * k} ${k} L ${0.6 * k} ${-0.2 * k} L ${0.08 * k} ${-0.2 * k} L ${0.4 * k} ${-k} Z`);
  } else if (kind === 'rose') {
    // A rose: five round petals around a spiral heart, on a short stem with one leaf.
    node = document.createElementNS(SVG_NS, 'g');
    const k = r;
    const add = (tag: string, attrs: Record<string, number | string>) => {
      const el = document.createElementNS(SVG_NS, tag);
      for (const [a, v] of Object.entries(attrs)) el.setAttribute(a, String(v));
      node.appendChild(el);
    };
    add('path', { d: `M 0 ${0.15 * k} L ${-0.1 * k} ${k} M ${-0.06 * k} ${0.6 * k} Q ${-0.55 * k} ${0.45 * k} ${-0.6 * k} ${0.8 * k} Q ${-0.25 * k} ${0.85 * k} ${-0.06 * k} ${0.6 * k}`, 'stroke-width': 0.12 * k, 'stroke-linecap': 'round', 'data-stem': 1 });
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
      add('circle', { cx: Math.cos(a) * 0.3 * k, cy: -0.25 * k + Math.sin(a) * 0.3 * k, r: 0.3 * k });
    }
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
  if (kind === 'rose' && !outline) {
    // The stem is drawn as a line in the same color.
    for (const c of Array.from(node.children)) if (c.hasAttribute('data-stem')) c.setAttribute('stroke', toCss(color));
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

import { Ulysses } from '../characters/ulysses/Ulysses';
import { SWORD_FLAGS, SWORD_FORM } from '../characters/ulysses/ulysses.config';
import { installInteractions } from '../director/interactions';
import { Mortimer } from '../characters/mortimer/Mortimer';
import { Warden } from '../characters/warden/Warden';
import { Ember } from '../characters/ember/Ember';
import { ACTIVE_INFO, PASSIVE_INFO, abilityName, equipLoadout, type Loadout } from '../abilities/loadout';
import { IFRAME_DURATION, MAX_HP, SLOW_MULTIPLIER } from '../tuning';
import { wardenConfig } from '../characters/warden/warden.config';
import { resolveLevel } from '../characters/config';
import Phaser from 'phaser';
import { PROJECTILE_TYPES } from '../combat/projectile';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { VIEW, theme } from '../render/theme';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { px } from '../tuning';
import { FixedLoop } from './FixedLoop';
import { aimed, fan, line, ring } from '../combat/patterns';
import type { Wall } from '../combat/Bullet';
import { STEP } from '../core/Clock';
import { WALLS } from '../core/Box';
import { WALL_DAMAGE } from '../tuning';
import { attacksOf, registry } from '../characters/registry';
import type { CharacterHandle } from '../characters/Character';

/**
 * Debug sandbox (every build; Menu -> Debug). A template box with the soul and a DOM panel:
 * character list, that character's attacks, level 1-20, fire (Character.fireNow), a phase-cycle
 * toggle (the character's normal schedule at the chosen level), invincible / hitboxes / HUD bands
 * toggles, clear bullets, back. One selection state: Tab / Shift+Tab move, PgUp / PgDn change the
 * focused list or value, Enter uses it; hover and click do the same. Esc or backtick: back to the menu.
 * The old dev keys still work as shortcuts:
 * 1 line · 2 fan · 3 ring · 4 aimed · 5 spinning rects · 6 splitting beams (wall hook) · 9 one bullet of each projectile type
 * 7 KR ring · 8 bouncing triangles · 0 stress (+300) · C clear · I invincible · H hitboxes · ` back
 * Box: Q/E rotate -/+30 deg · R +90 · T +180 · F resize small/default · G move · V fast squeeze left
 *      B slow squeeze right · N cycle damaging walls · M continuous motion · P prism 0/20 · Z reset box
 * Mortimer (level 20 params, fired now from off screen): J snowfall · K snowball roll · L blizzard
 * Ulysses (level 20 params): U summon · Y axe swing · O sword rain
 * Loadout: Home cycles the active (Shift uses it), End cycles the passive.
 * Ember (level 20 params): ; embers · ' fire sweep · - wildfire
 * The Warden (level 20 params): , punch (and the return) · / toss · [ rip apart · ] merge punch · \ re-center
 * Combos: X sword through a refraction prism (Prism + Ulysses) · . toggle Mortimer's blizzard phase (swords sync)
 */
export class DebugScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private readout!: HTMLElement;
  private readoutText = '';
  private invincible = false;
  private edgeIdx = 0;
  private stepSamples: number[] = [];
  private small = false;
  private moveIdx = 0;
  private wallMode = 0;
  private chaos = false;
  private chaosT = 0;
  private chars: CharacterHandle[] = [];
  private prism!: CharacterHandle;
  private mortimer!: Mortimer;
  private ulysses!: Ulysses;
  private warden!: Warden;
  private ember!: Ember;
  private blizzard = false;
  /** Sandbox state: chosen character / attack, level, phase cycle on, focused row, panel elements. */
  private charIdx = 0;
  private attackIdx = 0;
  private level = 20;
  private cycling = false;
  private focus = 0;
  private panelSig = '';
  private rows: { kind: 'list' | 'value' | 'button'; els: HTMLElement[]; change?: (d: number) => void; use?: () => void }[] = [];
  private attackBox!: HTMLElement;
  private levelEl!: HTMLElement;
  private fireLabel!: HTMLElement;
  private msg = '';

  constructor() {
    super('Debug');
  }

  private loadout: Loadout = { active: 'dash', passive: null };

  /** Dev: equip the next active or passive (soul stats reset first, so passives never stack). */
  private cycleLoadout(slot: 'active' | 'passive'): void {
    const list = slot === 'active' ? ACTIVE_INFO : PASSIVE_INFO;
    const i = list.findIndex((a) => a.id === this.loadout[slot]);
    this.loadout = { ...this.loadout, [slot]: list[(i + 1) % list.length]!.id };
    const s = this.world.soul;
    s.maxHp = MAX_HP;
    s.hp = MAX_HP;
    s.iframeDuration = IFRAME_DURATION;
    s.slowMultiplier = SLOW_MULTIPLIER;
    s.shielded = false;
    this.world.timeScale = 1;
    equipLoadout(this.world, this.loadout);
  }

  create(): void {
    enter(this);
    this.world = new World(VIEW.cx, VIEW.cy + px(6));
    this.view = new BattleView(this, this.world);
    this.loadout = { active: 'dash', passive: null };
    equipLoadout(this.world, this.loadout);
    this.view.showHitboxes = true;
    this.view.showBands = false;
    this.invincible = false;
    this.cycling = false;
    this.msg = '';
    // One instance of every registered character, at level 0 (fireNow works at any level).
    this.chars = registry.map((e) => e.create(this.world));
    const byId = (id: string) => this.chars[registry.findIndex((e) => e.id === id)]!;
    this.prism = byId('prism');
    this.mortimer = byId('mortimer') as Mortimer;
    this.ulysses = byId('ulysses') as Ulysses;
    this.warden = byId('warden') as Warden;
    this.ember = byId('ember') as Ember;
    // Every combo rule, as if all characters were active, so X and . can show them.
    const offCombos = installInteractions(this.world, new Set(registry.map((e) => e.id)));
    this.blizzard = false;
    this.events.once('shutdown', () => {
      for (const c of this.chars) c.dispose();
      offCombos();
    });
    this.loop = new FixedLoop(this);
    this.stepSamples = [];
    this.buildPanel();

    const kb = this.input.keyboard!;
    const fire: Record<string, () => void> = {
      ONE: () => this.fireLine(),
      TWO: () => fan(this.world.pool, { x: 0, y: -this.world.box.halfHeight, angle: Math.PI / 2, count: 9, spread: 1.6, speed: px(120) }),
      THREE: () => ring(this.world.pool, { x: 0, y: 0, count: 24, speed: px(90), radius: px(30), style: { a: px(5) } }),
      FOUR: () => aimed(this.world.pool, { x: this.world.box.halfWidth, y: -this.world.box.halfHeight, target: this.world.soul.pos, speed: px(180), count: 3, spread: 0.3 }),
      FIVE: () => ring(this.world.pool, { x: 0, y: 0, count: 10, speed: px(60), radius: px(20), style: { shape: 'rect', a: px(10), b: px(4), spin: 3 } }),
      SIX: () => this.fireSplitBeams(),
      SEVEN: () => ring(this.world.pool, { x: 0, y: 0, count: 12, speed: px(70), radius: px(25), style: { a: px(6), kind: 'kr', damage: 15 } }),
      EIGHT: () => ring(this.world.pool, { x: 0, y: 0, count: 8, speed: px(110), radius: px(20), style: { shape: 'triangle', a: px(8), spin: 2, lifetime: 6, onWall: () => 'bounce' } }),
      // One slow bullet of each projectile type, left to right: white, blue, orange, KR.
      NINE: () =>
        PROJECTILE_TYPES.forEach((kind, i) =>
          this.world.pool.spawn({
            shape: 'circle', kind, a: px(10), damage: 8,
            x: (i - 1.5) * (this.world.box.halfWidth / 2), y: -this.world.box.halfHeight - px(20), vy: px(40),
          }),
        ),
      ZERO: () => this.stress(),
    };
    for (const [key, fn] of Object.entries(fire)) kb.on(`keydown-${key}`, fn);
    kb.on('keydown-C', () => this.world.pool.clear());
    kb.on('keydown-I', () => (this.invincible = !this.invincible));
    kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
    kb.on('keydown-BACKTICK', () => go(this, 'Menu'));
    kb.on('keydown-ESC', () => go(this, 'Menu'));
    kb.on('keydown-TAB', (e: KeyboardEvent) => {
      e.preventDefault();
      this.setFocus(this.focus + (e.shiftKey ? -1 : 1), true);
    });
    kb.on('keydown-PAGE_UP', () => this.rows[this.focus]!.change?.(-1));
    kb.on('keydown-PAGE_DOWN', () => this.rows[this.focus]!.change?.(1));
    kb.on('keydown-ENTER', () => {
      const r = this.rows[this.focus]!;
      if (r.use) r.use();
      else r.change?.(1);
    });
    // Always the soul's box (it changes when the box is ripped apart or merged).
    const W = this.world;
    const box_: Record<string, () => void> = {
      Q: () => W.box.rotateBy(-Math.PI / 6, 0.4),
      E: () => W.box.rotateBy(Math.PI / 6, 0.4),
      R: () => W.box.rotateBy(Math.PI / 2, 0.5),
      T: () => W.box.rotateBy(Math.PI, 0.8),
      F: () => {
        this.small = !this.small;
        const d = W.home;
        W.box.resizeTo(this.small ? px(180) : d.width, this.small ? px(120) : d.height, 0.6);
      },
      G: () => {
        const d = W.home;
        const offs = [[60, -30], [-60, 30], [0, 0]] as const;
        const [ox, oy] = offs[this.moveIdx++ % offs.length]!;
        W.box.moveTo(d.x + px(ox), d.y + px(oy), 0.6);
      },
      V: () => W.box.squeezeWall('left', px(80), 0.12),
      B: () => W.box.squeezeWall('right', px(80), 1.5),
      N: () => this.cycleWalls(),
      M: () => (this.chaos = !this.chaos),
      P: () => this.prism.setLevel(this.prism.level === 20 ? 0 : 20),
      J: () => this.mortimer.fireNow('snowfall', 20),
      K: () => this.mortimer.fireNow('roll', 20),
      L: () => this.mortimer.fireNow('blizzard', 20),
      U: () => this.ulysses.fireNow('summon', 20),
      Y: () => this.ulysses.fireNow('axe', 20),
      O: () => this.ulysses.fireNow('rain', 20),
      // Loadout: HOME cycles the equipped active, END the passive (same hook as battles).
      HOME: () => this.cycleLoadout('active'),
      END: () => this.cycleLoadout('passive'),
      SEMICOLON: () => this.ember.fireNow('embers', 20),
      QUOTES: () => this.ember.fireNow('sweep', 20),
      MINUS: () => this.ember.fireNow('wildfire', 20),
      COMMA: () => this.warden.fireNow('punch', 20),
      FORWARD_SLASH: () => this.warden.fireNow('toss', 20),
      // Rip and merge on demand (level 20 params): [ rips the box apart, ] punches the left half
      // into the right (merge, offset), BACKSLASH punches the merged box back to center.
      OPEN_BRACKET: () => this.warden.ripNow(this.wardenParams('rip')),
      CLOSED_BRACKET: () => this.warden.mergeNow(this.wardenParams('rip'), 0),
      BACK_SLASH: () => this.warden.recenterNow(this.wardenParams('rip')),
      X: () => this.prismCombo(),
      PERIOD: () => {
        this.blizzard = !this.blizzard;
        const phase = this.blizzard ? 'blizzard' : 'breather';
        this.world.bus.emit('mortimerPhaseChanged', { owner: 'mortimer', phase, next: 'blizzard' });
        if (this.blizzard) this.ulysses.fireNow('summon', 20);
      },
      Z: () => {
        this.chaos = false;
        this.small = false;
        W.resetBoxes();
        W.box.reset();
      },
    };
    for (const [key, fn] of Object.entries(box_)) kb.on(`keydown-${key}`, fn);

    (window as unknown as Record<string, unknown>).__debug = {
      world: this.world, view: this.view, loop: this.loop, game: this.game, fire, box: box_,
      setChaos: (v: boolean) => (this.chaos = v),
      prism: () => this.prism,
      mortimer: () => this.mortimer,
      ulysses: () => this.ulysses,
      warden: () => this.warden,
      prismCombo: () => this.prismCombo(),
      setInvincible: (v: boolean) => (this.invincible = v),
      sandbox: {
        choose: (id: string, attack?: string) => {
          this.chooseChar(registry.findIndex((e) => e.id === id));
          if (attack) this.attackIdx = Math.max(0, attacksOf(registry[this.charIdx]!).findIndex((a) => a.id === attack));
          this.renderPanel(true);
        },
        setLevel: (lv: number) => this.changeLevel(lv - this.level),
        fire: () => this.fireChosen(),
        cycle: () => this.toggleCycle(),
        state: () => ({ char: registry[this.charIdx]!.id, attack: attacksOf(registry[this.charIdx]!)[this.attackIdx]?.id, level: this.level, cycling: this.cycling, focus: this.focus, msg: this.msg }),
      },
    };
  }

  /** Sandbox panel (DOM): left = characters and attacks, right = level, fire, toggles, clear, back. */
  private buildPanel(): void {
    const L = 40;
    const R = 912;
    const screen = h('div');
    this.rows = [];
    const row = (kind: 'list' | 'value' | 'button', els: HTMLElement[], change?: (d: number) => void, use?: () => void) => {
      const i = this.rows.length;
      this.rows.push({ kind, els, change, use });
      for (const el of els) el.addEventListener('mouseenter', () => this.setFocus(i));
      return i;
    };
    const button = (label: string, y: number, use: () => void, cls = 't-body') => {
      const el = at(h('div', `opt dbg ${cls} click`), R, y, 'left');
      el.append(h('span', 'dot'), h('span', 'k', label), h('span', 'v'));
      el.addEventListener('click', use);
      screen.append(el);
      row('button', [el], undefined, use);
      return el;
    };

    screen.append(at(h('div', 't-label', 'Debug'), L, 56, 'left'), at(h('div', 't-small section', 'character'), L, 116, 'left'));
    const charEls = registry.map((e, i) => {
      const el = at(h('div', 'opt dbg t-body click'), L + 18, 152 + i * 36, 'left');
      el.append(h('span', 'dot'), shape(e.shape, e.color, 9), h('span', '', e.name));
      el.addEventListener('click', () => this.chooseChar(i));
      screen.append(el);
      return el;
    });
    row('list', charEls, (d) => this.chooseChar((this.charIdx + d + registry.length) % registry.length));
    const charsEnd = 152 + registry.length * 36;
    screen.append(at(h('div', 't-small section', 'attack'), L, charsEnd + 22, 'left'));
    this.attackBox = h('div');
    this.attackBox.style.cssText = `position:absolute;left:0;top:${charsEnd + 58}px;width:0;height:0`;
    screen.append(this.attackBox);
    row('list', [this.attackBox], (d) => {
      const n = attacksOf(registry[this.charIdx]!).length;
      this.attackIdx = (this.attackIdx + d + n) % n;
      this.renderPanel(true);
    });

    // Level ‹ n ›
    const lv = at(h('div', 'opt dbg t-body click'), R, 152, 'left');
    const down = h('span', 'arrow click', '‹');
    const up = h('span', 'arrow click', '›');
    this.levelEl = h('span', 'v mono');
    lv.append(h('span', 'dot'), h('span', '', 'level'), down, this.levelEl, up);
    down.addEventListener('click', () => this.changeLevel(-1));
    up.addEventListener('click', () => this.changeLevel(1));
    lv.addEventListener('wheel', (e) => this.changeLevel(e.deltaY < 0 ? 1 : -1));
    screen.append(lv);
    row('value', [lv], (d) => this.changeLevel(-d)); // PgUp = level up
    this.fireLabel = button('fire', 204, () => this.fireChosen(), 't-label');
    button('phase cycle', 262, () => this.toggleCycle());
    button('invincible', 318, () => (this.invincible = !this.invincible));
    button('hitboxes', 356, () => (this.view.showHitboxes = !this.view.showHitboxes));
    button('hud bands', 394, () => (this.view.showBands = !this.view.showBands));
    button('clear bullets', 450, () => this.world.pool.clear());
    button('Back', 560, () => go(this, 'Menu'));

    this.readout = at(h('div', 'readout t-hint mono'), VIEW.cx, 60);
    screen.append(
      this.readout,
      at(h('div', 't-hint', 'tab choose    pgup pgdn change    enter use    arrows move    shift ability    esc back'), VIEW.cx, 684),
      at(h('div', 't-hint', "keys: 1-9 0 patterns  C clear  I invincible  H hitboxes  P prism  J K L  U Y O  , / [ ] \\  ; ' -  X .  box Q E R T F G V B N M Z  Home End loadout"), VIEW.cx, 708),
    );
    mountScreen(this, screen);
    this.charIdx = 0;
    this.attackIdx = 0;
    this.level = 20;
    this.focus = 0;
    this.renderPanel(true);
  }

  private setFocus(i: number, fromKeyboard = false): void {
    const n = this.rows.length;
    const next = ((i % n) + n) % n;
    if (next === this.focus) return;
    this.focus = next;
    this.renderPanel(true);
    if (fromKeyboard) replay(this.rows[next]!.els[0]!, 'pop');
  }

  private chooseChar(i: number): void {
    if (i < 0 || i === this.charIdx) return;
    this.charIdx = i;
    this.attackIdx = 0;
    if (this.cycling) this.applyCycle();
    this.renderPanel(true);
  }

  private changeLevel(d: number): void {
    const next = Math.max(1, Math.min(20, this.level + d));
    if (next === this.level) {
      replay(this.levelEl, 'nudge');
      return;
    }
    this.level = next;
    if (this.cycling) this.applyCycle();
    this.renderPanel(true);
    replay(this.levelEl, 'pop');
  }

  /** Fire the chosen attack at the chosen level now (Character.fireNow); locked attacks nudge. */
  private fireChosen(): void {
    const e = registry[this.charIdx]!;
    const a = attacksOf(e)[this.attackIdx]!;
    const ok = this.chars[this.charIdx]!.fireNow(a.id, this.level);
    this.msg = ok ? `fired ${e.name} ${a.id} at level ${this.level}` : `${e.name} ${a.id} unlocks at level ${a.from}`;
    if (!ok) replay(this.fireLabel, 'nudge');
  }

  private toggleCycle(): void {
    this.cycling = !this.cycling;
    this.applyCycle();
  }

  /** Phase cycle: the chosen character runs its normal schedule at the chosen level; every other one is at 0. */
  private applyCycle(): void {
    this.chars.forEach((c, i) => c.setLevel(this.cycling && i === this.charIdx ? this.level : 0));
    this.msg = this.cycling ? `phase cycle: ${registry[this.charIdx]!.name} at level ${this.level}` : 'phase cycle off';
  }

  /** Re-render the panel when its state changed (keys like I / H / P change it too). */
  private renderPanel(force = false): void {
    const e = registry[this.charIdx]!;
    const attacks = attacksOf(e);
    const sig = [this.charIdx, this.attackIdx, this.level, this.cycling, this.focus, this.invincible, this.view.showHitboxes, this.view.showBands].join();
    if (!force && sig === this.panelSig) return;
    const rebuildAttacks = force || this.panelSig.split(',')[0] !== String(this.charIdx) || this.attackBox.childElementCount !== attacks.length;
    this.panelSig = sig;
    const [charRow, , levelRow, ...buttons] = this.rows;
    charRow!.els.forEach((el, i) => {
      el.classList.toggle('chosen', i === this.charIdx);
      el.classList.toggle('sel', i === this.charIdx && this.focus === 0);
    });
    if (rebuildAttacks) {
      this.attackBox.replaceChildren(
        ...attacks.map((a, i) => {
          const el = at(h('div', 'opt dbg t-body click'), 58, i * 36, 'left');
          el.append(h('span', 'dot'), h('span', '', a.id), h('span', 'note', `lv ${a.from}+`));
          el.addEventListener('mouseenter', () => this.setFocus(1));
          el.addEventListener('click', () => {
            this.attackIdx = i;
            this.renderPanel(true);
          });
          return el;
        }),
      );
    }
    Array.from(this.attackBox.children).forEach((el, i) => {
      el.classList.toggle('chosen', i === this.attackIdx);
      el.classList.toggle('lockd', attacks[i]!.from > this.level);
      el.classList.toggle('sel', i === this.attackIdx && this.focus === 1);
    });
    levelRow!.els[0]!.classList.toggle('sel', this.focus === 2);
    this.levelEl.textContent = String(this.level).padStart(2, ' ');
    const vals = [`${e.name} ${attacks[this.attackIdx]?.id ?? ''}`, this.cycling ? 'on' : 'off', this.invincible ? 'on' : 'off', this.view.showHitboxes ? 'on' : 'off', this.view.showBands ? 'on' : 'off', '', ''];
    buttons.forEach((r, i) => {
      r.els[0]!.classList.toggle('sel', this.focus === i + 3);
      r.els[0]!.querySelector('.v')!.textContent = vals[i]!;
    });
  }

  /** Prism + Ulysses demo: a refraction prism at the center and one white sword flying through it. */
  private prismCombo(): void {
    const w = this.world;
    if (!w.props.some((p) => p.refracts)) {
      w.props.push({ shape: 'triangle', x: 0, y: 0, r: px(28), rotation: -Math.PI / 2, color: theme.prismProp, refracts: true });
    }
    w.pool.spawn({
      shape: 'composite', form: SWORD_FORM, a: 0, x: -w.box.halfWidth - px(40), y: 0, vx: px(180), faceVelocity: true,
      damage: 10, owner: 'ulysses', kind: 'white', noPop: true, flags: SWORD_FLAGS.sword,
    });
  }

  /** none -> all walls normal damage -> left/right KR -> none */
  private cycleWalls(): void {
    this.wallMode = (this.wallMode + 1) % 3;
    const b = this.world.box;
    for (const w of WALLS) {
      const damaging = this.wallMode === 1 || (this.wallMode === 2 && (w === 'left' || w === 'right'));
      b.setWall(w, { damaging, damage: this.wallMode === 2 ? 10 : WALL_DAMAGE, type: this.wallMode === 2 ? 'kr' : 'normal' });
    }
  }

  /** Continuous motion for testing: rotate and breathe the size on a loop. */
  private stepChaos(dt: number): void {
    if (!this.chaos) return;
    this.chaosT += dt;
    const b = this.world.box;
    if (this.chaosT >= 1) {
      this.chaosT -= 1;
      b.rotateBy(0.35, 1, 'linear');
      const d = b.defaults;
      const k = 0.65 + 0.35 * Math.abs(Math.sin(this.world.time * 0.7));
      b.resizeTo(d.width * k, d.height * (1.3 - k * 0.3), 1, 'sineInOut');
    }
  }

  private fireLine(): void {
    const edges: Wall[] = ['left', 'top', 'right', 'bottom'];
    const edge = edges[this.edgeIdx++ % 4]!;
    line(this.world.pool, this.world.box, { edge, count: 10, speed: px(110), gaps: [4, 5] });
  }

  /** Demonstrates the wall hook: beams split into two at the wall they hit (a generic hook demo; Prism no longer splits). */
  private fireSplitBeams(): void {
    const w = this.world;
    for (const angle of [-0.6, 0, 0.6]) {
      w.pool.spawn({
        shape: 'beam', x: 0, y: 0, vx: Math.cos(angle) * px(160), vy: Math.sin(angle) * px(160),
        faceVelocity: true, a: px(26), b: px(4), damage: 6,
        onWall: (b, wall, ctx) => {
          if (b.owner === 'child') return 'die';
          const vertical = wall === 'left' || wall === 'right';
          for (const s of [-1, 1]) {
            const vx = vertical ? -b.vx * 0.8 : b.vx * 0.8 + s * px(60);
            const vy = vertical ? b.vy * 0.8 + s * px(60) : -b.vy * 0.8;
            ctx.spawn({
              shape: 'beam', x: b.x, y: b.y, vx, vy, faceVelocity: true,
              a: px(18), b: px(3), damage: 5, owner: 'child', noPop: true,
              onWall: () => 'die',
            });
          }
          return 'die';
        },
      });
    }
  }

  private stress(): void {
    const w = this.world;
    for (let i = 0; i < 300; i++) {
      const a = (i / 300) * Math.PI * 2 * 7;
      const shape = (['circle', 'rect', 'triangle', 'beam'] as const)[i % 4]!;
      w.pool.spawn({
        shape, x: Math.cos(a) * px(20), y: Math.sin(a) * px(20),
        vx: Math.cos(a) * px(20 + (i % 13) * 4), vy: Math.sin(a) * px(20 + (i % 13) * 4),
        a: shape === 'beam' ? px(16) : px(4), b: px(2), spin: 1.5, damage: 1,
      });
    }
  }

  private wardenParams(id: 'rip') {
    return resolveLevel(wardenConfig, 20).attacks[id]!;
  }

  update(): void {
    const w = this.world;
    this.loop.frame((input, dt) => {
      if (this.invincible) w.soul.iframes = Math.max(w.soul.iframes, 2 * STEP);
      this.stepChaos(dt);
      for (const c of this.chars) c.tick(dt);
      w.step(input, dt);
    });
    if (this.loop.lastStepMs > 0) {
      this.stepSamples.push(this.loop.lastStepMs);
      if (this.stepSamples.length > 120) this.stepSamples.shift();
    }
    this.view.draw(this.loop.realDt);
    const avg = this.stepSamples.reduce((s, x) => s + x, 0) / Math.max(1, this.stepSamples.length);
    const b = w.box;
    const walls = WALLS.map((k) => `${k[0]!.toUpperCase()}:${b.walls[k].damaging ? (b.walls[k].type === 'kr' ? 'KR' : 'DMG') : 'safe'}`).join(' ');
    const text =
      `bullets ${w.pool.activeCount}/${w.pool.capacity}  dropped ${w.pool.dropped}   step avg ${avg.toFixed(3)} ms  max ${this.loop.maxStepMs.toFixed(3)} ms   hp ${Math.ceil(w.soul.hp)}/${w.soul.maxHp}  kr ${w.soul.kr.toFixed(1)}
` +
      `active ${abilityName(this.loadout.active, ACTIVE_INFO)} (Home)  passive ${abilityName(this.loadout.passive, PASSIVE_INFO)} (End)  time x${w.timeScale}   prism lv ${this.prism.level} (P)
` +
      `box ${b.width.toFixed(0)}x${b.height.toFixed(0)} at (${b.x.toFixed(0)},${b.y.toFixed(0)}) rot ${((b.rotation * 180) / Math.PI).toFixed(1)}°${b.moving ? ' moving' : ''}${this.chaos ? ' chaos' : ''}   walls ${walls}` +
      (this.msg ? `
${this.msg}` : '');
    if (text !== this.readoutText) {
      this.readoutText = text;
      this.readout.textContent = text;
    }
    this.renderPanel();
  }
}

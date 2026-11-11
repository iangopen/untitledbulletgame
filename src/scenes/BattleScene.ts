import Phaser from 'phaser';
import { World } from '../core/World';
import { BattleView } from '../render/BattleView';
import { VIEW, space, theme, toCss, type } from '../render/theme';
import { FixedLoop } from './FixedLoop';
import { Director } from '../director/Director';
import { TimerMode } from '../director/modes/TimerMode';
import { DEFAULT_ROSTER, normalizeRoster, type Roster } from '../director/roster';
import { registry, type CharacterEntry } from '../characters/registry';
import { at, h, replay, shape } from '../ui/dom';
import { enter, go, mountScreen } from './ui';
import { px } from '../tuning';
import { perfOverlay } from '../ui/PerfOverlay';
import { ui } from '../ui/UiLayer';
import { browserStorage, createActive, loadLoadout } from '../abilities/loadout';

export interface BattleData {
  roster?: Roster;
}

const PAUSE_OPTIONS = ['Resume', 'Settings', 'Restart', 'Quit to roster'] as const;
/** Real ms between the outcome and the results screen, so the final hit reads. */
const END_DELAY_MS = 700;

/** Dev only: ?duration=<seconds> shortens timer mode for testing. Ignored in production builds. */
function devDuration(): number | undefined {
  if (!import.meta.env.DEV) return undefined;
  const v = Number.parseFloat(new URLSearchParams(window.location.search).get('duration') ?? '');
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

/**
 * Draws the battle (canvas) and its HUD/pause (HTML layer) and reads input.
 * The Director owns time, characters and the outcome; this scene owns pause state.
 * Movement is keyboard-only; the mouse only works in the pause menu.
 */
export class BattleScene extends Phaser.Scene {
  private world!: World;
  private view!: BattleView;
  private loop!: FixedLoop;
  private director!: Director;
  private roster!: Roster;
  private paused = false;
  private pauseIndex = 0;
  private ending = false;
  private lastShownSecond = -1;
  // HTML layer
  private timerEl!: HTMLElement;
  private hpEl!: HTMLElement;
  private abilityEl: HTMLElement | null = null;
  private shownAbility = '';
  private hintEl!: HTMLElement;
  private pauseBtn!: HTMLElement;
  private pauseEl!: HTMLElement;
  private pauseItems: HTMLElement[] = [];
  private hudScreen!: HTMLElement;
  /** Profile box per active character, lit on its attackStarted events. */
  private profiles = new Map<string, HTMLElement>();
  /** Dev verification: when each light-up happened (sim time + real time). */
  readonly profileLog: { owner: string; attack: string; time: number; at: number }[] = [];
  private shownTimer = '';
  private shownHp = '';

  constructor() {
    super('Battle');
  }

  create(data: BattleData = {}): void {
    enter(this);
    // Fresh state every time: roster is copied plain data, everything else is new.
    this.roster = normalizeRoster(data.roster ?? DEFAULT_ROSTER);
    this.world = new World(VIEW.cx, VIEW.cy + px(6));
    this.view = new BattleView(this, this.world);
    this.loop = new FixedLoop(this);
    // The equipped active ability (plain-data loadout; the Phase 8 shop will change it).
    this.world.ability = createActive(loadLoadout(browserStorage()));
    this.director = new Director(this.world, this.roster, new TimerMode(devDuration()));
    this.paused = false;
    this.ending = false;
    this.lastShownSecond = -1;
    this.shownTimer = '';
    this.shownHp = '';
    this.shownAbility = '';
    this.abilityEl = null;

    this.buildHud();
    const kb = this.input.keyboard!;
    kb.on('keydown-ESC', () => (this.paused ? this.resume() : this.pause()));
    kb.on('keydown-UP', () => this.paused && this.setPause(this.pauseIndex - 1, true));
    kb.on('keydown-DOWN', () => this.paused && this.setPause(this.pauseIndex + 1, true));
    kb.on('keydown-ENTER', () => this.paused && this.choosePause(this.pauseIndex));
    if (import.meta.env.DEV) {
      kb.on('keydown-H', () => (this.view.showHitboxes = !this.view.showHitboxes));
      kb.on('keydown-BACKTICK', () => this.scene.start('Debug'));
      (window as unknown as Record<string, unknown>).__battle = {
        world: this.world, view: this.view, loop: this.loop, director: this.director, scene: this,
      };
    }
    // Back from Settings: show the HUD and pause menu again (still paused).
    const onResume = () => {
      ui.show(this.hudScreen);
      this.renderPause();
    };
    this.events.on('resume', onResume);
    this.events.once('shutdown', () => {
      this.events.off('resume', onResume);
      this.director.dispose();
      perfOverlay.bullets = -1;
    });
    this.updateHud();
  }

  private buildHud(): void {
    const screen = h('div');
    this.hudScreen = screen;
    // HUD: countdown top center, roster summary top left, hp value beside the canvas bar, one quiet hint.
    this.timerEl = at(h('div', 't-number mono'), VIEW.cx, 92);
    const summary = registry
      .filter((e) => (this.roster[e.id] ?? 0) > 0)
      .map((e) => `${e.name} ${this.roster[e.id]}`)
      .join('    ');
    const bar = this.view.hpBar;
    const midY = bar.y + bar.h / 2;
    this.hpEl = at(h('div', 't-small mono dim'), bar.x + bar.w + 16, midY, 'left');
    // Mouse route to pause (Esc still works).
    this.pauseBtn = at(h('div', 't-small hud-btn click', 'pause'), VIEW.width - space.lg, space.lg, 'right');
    this.pauseBtn.addEventListener('click', () => (this.paused ? this.resume() : this.pause()));
    this.hintEl = at(h('div', 't-hint', `arrows move    space slow    ${this.world.ability ? `shift ${this.world.ability.name}    ` : ''}esc pause`), VIEW.cx, VIEW.height - 40);
    // Ability bar label (canvas draws the bar itself, from the ActiveAbility interface).
    const ab = this.world.ability;
    if (ab) {
      const a = this.view.abilityBar;
      this.abilityEl = at(h('div', 't-small dim', ab.name), a.x - 16, midY, 'right');
      screen.append(this.abilityEl);
      this.world.bus.on('abilityDenied', () => {
        this.view.deniedAt = this.view.now;
        replay(this.abilityEl!, 'nudge');
      });
    }
    // Profile boxes: a centered row directly below the timer, one per active character.
    const active = registry.filter((e) => (this.roster[e.id] ?? 0) > 0);
    const PROFILE = 44;
    const GAP = 12;
    const rowY = 92 + type.number / 2 + space.sm + PROFILE / 2;
    const rowW = active.length * PROFILE + (active.length - 1) * GAP;
    this.profiles.clear();
    active.forEach((e, i) => {
      const box = at(h('div', 'profile'), VIEW.cx - rowW / 2 + PROFILE / 2 + i * (PROFILE + GAP), rowY);
      box.style.setProperty('--accent', toCss(e.color));
      box.append(shape(profileShape(e), e.color, 11));
      this.profiles.set(e.id, box);
      screen.append(box);
    });
    this.world.bus.on('attackStarted', (ev) => {
      const box = this.profiles.get(ev.owner);
      if (!box) return;
      box.classList.remove('lit');
      void box.offsetWidth; // restart the fade
      box.classList.add('lit');
      if (import.meta.env.DEV) this.profileLog.push({ owner: ev.owner, attack: ev.attack, time: this.world.time, at: performance.now() });
    });

    screen.append(
      this.timerEl,
      at(h('div', 't-small dim', summary || 'no opponents'), space.lg, space.lg, 'left'),
      at(h('div', 't-small dim', 'hp'), bar.x - 16, midY, 'right'),
      this.hpEl,
      this.hintEl,
      this.pauseBtn,
    );

    // Pause overlay (hidden until Esc). The backdrop swallows clicks so nothing reaches the battle.
    this.pauseEl = h('div');
    this.pauseEl.style.display = 'none';
    this.pauseEl.append(h('div', 'backdrop'), at(h('div', 't-title', 'Paused'), VIEW.cx, 250));
    this.pauseItems = PAUSE_OPTIONS.map((t, i) => {
      const item = at(h('div', 'opt t-label click'), VIEW.cx, 360 + i * (type.label + space.md));
      item.append(h('span', 'dot'), h('span', '', t));
      item.addEventListener('mouseenter', () => this.setPause(i, false));
      item.addEventListener('click', () => this.choosePause(i));
      return item;
    });
    this.pauseEl.append(...this.pauseItems, at(h('div', 't-hint', '↑ ↓ choose    enter select    esc resume'), VIEW.cx, VIEW.height - 40));
    screen.append(this.pauseEl);
    mountScreen(this, screen);
  }

  private pause(): void {
    if (this.ending) return;
    this.paused = true;
    this.pauseIndex = 0;
    this.renderPause();
    this.pauseEl.style.display = '';
    this.hintEl.style.visibility = 'hidden';
    this.pauseBtn.style.visibility = 'hidden';
  }

  private resume(): void {
    this.paused = false;
    this.pauseEl.style.display = 'none';
    this.hintEl.style.visibility = '';
    this.pauseBtn.style.visibility = '';
    this.loop.resync(); // don't let the clock "catch up" on time spent paused
  }

  /** One selection state for keyboard and hover. */
  private setPause(i: number, fromKeyboard: boolean): void {
    const next = (i + PAUSE_OPTIONS.length) % PAUSE_OPTIONS.length;
    if (next === this.pauseIndex && !fromKeyboard) return;
    this.pauseIndex = next;
    this.renderPause();
    if (fromKeyboard) replay(this.pauseItems[next]!, 'pop');
  }

  private renderPause(): void {
    this.pauseItems.forEach((t, i) => t.classList.toggle('sel', i === this.pauseIndex));
  }

  private choosePause(i: number): void {
    const choice = PAUSE_OPTIONS[i];
    if (choice === 'Resume') this.resume();
    else if (choice === 'Settings') {
      // Settings opens over the paused battle; this scene sleeps (no update, no keys) until it returns.
      this.scene.pause();
      this.scene.launch('Settings', { from: 'Battle' });
    }
    else if (choice === 'Restart') go(this, 'Battle', { roster: { ...this.roster } });
    else go(this, 'Roster', { roster: { ...this.roster } });
  }

  private updateHud(): void {
    const text = this.director.mode.hud(this.director.state);
    if (text !== this.shownTimer) {
      this.timerEl.textContent = text;
      this.shownTimer = text;
    }
    const sec = Math.ceil((this.director.mode as TimerMode).remaining(this.director.time));
    if (sec !== this.lastShownSecond) {
      if (this.lastShownSecond !== -1 && sec <= 10) replay(this.timerEl, 'pop');
      this.lastShownSecond = sec;
    }
    const soul = this.world.soul;
    const hp = `${Math.ceil(Math.max(0, soul.hp))}${soul.kr > 0 ? '  kr' : ''}`;
    if (hp !== this.shownHp) {
      this.hpEl.textContent = hp;
      this.hpEl.style.color = toCss(soul.kr > 0 ? theme.kr : theme.textDim);
      this.shownHp = hp;
    }
    const ab = this.world.ability;
    if (ab && this.abilityEl) {
      const state = ab.ready ? 'ready' : 'charging';
      if (state !== this.shownAbility) {
        this.abilityEl.style.color = toCss(ab.ready ? theme.text : theme.textDim);
        if (ab.ready && this.shownAbility) replay(this.abilityEl, 'pop');
        this.shownAbility = state;
      }
    }
  }

  update(): void {
    if (!this.paused) {
      this.loop.frame((input, dt) => {
        const before = this.world.steps;
        this.director.step(input, dt);
        // Once the battle has frozen the world no longer steps; settle the snapshots so
        // interpolation draws the final state instead of blending stale ones.
        if (this.world.steps === before) this.world.snapshot();
      });
    }
    // Render interpolation: blend by the leftover step fraction. While paused the clock is not
    // advanced, so alpha holds still and pause/resume never jumps.
    this.view.draw(this.paused ? 0 : this.loop.realDt, this.loop.clock.alpha);
    this.updateHud();
    perfOverlay.bullets = this.world.pool.activeCount;

    const outcome = this.director.outcome;
    if (outcome && !this.ending) {
      this.ending = true;
      this.time.delayedCall(END_DELAY_MS, () => go(this, 'Results', { outcome: { ...outcome, roster: { ...outcome.roster } } }));
    }
  }
}

/** Profile icon for a character (the DOM shape helper draws triangle, circle and square). */
function profileShape(e: CharacterEntry): 'triangle' | 'circle' | 'square' {
  return e.shape === 'triangle' || e.shape === 'circle' ? e.shape : 'square';
}

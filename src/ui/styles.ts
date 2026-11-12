import { VIEW, fonts, line, space, theme, toCss, type } from '../render/theme';
import { SCENE_FADE_MS } from '../tuning';

const c = toCss;
/** Background with alpha, for the pause backdrop. */
const bg = (a: number) => {
  const v = theme.background;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};

/** `#ui` below = both roots (over and under the canvas). All UI-layer CSS, generated from the theme tokens so DOM and canvas share one design system. */
export const UI_CSS = `
#ui-overlay { position: absolute; z-index: 2; pointer-events: none; overflow: hidden; }
#ui-underlay { position: absolute; z-index: 0; pointer-events: none; overflow: hidden; }
#ui-root, #ui-under-root {
  position: absolute; left: 0; top: 0; width: ${VIEW.width}px; height: ${VIEW.height}px;
  transform-origin: 0 0; pointer-events: none; user-select: none; -webkit-user-select: none;
  font-family: ${fonts.sans}; color: ${c(theme.text)}; font-size: ${type.body}px; line-height: 1;
  -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
}
:is(#ui-root, #ui-under-root) .screen { position: absolute; inset: 0; opacity: 0; transition: opacity ${SCENE_FADE_MS}ms linear; }
:is(#ui-root, #ui-under-root) .screen.shown { opacity: 1; }
/* A screen fading out takes no mouse input (its scene also ignores keys; see scenes/ui.ts go()). */
:is(#ui-root, #ui-under-root) .screen.leaving, :is(#ui-root, #ui-under-root) .screen.leaving * { pointer-events: none !important; }
:is(#ui-root, #ui-under-root) .abs { position: absolute; white-space: nowrap; }
:is(#ui-root, #ui-under-root) .a-center { transform: translate(-50%, -50%); }
:is(#ui-root, #ui-under-root) .a-left { transform: translate(0, -50%); }
:is(#ui-root, #ui-under-root) .a-right { transform: translate(-100%, -50%); }

:is(#ui-root, #ui-under-root) .mono { font-family: ${fonts.mono}; }
:is(#ui-root, #ui-under-root) .t-hint { font-size: ${type.hint}px; color: ${c(theme.textMuted)}; letter-spacing: 0.5px; white-space: pre; }
:is(#ui-root, #ui-under-root) .t-small { font-size: ${type.small}px; }
:is(#ui-root, #ui-under-root) .t-body { font-size: ${type.body}px; }
:is(#ui-root, #ui-under-root) .t-label { font-size: ${type.label}px; }
:is(#ui-root, #ui-under-root) .t-number { font-size: ${type.number}px; }
:is(#ui-root, #ui-under-root) .t-title { font-size: ${type.title}px; font-weight: 600; letter-spacing: -0.5px; }
:is(#ui-root, #ui-under-root) .dim { color: ${c(theme.textDim)}; }
:is(#ui-root, #ui-under-root) .muted { color: ${c(theme.textMuted)}; }

/* Clickable things: pointer, and the hover look is the keyboard-selected look (state lives in the scene). */
:is(#ui-root, #ui-under-root) .click { pointer-events: auto; cursor: pointer; }
:is(#ui-root, #ui-under-root) .no { pointer-events: auto; cursor: not-allowed; }

/* Menu-style options: dim, selected = bright with a red dot to the left. */
:is(#ui-root, #ui-under-root) .opt { color: ${c(theme.textDim)}; padding: 6px 0; }
:is(#ui-root, #ui-under-root) .opt.sel { color: ${c(theme.text)}; }
:is(#ui-root, #ui-under-root) .opt.off { color: ${c(theme.textMuted)}; }
:is(#ui-root, #ui-under-root) .opt.off.sel { color: ${c(theme.textDim)}; }
:is(#ui-root, #ui-under-root) .opt .dot {
  position: absolute; right: calc(100% + ${space.md - 6}px); top: 50%; width: 12px; height: 12px;
  margin-top: -6px; border-radius: 50%; background: ${c(theme.soul)}; visibility: hidden;
}
:is(#ui-root, #ui-under-root) .opt.sel .dot { visibility: visible; }
:is(#ui-root, #ui-under-root) .opt .note { position: absolute; left: calc(100% + ${space.sm}px); top: 50%; transform: translateY(-40%);
  font-size: ${type.hint}px; color: ${c(theme.textMuted)}; }

/* Roster */
:is(#ui-root, #ui-under-root) .slot { position: absolute; top: 0; width: 0; height: ${VIEW.height}px; opacity: 0.4; transition: opacity 90ms linear; }
:is(#ui-root, #ui-under-root) .slot.sel, :is(#ui-root, #ui-under-root) .slot.locked { opacity: 1; }
:is(#ui-root, #ui-under-root) .slot .hit { position: absolute; left: -90px; width: 180px; top: 250px; height: 250px; }
:is(#ui-root, #ui-under-root) .slot .underline { position: absolute; left: -36px; width: 72px; top: 470px; height: ${line.thin}px; visibility: hidden; }
:is(#ui-root, #ui-under-root) .slot.sel .underline { visibility: visible; }
:is(#ui-root, #ui-under-root) .slot.locked .name { color: ${c(theme.locked)}; font-size: ${type.small}px; }
:is(#ui-root, #ui-under-root) .arrow { font-size: 14px; color: ${c(theme.textMuted)}; padding: 6px 10px; }
:is(#ui-root, #ui-under-root) .slot.sel .arrow { color: ${c(theme.textDim)}; }
:is(#ui-root, #ui-under-root) .arrow:hover { color: ${c(theme.text)}; }
:is(#ui-root, #ui-under-root) .level.zero { color: ${c(theme.textDim)}; }

/* Roster loadout picker: a row label, then options (icon + name). Equipped = bright with a thin
   underline; in the focused row the equipped option also gets the red dot. Hover = bright. */
:is(#ui-root, #ui-under-root) .lrow-label { color: ${c(theme.textMuted)}; }
:is(#ui-root, #ui-under-root) .lrow-label.focus { color: ${c(theme.text)}; }
:is(#ui-root, #ui-under-root) .lopt { display: flex; align-items: center; gap: 8px; color: ${c(theme.textDim)}; padding: 6px 2px; opacity: 0.55; }
:is(#ui-root, #ui-under-root) .lopt svg { flex: none; }
:is(#ui-root, #ui-under-root) .lopt.eq, :is(#ui-root, #ui-under-root) .lopt:hover { color: ${c(theme.text)}; opacity: 1; }
:is(#ui-root, #ui-under-root) .lopt .uline { position: absolute; left: 0; right: 0; bottom: 0; height: ${line.thin}px; background: ${c(theme.text)}; visibility: hidden; }
:is(#ui-root, #ui-under-root) .lopt.eq .uline { visibility: visible; }
:is(#ui-root, #ui-under-root) .lopt .dot {
  position: absolute; right: calc(100% + 6px); top: 50%; width: 10px; height: 10px;
  margin-top: -5px; border-radius: 50%; background: ${c(theme.soul)}; visibility: hidden;
}
:is(#ui-root, #ui-under-root) .lopt.eq.focus .dot { visibility: visible; }

/* Settings rows: label left, ‹ value › right; the red dot sits left of the row like menus. */
:is(#ui-root, #ui-under-root) .srow { width: 560px; display: flex; justify-content: space-between; align-items: center; }
:is(#ui-root, #ui-under-root) .srow .val { display: flex; align-items: center; gap: 2px; }
:is(#ui-root, #ui-under-root) .srow .v { min-width: 150px; text-align: center; }
:is(#ui-root, #ui-under-root) .srow .arrow { font-size: ${type.body}px; }
:is(#ui-root, #ui-under-root) .srow.sel .arrow { color: ${c(theme.textDim)}; }

/* Character profile boxes (battle): a thin dim square with the character's shape (dimmed). On an
   attack only the border and the icon light in the accent (--accent) and fade back. The box has no
   fill at any time, so bullets passing under the row never change color. */
:is(#ui-root, #ui-under-root) .profile { width: 44px; height: 44px; box-sizing: border-box; border: ${line.thin}px solid ${c(theme.rule)};
  display: flex; align-items: center; justify-content: center; background: none; }
:is(#ui-root, #ui-under-root) .profile svg { opacity: 0.55; }
:is(#ui-root, #ui-under-root) .profile.lit { animation: ui-profile-lit 450ms ease-out; }
:is(#ui-root, #ui-under-root) .profile.lit svg { animation: ui-profile-icon 450ms ease-out; }
@keyframes ui-profile-lit { from { border-color: var(--accent); } to { border-color: ${c(theme.rule)}; } }
@keyframes ui-profile-icon { from { opacity: 1; } to { opacity: 0.55; } }

/* Quiet HUD button (pause): dim, bright on hover. */
:is(#ui-root, #ui-under-root) .hud-btn { color: ${c(theme.textDim)}; padding: 8px 0; }
:is(#ui-root, #ui-under-root) .hud-btn:hover { color: ${c(theme.text)}; }

/* Pause */
:is(#ui-root, #ui-under-root) .backdrop { position: absolute; inset: -2px; background: ${bg(0.88)}; pointer-events: auto; }

/* Feedback animations */
@keyframes ui-pop { from { scale: 1.15; } to { scale: 1; } }
@keyframes ui-nudge { 0%, 100% { translate: 0 0; } 25%, 75% { translate: 6px 0; } 50% { translate: -6px 0; } }
:is(#ui-root, #ui-under-root) .pop { animation: ui-pop 120ms ease-out; }
:is(#ui-root, #ui-under-root) .nudge { animation: ui-nudge 160ms linear; }
`;

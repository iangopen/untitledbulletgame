import { VIEW, fonts, line, space, theme, toCss, type } from '../render/theme';
import { SCENE_FADE_MS } from '../tuning';

const c = toCss;
/** Background with alpha, for the pause backdrop. */
const bg = (a: number) => {
  const v = theme.background;
  return `rgba(${(v >> 16) & 255}, ${(v >> 8) & 255}, ${v & 255}, ${a})`;
};

/** All UI-layer CSS, generated from the theme tokens so DOM and canvas share one design system. */
export const UI_CSS = `
#ui-overlay { position: absolute; z-index: 2; pointer-events: none; overflow: hidden; }
#ui-root {
  position: absolute; left: 0; top: 0; width: ${VIEW.width}px; height: ${VIEW.height}px;
  transform-origin: 0 0; pointer-events: none; user-select: none; -webkit-user-select: none;
  font-family: ${fonts.sans}; color: ${c(theme.text)}; font-size: ${type.body}px; line-height: 1;
  -webkit-font-smoothing: antialiased; text-rendering: geometricPrecision;
}
#ui-root .screen { position: absolute; inset: 0; opacity: 0; transition: opacity ${SCENE_FADE_MS}ms linear; }
#ui-root .screen.shown { opacity: 1; }
#ui-root .abs { position: absolute; white-space: nowrap; }
#ui-root .a-center { transform: translate(-50%, -50%); }
#ui-root .a-left { transform: translate(0, -50%); }
#ui-root .a-right { transform: translate(-100%, -50%); }

#ui-root .mono { font-family: ${fonts.mono}; }
#ui-root .t-hint { font-size: ${type.hint}px; color: ${c(theme.textMuted)}; letter-spacing: 0.5px; white-space: pre; }
#ui-root .t-small { font-size: ${type.small}px; }
#ui-root .t-body { font-size: ${type.body}px; }
#ui-root .t-label { font-size: ${type.label}px; }
#ui-root .t-number { font-size: ${type.number}px; }
#ui-root .t-title { font-size: ${type.title}px; font-weight: 600; letter-spacing: -0.5px; }
#ui-root .dim { color: ${c(theme.textDim)}; }
#ui-root .muted { color: ${c(theme.textMuted)}; }

/* Clickable things: pointer, and the hover look is the keyboard-selected look (state lives in the scene). */
#ui-root .click { pointer-events: auto; cursor: pointer; }
#ui-root .no { pointer-events: auto; cursor: not-allowed; }

/* Menu-style options: dim, selected = bright with a red dot to the left. */
#ui-root .opt { color: ${c(theme.textDim)}; padding: 6px 0; }
#ui-root .opt.sel { color: ${c(theme.text)}; }
#ui-root .opt.off { color: ${c(theme.textMuted)}; }
#ui-root .opt.off.sel { color: ${c(theme.textDim)}; }
#ui-root .opt .dot {
  position: absolute; right: calc(100% + ${space.md - 6}px); top: 50%; width: 12px; height: 12px;
  margin-top: -6px; border-radius: 50%; background: ${c(theme.soul)}; visibility: hidden;
}
#ui-root .opt.sel .dot { visibility: visible; }
#ui-root .opt .note { position: absolute; left: calc(100% + ${space.sm}px); top: 50%; transform: translateY(-40%);
  font-size: ${type.hint}px; color: ${c(theme.textMuted)}; }

/* Roster */
#ui-root .slot { position: absolute; top: 0; width: 0; height: ${VIEW.height}px; opacity: 0.4; transition: opacity 90ms linear; }
#ui-root .slot.sel, #ui-root .slot.locked { opacity: 1; }
#ui-root .slot .hit { position: absolute; left: -90px; width: 180px; top: 250px; height: 250px; }
#ui-root .slot .underline { position: absolute; left: -36px; width: 72px; top: 470px; height: ${line.thin}px; visibility: hidden; }
#ui-root .slot.sel .underline { visibility: visible; }
#ui-root .slot.locked .name { color: ${c(theme.locked)}; font-size: ${type.small}px; }
#ui-root .arrow { font-size: 14px; color: ${c(theme.textMuted)}; padding: 6px 10px; }
#ui-root .slot.sel .arrow { color: ${c(theme.textDim)}; }
#ui-root .arrow:hover { color: ${c(theme.text)}; }
#ui-root .level.zero { color: ${c(theme.textDim)}; }

/* Settings rows: label left, ‹ value › right; the red dot sits left of the row like menus. */
#ui-root .srow { width: 560px; display: flex; justify-content: space-between; align-items: center; }
#ui-root .srow .val { display: flex; align-items: center; gap: 2px; }
#ui-root .srow .v { min-width: 150px; text-align: center; }
#ui-root .srow .arrow { font-size: ${type.body}px; }
#ui-root .srow.sel .arrow { color: ${c(theme.textDim)}; }

/* Character profile boxes (battle): a thin dim square with the character's shape; lights up in
   its accent (--accent) when it starts an attack, then fades back. */
#ui-root .profile { width: 44px; height: 44px; box-sizing: border-box; border: ${line.thin}px solid ${c(theme.rule)};
  display: flex; align-items: center; justify-content: center; }
#ui-root .profile.lit { animation: ui-profile-lit 450ms ease-out; }
@keyframes ui-profile-lit {
  from { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 28%, transparent); }
  to { border-color: ${c(theme.rule)}; background: transparent; }
}

/* Quiet HUD button (pause): dim, bright on hover. */
#ui-root .hud-btn { color: ${c(theme.textDim)}; padding: 8px 0; }
#ui-root .hud-btn:hover { color: ${c(theme.text)}; }

/* Pause */
#ui-root .backdrop { position: absolute; inset: -2px; background: ${bg(0.88)}; pointer-events: auto; }

/* Feedback animations */
@keyframes ui-pop { from { scale: 1.15; } to { scale: 1; } }
@keyframes ui-nudge { 0%, 100% { translate: 0 0; } 25%, 75% { translate: 6px 0; } 50% { translate: -6px 0; } }
#ui-root .pop { animation: ui-pop 120ms ease-out; }
#ui-root .nudge { animation: ui-nudge 160ms linear; }
`;

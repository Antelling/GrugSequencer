// Canvas-rendered step sequencer grid view.
// Implements the View interface from renderer.ts.

import type { View, Rect, HitResult } from './renderer.ts';
import {
  state,
  STANZA_SIZE,
  TRACK_COLORS,
  NOTES,
} from './state.ts';

// ---------------------------------------------------------------------------
// Layout constants (CSS pixels)
// ---------------------------------------------------------------------------

const CELL_SIZE = 56;
const CELL_GAP = 8;
const CELL_RADIUS = 8;
const TRACK_LABEL_WIDTH = 40;
const STEP_LABEL_HEIGHT = 28;
const STANZA_GAP = 16;

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------

const COL = {
  bg:          '#0f0f1a',
  cellInactive:'#252538',
  cellActive:  'rgba(255, 255, 255, 0.08)',
  playOutline: '#ffffff',
  cursor:      '#f59e0b',
  textMuted:   '#666680',
  stanzaAlt:   'rgba(255, 255, 255, 0.018)',
} as const;

// ---------------------------------------------------------------------------
// Mutable view-local scroll state
// ---------------------------------------------------------------------------

let scrollOffset = 0;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function roundRect(
  c: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y,     x + w, y + h, r);
  c.arcTo(x + w, y + h, x,     y + h, r);
  c.arcTo(x,     y + h, x,     y,     r);
  c.arcTo(x,     y,     x + w, y,     r);
  c.closePath();
}

/** Total grid height (before clamping to viewport). */
const SCROLL_PADDING = 80;

function gridHeight(): number {
  const steps = state.totalSteps;
  let h = STEP_LABEL_HEIGHT;
  for (let s = 0; s < steps; s++) {
    h += CELL_SIZE + CELL_GAP;
    if (s > 0 && s % STANZA_SIZE === 0) h += STANZA_GAP - CELL_GAP;
  }
  return h + SCROLL_PADDING;
}

/** Y offset for a given step row. */
function stepY(step: number): number {
  let y = STEP_LABEL_HEIGHT;
  for (let s = 0; s < step; s++) {
    y += CELL_SIZE + CELL_GAP;
    if (s > 0 && s % STANZA_SIZE === 0) y += STANZA_GAP - CELL_GAP;
  }
  return y;
}

/** X offset for a given track column. */
function trackX(track: number): number {
  return TRACK_LABEL_WIDTH + track * (CELL_SIZE + CELL_GAP);
}

/** Total grid width. */
function gridWidth(): number {
  const trackCount = state.tracks.length;
  return TRACK_LABEL_WIDTH + trackCount * (CELL_SIZE + CELL_GAP) - CELL_GAP;
}

/** Clamp scroll so the user can't scroll past content. */
function clampScroll(_contentH: number): void {
  const totalH = gridHeight();
  const maxScroll = Math.max(0, totalH - _contentH);
  scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

function render(ctx: CanvasRenderingContext2D, rect: Rect): void {
  clampScroll(rect.h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();

  // Offset so content starts at rect origin, accounting for scroll.
  ctx.translate(rect.x, rect.y - scrollOffset);

  // Background
  ctx.fillStyle = COL.bg;
  ctx.fillRect(0, 0, rect.w, gridHeight() + scrollOffset);

  // Stanza alternating background bands
  const totalSteps = state.totalSteps;
  const stanzas = Math.ceil(totalSteps / STANZA_SIZE);
  for (let si = 0; si < stanzas; si++) {
    if (si % 2 === 0) continue;
    const first = si * STANZA_SIZE;
    const y0 = stepY(first) - CELL_GAP / 2;
    const last = Math.min(first + STANZA_SIZE - 1, totalSteps - 1);
    const y1 = stepY(last) + CELL_SIZE + CELL_GAP / 2;
    ctx.fillStyle = COL.stanzaAlt;
    ctx.fillRect(0, y0, gridWidth(), y1 - y0);
  }

  // Track label buttons (top row)
  const trackCount = state.tracks.length;
  for (let t = 0; t < trackCount; t++) {
    const tx = trackX(t);
    const trackColor = TRACK_COLORS[t % TRACK_COLORS.length];

    ctx.fillStyle = trackColor + '20';
    roundRect(ctx, tx, 2, CELL_SIZE, STEP_LABEL_HEIGHT - 4, CELL_RADIUS);
    ctx.fill();

    ctx.strokeStyle = trackColor;
    ctx.lineWidth = 1;
    roundRect(ctx, tx, 2, CELL_SIZE, STEP_LABEL_HEIGHT - 4, CELL_RADIUS);
    ctx.stroke();

    ctx.fillStyle = trackColor;
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(
      state.tracks[t]?.name ?? `T${t + 1}`,
      tx + CELL_SIZE / 2,
      STEP_LABEL_HEIGHT / 2,
    );
  }

  // Step labels (left column)
  ctx.fillStyle = COL.textMuted;
  ctx.font = '600 11px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  for (let s = 0; s < totalSteps; s++) {
    const y = stepY(s);
    ctx.fillText(String(s + 1), TRACK_LABEL_WIDTH - 8, y + CELL_SIZE / 2);
  }

  // Grid cells
  const isCurrentlyPlaying = state.isPlaying || state.isPaused;

  for (let s = 0; s < totalSteps; s++) {
    const y = stepY(s);
    const isPlayingStep = isCurrentlyPlaying && s === state.currentStep;

    for (let t = 0; t < trackCount; t++) {
      const x = trackX(t);
      const cell = state.tracks[t]?.cells[s];
      const active = cell?.active ?? false;
      const trackColor = TRACK_COLORS[t % TRACK_COLORS.length];
      const isCursor = t === state.cursorTrack && s === state.cursorStep;

      // Cell background
      ctx.fillStyle = COL.cellInactive;
      roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_RADIUS);
      ctx.fill();

      if (active && cell) {
        // Pitch stripes: each vertical slice is a note, highlight the selected one
        ctx.save();
        roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_RADIUS);
        ctx.clip();

        const noteCount = NOTES.length;
        const stripeW = CELL_SIZE / noteCount;
        const selectedIdx = NOTES.indexOf(cell.pitch);

        for (let n = 0; n < noteCount; n++) {
          const sx = x + n * stripeW;
          const isSharp = NOTES[n].includes('#');
          const isSelected = n === selectedIdx;

          if (isSelected) {
            ctx.fillStyle = trackColor;
            ctx.globalAlpha = 0.5;
          } else if (isSharp) {
            ctx.fillStyle = '#1a1a2a';
            ctx.globalAlpha = 0.4;
          } else {
            ctx.fillStyle = '#2a2a40';
            ctx.globalAlpha = 0.2;
          }
          ctx.fillRect(sx, y, stripeW + 0.5, CELL_SIZE);
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        // Active cell border + glow
        ctx.save();
        ctx.shadowColor = trackColor;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = trackColor;
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_RADIUS);
        ctx.stroke();
        ctx.restore();

        // Pitch label
        ctx.fillStyle = '#ffffff';
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(cell.pitch, x + CELL_SIZE / 2, y + CELL_SIZE / 2);
      }

      // Playing step: white outline
      if (isPlayingStep) {
        ctx.strokeStyle = COL.playOutline;
        ctx.lineWidth = 2;
        roundRect(ctx, x - 1, y - 1, CELL_SIZE + 2, CELL_SIZE + 2, CELL_RADIUS + 1);
        ctx.stroke();
      }

      // Cursor: dashed yellow border
      if (isCursor) {
        ctx.save();
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = COL.cursor;
        ctx.lineWidth = 2;
        roundRect(ctx, x - 3, y - 3, CELL_SIZE + 6, CELL_SIZE + 6, CELL_RADIUS + 3);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }

    }
  }

  // Playhead line
  if (isCurrentlyPlaying && state.currentStep >= 0 && state.currentStep < totalSteps) {
    const py = stepY(state.currentStep) + CELL_SIZE / 2;
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(TRACK_LABEL_WIDTH, py);
    ctx.lineTo(gridWidth(), py);
    ctx.stroke();
    ctx.restore();
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Hit testing
// ---------------------------------------------------------------------------

function hitTest(x: number, y: number, rect: Rect): HitResult | null {
  clampScroll(rect.h);

  // Translate to grid-local coordinates (undo content rect offset and scroll)
  const lx = x - rect.x;
  const ly = y - rect.y + scrollOffset;

  // Step label hit
  if (lx >= 0 && lx < TRACK_LABEL_WIDTH) {
    for (let s = 0; s < state.totalSteps; s++) {
      const sy = stepY(s);
      if (ly >= sy && ly < sy + CELL_SIZE) {
        return { type: 'step-label', step: s };
      }
    }
  }

  // Track label hit
  if (ly >= 0 && ly < STEP_LABEL_HEIGHT) {
    for (let t = 0; t < state.tracks.length; t++) {
      const tx = trackX(t);
      if (lx >= tx && lx < tx + CELL_SIZE) {
        return { type: 'track-label', track: t };
      }
    }
  }

  // Cell hit
  for (let s = 0; s < state.totalSteps; s++) {
    const sy = stepY(s);
    if (ly < sy || ly >= sy + CELL_SIZE) continue;
    for (let t = 0; t < state.tracks.length; t++) {
      const tx = trackX(t);
      if (lx >= tx && lx < tx + CELL_SIZE) {
        return { type: 'cell', track: t, step: s, localX: lx - tx };
      }
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Public factory
// ---------------------------------------------------------------------------

export function pitchFromCellX(localX: number): string {
  const noteCount = NOTES.length;
  const stripeW = CELL_SIZE / noteCount;
  const idx = Math.max(0, Math.min(Math.floor(localX / stripeW), noteCount - 1));
  return NOTES[idx];
}

export function createSequencerView(): View {
  return {
    id: 'sequencer',
    label: 'Sequencer',
    render,
    hitTest,
    activate() { scrollOffset = 0; },
  };
}

export function scrollSequencer(delta: number, viewportH: number): void {
  scrollOffset += delta;
  const totalH = gridHeight();
  const maxScroll = Math.max(0, totalH - viewportH);
  scrollOffset = Math.max(0, Math.min(scrollOffset, maxScroll));
}

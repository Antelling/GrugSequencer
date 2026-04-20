// Canvas-rendered step sequencer grid view.
// Implements the View interface from renderer.ts.

import type { View, Rect, HitResult } from './renderer.ts';
import {
  state,
  STANZA_SIZE,
  TRACK_COLORS,
  computeTrackNotes,
  isConsumedStep,
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
const HANDLE_SIZE = 12;
const HANDLE_HIT = 24;

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
  loopRegion:  'rgba(29, 209, 161, 0.06)',
  loopBoundary:'rgba(29, 209, 161, 0.4)',
  loopHandle:  '#1dd1a1',
  playheadHandle: '#ffffff',
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

function mergedCellHeight(mergeLength: number): number {
  return mergeLength * CELL_SIZE + (mergeLength - 1) * CELL_GAP;
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

  // Loop region highlight + handles
  {
    const loopActive = state.loopStart > 0 || state.loopEnd < totalSteps
    const lastLoopStep = state.loopEnd - 1
    const lsY = stepY(state.loopStart) + CELL_SIZE / 2
    const leY = stepY(lastLoopStep) + CELL_SIZE / 2

    if (loopActive) {
      const ly0 = stepY(state.loopStart) - CELL_GAP / 2
      const ly1 = stepY(lastLoopStep) + CELL_SIZE + CELL_GAP / 2
      const gw = gridWidth()

      ctx.fillStyle = COL.loopRegion
      ctx.fillRect(TRACK_LABEL_WIDTH, ly0, gw - TRACK_LABEL_WIDTH, ly1 - ly0)

      ctx.strokeStyle = COL.loopBoundary
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(TRACK_LABEL_WIDTH, ly0)
      ctx.lineTo(gw, ly0)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(TRACK_LABEL_WIDTH, ly1)
      ctx.lineTo(gw, ly1)
      ctx.stroke()
      ctx.setLineDash([])
    }

    // Loop start handle (always visible, dimmed when at default position)
    const handleAlpha = loopActive ? 1 : 0.35
    ctx.save()
    ctx.globalAlpha = handleAlpha
    ctx.fillStyle = COL.loopHandle
    ctx.shadowColor = COL.loopHandle
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(0, lsY - HANDLE_SIZE / 2)
    ctx.lineTo(HANDLE_SIZE, lsY)
    ctx.lineTo(0, lsY + HANDLE_SIZE / 2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()

    // Loop end handle (always visible, dimmed when at default position)
    ctx.save()
    ctx.globalAlpha = handleAlpha
    ctx.fillStyle = COL.loopHandle
    ctx.shadowColor = COL.loopHandle
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.moveTo(0, leY - HANDLE_SIZE / 2)
    ctx.lineTo(HANDLE_SIZE, leY)
    ctx.lineTo(0, leY + HANDLE_SIZE / 2)
    ctx.closePath()
    ctx.fill()
    ctx.restore()
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

      if (isConsumedStep(t, s)) continue;

      if (active && cell && cell.mergeLength > 1) {
        const totalH = mergedCellHeight(cell.mergeLength);

        ctx.fillStyle = COL.cellInactive;
        roundRect(ctx, x, y, CELL_SIZE, totalH, CELL_RADIUS);
        ctx.fill();

        ctx.save();
        roundRect(ctx, x, y, CELL_SIZE, totalH, CELL_RADIUS);
        ctx.clip();
        const trackNotes = computeTrackNotes(state.tracks[t].config);
        const noteCount = trackNotes.length;
        const stripeW = CELL_SIZE / noteCount;
        for (let i = 0; i < cell.mergeLength && s + i < state.totalSteps; i++) {
          const stepYPos = stepY(s + i);
          const stepPitch = state.tracks[t].cells[s + i].pitch;
          const selectedIdx = trackNotes.indexOf(stepPitch);
          for (let n = 0; n < noteCount; n++) {
            const sx = x + n * stripeW;
            const isSharp = trackNotes[n].includes('#');
            const isSelected = n === selectedIdx;
            if (isSelected) { ctx.fillStyle = trackColor; ctx.globalAlpha = 0.5; }
            else if (isSharp) { ctx.fillStyle = '#1a1a2a'; ctx.globalAlpha = 0.4; }
            else { ctx.fillStyle = '#2a2a40'; ctx.globalAlpha = 0.2; }
            ctx.fillRect(sx, stepYPos, stripeW + 0.5, CELL_SIZE);
          }
        }
        ctx.globalAlpha = 1;
        ctx.restore();

        ctx.save();
        ctx.shadowColor = trackColor;
        ctx.shadowBlur = 16;
        ctx.strokeStyle = trackColor;
        ctx.lineWidth = 2;
        roundRect(ctx, x, y, CELL_SIZE, totalH, CELL_RADIUS);
        ctx.stroke();
        ctx.restore();

        ctx.fillStyle = '#ffffff';
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        for (let i = 0; i < cell.mergeLength && s + i < state.totalSteps; i++) {
          const pitch = state.tracks[t].cells[s + i].pitch;
          const stepCenterY = stepY(s + i) + CELL_SIZE / 2;
          ctx.fillText(pitch, x + CELL_SIZE / 2, stepCenterY);
        }

        if (isPlayingStep) {
          ctx.strokeStyle = COL.playOutline;
          ctx.lineWidth = 2;
          roundRect(ctx, x - 1, y - 1, CELL_SIZE + 2, totalH + 2, CELL_RADIUS + 1);
          ctx.stroke();
        }

        if (isCursor) {
          ctx.save();
          ctx.setLineDash([4, 3]);
          ctx.strokeStyle = COL.cursor;
          ctx.lineWidth = 2;
          roundRect(ctx, x - 3, y - 3, CELL_SIZE + 6, totalH + 6, CELL_RADIUS + 3);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.restore();
        }

        continue;
      }

      // Cell background
      ctx.fillStyle = COL.cellInactive;
      roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_RADIUS);
      ctx.fill();

      if (active && cell) {
        ctx.save();
        roundRect(ctx, x, y, CELL_SIZE, CELL_SIZE, CELL_RADIUS);
        ctx.clip();

        const trackNotes = computeTrackNotes(state.tracks[t].config);
        const noteCount = trackNotes.length;
        const stripeW = CELL_SIZE / noteCount;
        const selectedIdx = trackNotes.indexOf(cell.pitch);

        for (let n = 0; n < noteCount; n++) {
          const sx = x + n * stripeW;
          const isSharp = trackNotes[n].includes('#');
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

  // Merge mode overlay
  if (state.mergeMode && state.mergeAnchor) {
    const { track: mt, step: ms } = state.mergeAnchor;
    const mx = trackX(mt);
    const my = stepY(ms);
    const anchorCell = state.tracks[mt]?.cells[ms];
    if (anchorCell && anchorCell.active) {
      const mh = anchorCell.mergeLength > 1 
        ? mergedCellHeight(anchorCell.mergeLength) 
        : CELL_SIZE;

      ctx.save();
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = '#00ffff';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#00ffff';
      ctx.shadowBlur = 12;
      roundRect(ctx, mx - 4, my - 4, CELL_SIZE + 8, mh + 8, CELL_RADIUS + 4);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();

      ctx.fillStyle = '#00ffff';
      ctx.font = 'bold 16px system-ui';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      const groupEnd = ms + anchorCell.mergeLength - 1;
      if (ms > 0) {
        ctx.fillText('▲', mx + CELL_SIZE / 2, stepY(ms) - CELL_GAP - 4);
      }
      if (groupEnd < state.totalSteps - 1) {
        const endY = stepY(groupEnd) + CELL_SIZE + CELL_GAP + 4;
        ctx.fillText('▼', mx + CELL_SIZE / 2, endY);
      }
    }
  }

  // Playhead line + handle
  if (state.currentStep >= 0 && state.currentStep < totalSteps) {
    const py = stepY(state.currentStep) + CELL_SIZE / 2;
    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 8;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(TRACK_LABEL_WIDTH, py);
    ctx.lineTo(gridWidth(), py);
    ctx.stroke();
    ctx.restore();

    // Playhead handle in left margin
    ctx.save()
    ctx.fillStyle = COL.playheadHandle
    ctx.shadowColor = COL.playheadHandle
    ctx.shadowBlur = 6
    ctx.beginPath()
    ctx.arc(TRACK_LABEL_WIDTH / 2, py, 6, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
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

  const totalSteps = state.totalSteps

  // Playhead handle hit (left margin, near current step)
  if (state.currentStep >= 0 && state.currentStep < totalSteps) {
    const phY = stepY(state.currentStep) + CELL_SIZE / 2
    if (lx >= 0 && lx < TRACK_LABEL_WIDTH && Math.abs(ly - phY) <= HANDLE_HIT / 2) {
      return { type: 'playhead-handle' }
    }
  }

  // Loop handle hits (left margin triangles)
  {
    const lsY = stepY(state.loopStart) + CELL_SIZE / 2
    if (lx < TRACK_LABEL_WIDTH && Math.abs(ly - lsY) <= HANDLE_HIT / 2) {
      return { type: 'loop-handle', handle: 'start' }
    }
    const leY = stepY(state.loopEnd - 1) + CELL_SIZE / 2
    if (lx < TRACK_LABEL_WIDTH && Math.abs(ly - leY) <= HANDLE_HIT / 2) {
      return { type: 'loop-handle', handle: 'end' }
    }
  }

  // Step label hit
  if (lx >= 0 && lx < TRACK_LABEL_WIDTH) {
    for (let s = 0; s < totalSteps; s++) {
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
  for (let s = 0; s < totalSteps; s++) {
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

export function pitchFromCellX(trackIndex: number, localX: number): string {
  const notes = computeTrackNotes(state.tracks[trackIndex]?.config ?? { scale: 'pentatonic', root: 0, octaveLow: 4, octaveHigh: 4 });
  const noteCount = notes.length;
  const stripeW = CELL_SIZE / noteCount;
  const idx = Math.max(0, Math.min(Math.floor(localX / stripeW), noteCount - 1));
  return notes[idx];
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

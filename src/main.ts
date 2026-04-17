import './style.css';
import { state, toggleCell, moveCursor, seekToStep, addStanza, addTrack, setPlaying, setPaused, setBPM, removeStanza, NOTES } from './state.ts';
import { Renderer } from './renderer.ts';
import { Scheduler, setOnStep, addSynth } from './scheduler.ts';
import { createSequencerView, scrollSequencer, pitchFromCellX } from './sequencer-view.ts';
import { buildSidepanel } from './sidepanel.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;

Renderer.init(canvas);
Renderer.registerView(createSequencerView());

buildSidepanel(document.getElementById('sidepanel') as HTMLElement);

setOnStep((step: number) => {
  setTimeout(() => {
    state.currentStep = step;
    Renderer.markDirty();
  }, 150);
});

// ---------------------------------------------------------------------------
// Pointer events
// ---------------------------------------------------------------------------

function canvasCoords(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

let isDraggingPlayhead = false;

canvas.addEventListener('pointerdown', (e) => {
  const { x, y } = canvasCoords(e);
  const hit = Renderer.handlePointer(x, y);
  if (!hit) return;

  if (hit.type === 'cell') {
    const track = hit.track as number;
    const step = hit.step as number;
    const cell = state.tracks[track].cells[step];
    if (!cell.active) {
      cell.active = true;
    }
    cell.pitch = pitchFromCellX(hit.localX as number);
    state.cursorTrack = track;
    state.cursorStep = step;
    moveCursor(0, 1);
    Renderer.markDirty();
    return;
  }

  if (hit.type === 'step-label') {
    const step = hit.step as number;
    seekToStep(step);
    if (state.isPlaying) {
      Scheduler.seekTo(step);
    }
    isDraggingPlayhead = true;
    Renderer.markDirty();
    return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (!isDraggingPlayhead) return;
  const { x, y } = canvasCoords(e);
  const hit = Renderer.handlePointer(x, y);
  if (hit?.type === 'step-label' || hit?.type === 'cell') {
    const step = (hit.step as number) ?? state.currentStep;
    seekToStep(step);
    if (state.isPlaying) {
      Scheduler.seekTo(step);
    }
    Renderer.markDirty();
  }
});

canvas.addEventListener('pointerup', () => {
  isDraggingPlayhead = false;
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scrollSequencer(e.deltaY, canvas.clientHeight);
  Renderer.markDirty();
}, { passive: false });

// ---------------------------------------------------------------------------
// DOM controls
// ---------------------------------------------------------------------------

const bpmSlider = document.getElementById('bpm-slider') as HTMLInputElement;
const bpmDisplay = document.getElementById('bpm-display') as HTMLElement;

bpmSlider.addEventListener('input', () => {
  const bpm = parseInt(bpmSlider.value, 10);
  setBPM(bpm);
  Scheduler.setBPM(state.bpm);
  bpmDisplay.textContent = String(state.bpm);
});

document.getElementById('add-stanza-btn')?.addEventListener('click', () => {
  addStanza();
  Scheduler.rebuildSequence();
  Renderer.markDirty();
});

document.getElementById('add-track-btn')?.addEventListener('click', () => {
  addTrack();
  addSynth();
  Renderer.markDirty();
  buildSidepanel(document.getElementById('sidepanel') as HTMLElement);
});

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;

  switch (e.key) {
    case 'ArrowUp': {
      e.preventDefault();
      if (e.shiftKey) {
        const src = state.tracks[state.cursorTrack].cells[state.cursorStep];
        if (state.cursorStep > 0) {
          const dst = state.tracks[state.cursorTrack].cells[state.cursorStep - 1];
          dst.active = src.active;
          dst.pitch = src.pitch;
        }
      }
      moveCursor(0, -1);
      Renderer.markDirty();
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      if (e.shiftKey) {
        const src = state.tracks[state.cursorTrack].cells[state.cursorStep];
        if (state.cursorStep < state.totalSteps - 1) {
          const dst = state.tracks[state.cursorTrack].cells[state.cursorStep + 1];
          dst.active = src.active;
          dst.pitch = src.pitch;
        }
      }
      moveCursor(0, 1);
      Renderer.markDirty();
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      moveCursor(-1, 0);
      Renderer.markDirty();
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      moveCursor(1, 0);
      Renderer.markDirty();
      break;
    }
    case 'Enter': {
      e.preventDefault();
      toggleCell(state.cursorTrack, state.cursorStep);
      if (e.shiftKey) {
        moveCursor(0, 1);
      }
      Renderer.markDirty();
      break;
    }
    case ' ': {
      e.preventDefault();
      if (state.isPlaying) {
        Scheduler.pause();
        setPlaying(false);
        setPaused(true);
      } else {
        Scheduler.start();
        setPlaying(true);
        setPaused(false);
        Scheduler.setBPM(state.bpm);
      }
      Renderer.markDirty();
      break;
    }
    case 'Home': {
      e.preventDefault();
      state.cursorStep = 0;
      moveCursor(0, 0);
      Renderer.markDirty();
      break;
    }
    case 'End': {
      e.preventDefault();
      state.cursorStep = state.totalSteps - 1;
      moveCursor(0, 0);
      Renderer.markDirty();
      break;
    }
    case '[': {
      e.preventDefault();
      changeOctaveAtCursor(-1);
      Renderer.markDirty();
      break;
    }
    case ']': {
      e.preventDefault();
      changeOctaveAtCursor(1);
      Renderer.markDirty();
      break;
    }
    case '+':
    case '=': {
      e.preventDefault();
      addStanza();
      Scheduler.rebuildSequence();
      Renderer.markDirty();
      break;
    }
    case '-':
    case '_': {
      e.preventDefault();
      removeStanza();
      Scheduler.rebuildSequence();
      Renderer.markDirty();
      break;
    }
    default: {
      if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        state.cursorTrack = parseInt(e.key, 10) - 1;
        Renderer.markDirty();
      } else if (/^[A-Ga-g]$/.test(e.key)) {
        e.preventDefault();
        editNoteAtCursor(e.key);
        Renderer.markDirty();
      } else if (e.key === '#') {
        e.preventDefault();
        toggleSharpAtCursor();
        Renderer.markDirty();
      }
      break;
    }
  }
});

function changeOctaveAtCursor(delta: number): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) {
    cell.active = true;
  }
  const noteName = cell.pitch.slice(0, -1).replace('#', '');
  const hasSharp = cell.pitch.includes('#');
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const newOctave = Math.max(1, Math.min(octave + delta, 5));

  const tryPitch = `${noteName}${newOctave}`;
  const trySharp = `${noteName}#${newOctave}`;
  if (hasSharp && NOTES.includes(trySharp)) {
    cell.pitch = trySharp;
  } else if (NOTES.includes(tryPitch)) {
    cell.pitch = tryPitch;
  }
}

function editNoteAtCursor(key: string): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) {
    cell.active = true;
  }

  const noteName = key.toUpperCase();
  const octave = parseInt(cell.pitch.slice(-1), 10);

  const tryPitch = `${noteName}${octave}`;
  const trySharp = `${noteName}#${octave}`;
  if (NOTES.includes(tryPitch)) {
    cell.pitch = tryPitch;
  } else if (NOTES.includes(trySharp)) {
    cell.pitch = trySharp;
  }
}

function toggleSharpAtCursor(): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) {
    cell.active = true;
  }

  const noteName = cell.pitch.slice(0, -1).replace('#', '');
  const hasSharp = cell.pitch.includes('#');
  const octave = parseInt(cell.pitch.slice(-1), 10);

  const natural = `${noteName}${octave}`;
  const sharp = `${noteName}#${octave}`;
  if (hasSharp && NOTES.includes(natural)) {
    cell.pitch = natural;
  } else if (!hasSharp && NOTES.includes(sharp)) {
    cell.pitch = sharp;
  }
}

Scheduler.init();
Scheduler.setBPM(state.bpm);

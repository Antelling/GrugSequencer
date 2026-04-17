import './style.css';
import { state, toggleCell, moveCursor, seekToStep, addStanza, addTrack, setPlaying, setPaused, setBPM, removeStanza, NOTES, TRACK_COLORS } from './state.ts';
import { Renderer } from './renderer.ts';
import { Scheduler, setOnStep, addSynth, SYNTH_TYPES, getSynthType, getEnvelope, setEnvelope, swapSynth } from './scheduler.ts';
import type { SynthTypeId } from './scheduler.ts';
import { createSequencerView, scrollSequencer, pitchFromCellX } from './sequencer-view.ts';
import { buildSaveLoadSection } from './sidepanel.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const bottomPanel = document.getElementById('bottom-panel') as HTMLElement;
const panelContent = document.getElementById('panel-content') as HTMLElement;
const panelHandle = document.getElementById('panel-handle') as HTMLElement;

Renderer.init(canvas);
Renderer.registerView(createSequencerView());

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
    const clickedPitch = pitchFromCellX(hit.localX as number);
    if (cell.active && cell.pitch === clickedPitch) {
      cell.active = false;
    } else {
      cell.active = true;
      cell.pitch = clickedPitch;
    }
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

  if (hit.type === 'track-label') {
    openInstrumentPanel(hit.track as number);
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

let touchStartY = 0;
canvas.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1) {
    const dy = touchStartY - e.touches[0].clientY;
    touchStartY = e.touches[0].clientY;
    scrollSequencer(dy, canvas.clientHeight);
    Renderer.markDirty();
  }
}, { passive: true });

// ---------------------------------------------------------------------------
// Bottom panel
// ---------------------------------------------------------------------------

let panelOpenTrack = -1;

function openInstrumentPanel(trackIndex: number): void {
  if (panelOpenTrack === trackIndex && bottomPanel.classList.contains('open')) {
    closePanel();
    return;
  }

  panelContent.innerHTML = '';
  buildInstrumentContent(panelContent, trackIndex);

  panelOpenTrack = trackIndex;
  bottomPanel.classList.add('open');
  Renderer.resize();
}

function closePanel(): void {
  bottomPanel.classList.remove('open');
  panelOpenTrack = -1;
  Renderer.resize();
}

panelHandle.addEventListener('click', closePanel);

function buildInstrumentContent(container: HTMLElement, trackIndex: number): void {
  const track = state.tracks[trackIndex];
  const color = TRACK_COLORS[trackIndex % TRACK_COLORS.length];

  const header = document.createElement('div');
  header.className = 'fp-header';

  const dot = document.createElement('div');
  dot.className = 'sp-track-dot';
  dot.style.background = color;

  const name = document.createElement('span');
  name.style.fontWeight = '600';
  name.style.fontSize = '14px';
  name.textContent = track.name;

  header.appendChild(dot);
  header.appendChild(name);
  container.appendChild(header);

  const synthField = document.createElement('div');
  synthField.className = 'sp-field';
  const synthLabel = document.createElement('label');
  synthLabel.textContent = 'Type';
  const synthSelect = document.createElement('select');
  for (const st of SYNTH_TYPES) {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.label;
    if (st.id === getSynthType(trackIndex)) opt.selected = true;
    synthSelect.appendChild(opt);
  }
  synthSelect.addEventListener('change', () => {
    swapSynth(trackIndex, synthSelect.value as SynthTypeId);
  });
  synthField.appendChild(synthLabel);
  synthField.appendChild(synthSelect);
  container.appendChild(synthField);

  const env = getEnvelope(trackIndex);
  const envParams = [
    { label: 'Attack', param: 'attack', min: 0, max: 1, step: 0.001 },
    { label: 'Decay', param: 'decay', min: 0.001, max: 2, step: 0.001 },
    { label: 'Sustain', param: 'sustain', min: 0, max: 1, step: 0.01 },
    { label: 'Release', param: 'release', min: 0.001, max: 2, step: 0.001 },
  ];
  for (const p of envParams) {
    const val = (env as Record<string, number>)[p.param];
    container.appendChild(makeEnvSlider(trackIndex, p.label, p.param, val, p.min, p.max, p.step));
  }

  container.appendChild(buildSaveLoadSection());
}

function makeEnvSlider(trackIndex: number, label: string, param: string, value: number, min: number, max: number, step: number): HTMLElement {
  const field = document.createElement('div');
  field.className = 'sp-field';

  const lbl = document.createElement('label');
  lbl.textContent = label;

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);

  const valSpan = document.createElement('span');
  valSpan.className = 'sp-val';
  valSpan.textContent = fmtNum(value);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    const env = getEnvelope(trackIndex);
    (env as Record<string, number>)[param] = v;
    setEnvelope(trackIndex, env);
    valSpan.textContent = fmtNum(v);
    Renderer.markDirty();
  });

  field.appendChild(lbl);
  field.appendChild(input);
  field.appendChild(valSpan);
  return field;
}

function fmtNum(n: number): string {
  return n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : String(Math.round(n));
}

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

const playBtn = document.getElementById('play-btn') as HTMLButtonElement;
const stopBtn = document.getElementById('stop-btn') as HTMLButtonElement;

playBtn.addEventListener('click', () => {
  if (state.isPlaying) {
    Scheduler.pause();
    setPlaying(false);
    setPaused(true);
    playBtn.textContent = '▶ Play';
    playBtn.classList.remove('playing');
  } else {
    Scheduler.start();
    setPlaying(true);
    setPaused(false);
    Scheduler.setBPM(state.bpm);
    playBtn.textContent = '❚❚ Pause';
    playBtn.classList.add('playing');
  }
});

stopBtn.addEventListener('click', () => {
  Scheduler.stop();
  setPlaying(false);
  setPaused(false);
  state.currentStep = 0;
  playBtn.textContent = '▶ Play';
  playBtn.classList.remove('playing');
  Renderer.markDirty();
});

document.getElementById('add-track-btn')?.addEventListener('click', () => {
  addTrack();
  addSynth();
  Renderer.markDirty();
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
        playBtn.textContent = '▶ Play';
        playBtn.classList.remove('playing');
      } else {
        Scheduler.start();
        setPlaying(true);
        setPaused(false);
        Scheduler.setBPM(state.bpm);
        playBtn.textContent = '❚❚ Pause';
        playBtn.classList.add('playing');
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
  if (!cell.active) cell.active = true;
  const noteName = cell.pitch.slice(0, -1).replace('#', '');
  const hasSharp = cell.pitch.includes('#');
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const newOctave = Math.max(1, Math.min(octave + delta, 5));
  const tryPitch = `${noteName}${newOctave}`;
  const trySharp = `${noteName}#${newOctave}`;
  if (hasSharp && NOTES.includes(trySharp)) cell.pitch = trySharp;
  else if (NOTES.includes(tryPitch)) cell.pitch = tryPitch;
}

function editNoteAtCursor(key: string): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) cell.active = true;
  const noteName = key.toUpperCase();
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const tryPitch = `${noteName}${octave}`;
  const trySharp = `${noteName}#${octave}`;
  if (NOTES.includes(tryPitch)) cell.pitch = tryPitch;
  else if (NOTES.includes(trySharp)) cell.pitch = trySharp;
}

function toggleSharpAtCursor(): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) cell.active = true;
  const noteName = cell.pitch.slice(0, -1).replace('#', '');
  const hasSharp = cell.pitch.includes('#');
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const natural = `${noteName}${octave}`;
  const sharp = `${noteName}#${octave}`;
  if (hasSharp && NOTES.includes(natural)) cell.pitch = natural;
  else if (!hasSharp && NOTES.includes(sharp)) cell.pitch = sharp;
}

Scheduler.init();
Scheduler.setBPM(state.bpm);

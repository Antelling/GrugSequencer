import './style.css';
import { state, toggleCell, moveCursor, seekToStep, addStanza, addTrack, setPlaying, setPaused, setBPM, removeStanza, TRACK_COLORS, computeTrackNotes, SCALES, SCALE_IDS, NOTE_NAMES, setTrackConfig, DEFAULT_NOTES } from './state.ts';
import { Renderer } from './renderer.ts';
import { Scheduler, setOnStep, addSynth, SYNTH_TYPES, getSynthType, getEnvelope, setEnvelope, swapSynth, getWaveform, previewNote } from './scheduler.ts';
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
    const clickedPitch = pitchFromCellX(track, hit.localX as number);
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
let waveformRaf = 0;

function openInstrumentPanel(trackIndex: number): void {
  cancelAnimationFrame(waveformRaf);
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
  cancelAnimationFrame(waveformRaf);
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

  // Waveform preview
  const waveCanvas = document.createElement('canvas');
  waveCanvas.id = 'waveform-canvas';
  waveCanvas.width = 512;
  waveCanvas.height = 80;
  waveCanvas.style.width = '100%';
  waveCanvas.style.height = '60px';
  waveCanvas.style.borderRadius = '6px';
  waveCanvas.style.background = '#0f0f1a';
  container.appendChild(waveCanvas);

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.textContent = '▶ Preview';
  previewBtn.style.cssText = 'padding:4px 12px;border:1px solid #2a2a40;border-radius:4px;background:#1a1a28;color:#b8b8d0;font-size:11px;cursor:pointer;align-self:flex-start';
  previewBtn.addEventListener('click', () => {
    const notes = computeTrackNotes(track.config);
    previewNote(trackIndex, notes[Math.floor(notes.length / 2)] ?? 'C4');
  });
  container.appendChild(previewBtn);

  // Waveform animation
  const drawWave = () => {
    const ctx = waveCanvas.getContext('2d');
    if (!ctx) return;
    const data = getWaveform(trackIndex);
    ctx.clearRect(0, 0, 512, 80);
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    const sliceW = 512 / data.length;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] as number) * 0.5 + 0.5;
      const y = v * 80;
      if (i === 0) ctx.moveTo(0, y);
      else ctx.lineTo(i * sliceW, y);
    }
    ctx.stroke();
    waveformRaf = requestAnimationFrame(drawWave);
  };
  drawWave();

  // Synth type
  const synthField = makeField('Sound');
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
  synthField.appendChild(synthSelect);
  container.appendChild(synthField);

  // Scale
  const scaleField = makeField('Scale');
  const scaleSelect = document.createElement('select');
  for (const id of SCALE_IDS) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = SCALES[id].label;
    if (id === track.config.scale) opt.selected = true;
    scaleSelect.appendChild(opt);
  }
  scaleSelect.addEventListener('change', () => {
    const config = { ...track.config, scale: scaleSelect.value };
    setTrackConfig(trackIndex, config);
    Renderer.markDirty();
  });
  scaleField.appendChild(scaleSelect);
  container.appendChild(scaleField);

  // Root note
  const rootField = makeField('Root');
  const rootSelect = document.createElement('select');
  for (let i = 0; i < NOTE_NAMES.length; i++) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = NOTE_NAMES[i];
    if (i === track.config.root) opt.selected = true;
    rootSelect.appendChild(opt);
  }
  rootSelect.addEventListener('change', () => {
    const config = { ...track.config, root: parseInt(rootSelect.value, 10) };
    setTrackConfig(trackIndex, config);
    Renderer.markDirty();
  });
  rootField.appendChild(rootSelect);
  container.appendChild(rootField);

  // Octave range
  const octField = makeField('Octave');
  const octLow = document.createElement('select');
  const octHigh = document.createElement('select');
  for (let o = 2; o <= 6; o++) {
    const optLow = document.createElement('option');
    optLow.value = String(o);
    optLow.textContent = String(o);
    if (o === track.config.octaveLow) optLow.selected = true;
    octLow.appendChild(optLow);

    const optHigh = document.createElement('option');
    optHigh.value = String(o);
    optHigh.textContent = String(o);
    if (o === track.config.octaveHigh) optHigh.selected = true;
    octHigh.appendChild(optHigh);
  }
  const octSep = document.createElement('span');
  octSep.textContent = '–';
  octSep.style.color = '#8888a0';
  const updateOctave = () => {
    let lo = parseInt(octLow.value, 10);
    let hi = parseInt(octHigh.value, 10);
    if (hi < lo) hi = lo;
    const config = { ...track.config, octaveLow: lo, octaveHigh: hi };
    setTrackConfig(trackIndex, config);
    Renderer.markDirty();
  };
  octLow.addEventListener('change', updateOctave);
  octHigh.addEventListener('change', updateOctave);
  octField.appendChild(octLow);
  octField.appendChild(octSep);
  octField.appendChild(octHigh);
  container.appendChild(octField);

  // Friendly ADSR
  const env = getEnvelope(trackIndex);
  const envLabels: [string, string, number, number, number][] = [
    ['Snap', 'attack', 0, 1, 0.001],
    ['Punch', 'decay', 0.001, 2, 0.001],
    ['Hold', 'sustain', 0, 1, 0.01],
    ['Fade', 'release', 0.001, 2, 0.001],
  ];
  for (const [label, param, min, max, step] of envLabels) {
    const val = (env as Record<string, number>)[param];
    container.appendChild(makeEnvSlider(trackIndex, label, param, val, min, max, step));
  }

  container.appendChild(buildSaveLoadSection());
}

function makeField(label: string): HTMLElement {
  const field = document.createElement('div');
  field.className = 'sp-field';
  const lbl = document.createElement('label');
  lbl.textContent = label;
  field.appendChild(lbl);
  return field;
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
  if (hasSharp && DEFAULT_NOTES.includes(trySharp)) cell.pitch = trySharp;
  else if (DEFAULT_NOTES.includes(tryPitch)) cell.pitch = tryPitch;
}

function editNoteAtCursor(key: string): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) cell.active = true;
  const noteName = key.toUpperCase();
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const tryPitch = `${noteName}${octave}`;
  const trySharp = `${noteName}#${octave}`;
  if (DEFAULT_NOTES.includes(tryPitch)) cell.pitch = tryPitch;
  else if (DEFAULT_NOTES.includes(trySharp)) cell.pitch = trySharp;
}

function toggleSharpAtCursor(): void {
  const cell = state.tracks[state.cursorTrack].cells[state.cursorStep];
  if (!cell.active) cell.active = true;
  const noteName = cell.pitch.slice(0, -1).replace('#', '');
  const hasSharp = cell.pitch.includes('#');
  const octave = parseInt(cell.pitch.slice(-1), 10);
  const natural = `${noteName}${octave}`;
  const sharp = `${noteName}#${octave}`;
  if (hasSharp && DEFAULT_NOTES.includes(natural)) cell.pitch = natural;
  else if (!hasSharp && DEFAULT_NOTES.includes(sharp)) cell.pitch = sharp;
}

Scheduler.init();
Scheduler.setBPM(state.bpm);

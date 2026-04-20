import './style.css';
import { state, toggleCell, moveCursor, seekToStep, addStanza, addTrack, setPlaying, setPaused, setBPM, removeStanza, TRACK_COLORS, computeTrackNotes, SCALES, SCALE_IDS, NOTE_NAMES, setTrackConfig, DEFAULT_NOTES, initTracks, setLoopRange, isConsumedStep, mergeCells, unmergeCells, setMergeMode, getMergeAnchorForStep } from './state.ts';
import { Renderer } from './renderer.ts';
import { Scheduler, setOnStep, addSynth, synths, SYNTH_TYPES, getSynthType, getEnvelope, setEnvelope, swapSynth, getWaveform, previewNote } from './scheduler.ts';
import type { SynthTypeId } from './scheduler.ts';
import { createSequencerView, scrollSequencer, pitchFromCellX } from './sequencer-view.ts';
import { listProjects, loadProject, saveProject, deleteProject, getCurrentProject, setCurrentProject } from './projects.ts';
import type { ProjectData } from './projects.ts';

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const bottomPanel = document.getElementById('bottom-panel') as HTMLElement;
const panelContent = document.getElementById('panel-content') as HTMLElement;
const panelHandle = document.getElementById('panel-handle') as HTMLElement;
const projectBtn = document.getElementById('project-btn') as HTMLButtonElement;
const projectNameEl = document.getElementById('project-name') as HTMLElement;

Renderer.init(canvas);
Renderer.registerView(createSequencerView());

setOnStep((step: number) => {
  setTimeout(() => {
    state.currentStep = step;
    Renderer.markDirty();
  }, 150);
});

// ---------------------------------------------------------------------------
// State serialization helpers
// ---------------------------------------------------------------------------

function serializeCurrentState(): ProjectData {
  const currentName = getCurrentProject() ?? 'Untitled';
  return {
    name: currentName,
    bpm: state.bpm,
    totalSteps: state.totalSteps,
    tracks: state.tracks.map((t, i) => ({
      name: t.name,
      color: t.color,
      cells: t.cells,
      config: t.config,
      synthType: getSynthType(i),
      envelope: getEnvelope(i),
    })),
  };
}

function deserializeToState(data: ProjectData): void {
  state.bpm = data.bpm;
  state.totalSteps = data.totalSteps;
  state.tracks = data.tracks.map((t, i) => {
    while (synths.length <= i) { addSynth(); }
    swapSynth(i, t.synthType);
    setEnvelope(i, t.envelope);
    return {
      name: t.name,
      color: t.color,
      cells: t.cells.map(c => ({
        active: c.active,
        pitch: c.pitch,
        mergeLength: c.mergeLength ?? 1,
      })),
      config: t.config ?? { scale: 'pentatonic', root: 0, octaveLow: 4, octaveHigh: 4 },
    };
  });
  (document.getElementById('bpm-slider') as HTMLInputElement).value = String(state.bpm);
  (document.getElementById('bpm-display') as HTMLElement).textContent = String(state.bpm);
  Scheduler.rebuildSequence();
  Renderer.markDirty();
}

function updateProjectNameDisplay(): void {
  const name = getCurrentProject();
  projectNameEl.textContent = name ?? 'New Project';
}

// ---------------------------------------------------------------------------
// Pointer events
// ---------------------------------------------------------------------------

type DragMode = 'none' | 'playhead' | 'loop-start' | 'loop-end'

let dragMode: DragMode = 'none'
let dragMoved = false
let longPressTimer: number | null = null;
let longPressFired = false;
let pendingCellHit: { track: number; step: number; clickedPitch: string } | null = null;

function canvasCoords(e: PointerEvent): { x: number; y: number } {
  const rect = canvas.getBoundingClientRect()
  return { x: e.clientX - rect.left, y: e.clientY - rect.top }
}

function stepFromY(y: number): number {
  const hit = Renderer.handlePointer(0, y)
  if (hit?.type === 'step-label' || hit?.type === 'cell') {
    return (hit.step as number) ?? state.currentStep
  }
  return state.currentStep
}

canvas.addEventListener('pointerdown', (e) => {
  const { x, y } = canvasCoords(e);
  const hit = Renderer.handlePointer(x, y);
  if (!hit) {
    if (state.mergeMode) {
      setMergeMode(false);
      Renderer.markDirty();
    }
    return;
  }

  if (hit.type === 'playhead-handle') {
    dragMode = 'playhead'
    dragMoved = false
    Renderer.markDirty()
    return
  }

  if (hit.type === 'loop-handle') {
    dragMode = hit.handle === 'start' ? 'loop-start' : 'loop-end'
    dragMoved = false
    Renderer.markDirty()
    return
  }

  if (hit.type === 'cell') {
    const track = hit.track as number;
    const step = hit.step as number;
    const clickedPitch = pitchFromCellX(track, hit.localX as number);
    
    if (state.mergeMode) {
      if (track === state.mergeAnchor?.track) {
        const anchor = state.mergeAnchor;
        const anchorCell = state.tracks[anchor.track].cells[anchor.step];
        const groupEnd = anchor.step + anchorCell.mergeLength - 1;
        
        if (step === anchor.step - 1 || step === groupEnd + 1) {
          if (mergeCells(track, step)) {
            Scheduler.rebuildSequence();
            Renderer.markDirty();
            return;
          }
        }
      }
      setMergeMode(false);
      Renderer.markDirty();
      return;
    }
    
    pendingCellHit = { track, step, clickedPitch };
    longPressFired = false;
    
    longPressTimer = window.setTimeout(() => {
      longPressFired = true;
      pendingCellHit = null;
      
      const currentCell = state.tracks[track].cells[step];
      if (isConsumedStep(track, step)) {
        const anchorStep = getMergeAnchorForStep(track, step);
        unmergeCells(track, anchorStep);
        Scheduler.rebuildSequence();
        Renderer.markDirty();
        return;
      }
      
      if (currentCell.mergeLength > 1) {
        unmergeCells(track, step);
        Scheduler.rebuildSequence();
        Renderer.markDirty();
        return;
      }
      
      if (currentCell.active) {
        setMergeMode(true, { track, step });
        Renderer.markDirty();
      }
    }, 350);
    
    return;
  }

  if (hit.type === 'step-label') {
    const step = hit.step as number;
    seekToStep(step);
    if (state.isPlaying) {
      Scheduler.seekTo(step);
    }
    dragMode = 'playhead';
    dragMoved = false;
    Renderer.markDirty();
    return;
  }

  if (hit.type === 'track-label') {
    openInstrumentPanel(hit.track as number);
    return;
  }
});

canvas.addEventListener('pointermove', (e) => {
  if (dragMode === 'none') return
  const { y } = canvasCoords(e)
  dragMoved = true

  if (dragMode === 'playhead') {
    const step = stepFromY(y)
    seekToStep(step)
    if (state.isPlaying) {
      Scheduler.seekTo(step)
    }
    Renderer.markDirty()
    return
  }

  if (dragMode === 'loop-start') {
    const step = stepFromY(y)
    setLoopRange(step, state.loopEnd)
    if (state.isPlaying) {
      Scheduler.rebuildSequence()
    }
    Renderer.markDirty()
    return
  }

  if (dragMode === 'loop-end') {
    const step = stepFromY(y)
    setLoopRange(state.loopStart, step + 1)
    if (state.isPlaying) {
      Scheduler.rebuildSequence()
    }
    Renderer.markDirty()
    return
  }
});

canvas.addEventListener('pointerup', () => {
  if (longPressTimer !== null) {
    clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  
  if (!longPressFired && pendingCellHit) {
    const { track, step, clickedPitch } = pendingCellHit;
    const cell = state.tracks[track].cells[step];
    if (cell.active && cell.pitch === clickedPitch) {
      if (cell.mergeLength > 1) {
        unmergeCells(track, step);
      }
      cell.active = false;
    } else {
      cell.active = true;
      cell.pitch = clickedPitch;
    }
    state.cursorTrack = track;
    state.cursorStep = step;
    moveCursor(0, 1);
    Renderer.markDirty();
    pendingCellHit = null;
  }
  
  if (!dragMoved) {
    if (dragMode === 'loop-start') {
      setLoopRange(0, state.loopEnd)
    } else if (dragMode === 'loop-end') {
      setLoopRange(state.loopStart, state.totalSteps)
    }
  }
  if (dragMode === 'loop-start' || dragMode === 'loop-end') {
    Scheduler.rebuildSequence()
  }
  dragMode = 'none'
});

canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  scrollSequencer(e.deltaY, canvas.clientHeight);
  Renderer.markDirty();
}, { passive: false });

let touchStartY = 0;
canvas.addEventListener('touchstart', (e) => {
  if (dragMode !== 'none') return
  if (e.touches.length === 1) {
    touchStartY = e.touches[0].clientY;
  }
}, { passive: true });

canvas.addEventListener('touchmove', (e) => {
  if (dragMode !== 'none') return
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
let panelMode: 'instrument' | 'project' = 'instrument';

function openInstrumentPanel(trackIndex: number): void {
  cancelAnimationFrame(waveformRaf);
  panelMode = 'instrument';

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

function openProjectPanel(): void {
  cancelAnimationFrame(waveformRaf);
  panelMode = 'project';

  panelContent.innerHTML = '';
  buildProjectPanel(panelContent);

  panelOpenTrack = -1;
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

// ---------------------------------------------------------------------------
// Project panel
// ---------------------------------------------------------------------------

function buildProjectPanel(container: HTMLElement): void {
  const panel = document.createElement('div');
  panel.className = 'project-panel';

  const header = document.createElement('div');
  header.className = 'project-panel-header';
  const title = document.createElement('h2');
  title.textContent = 'Projects';
  const newBtn = document.createElement('button');
  newBtn.type = 'button';
  newBtn.className = 'project-new-btn';
  newBtn.textContent = '+ New';
  newBtn.addEventListener('click', () => {
    const name = prompt('Project name:');
    if (!name) return;
    const existing = loadProject(name);
    if (existing) {
      alert('A project with that name already exists.');
      return;
    }
    initTracks();
    state.bpm = 120;
    state.currentStep = 0;
    state.cursorTrack = 0;
    state.cursorStep = 0;
    const targetTracks = state.tracks.length;
    while (synths.length < targetTracks) { addSynth(); }
    for (let i = 0; i < targetTracks; i++) {
      swapSynth(i, 'Synth');
      setEnvelope(i, { attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.08 });
    }
    Scheduler.setBPM(state.bpm);
    setCurrentProject(name);
    const data = serializeCurrentState();
    data.name = name;
    saveProject(data);
    updateProjectNameDisplay();
    (document.getElementById('bpm-slider') as HTMLInputElement).value = String(state.bpm);
    (document.getElementById('bpm-display') as HTMLElement).textContent = String(state.bpm);
    closePanel();
    Renderer.markDirty();
  });
  header.appendChild(title);
  header.appendChild(newBtn);
  panel.appendChild(header);

  const currentName = getCurrentProject();

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.style.cssText = 'padding:8px;border:1px solid #2a2a40;border-radius:6px;background:#1a1a28;color:#b8b8d0;font-size:12px;font-weight:600;cursor:pointer';
  saveBtn.textContent = currentName ? `Save "${currentName}"` : 'Save Current';
  saveBtn.addEventListener('click', () => {
    let name = getCurrentProject();
    if (!name) {
      name = prompt('Save project as:');
      if (!name) return;
    }
    const data = serializeCurrentState();
    data.name = name;
    saveProject(data);
    updateProjectNameDisplay();
    buildProjectPanel(container);
  });
  panel.appendChild(saveBtn);

  const projects = listProjects();
  if (projects.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'project-empty';
    empty.textContent = 'No saved projects yet.';
    panel.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'project-list';

    for (const name of projects) {
      const row = document.createElement('div');
      row.className = 'project-row';
      if (name === currentName) row.classList.add('current');

      const nameEl = document.createElement('span');
      nameEl.className = 'project-row-name';
      nameEl.textContent = name;

      const meta = document.createElement('span');
      meta.className = 'project-row-meta';
      const pData = loadProject(name);
      meta.textContent = pData ? `${pData.tracks.length} inst · ${pData.totalSteps} steps` : '';

      row.appendChild(nameEl);
      row.appendChild(meta);

      row.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).closest('.project-row-delete')) return;
        const pData = loadProject(name);
        if (!pData) return;
        deserializeToState(pData);
        setCurrentProject(name);
        updateProjectNameDisplay();
        closePanel();
      });

      const delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'project-row-delete';
      delBtn.textContent = '✕';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${name}"?`)) return;
        deleteProject(name);
        updateProjectNameDisplay();
        buildProjectPanel(container);
      });

      row.appendChild(delBtn);
      list.appendChild(row);
    }

    panel.appendChild(list);
  }

  container.innerHTML = '';
  container.appendChild(panel);
}

projectBtn.addEventListener('click', () => {
  if (panelMode === 'project' && bottomPanel.classList.contains('open')) {
    closePanel();
    return;
  }
  openProjectPanel();
});

// ---------------------------------------------------------------------------
// Instrument panel content
// ---------------------------------------------------------------------------

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

  // ADSR
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

playBtn.addEventListener('click', () => {
  if (state.isPlaying) {
    Scheduler.pause();
    setPlaying(false);
    setPaused(true);
    playBtn.textContent = '▶';
    playBtn.classList.remove('playing');
  } else {
    Scheduler.start();
    setPlaying(true);
    setPaused(false);
    Scheduler.setBPM(state.bpm);
    playBtn.textContent = '❚❚';
    playBtn.classList.add('playing');
  }
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
        playBtn.textContent = '▶';
        playBtn.classList.remove('playing');
      } else {
        Scheduler.start();
        setPlaying(true);
        setPaused(false);
        Scheduler.setBPM(state.bpm);
        playBtn.textContent = '❚❚';
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

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

Scheduler.init();
Scheduler.setBPM(state.bpm);

const savedProjectName = getCurrentProject();
if (savedProjectName) {
  const saved = loadProject(savedProjectName);
  if (saved) {
    deserializeToState(saved);
  }
}
updateProjectNameDisplay();

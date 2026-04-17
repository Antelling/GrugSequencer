import * as Tone from 'tone';
import './style.css';

interface Cell {
  active: boolean;
  pitch: string;
}

type TrackSynth = Tone.PolySynth | Tone.Synth | Tone.AMSynth | Tone.FMSynth | Tone.DuoSynth | Tone.MembraneSynth | Tone.MetalSynth | Tone.PluckSynth;

interface Track {
  name: string;
  synth: TrackSynth;
  color: string;
  cells: Cell[];
}

const TRACK_COUNT = 8;
const NOTES = ['C3', 'C#3', 'D3', 'D#3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'A#3', 'B3', 'C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4', 'C5'];

const TRACK_COLORS = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#00d2d3', '#1dd1a1'
];

function createSynth(index: number): TrackSynth {
  switch (index % 8) {
    case 0: return new Tone.PolySynth(Tone.Synth).toDestination();
    case 1: return new Tone.AMSynth().toDestination();
    case 2: return new Tone.FMSynth().toDestination();
    case 3: return new Tone.DuoSynth().toDestination();
    case 4: return new Tone.MembraneSynth().toDestination();
    case 5: return new Tone.MetalSynth().toDestination();
    case 6: return new Tone.PluckSynth().toDestination();
    case 7: return new Tone.PolySynth(Tone.Synth, {
      oscillator: { type: 'sawtooth' }
    }).toDestination();
    default: return new Tone.Synth().toDestination();
  }
}

const STANZA_SIZE = 4;
let totalSteps = 16;

const tracks: Track[] = Array.from({ length: TRACK_COUNT }, (_, i) => ({
  name: `T${i + 1}`,
  synth: createSynth(i),
  color: TRACK_COLORS[i],
  cells: Array.from({ length: totalSteps }, () => ({
    active: false,
    pitch: 'C4'
  }))
}));

let isPlaying = false;
let isPaused = false;
let sequence: Tone.Sequence | null = null;
let currentStep = 0;
let cursorTrack = 0;
let cursorStep = 0;
let isDraggingPlayhead = false;
let helpOpen = false;

function addStanza() {
  const count = STANZA_SIZE;
  totalSteps += count;
  tracks.forEach(track => {
    for (let i = 0; i < count; i++) {
      track.cells.push({ active: false, pitch: 'C4' });
    }
  });
  rebuildSequence();
  renderGrid();
  updateStanzaLabel();
}

function removeStanza() {
  if (totalSteps <= STANZA_SIZE) return;
  totalSteps -= STANZA_SIZE;
  tracks.forEach(track => {
    track.cells.length = totalSteps;
  });
  if (currentStep >= totalSteps) currentStep = 0;
  if (cursorStep >= totalSteps) cursorStep = totalSteps - 1;
  rebuildSequence();
  renderGrid();
  updateStanzaLabel();
}

function updateStanzaLabel() {
  const countEl = document.querySelector('.stanza-count') as HTMLElement | null;
  const stanzas = totalSteps / STANZA_SIZE;
  if (countEl) countEl.textContent = `${stanzas} stanzas · ${totalSteps} steps`;
}

function createSequence() {
  if (sequence) {
    sequence.dispose();
  }
  sequence = new Tone.Sequence((time, step) => {
    tracks.forEach(track => {
      const cell = track.cells[step];
      if (cell.active) {
        track.synth.triggerAttackRelease(cell.pitch, '16n', time);
      }
    });
    Tone.Draw.schedule(() => {
      updatePlayhead(step);
    }, time);
  }, Array.from({ length: totalSteps }, (_, i) => i), '16n');
}

function rebuildSequence() {
  const wasPlaying = isPlaying;
  createSequence();
  if (wasPlaying) {
    sequence!.start(0);
  }
}

function updatePlayhead(step: number) {
  currentStep = step;
  updatePlayheadVisuals();
}

function updatePlayheadVisuals() {
  document.querySelectorAll('.cell').forEach(el => {
    el.classList.remove('playing');
  });
  if ((isPlaying || isPaused) && currentStep >= 0) {
    document.querySelectorAll(`.step-${currentStep}`).forEach(el => {
      el.classList.add('playing');
    });
  }

  const playheadLine = document.querySelector('.playhead-line') as HTMLElement | null;
  const gridWrapper = document.querySelector('.grid-wrapper') as HTMLElement | null;
  const row = document.querySelector(`.grid-row[data-step="${currentStep}"]`) as HTMLElement | null;

  if (playheadLine && gridWrapper && row) {
    const gridRect = gridWrapper.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    playheadLine.style.top = `${rowRect.top - gridRect.top + rowRect.height / 2}px`;
  }

  document.querySelectorAll('.cell').forEach(el => {
    el.classList.remove('cursor');
  });
  const cursorCell = document.querySelector(`.cell[data-track="${cursorTrack}"][data-step="${cursorStep}"]`) as HTMLElement | null;
  if (cursorCell) {
    cursorCell.classList.add('cursor');
  }
}

function toggleCell(trackIndex: number, stepIndex: number) {
  const cell = tracks[trackIndex].cells[stepIndex];
  cell.active = !cell.active;
  renderGrid();
}

function setPitch(trackIndex: number, stepIndex: number, pitch: string) {
  tracks[trackIndex].cells[stepIndex].pitch = pitch;
}

function seekToStep(step: number) {
  const clamped = Math.max(0, Math.min(step, totalSteps - 1));
  currentStep = clamped;
  if (isPlaying) {
    Tone.Transport.position = Tone.Time('16n').toSeconds() * clamped;
  }
  updatePlayheadVisuals();
}

async function startPlayback() {
  if (isPlaying) return;
  await Tone.start();

  createSequence();

  if (!isPaused) {
    Tone.Transport.position = Tone.Time('16n').toSeconds() * currentStep;
  }

  sequence!.start(0);
  Tone.Transport.start();
  isPlaying = true;
  isPaused = false;
  updateTransportButtons();
  updatePlayheadVisuals();
}

function pausePlayback() {
  if (!isPlaying) return;
  Tone.Transport.pause();
  isPlaying = false;
  isPaused = true;
  updateTransportButtons();
}

function stopPlayback() {
  Tone.Transport.stop();
  Tone.Transport.position = 0;
  isPlaying = false;
  isPaused = false;
  currentStep = 0;
  updatePlayheadVisuals();
  updateTransportButtons();
}

function updateTransportButtons() {
  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');
  const stopBtn = document.getElementById('stop-btn');
  if (playBtn) playBtn.classList.toggle('active', isPlaying);
  if (pauseBtn) pauseBtn.classList.toggle('active', isPaused);
  if (stopBtn) stopBtn.classList.toggle('active', !isPlaying && !isPaused);
}

function setBPM(value: number) {
  const bpm = Math.max(40, Math.min(Math.round(value), 300));
  Tone.Transport.bpm.value = bpm;
  const slider = document.getElementById('bpm-slider') as HTMLInputElement | null;
  const display = document.getElementById('bpm-display') as HTMLElement | null;
  if (slider) slider.value = String(bpm);
  if (display) display.textContent = String(bpm);
}

function moveCursor(dTrack: number, dStep: number) {
  cursorTrack = Math.max(0, Math.min(cursorTrack + dTrack, TRACK_COUNT - 1));
  cursorStep = Math.max(0, Math.min(cursorStep + dStep, totalSteps - 1));
  updatePlayheadVisuals();
  scrollCursorIntoView();
}

function scrollCursorIntoView() {
  const cursorCell = document.querySelector(`.cell[data-track="${cursorTrack}"][data-step="${cursorStep}"]`) as HTMLElement | null;
  if (cursorCell) {
    cursorCell.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function changeOctaveAtCursor(delta: number) {
  const cell = tracks[cursorTrack].cells[cursorStep];
  if (!cell.active) {
    cell.active = true;
  }
  let noteName = cell.pitch.slice(0, -1).replace('#', '');
  let hasSharp = cell.pitch.includes('#');
  let octave = parseInt(cell.pitch.slice(-1), 10);
  let newOctave = Math.max(1, Math.min(octave + delta, 5));

  const tryPitch = `${noteName}${newOctave}`;
  const trySharp = `${noteName}#${newOctave}`;
  if (hasSharp && NOTES.includes(trySharp)) {
    cell.pitch = trySharp;
  } else if (NOTES.includes(tryPitch)) {
    cell.pitch = tryPitch;
  }
  renderGrid();
}

function editNoteAtCursor(key: string) {
  const cell = tracks[cursorTrack].cells[cursorStep];
  if (!cell.active) {
    cell.active = true;
  }

  const noteMatch = key.match(/^[A-Ga-g]$/);
  const sharpMatch = key === '#';

  let current = cell.pitch;
  let noteName = current.slice(0, -1).replace('#', '');
  let hasSharp = current.includes('#');
  let octave = parseInt(current.slice(-1), 10);

  if (noteMatch) {
    noteName = noteMatch[0].toUpperCase();
    const tryPitch = `${noteName}${octave}`;
    const trySharp = `${noteName}#${octave}`;
    if (NOTES.includes(tryPitch)) {
      current = tryPitch;
    } else if (NOTES.includes(trySharp)) {
      current = trySharp;
    }
  } else if (sharpMatch) {
    const natural = `${noteName}${octave}`;
    const sharp = `${noteName}#${octave}`;
    if (hasSharp && NOTES.includes(natural)) {
      current = natural;
    } else if (!hasSharp && NOTES.includes(sharp)) {
      current = sharp;
    }
  }

  if (NOTES.includes(current)) {
    cell.pitch = current;
  }
  renderGrid();
}

function handleKeyDown(e: KeyboardEvent) {
  const activeEl = document.activeElement;
  if (activeEl && (activeEl.tagName === 'SELECT' || activeEl.tagName === 'INPUT')) {
    if (e.key === 'Escape') {
      (activeEl as HTMLElement).blur();
    }
    return;
  }

  if (e.key === '?' || (e.shiftKey && e.key === '/')) {
    e.preventDefault();
    toggleHelp();
    return;
  }

  switch (e.key) {
    case 'ArrowUp': {
      e.preventDefault();
      if (e.shiftKey) {
        const src = tracks[cursorTrack].cells[cursorStep];
        if (cursorStep > 0) {
          const dst = tracks[cursorTrack].cells[cursorStep - 1];
          dst.active = src.active;
          dst.pitch = src.pitch;
          renderGrid();
        }
      }
      moveCursor(0, -1);
      break;
    }
    case 'ArrowDown': {
      e.preventDefault();
      if (e.shiftKey) {
        const src = tracks[cursorTrack].cells[cursorStep];
        if (cursorStep < totalSteps - 1) {
          const dst = tracks[cursorTrack].cells[cursorStep + 1];
          dst.active = src.active;
          dst.pitch = src.pitch;
          renderGrid();
        }
      }
      moveCursor(0, 1);
      break;
    }
    case 'ArrowLeft': {
      e.preventDefault();
      moveCursor(-1, 0);
      break;
    }
    case 'ArrowRight': {
      e.preventDefault();
      moveCursor(1, 0);
      break;
    }
    case 'Enter': {
      e.preventDefault();
      toggleCell(cursorTrack, cursorStep);
      if (e.shiftKey) {
        moveCursor(0, 1);
      }
      break;
    }
    case ' ': {
      e.preventDefault();
      if (isPlaying) {
        pausePlayback();
      } else {
        startPlayback();
      }
      break;
    }
    case 'Home': {
      e.preventDefault();
      cursorStep = 0;
      moveCursor(0, 0);
      break;
    }
    case 'End': {
      e.preventDefault();
      cursorStep = totalSteps - 1;
      moveCursor(0, 0);
      break;
    }
    case '[': {
      e.preventDefault();
      changeOctaveAtCursor(-1);
      break;
    }
    case ']': {
      e.preventDefault();
      changeOctaveAtCursor(1);
      break;
    }
    default: {
      if (/^[1-8]$/.test(e.key)) {
        e.preventDefault();
        cursorTrack = parseInt(e.key, 10) - 1;
        moveCursor(0, 0);
      } else if (/^[A-Ga-g#]$/.test(e.key)) {
        e.preventDefault();
        editNoteAtCursor(e.key);
      }
      break;
    }
  }
}

function toggleHelp() {
  helpOpen = !helpOpen;
  const panel = document.getElementById('help-panel');
  if (panel) {
    panel.classList.toggle('open', helpOpen);
  }
}

function renderGrid() {
  const grid = document.getElementById('grid');
  if (!grid) return;
  grid.innerHTML = '';

  const headerRow = document.createElement('div');
  headerRow.className = 'grid-row header-row';
  headerRow.innerHTML = '<div class="step-label"></div>' +
    tracks.map(t => `<div class="track-label" style="color:${t.color}">${t.name}</div>`).join('');
  grid.appendChild(headerRow);

  for (let step = 0; step < totalSteps; step++) {
    const row = document.createElement('div');
    row.className = 'grid-row';
    row.setAttribute('data-step', String(step));

    const stepLabel = document.createElement('div');
    stepLabel.className = 'step-label';
    stepLabel.textContent = `${step + 1}`;
    stepLabel.addEventListener('click', () => seekToStep(step));
    row.appendChild(stepLabel);

    for (let track = 0; track < TRACK_COUNT; track++) {
      const cell = tracks[track].cells[step];
      const cellEl = document.createElement('div');
      cellEl.className = `cell step-${step} ${cell.active ? 'active' : ''}`;
      cellEl.style.setProperty('--track-color', tracks[track].color);
      cellEl.setAttribute('data-track', String(track));
      cellEl.setAttribute('data-step', String(step));

      if (cell.active) {
        const select = document.createElement('select');
        select.className = 'pitch-select';
        NOTES.forEach(note => {
          const opt = document.createElement('option');
          opt.value = note;
          opt.textContent = note;
          if (note === cell.pitch) {
            opt.selected = true;
          }
          select.appendChild(opt);
        });
        select.addEventListener('click', e => e.stopPropagation());
        select.addEventListener('change', e => {
          setPitch(track, step, (e.target as HTMLSelectElement).value);
        });
        cellEl.appendChild(select);
      }

      cellEl.addEventListener('click', () => {
        cursorTrack = track;
        cursorStep = step;
        toggleCell(track, step);
      });
      row.appendChild(cellEl);
    }

    grid.appendChild(row);
  }

  updatePlayheadVisuals();
}

function initUI() {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="sequencer-container">
      <h1>Step Sequencer</h1>
      <div class="controls">
        <button id="play-btn" class="control-btn">▶ Play</button>
        <button id="pause-btn" class="control-btn">⏸ Pause</button>
        <button id="stop-btn" class="control-btn active">⏹ Stop</button>
        <button id="help-btn" class="control-btn">? Help</button>
      </div>
      <div class="step-controls">
        <button id="add-stanza-btn" class="step-btn">+ Stanza</button>
        <button id="remove-stanza-btn" class="step-btn">- Stanza</button>
        <span class="stanza-count">4 stanzas · 16 steps</span>
      </div>
      <div class="bpm-control">
        <label for="bpm-slider">BPM</label>
        <input id="bpm-slider" type="range" min="40" max="300" value="120" />
        <span id="bpm-display" class="bpm-display">120</span>
      </div>
      <div class="grid-wrapper">
        <div id="grid" class="grid"></div>
        <div class="playhead-line">
          <div class="playhead-handle"></div>
        </div>
      </div>
      <div class="instructions">
        <p>Use keyboard shortcuts for speed. Press <strong>?</strong> for help.</p>
      </div>
    </div>
    <div id="help-panel" class="help-panel">
      <div class="help-content">
        <h2>Keyboard Shortcuts</h2>
        <ul>
          <li><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd> — Move cursor</li>
          <li><kbd>Enter</kbd> — Toggle note at cursor</li>
          <li><kbd>Shift</kbd> + <kbd>Enter</kbd> — Toggle note and move down</li>
          <li><kbd>Shift</kbd> + <kbd>↑</kbd> / <kbd>↓</kbd> — Copy note to adjacent step</li>
          <li><kbd>A</kbd> … <kbd>G</kbd> — Set note letter at cursor</li>
          <li><kbd>#</kbd> — Toggle sharp / natural</li>
          <li><kbd>[</kbd> / <kbd>]</kbd> — Octave down / up</li>
          <li><kbd>Space</kbd> — Play / Pause</li>
          <li><kbd>1</kbd> … <kbd>8</kbd> — Jump to track column</li>
          <li><kbd>Home</kbd> — Jump to first step</li>
          <li><kbd>End</kbd> — Jump to last step</li>
          <li><kbd>?</kbd> — Toggle this help panel</li>
        </ul>
        <h3>Mouse</h3>
        <ul>
          <li>Click any cell to toggle a note</li>
          <li>Click step number to seek playhead</li>
          <li>Drag the white playhead line to scrub playback position</li>
          <li>Drag the BPM slider to change tempo</li>
        </ul>
        <button id="close-help-btn" class="control-btn">Close</button>
      </div>
    </div>
  `;

  document.getElementById('play-btn')?.addEventListener('click', startPlayback);
  document.getElementById('pause-btn')?.addEventListener('click', pausePlayback);
  document.getElementById('stop-btn')?.addEventListener('click', stopPlayback);
  document.getElementById('help-btn')?.addEventListener('click', toggleHelp);
  document.getElementById('close-help-btn')?.addEventListener('click', toggleHelp);
  document.getElementById('add-stanza-btn')?.addEventListener('click', addStanza);
  document.getElementById('remove-stanza-btn')?.addEventListener('click', removeStanza);
  document.getElementById('bpm-slider')?.addEventListener('input', e => {
    setBPM(parseInt((e.target as HTMLInputElement).value, 10));
  });

  const playheadLine = document.querySelector('.playhead-line') as HTMLElement | null;
  const gridWrapper = document.querySelector('.grid-wrapper') as HTMLElement | null;

  if (playheadLine && gridWrapper) {
    playheadLine.addEventListener('mousedown', e => {
      isDraggingPlayhead = true;
      e.preventDefault();
      handleDragSeek(e.clientY);
    });

    gridWrapper.addEventListener('mousedown', e => {
      const target = e.target as HTMLElement;
      if (target === gridWrapper || target.classList.contains('grid') || target.classList.contains('playhead-line')) {
        isDraggingPlayhead = true;
        handleDragSeek(e.clientY);
      }
    });
  }

  document.addEventListener('mousemove', e => {
    if (isDraggingPlayhead) {
      handleDragSeek(e.clientY);
    }
  });

  document.addEventListener('mouseup', () => {
    isDraggingPlayhead = false;
  });

  document.addEventListener('keydown', handleKeyDown);

  setBPM(120);
  renderGrid();
}

function handleDragSeek(clientY: number) {
  const gridWrapper = document.querySelector('.grid-wrapper') as HTMLElement | null;
  if (!gridWrapper) return;
  const gridRect = gridWrapper.getBoundingClientRect();
  const relativeY = clientY - gridRect.top;
  const rows = Array.from(document.querySelectorAll('.grid-row[data-step]')) as HTMLElement[];
  let closestStep = 0;
  let minDistance = Infinity;
  rows.forEach(r => {
    const rect = r.getBoundingClientRect();
    const centerY = rect.top - gridRect.top + rect.height / 2;
    const dist = Math.abs(centerY - relativeY);
    if (dist < minDistance) {
      minDistance = dist;
      closestStep = parseInt(r.getAttribute('data-step') || '0', 10);
    }
  });
  seekToStep(closestStep);
}

initUI();

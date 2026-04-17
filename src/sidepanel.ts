import { state, TRACK_COLORS } from './state.ts';
import { synths, SYNTH_TYPES, swapSynth, getSynthType, getEnvelope, setEnvelope } from './scheduler.ts';
import type { SynthTypeId } from './scheduler.ts';
import { Renderer } from './renderer.ts';

// ---------------------------------------------------------------------------
// Preset storage
// ---------------------------------------------------------------------------

const PRESET_KEY = 'step-sequencer-presets';
const TRACK_KEY = 'step-sequencer-tracks';

interface Preset {
  name: string;
  synthType: SynthTypeId;
  envelope: { attack: number; decay: number; sustain: number; release: number };
}

function loadPresets(): Preset[] {
  try {
    return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function savePresets(presets: Preset[]): void {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

function loadSavedTracks(): string[] {
  try {
    return JSON.parse(localStorage.getItem(TRACK_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveTrackList(names: string[]): void {
  localStorage.setItem(TRACK_KEY, JSON.stringify(names));
}

function getTrackData(trackName: string): string | null {
  return localStorage.getItem(`step-sequencer-track:${trackName}`);
}

// ---------------------------------------------------------------------------
// Build sidepanel
// ---------------------------------------------------------------------------

export function buildSidepanel(container: HTMLElement): void {
  container.innerHTML = '';

  const tracksSection = document.createElement('div');
  tracksSection.className = 'sp-section';
  tracksSection.innerHTML = '<h2>Instruments</h2>';

  for (let t = 0; t < state.tracks.length; t++) {
    tracksSection.appendChild(buildTrackCard(t));
  }
  container.appendChild(tracksSection);

  container.appendChild(buildSaveLoadSection());
}

function buildTrackCard(trackIndex: number): HTMLElement {
  const track = state.tracks[trackIndex];
  const card = document.createElement('div');
  card.className = 'sp-track';

  const header = document.createElement('div');
  header.className = 'sp-track-header';

  const dot = document.createElement('div');
  dot.className = 'sp-track-dot';
  dot.style.background = TRACK_COLORS[trackIndex % TRACK_COLORS.length];

  const name = document.createElement('span');
  name.className = 'sp-track-name';
  name.textContent = track.name;

  header.appendChild(dot);
  header.appendChild(name);
  card.appendChild(header);

  const currentType = getSynthType(trackIndex);

  const synthField = document.createElement('div');
  synthField.className = 'sp-field';

  const synthLabel = document.createElement('label');
  synthLabel.textContent = 'Type';

  const synthSelect = document.createElement('select');
  for (const st of SYNTH_TYPES) {
    const opt = document.createElement('option');
    opt.value = st.id;
    opt.textContent = st.label;
    if (st.id === currentType) opt.selected = true;
    synthSelect.appendChild(opt);
  }
  synthSelect.addEventListener('change', () => {
    const newType = synthSelect.value as SynthTypeId;
    swapSynth(trackIndex, newType);
    rebuildEnvelopeSliders(card, trackIndex);
  });

  synthField.appendChild(synthLabel);
  synthField.appendChild(synthSelect);
  card.appendChild(synthField);

  const env = getEnvelope(trackIndex);
  card.appendChild(makeSlider(trackIndex, 'Attack', 'attack', env.attack, 0, 1, 0.001));
  card.appendChild(makeSlider(trackIndex, 'Decay', 'decay', env.decay, 0.001, 2, 0.001));
  card.appendChild(makeSlider(trackIndex, 'Sustain', 'sustain', env.sustain, 0, 1, 0.01));
  card.appendChild(makeSlider(trackIndex, 'Release', 'release', env.release, 0.001, 2, 0.001));

  card.appendChild(buildPresetRow(trackIndex));

  return card;
}

function makeSlider(trackIndex: number, label: string, param: string, value: number, min: number, max: number, step: number): HTMLElement {
  const field = document.createElement('div');
  field.className = 'sp-field';
  field.dataset.envParam = param;

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
  valSpan.textContent = formatNum(value);

  input.addEventListener('input', () => {
    const v = parseFloat(input.value);
    const env = getEnvelope(trackIndex);
    (env as Record<string, number>)[param] = v;
    setEnvelope(trackIndex, env);
    valSpan.textContent = formatNum(v);
    Renderer.markDirty();
  });

  field.appendChild(lbl);
  field.appendChild(input);
  field.appendChild(valSpan);
  return field;
}

function rebuildEnvelopeSliders(card: HTMLElement, trackIndex: number): void {
  const env = getEnvelope(trackIndex);
  const params = [
    { label: 'Attack', param: 'attack', min: 0, max: 1, step: 0.001 },
    { label: 'Decay', param: 'decay', min: 0.001, max: 2, step: 0.001 },
    { label: 'Sustain', param: 'sustain', min: 0, max: 1, step: 0.01 },
    { label: 'Release', param: 'release', min: 0.001, max: 2, step: 0.001 },
  ];

  for (const p of params) {
    const field = card.querySelector(`[data-env-param="${p.param}"]`);
    if (!field) continue;
    const input = field.querySelector('input') as HTMLInputElement;
    const valSpan = field.querySelector('.sp-val') as HTMLElement;
    const v = (env as Record<string, number>)[p.param];
    input.min = String(p.min);
    input.max = String(p.max);
    input.step = String(p.step);
    input.value = String(v);
    valSpan.textContent = formatNum(v);
  }
}

function buildPresetRow(trackIndex: number): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sp-presets';

  const presets = loadPresets();
  for (const p of presets) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      swapSynth(trackIndex, p.synthType);
      setEnvelope(trackIndex, p.envelope);
      const card = row.closest('.sp-track') as HTMLElement;
      const select = card.querySelector('select') as HTMLSelectElement;
      select.value = p.synthType;
      rebuildEnvelopeSliders(card, trackIndex);
      Renderer.markDirty();
    });
    row.appendChild(btn);
  }

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = '+ Save';
  saveBtn.addEventListener('click', () => {
    const name = prompt('Preset name:');
    if (!name) return;
    const presets = loadPresets();
    presets.push({
      name,
      synthType: getSynthType(trackIndex),
      envelope: getEnvelope(trackIndex),
    });
    savePresets(presets);
    const panel = document.getElementById('sidepanel') as HTMLElement;
    buildSidepanel(panel);
  });
  row.appendChild(saveBtn);

  return row;
}

// ---------------------------------------------------------------------------
// Save/Load tracks
// ---------------------------------------------------------------------------

function buildSaveLoadSection(): HTMLElement {
  const section = document.createElement('div');
  section.className = 'sp-section';
  section.innerHTML = '<h2>Tracks</h2>';

  const saveRow = document.createElement('div');
  saveRow.className = 'sp-actions';

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.textContent = 'Save Track';
  saveBtn.addEventListener('click', () => {
    const name = prompt('Track name:');
    if (!name) return;
    const data = {
      bpm: state.bpm,
      totalSteps: state.totalSteps,
      tracks: state.tracks.map((t, i) => ({
        name: t.name,
        color: t.color,
        cells: t.cells,
        synthType: getSynthType(i),
        envelope: getEnvelope(i),
      })),
    };
    localStorage.setItem(`step-sequencer-track:${name}`, JSON.stringify(data));
    const names = loadSavedTracks();
    if (!names.includes(name)) {
      names.push(name);
      saveTrackList(names);
    }
    buildSidepanel(document.getElementById('sidepanel') as HTMLElement);
  });
  saveRow.appendChild(saveBtn);

  section.appendChild(saveRow);

  const saved = loadSavedTracks();
  for (const trackName of saved) {
    const row = document.createElement('div');
    row.className = 'sp-actions';

    const loadBtn = document.createElement('button');
    loadBtn.type = 'button';
    loadBtn.textContent = trackName;
    loadBtn.addEventListener('click', () => {
      const raw = getTrackData(trackName);
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        state.bpm = data.bpm;
        state.totalSteps = data.totalSteps;
        state.tracks = data.tracks.map((t: { name: string; color: string; cells: { active: boolean; pitch: string }[]; synthType: SynthTypeId; envelope: { attack: number; decay: number; sustain: number; release: number } }, i: number) => {
          if (synths[i]) {
            swapSynth(i, t.synthType);
            setEnvelope(i, t.envelope);
          }
          return { name: t.name, color: t.color, cells: t.cells };
        });
        const bpmSlider = document.getElementById('bpm-slider') as HTMLInputElement;
        const bpmDisplay = document.getElementById('bpm-display') as HTMLElement;
        bpmSlider.value = String(state.bpm);
        bpmDisplay.textContent = String(state.bpm);
        buildSidepanel(document.getElementById('sidepanel') as HTMLElement);
        Renderer.markDirty();
      } catch { /* ignore corrupt data */ }
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '✕';
    delBtn.style.flex = '0';
    delBtn.style.padding = '8px 12px';
    delBtn.addEventListener('click', () => {
      localStorage.removeItem(`step-sequencer-track:${trackName}`);
      const names = loadSavedTracks().filter(n => n !== trackName);
      saveTrackList(names);
      buildSidepanel(document.getElementById('sidepanel') as HTMLElement);
    });

    row.appendChild(loadBtn);
    row.appendChild(delBtn);
    section.appendChild(row);
  }

  return section;
}

function formatNum(n: number): string {
  return n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : String(Math.round(n));
}

import { state, TRACK_COLORS } from './state.ts';
import { synths, SYNTH_TYPES, swapSynth, getSynthType, getEnvelope, setEnvelope } from './scheduler.ts';
import type { SynthTypeId } from './scheduler.ts';
import { Renderer } from './renderer.ts';

const PRESET_KEY = 'step-sequencer-presets';

interface Preset {
  name: string;
  synthType: SynthTypeId;
  envelope: { attack: number; decay: number; sustain: number; release: number };
}

function loadPresets(): Preset[] {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY) ?? '[]'); } catch { return []; }
}

function savePresets(presets: Preset[]): void {
  localStorage.setItem(PRESET_KEY, JSON.stringify(presets));
}

export function buildSidepanel(container: HTMLElement): void {
  container.innerHTML = '';

  const handle = document.createElement('div');
  handle.id = 'panel-handle';
  container.appendChild(handle);

  const tracksSection = document.createElement('div');
  tracksSection.className = 'sp-section';
  tracksSection.innerHTML = '<h2>Instruments</h2>';

  for (let t = 0; t < state.tracks.length; t++) {
    tracksSection.appendChild(buildTrackCard(t));
  }
  container.appendChild(tracksSection);

  Renderer.resize();
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

  const chevron = document.createElement('span');
  chevron.className = 'sp-track-chevron';
  chevron.textContent = '▶';

  header.appendChild(dot);
  header.appendChild(name);
  header.appendChild(chevron);

  header.addEventListener('click', () => {
    const isCardOpen = card.classList.contains('open');
    const allCards = card.parentElement?.querySelectorAll('.sp-track');
    if (allCards) {
      for (const c of allCards) c.classList.remove('open');
    }
    if (!isCardOpen) card.classList.add('open');
  });

  card.appendChild(header);

  const body = document.createElement('div');
  body.className = 'sp-track-body';

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
    swapSynth(trackIndex, synthSelect.value as SynthTypeId);
    rebuildEnvelopeSliders(body, trackIndex);
  });
  synthField.appendChild(synthLabel);
  synthField.appendChild(synthSelect);
  body.appendChild(synthField);

  const env = getEnvelope(trackIndex);
  body.appendChild(makeSlider(trackIndex, 'Attack', 'attack', env.attack, 0, 1, 0.001));
  body.appendChild(makeSlider(trackIndex, 'Decay', 'decay', env.decay, 0.001, 2, 0.001));
  body.appendChild(makeSlider(trackIndex, 'Sustain', 'sustain', env.sustain, 0, 1, 0.01));
  body.appendChild(makeSlider(trackIndex, 'Release', 'release', env.release, 0.001, 2, 0.001));
  body.appendChild(buildPresetRow(trackIndex));

  card.appendChild(body);
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

function rebuildEnvelopeSliders(body: HTMLElement, trackIndex: number): void {
  const env = getEnvelope(trackIndex);
  const params = [
    { param: 'attack', min: 0, max: 1, step: 0.001 },
    { param: 'decay', min: 0.001, max: 2, step: 0.001 },
    { param: 'sustain', min: 0, max: 1, step: 0.01 },
    { param: 'release', min: 0.001, max: 2, step: 0.001 },
  ];
  for (const p of params) {
    const field = body.querySelector(`[data-env-param="${p.param}"]`);
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

  for (const p of loadPresets()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      swapSynth(trackIndex, p.synthType);
      setEnvelope(trackIndex, p.envelope);
      const card = row.closest('.sp-track') as HTMLElement;
      const select = card.querySelector('select') as HTMLSelectElement;
      select.value = p.synthType;
      rebuildEnvelopeSliders(row.closest('.sp-track-body') as HTMLElement, trackIndex);
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
    presets.push({ name, synthType: getSynthType(trackIndex), envelope: getEnvelope(trackIndex) });
    savePresets(presets);
    buildSidepanel(document.getElementById('sidepanel') as HTMLElement);
  });
  row.appendChild(saveBtn);

  return row;
}

function formatNum(n: number): string {
  return n < 0.1 ? n.toFixed(3) : n < 10 ? n.toFixed(2) : String(Math.round(n));
}

// Pure data module for the step sequencer.

export const INITIAL_TRACK_COUNT = 4;
export const STANZA_SIZE = 4;

export const TRACK_COLORS: string[] = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#00d2d3', '#1dd1a1',
  '#f368e0', '#ff9f43', '#0abde3', '#10ac84',
];

export const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const;

export const SCALES: Record<string, { label: string; intervals: number[] }> = {
  pentatonic: { label: 'Pentatonic', intervals: [0, 2, 4, 7, 9] },
  major:      { label: 'Major',      intervals: [0, 2, 4, 5, 7, 9, 11] },
  minor:      { label: 'Minor',      intervals: [0, 2, 3, 5, 7, 8, 10] },
  blues:      { label: 'Blues',       intervals: [0, 3, 5, 6, 7, 10] },
  chromatic:  { label: 'Chromatic',   intervals: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
};

export const SCALE_IDS = Object.keys(SCALES);

export interface TrackConfig {
  scale: string;
  root: number;
  octaveLow: number;
  octaveHigh: number;
}

export function computeTrackNotes(config: TrackConfig): string[] {
  const scale = SCALES[config.scale]?.intervals ?? SCALES.pentatonic.intervals;
  const notes: string[] = [];
  for (let oct = config.octaveLow; oct <= config.octaveHigh; oct++) {
    for (const interval of scale) {
      const noteIdx = (config.root + interval) % 12;
      notes.push(`${NOTE_NAMES[noteIdx]}${oct}`);
    }
  }
  return notes;
}

export const DEFAULT_NOTES: string[] = computeTrackNotes({
  scale: 'pentatonic',
  root: 0,
  octaveLow: 4,
  octaveHigh: 4,
});

export interface Cell {
  active: boolean;
  pitch: string;
  mergeLength: number;
}

export interface Track {
  name: string;
  color: string;
  cells: Cell[];
  config: TrackConfig;
}

export interface SequencerState {
  tracks: Track[];
  isPlaying: boolean;
  isPaused: boolean;
  currentStep: number;
  cursorTrack: number;
  cursorStep: number;
  totalSteps: number;
  bpm: number;
  helpOpen: boolean;
  loopStart: number;
  loopEnd: number;
  mergeMode: boolean;
  mergeAnchor: { track: number; step: number } | null;
}

export const state: SequencerState = {
  tracks: [],
  isPlaying: false,
  isPaused: false,
  currentStep: 0,
  cursorTrack: 0,
  cursorStep: 0,
  totalSteps: 4,
  bpm: 120,
  helpOpen: false,
  loopStart: 0,
  loopEnd: 4,
  mergeMode: false,
  mergeAnchor: null,
};

export function initTracks(): void {
  state.totalSteps = STANZA_SIZE
  state.loopStart = 0
  state.loopEnd = STANZA_SIZE
  state.mergeMode = false
  state.mergeAnchor = null
  state.tracks = Array.from({ length: INITIAL_TRACK_COUNT }, (_, i) => ({
    name: `T${i + 1}`,
    color: TRACK_COLORS[i],
    cells: Array.from({ length: state.totalSteps }, () => ({
      active: false,
      pitch: 'C4',
      mergeLength: 1,
    })),
    config: { scale: 'pentatonic', root: 0, octaveLow: 4, octaveHigh: 4 },
  }));
}

export function toggleCell(trackIndex: number, stepIndex: number): void {
  if (isConsumedStep(trackIndex, stepIndex)) return;
  const cell = state.tracks[trackIndex].cells[stepIndex];
  if (cell.mergeLength > 1) {
    unmergeCells(trackIndex, stepIndex);
    cell.active = false;
    return;
  }
  cell.active = !cell.active;
}

export function setPitch(trackIndex: number, stepIndex: number, pitch: string): void {
  state.tracks[trackIndex].cells[stepIndex].pitch = pitch;
}

export function moveCursor(dTrack: number, dStep: number): void {
  state.cursorTrack = Math.max(0, Math.min(state.cursorTrack + dTrack, state.tracks.length - 1));
  state.cursorStep = Math.max(0, Math.min(state.cursorStep + dStep, state.totalSteps - 1));
}

export function seekToStep(step: number): void {
  state.currentStep = Math.max(0, Math.min(step, state.totalSteps - 1));
}

export function setLoopRange(start: number, end: number): void {
  state.loopStart = Math.max(0, Math.min(start, state.totalSteps - 1))
  state.loopEnd = Math.max(state.loopStart + 1, Math.min(end, state.totalSteps))
}

export function addStanza(): void {
  state.totalSteps += STANZA_SIZE;
  state.loopEnd = Math.min(state.loopEnd + STANZA_SIZE, state.totalSteps)
  for (const track of state.tracks) {
    const defaultPitch = computeTrackNotes(track.config)[0] ?? 'C4';
    for (let i = 0; i < STANZA_SIZE; i++) {
      track.cells.push({ active: false, pitch: defaultPitch, mergeLength: 1 });
    }
  }
}

export function removeStanza(): void {
  if (state.totalSteps <= STANZA_SIZE) return;
  state.totalSteps -= STANZA_SIZE;
  state.loopEnd = Math.min(state.loopEnd, state.totalSteps)
  if (state.loopStart >= state.totalSteps) state.loopStart = 0
  if (state.loopEnd <= state.loopStart) state.loopEnd = state.totalSteps
  for (const track of state.tracks) {
    for (let s = 0; s < state.totalSteps; s++) {
      const cell = track.cells[s];
      if (cell.mergeLength > 1 && s + cell.mergeLength > state.totalSteps) {
        cell.mergeLength = state.totalSteps - s;
      }
    }
    track.cells.length = state.totalSteps;
  }
  if (state.currentStep >= state.totalSteps) state.currentStep = 0;
  if (state.cursorStep >= state.totalSteps) state.cursorStep = state.totalSteps - 1;
}

export function addTrack(): void {
  const i = state.tracks.length;
  const config: TrackConfig = { scale: 'pentatonic', root: 0, octaveLow: 4, octaveHigh: 4 };
  state.tracks.push({
    name: `T${i + 1}`,
    color: TRACK_COLORS[i % TRACK_COLORS.length],
    cells: Array.from({ length: state.totalSteps }, () => ({
      active: false,
      pitch: computeTrackNotes(config)[0] ?? 'C4',
      mergeLength: 1,
    })),
    config,
  });
}

export function setTrackConfig(trackIndex: number, config: TrackConfig): void {
  state.tracks[trackIndex].config = config;
  const notes = computeTrackNotes(config);
  for (const cell of state.tracks[trackIndex].cells) {
    if (cell.active && !notes.includes(cell.pitch)) {
      cell.pitch = notes[0] ?? 'C4';
    }
  }
}

export function setBPM(bpm: number): void {
  state.bpm = Math.max(1, Math.min(Math.round(bpm), 300));
}

export function setPlaying(v: boolean): void {
  state.isPlaying = v;
}

export function setPaused(v: boolean): void {
  state.isPaused = v;
}

export function isConsumedStep(trackIndex: number, stepIndex: number): boolean {
  const track = state.tracks[trackIndex];
  if (!track) return false;
  for (let s = Math.max(0, stepIndex - 64); s < stepIndex; s++) {
    const cell = track.cells[s];
    if (cell.mergeLength > 1 && s + cell.mergeLength > stepIndex) {
      return true;
    }
  }
  return false;
}

export function getMergeGroup(trackIndex: number, stepIndex: number): { startStep: number; length: number; pitches: string[] } | null {
  const track = state.tracks[trackIndex];
  if (!track) return null;

  const cell = track.cells[stepIndex];
  if (cell && cell.active && cell.mergeLength > 1) {
    const pitches: string[] = [];
    for (let i = 0; i < cell.mergeLength && stepIndex + i < track.cells.length; i++) {
      pitches.push(track.cells[stepIndex + i].pitch);
    }
    return { startStep: stepIndex, length: cell.mergeLength, pitches };
  }

  for (let s = stepIndex - 1; s >= Math.max(0, stepIndex - 64); s--) {
    const prevCell = track.cells[s];
    if (prevCell.mergeLength > 1 && s + prevCell.mergeLength > stepIndex) {
      const pitches: string[] = [];
      for (let i = 0; i < prevCell.mergeLength && s + i < track.cells.length; i++) {
        pitches.push(track.cells[s + i].pitch);
      }
      return { startStep: s, length: prevCell.mergeLength, pitches };
    }
  }

  return null;
}

export function getMergeAnchorForStep(trackIndex: number, stepIndex: number): number {
  const track = state.tracks[trackIndex];
  if (!track) return stepIndex;
  const cell = track.cells[stepIndex];
  if (cell && cell.mergeLength > 1) return stepIndex;
  for (let s = stepIndex - 1; s >= Math.max(0, stepIndex - 64); s--) {
    const prevCell = track.cells[s];
    if (prevCell.mergeLength > 1 && s + prevCell.mergeLength > stepIndex) {
      return s;
    }
  }
  return stepIndex;
}

export function mergeCells(trackIndex: number, targetStep: number): boolean {
  if (!state.mergeAnchor) return false;
  const { track, step: anchorStep } = state.mergeAnchor;
  if (track !== trackIndex) return false;
  if (targetStep < 0 || targetStep >= state.totalSteps) return false;

  const trackData = state.tracks[trackIndex];
  const anchor = trackData.cells[anchorStep];
  if (!anchor || !anchor.active) return false;

  const groupEnd = anchorStep + anchor.mergeLength - 1;

  if (targetStep === anchorStep - 1) {
    const target = trackData.cells[targetStep];
    if (!target || isConsumedStep(trackIndex, targetStep)) return false;
    target.active = true;
    target.mergeLength = anchor.mergeLength + 1;
    anchor.mergeLength = 1;
    state.mergeAnchor = { track: trackIndex, step: targetStep };
    return true;
  }

  if (targetStep === groupEnd + 1) {
    const target = trackData.cells[targetStep];
    if (!target || isConsumedStep(trackIndex, targetStep)) return false;
    target.active = true;
    anchor.mergeLength += 1;
    return true;
  }

  return false;
}

export function unmergeCells(trackIndex: number, anchorStep: number): void {
  const track = state.tracks[trackIndex];
  if (!track) return;
  const cell = track.cells[anchorStep];
  if (!cell || cell.mergeLength <= 1) return;

  for (let i = 1; i < cell.mergeLength; i++) {
    const step = anchorStep + i;
    if (step < track.cells.length) {
      track.cells[step].active = false;
      track.cells[step].mergeLength = 1;
    }
  }
  cell.mergeLength = 1;
}

export function setMergeMode(active: boolean, anchor?: { track: number; step: number }): void {
  state.mergeMode = active;
  state.mergeAnchor = active && anchor ? anchor : null;
}

export function resetTransport(): void {
  state.isPlaying = false;
  state.isPaused = false;
  state.currentStep = 0;
}

initTracks();

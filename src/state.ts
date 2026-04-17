// Pure data module for the step sequencer.
// No DOM, no audio, no Tone.js. Plain mutable state + mutation functions.

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const INITIAL_TRACK_COUNT = 4;
export const STANZA_SIZE = 4;

export const NOTES: string[] = [
  'C4', 'D4', 'E4', 'F4', 'G4', 'A4',
];

export const TRACK_COLORS: string[] = [
  '#ff6b6b', '#feca57', '#48dbfb', '#ff9ff3',
  '#54a0ff', '#5f27cd', '#00d2d3', '#1dd1a1',
  '#f368e0', '#ff9f43', '#0abde3', '#10ac84',
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Cell {
  active: boolean;
  pitch: string;
}

export interface Track {
  name: string;
  color: string;
  cells: Cell[];
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
}

// ---------------------------------------------------------------------------
// Mutable state store
// ---------------------------------------------------------------------------

export const state: SequencerState = {
  tracks: [],
  isPlaying: false,
  isPaused: false,
  currentStep: 0,
  cursorTrack: 0,
  cursorStep: 0,
  totalSteps: 16,
  bpm: 120,
  helpOpen: false,
};

// ---------------------------------------------------------------------------
// Mutation functions
// ---------------------------------------------------------------------------

export function initTracks(): void {
  state.totalSteps = STANZA_SIZE;
  state.tracks = Array.from({ length: INITIAL_TRACK_COUNT }, (_, i) => ({
    name: `T${i + 1}`,
    color: TRACK_COLORS[i],
    cells: Array.from({ length: state.totalSteps }, () => ({
      active: false,
      pitch: 'C4',
    })),
  }));
}

export function toggleCell(trackIndex: number, stepIndex: number): void {
  state.tracks[trackIndex].cells[stepIndex].active =
    !state.tracks[trackIndex].cells[stepIndex].active;
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

export function addStanza(): void {
  state.totalSteps += STANZA_SIZE;
  for (const track of state.tracks) {
    for (let i = 0; i < STANZA_SIZE; i++) {
      track.cells.push({ active: false, pitch: 'C4' });
    }
  }
}

export function removeStanza(): void {
  if (state.totalSteps <= STANZA_SIZE) return;
  state.totalSteps -= STANZA_SIZE;
  for (const track of state.tracks) {
    track.cells.length = state.totalSteps;
  }
  if (state.currentStep >= state.totalSteps) state.currentStep = 0;
  if (state.cursorStep >= state.totalSteps) state.cursorStep = state.totalSteps - 1;
}

export function addTrack(): void {
  const i = state.tracks.length;
  state.tracks.push({
    name: `T${i + 1}`,
    color: TRACK_COLORS[i % TRACK_COLORS.length],
    cells: Array.from({ length: state.totalSteps }, () => ({
      active: false,
      pitch: 'C4',
    })),
  });
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

export function resetTransport(): void {
  state.isPlaying = false;
  state.isPaused = false;
  state.currentStep = 0;
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

initTracks();

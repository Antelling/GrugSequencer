import * as Tone from 'tone';
import { state, INITIAL_TRACK_COUNT } from './state.ts';

export type TrackSynth =
  | Tone.PolySynth
  | Tone.Synth
  | Tone.AMSynth
  | Tone.FMSynth
  | Tone.DuoSynth
  | Tone.MembraneSynth
  | Tone.MetalSynth
  | Tone.PluckSynth;

export const SYNTH_TYPES = [
  { id: 'Synth', label: 'Synth' },
  { id: 'AMSynth', label: 'AM Synth' },
  { id: 'FMSynth', label: 'FM Synth' },
  { id: 'DuoSynth', label: 'Duo Synth' },
  { id: 'MembraneSynth', label: 'Membrane' },
  { id: 'MetalSynth', label: 'Metal' },
  { id: 'PluckSynth', label: 'Pluck' },
] as const;

export type SynthTypeId = typeof SYNTH_TYPES[number]['id'];

const SNAP_ENV = { attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.08 };
const MEMBRANE_ENV = { attack: 0.001, decay: 0.1, sustain: 0, release: 0.04 };

let onStepCallback: ((step: number) => void) | null = null;
let sequence: Tone.Sequence | null = null;

const trackSynthTypes: SynthTypeId[] = [];

export function createSynthByType(typeId: SynthTypeId): TrackSynth {
  switch (typeId) {
    case 'Synth': return new Tone.PolySynth(Tone.Synth, { envelope: SNAP_ENV }).toDestination();
    case 'AMSynth': return new Tone.AMSynth({ envelope: SNAP_ENV }).toDestination();
    case 'FMSynth': return new Tone.FMSynth({ envelope: SNAP_ENV }).toDestination();
    case 'DuoSynth': return new Tone.DuoSynth().toDestination();
    case 'MembraneSynth': return new Tone.MembraneSynth({ envelope: MEMBRANE_ENV }).toDestination();
    case 'MetalSynth': return new Tone.MetalSynth().toDestination();
    case 'PluckSynth': return new Tone.PluckSynth().toDestination();
    default: return new Tone.Synth({ envelope: SNAP_ENV }).toDestination();
  }
}

function createSynth(index: number): TrackSynth {
  const typeId: SynthTypeId = ['Synth', 'AMSynth', 'FMSynth', 'MembraneSynth'][index % 4] as SynthTypeId;
  trackSynthTypes.push(typeId);
  return createSynthByType(typeId);
}

export const synths: TrackSynth[] = Array.from({ length: INITIAL_TRACK_COUNT }, (_, i) => createSynth(i));

export function addSynth(): void {
  const idx = synths.length;
  const typeId: SynthTypeId = ['Synth', 'AMSynth', 'FMSynth', 'MembraneSynth'][idx % 4] as SynthTypeId;
  trackSynthTypes.push(typeId);
  synths.push(createSynthByType(typeId));
}

export function swapSynth(trackIndex: number, typeId: SynthTypeId): void {
  if (trackIndex < 0 || trackIndex >= synths.length) return;
  synths[trackIndex].dispose();
  synths[trackIndex] = createSynthByType(typeId);
  trackSynthTypes[trackIndex] = typeId;
}

export function getSynthType(trackIndex: number): SynthTypeId {
  return trackSynthTypes[trackIndex] ?? 'Synth';
}

export function getEnvelope(trackIndex: number): { attack: number; decay: number; sustain: number; release: number } {
  const s = synths[trackIndex];
  const env = (s as { envelope?: Tone.Envelope }).envelope;
  if (env) {
    return {
      attack: Number(env.attack),
      decay: Number(env.decay),
      sustain: Number(env.sustain),
      release: Number(env.release),
    };
  }
  return { attack: 0.005, decay: 0.05, sustain: 0.3, release: 0.08 };
}

export function setEnvelope(trackIndex: number, env: { attack: number; decay: number; sustain: number; release: number }): void {
  const s = synths[trackIndex];
  const envelope = (s as { envelope?: Tone.Envelope }).envelope;
  if (envelope) {
    envelope.attack = env.attack;
    envelope.decay = env.decay;
    envelope.sustain = env.sustain;
    envelope.release = env.release;
  }
}

function createSequenceInternal(): void {
  if (sequence) {
    sequence.dispose();
  }
  sequence = new Tone.Sequence((time, step) => {
    const tracks = state.tracks;
    for (let t = 0; t < tracks.length; t++) {
      const cell = tracks[t].cells[step];
      if (cell.active) {
        synths[t].triggerAttackRelease(cell.pitch, '16n', time);
      }
    }
    Tone.Draw.schedule(() => {
      if (onStepCallback) {
        onStepCallback(step);
      }
    }, time);
  }, Array.from({ length: state.totalSteps }, (_, i) => i), '16n');
}

export const Scheduler = {
  init(): void {
    createSequenceInternal();
  },

  rebuildSequence(): void {
    const wasPlaying = Tone.Transport.state === 'started';
    createSequenceInternal();
    if (wasPlaying && sequence) {
      sequence.start(0);
    }
  },

  async start(): Promise<void> {
    await Tone.start();
    createSequenceInternal();
    if (sequence) {
      sequence.start(0);
    }
    Tone.Transport.start();
  },

  pause(): void {
    Tone.Transport.pause();
  },

  stop(): void {
    Tone.Transport.stop();
    Tone.Transport.position = 0;
  },

  setBPM(bpm: number): void {
    Tone.Transport.bpm.value = bpm;
  },

  seekTo(step: number): void {
    Tone.Transport.position = Tone.Time('16n').toSeconds() * step;
  },

  dispose(): void {
    sequence?.dispose();
    sequence = null;
    for (const s of synths) {
      s.dispose();
    }
  }
};

export function setOnStep(callback: (step: number) => void): void {
  onStepCallback = callback;
}

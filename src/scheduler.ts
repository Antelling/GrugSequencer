import * as Tone from 'tone';
import { state, INITIAL_TRACK_COUNT, isConsumedStep, getMergeGroup } from './state.ts';

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
const analysers: (Tone.Analyser | null)[] = [];
const glideSynths: (Tone.Synth | null)[] = [];

function createAnalyser(): Tone.Analyser {
  const analyser = new Tone.Analyser('waveform', 256);
  return analyser;
}

function getGlideSynth(trackIndex: number): Tone.Synth {
  if (!glideSynths[trackIndex]) {
    const env = getEnvelope(trackIndex);
    const synth = new Tone.Synth({ envelope: env });
    const analyser = analysers[trackIndex] ?? createAnalyser();
    synth.fan(analyser).toDestination();
    glideSynths[trackIndex] = synth;
  }
  return glideSynths[trackIndex]!;
}

export function createSynthByType(typeId: SynthTypeId): TrackSynth {
  const analyser = createAnalyser();
  analysers.push(analyser);

  switch (typeId) {
    case 'Synth': return new Tone.PolySynth(Tone.Synth, { envelope: SNAP_ENV }).fan(analyser).toDestination();
    case 'AMSynth': return new Tone.AMSynth({ envelope: SNAP_ENV }).fan(analyser).toDestination();
    case 'FMSynth': return new Tone.FMSynth({ envelope: SNAP_ENV }).fan(analyser).toDestination();
    case 'DuoSynth': return new Tone.DuoSynth().fan(analyser).toDestination();
    case 'MembraneSynth': return new Tone.MembraneSynth({ envelope: MEMBRANE_ENV }).fan(analyser).toDestination();
    case 'MetalSynth': return new Tone.MetalSynth().fan(analyser).toDestination();
    case 'PluckSynth': return new Tone.PluckSynth().fan(analyser).toDestination();
    default: return new Tone.Synth({ envelope: SNAP_ENV }).fan(analyser).toDestination();
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
  analysers[trackIndex]?.dispose();
  const analyser = createAnalyser();
  analysers[trackIndex] = analyser;
  const synth = (() => {
    switch (typeId) {
      case 'Synth': return new Tone.PolySynth(Tone.Synth, { envelope: SNAP_ENV });
      case 'AMSynth': return new Tone.AMSynth({ envelope: SNAP_ENV });
      case 'FMSynth': return new Tone.FMSynth({ envelope: SNAP_ENV });
      case 'DuoSynth': return new Tone.DuoSynth();
      case 'MembraneSynth': return new Tone.MembraneSynth({ envelope: MEMBRANE_ENV });
      case 'MetalSynth': return new Tone.MetalSynth();
      case 'PluckSynth': return new Tone.PluckSynth();
      default: return new Tone.Synth({ envelope: SNAP_ENV });
    }
  })();
  synth.fan(analyser).toDestination();
  synths[trackIndex] = synth;
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
  const gSynth = glideSynths[trackIndex];
  if (gSynth) {
    const gEnv = (gSynth as { envelope?: Tone.Envelope }).envelope;
    if (gEnv) {
      gEnv.attack = env.attack;
      gEnv.decay = env.decay;
      gEnv.sustain = env.sustain;
      gEnv.release = env.release;
    }
  }
}

export function getWaveform(trackIndex: number): Float32List {
  const analyser = analysers[trackIndex];
  if (!analyser) return new Float32Array(256);
  return analyser.getValue() as Float32List;
}

export async function previewNote(trackIndex: number, pitch: string): Promise<void> {
  await Tone.start();
  synths[trackIndex].triggerAttackRelease(pitch, '8n', Tone.now());
}

function createSequenceInternal(): void {
  if (sequence) {
    sequence.dispose();
  }
  const loopStart = state.loopStart
  const loopEnd = state.loopEnd
  const totalSteps = state.totalSteps
  const loopActive = loopStart > 0 || loopEnd < totalSteps
  const effectiveStart = loopActive ? loopStart : 0
  const effectiveEnd = loopActive ? loopEnd : totalSteps
  const steps = loopActive
    ? Array.from({ length: effectiveEnd - effectiveStart }, (_, i) => effectiveStart + i)
    : Array.from({ length: totalSteps }, (_, i) => i)

  sequence = new Tone.Sequence((time, step) => {
    const tracks = state.tracks;
    for (let t = 0; t < tracks.length; t++) {
      if (isConsumedStep(t, step)) continue;

      const cell = tracks[t].cells[step];
      if (!cell.active) continue;

      if (cell.mergeLength <= 1) {
        synths[t].triggerAttackRelease(cell.pitch, '16n', time);
        continue;
      }

      const stepSeconds = Tone.Time('16n').toSeconds();
      const duration = stepSeconds * cell.mergeLength;
      const group = getMergeGroup(t, step);
      const pitches = group ? group.pitches : [cell.pitch];
      const allSamePitch = pitches.every(p => p === pitches[0]);

      if (allSamePitch) {
        synths[t].triggerAttackRelease(pitches[0], duration, time);
        continue;
      }

      const synthType = getSynthType(t);
      const glideCapable = synthType === 'Synth' || synthType === 'AMSynth' || synthType === 'FMSynth' || synthType === 'DuoSynth';

      if (!glideCapable) {
        synths[t].triggerAttackRelease(pitches[0], duration, time);
        continue;
      }

      const synth = synths[t];
      const isPoly = synth instanceof Tone.PolySynth;
      const glideVoice = isPoly ? getGlideSynth(t) : (synth as Tone.Synth | Tone.AMSynth | Tone.FMSynth | Tone.DuoSynth);

      glideVoice.triggerAttack(pitches[0], time);

      for (let i = 1; i < pitches.length; i++) {
        const freq = Tone.Frequency(pitches[i]).toFrequency();
        const rampTargetTime = time + (i + 1) * stepSeconds;
        glideVoice.frequency.exponentialRampToValueAtTime(freq, rampTargetTime);
      }

      glideVoice.triggerRelease(time + duration);
    }
    Tone.Draw.schedule(() => {
      if (onStepCallback) {
        onStepCallback(step);
      }
    }, time);
  }, steps, '16n');

  sequence.loopStart = 0
  sequence.loopEnd = steps.length
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
    for (const a of analysers) {
      a?.dispose();
    }
    for (const gs of glideSynths) {
      gs?.dispose();
    }
    synths.length = 0;
    analysers.length = 0;
    glideSynths.length = 0;
    trackSynthTypes.length = 0;
  }
};

export function setOnStep(callback: (step: number) => void): void {
  onStepCallback = callback;
}

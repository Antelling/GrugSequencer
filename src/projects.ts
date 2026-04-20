// Project CRUD module — persists full sequencer state to localStorage.

import type { SynthTypeId } from './scheduler.ts';

const PROJECTS_KEY = 'grug-projects';
const PROJECT_PREFIX = 'grug-project:';
const CURRENT_KEY = 'grug-current-project';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectTrack {
  name: string;
  color: string;
  cells: { active: boolean; pitch: string }[];
  config: { scale: string; root: number; octaveLow: number; octaveHigh: number };
  synthType: SynthTypeId;
  envelope: { attack: number; decay: number; sustain: number; release: number };
}

export interface ProjectData {
  name: string;
  bpm: number;
  totalSteps: number;
  tracks: ProjectTrack[];
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export function listProjects(): string[] {
  try {
    return JSON.parse(localStorage.getItem(PROJECTS_KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function loadProject(name: string): ProjectData | null {
  try {
    const raw = localStorage.getItem(PROJECT_PREFIX + name);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function saveProject(data: ProjectData): void {
  localStorage.setItem(PROJECT_PREFIX + data.name, JSON.stringify(data));
  const names = listProjects();
  if (!names.includes(data.name)) {
    names.push(data.name);
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(names));
  }
  localStorage.setItem(CURRENT_KEY, data.name);
}

export function deleteProject(name: string): void {
  localStorage.removeItem(PROJECT_PREFIX + name);
  const names = listProjects().filter(n => n !== name);
  localStorage.setItem(PROJECTS_KEY, JSON.stringify(names));
  if (getCurrentProject() === name) {
    localStorage.removeItem(CURRENT_KEY);
  }
}

export function getCurrentProject(): string | null {
  return localStorage.getItem(CURRENT_KEY);
}

export function setCurrentProject(name: string | null): void {
  if (name) {
    localStorage.setItem(CURRENT_KEY, name);
  } else {
    localStorage.removeItem(CURRENT_KEY);
  }
}

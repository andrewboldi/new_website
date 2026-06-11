/**
 * Maps an `anim` key (set per project in data.ts) to its Canvas2D draw factory.
 * Unknown keys fall back to the linked-note graph, which is generic enough.
 */
import type { DrawFactory } from './types';
import { pathfind } from './pathfind';
import { mathcomp } from './mathcomp';
import { fibprimes } from './fibprimes';
import { molecule } from './molecule';
import { orbits } from './orbits';
import {
  oscillator,
  waveform,
  puzzle,
  mazehash,
  notegraph,
  packets,
  agents,
  zipf,
  gridworld,
} from './misc';

export const CARDFX: Record<string, DrawFactory> = {
  pathfind,
  mathcomp,
  fibprimes,
  molecule,
  orbits,
  oscillator,
  waveform,
  puzzle,
  mazehash,
  notegraph,
  packets,
  agents,
  zipf,
  gridworld,
};

export function getFactory(key: string | undefined): DrawFactory {
  return (key && CARDFX[key]) || notegraph;
}

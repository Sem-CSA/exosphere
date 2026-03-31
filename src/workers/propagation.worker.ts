// Web Worker for SGP4 orbital propagation
// Runs satellite.js computations off the main thread to prevent CPU bottleneck.

import { twoline2satrec, propagate, gstime, eciToEcf } from 'satellite.js';

export interface SatWorkerInput {
  type: 'init' | 'propagate';
  satellites?: { id: string; tleLine1: string; tleLine2: string; group: string }[];
  timestamp?: number; // Unix ms
}

export interface SatWorkerOutput {
  type: 'positions';
  // Flat Float64Array: [id_index, x, y, z, id_index, x, y, z, ...]
  // We use a map of id → {x, y, z} for simplicity
  positions: Record<string, { x: number; y: number; z: number } | null>;
}

// Cache satrec objects so we don't re-parse TLEs every frame
let satrecCache: Map<string, ReturnType<typeof twoline2satrec>> = new Map();
let satIds: string[] = [];

self.onmessage = (e: MessageEvent<SatWorkerInput>) => {
  const { type } = e.data;

  if (type === 'init' && e.data.satellites) {
    // Parse all TLEs once and cache the satrec objects
    satrecCache.clear();
    satIds = [];

    for (const sat of e.data.satellites) {
      try {
        const satrec = twoline2satrec(sat.tleLine1, sat.tleLine2);
        satrecCache.set(sat.id, satrec);
        satIds.push(sat.id);
      } catch {
        // Skip satellites with invalid TLEs
      }
    }

    self.postMessage({ type: 'ready', count: satIds.length });
  }

  if (type === 'propagate' && e.data.timestamp) {
    const date = new Date(e.data.timestamp);
    const gmst = gstime(date);
    const positions: Record<string, { x: number; y: number; z: number } | null> = {};

    for (const id of satIds) {
      const satrec = satrecCache.get(id);
      if (!satrec) {
        positions[id] = null;
        continue;
      }

      try {
        const positionAndVelocity = propagate(satrec, date);
        const positionEci = positionAndVelocity.position;

        if (typeof positionEci !== 'boolean' && positionEci) {
          const positionEcf = eciToEcf(positionEci, gmst);
          positions[id] = {
            x: positionEcf.x,
            y: positionEcf.y,
            z: positionEcf.z,
          };
        } else {
          positions[id] = null;
        }
      } catch {
        positions[id] = null;
      }
    }

    self.postMessage({ type: 'positions', positions } as SatWorkerOutput);
  }
};

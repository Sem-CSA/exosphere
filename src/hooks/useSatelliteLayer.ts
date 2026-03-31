import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { fetchActiveSatellites } from '../services/satelliteService';
import type { SatelliteData, SatelliteGroup } from '../types';
import type { SatWorkerOutput } from '../workers/propagation.worker';

// Throttle interval for worker propagation (ms).
// 500ms = 2 updates/sec — positions barely change at human timescales.
const PROPAGATION_INTERVAL = 500;

interface UseSatelliteLayerProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  pointsRef: MutableRefObject<Cesium.PointPrimitiveCollection | null>;
  satPrimitivesRef: MutableRefObject<Map<string, Cesium.PointPrimitive>>;
  showSats: boolean;
  satFilters: Record<SatelliteGroup, boolean>;
  exclusiveIdsRef?: React.MutableRefObject<Set<string> | null>;
}

export function useSatelliteLayer({
  viewerRef,
  pointsRef,
  satPrimitivesRef,
  showSats,
  satFilters,
  exclusiveIdsRef,
}: UseSatelliteLayerProps) {
  const [satellites, setSatellites] = useState<SatelliteData[]>([]);
  const [loadingSats, setLoadingSats] = useState(true);
  const [satelliteCount, setSatelliteCount] = useState(0);

  const showSatsRef = useRef(showSats);
  const satFiltersRef = useRef(satFilters);
  const mountId = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const satsRef = useRef<SatelliteData[]>([]);
  const latestPositionsRef = useRef<Record<string, { x: number; y: number; z: number } | null>>({});

  useEffect(() => { showSatsRef.current = showSats; }, [showSats]);
  useEffect(() => { satFiltersRef.current = satFilters; }, [satFilters]);

  useEffect(() => {
    const currentMount = ++mountId.current;
    if (!viewerRef.current || !pointsRef.current) return;

    const load = async () => {
      setLoadingSats(true);
      const sats = await fetchActiveSatellites();
      if (currentMount !== mountId.current || !viewerRef.current || !pointsRef.current) return;

      // Yield thread to let Cesium render Earth's initial imagery tiles smoothly
      await new Promise(r => setTimeout(r, 2000));

      setSatelliteCount(sats.length);
      setSatellites(sats);
      satsRef.current = sats;

      // Send TLE data to worker immediately
      workerRef.current = new Worker(
        new URL('../workers/propagation.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (e: MessageEvent<SatWorkerOutput>) => {
        if (e.data.type === 'positions') {
          latestPositionsRef.current = e.data.positions;
        }
      };

      workerRef.current.postMessage({
        type: 'init',
        satellites: sats.map(s => ({
          id: s.id,
          tleLine1: s.tleLine1,
          tleLine2: s.tleLine2,
          group: s.group,
        })),
      });

      // ── Chunked Primitive Creation ──
      // This massively reduces the initial main-thread block, allowing Earth to load instantly
      const CHUNK_SIZE = 300; // Smaller chunks to keep frame budget for map tiles
      let currentIndex = 0;
      const primitivesArr: Cesium.PointPrimitive[] = [];

      const createPointsChunk = () => {
        if (!viewerRef.current || !pointsRef.current || currentMount !== mountId.current) return;

        const end = Math.min(currentIndex + CHUNK_SIZE, sats.length);
        for (let i = currentIndex; i < end; i++) {
          const sat = sats[i];
          const primitive = pointsRef.current.add({
            position: Cesium.Cartesian3.ZERO,
            pixelSize: sat.group === 'STATION' ? 8 : (sat.group === 'OTHER' ? 3 : 5),
            color: Cesium.Color.fromCssColorString(sat.colorHex).withAlpha(0.85), // Final color always
            outlineColor: Cesium.Color.TRANSPARENT,
            outlineWidth: 0,
            show: true, // Always structural true to prevent WebGL buffer rebuild stutters
            id: sat,
          });
          satPrimitivesRef.current.set(sat.id, primitive);
          primitivesArr[i] = primitive;
        }

        currentIndex = end;
        if (currentIndex < sats.length) {
          requestAnimationFrame(createPointsChunk);
        } else {
          // Finished creating primitives
          setLoadingSats(false);
          const firstTimestamp = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime).getTime();
          workerRef.current!.postMessage({ type: 'propagate', timestamp: firstTimestamp });
        }
      };

      requestAnimationFrame(createPointsChunk);

      // Throttled propagation: ask worker every PROPAGATION_INTERVAL ms
      const propagationTimer = setInterval(() => {
        if (!viewerRef.current || !workerRef.current) return;
        const timestamp = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime).getTime();
        workerRef.current.postMessage({ type: 'propagate', timestamp });
      }, PROPAGATION_INTERVAL);

      // Use scratch variables to prevent garbage collection thrashing at 60fps
      const targetScratch = new Cesium.Cartesian3();
      const lerpScratch = new Cesium.Cartesian3();
      const SNAP_DISTANCE_SQ = 100000 * 100000;
      const colorScratch = new Cesium.Color();
      const baseColors = new Map<string, Cesium.Color>();

      // preUpdate: smoothly interpolate from current position to latest worker position
      viewerRef.current.scene.preUpdate.addEventListener(() => {
        const positions = latestPositionsRef.current;
        const currentSats = satsRef.current;
        const filters = satFiltersRef.current;
        const globalShow = showSatsRef.current;
        const spyModeActive = !!(exclusiveIdsRef && exclusiveIdsRef.current !== null);
        const exclusiveIds = exclusiveIdsRef?.current;

        // Pre-compute visibility per group to avoid 10k lookups
        const groupVisibility: Record<string, boolean> = {};

        for (let i = 0; i < currentSats.length; i++) {
          const sat = currentSats[i];
          const primitive = primitivesArr[i];
          if (!primitive) continue;

          const pos = positions[sat.id];
          
          if (groupVisibility[sat.group] === undefined) {
             groupVisibility[sat.group] = !!(globalShow && filters[sat.group as SatelliteGroup]);
          }
          
          const shouldBeVisible = !!(pos && groupVisibility[sat.group]);

          if (!shouldBeVisible) {
            // If already invisible, skip ALL heavy logic (cloning, branch checks, etc)
            if (primitive.color.alpha <= 0.005) continue;
            
            Cesium.Color.clone(primitive.color, colorScratch);
            colorScratch.alpha = 0.005;
            primitive.color = colorScratch;
            primitive.position = Cesium.Cartesian3.ZERO; // Bury during invisibility
            continue;
          }

          // Update position
          targetScratch.x = pos.x * 1000;
          targetScratch.y = pos.y * 1000;
          targetScratch.z = pos.z * 1000;

          const currentPos = primitive.position;
          if (Cesium.Cartesian3.equals(currentPos, Cesium.Cartesian3.ZERO)) {
            primitive.position = Cesium.Cartesian3.clone(targetScratch);
          } else {
            const distSq = Cesium.Cartesian3.distanceSquared(currentPos, targetScratch);
            if (distSq > SNAP_DISTANCE_SQ) {
              primitive.position = Cesium.Cartesian3.clone(targetScratch);
            } else {
              Cesium.Cartesian3.lerp(currentPos, targetScratch, 0.15, lerpScratch);
              primitive.position = Cesium.Cartesian3.clone(lerpScratch);
            }
          }

          // Update color/size
          if (spyModeActive) {
            const isTarget = exclusiveIds!.has(sat.id);
            if (isTarget) {
              if (primitive.color.alpha !== 1.0 || primitive.color.red !== 1.0) {
                 primitive.color = Cesium.Color.RED;
              }
              if (primitive.pixelSize !== 8) primitive.pixelSize = 8;
            } else {
              if (primitive.color.alpha !== 0.15) {
                let bc = baseColors.get(sat.colorHex);
                if (!bc) { bc = Cesium.Color.fromCssColorString(sat.colorHex); baseColors.set(sat.colorHex, bc); }
                Cesium.Color.clone(bc, colorScratch);
                colorScratch.alpha = 0.15;
                primitive.color = colorScratch;
              }
              if (primitive.pixelSize !== 3) primitive.pixelSize = 3;
            }
          } else {
            if (primitive.color.alpha !== 0.85) {
              let bc = baseColors.get(sat.colorHex);
              if (!bc) { bc = Cesium.Color.fromCssColorString(sat.colorHex); baseColors.set(sat.colorHex, bc); }
              Cesium.Color.clone(bc, colorScratch);
              colorScratch.alpha = 0.85;
              primitive.color = colorScratch;
            }
            const targetSize = sat.group === 'STATION' ? 8 : (sat.group === 'OTHER' ? 3 : 5);
            if (primitive.pixelSize !== targetSize) primitive.pixelSize = targetSize;
          }
        }
      });

      // Cleanup timer on unmount
      return () => clearInterval(propagationTimer);
    };

    load();

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { satellites, loadingSats, satelliteCount };
}

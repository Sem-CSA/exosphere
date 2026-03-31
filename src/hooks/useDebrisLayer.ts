import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { fetchDebris } from '../services/satelliteService';
import type { SatelliteData, SatelliteGroup } from '../types';

// Same throttle as satellites — 2 updates/sec
const PROPAGATION_INTERVAL = 500;

interface UseDebrisLayerProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  pointsRef: MutableRefObject<Cesium.PointPrimitiveCollection | null>;
  satPrimitivesRef: MutableRefObject<Map<string, Cesium.PointPrimitive>>;
  showDebris: boolean;
  satFilters: Record<SatelliteGroup, boolean>;
  exclusiveIdsRef?: React.MutableRefObject<Set<string> | null>;
}

export function useDebrisLayer({
  viewerRef,
  pointsRef,
  satPrimitivesRef,
  showDebris,
  satFilters,
  exclusiveIdsRef,
}: UseDebrisLayerProps) {
  const [debrisList, setDebrisList] = useState<SatelliteData[]>([]);
  const [loadingDebris, setLoadingDebris] = useState(true);
  const [debrisCount, setDebrisCount] = useState(0);

  const showDebrisRef = useRef(showDebris);
  const satFiltersRef = useRef(satFilters);
  const mountId = useRef(0);
  const workerRef = useRef<Worker | null>(null);
  const debrisRef = useRef<SatelliteData[]>([]);
  const latestPositionsRef = useRef<Record<string, { x: number; y: number; z: number } | null>>({});

  useEffect(() => { showDebrisRef.current = showDebris; }, [showDebris]);
  useEffect(() => { satFiltersRef.current = satFilters; }, [satFilters]);

  useEffect(() => {
    const currentMount = ++mountId.current;
    if (!viewerRef.current || !pointsRef.current) return;

    const load = async () => {
      setLoadingDebris(true);
      const debris = await fetchDebris();
      if (currentMount !== mountId.current || !viewerRef.current || !pointsRef.current) return;

      setDebrisCount(debris.length);
      setDebrisList(debris);
      debrisRef.current = debris;

      // Initialize a separate worker for debris
      workerRef.current = new Worker(
        new URL('../workers/propagation.worker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (e: MessageEvent<{ type: string; positions: Record<string, { x: number; y: number; z: number } | null> }>) => {
        if (e.data.type === 'positions') {
          latestPositionsRef.current = e.data.positions;
        }
      };

      workerRef.current.postMessage({
        type: 'init',
        satellites: debris.map(d => ({
          id: d.id,
          tleLine1: d.tleLine1,
          tleLine2: d.tleLine2,
          group: d.group,
        })),
      });

      const primitivesArr: Cesium.PointPrimitive[] = [];
      let currentIndex = 0;
      const CHUNK_SIZE = 300;

      const createDebrisChunk = () => {
        if (!viewerRef.current || !pointsRef.current || currentMount !== mountId.current) return;
        const end = Math.min(currentIndex + CHUNK_SIZE, debris.length);
        for (let i = currentIndex; i < end; i++) {
          const deb = debris[i];
          const primitive = pointsRef.current.add({
            position: Cesium.Cartesian3.ZERO,
            pixelSize: 4,
            color: Cesium.Color.fromCssColorString(deb.colorHex).withAlpha(0.005),
            outlineColor: Cesium.Color.TRANSPARENT,
            outlineWidth: 0,
            show: true,
            id: deb,
          });
          satPrimitivesRef.current.set(deb.id, primitive);
          primitivesArr[i] = primitive;
        }
        currentIndex = end;
        if (currentIndex < debris.length) {
          requestAnimationFrame(createDebrisChunk);
        } else {
          setLoadingDebris(false);
          const firstTimestamp = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime).getTime();
          workerRef.current?.postMessage({ type: 'propagate', timestamp: firstTimestamp });
        }
      };

      requestAnimationFrame(createDebrisChunk);

      // Throttled propagation
      const propagationTimer = setInterval(() => {
        if (!viewerRef.current || !workerRef.current) return;
        const timestamp = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime).getTime();
        workerRef.current.postMessage({ type: 'propagate', timestamp });
      }, PROPAGATION_INTERVAL);

      const targetScratch = new Cesium.Cartesian3();
      const lerpScratch = new Cesium.Cartesian3();
      const colorScratch = new Cesium.Color();
      const SNAP_DISTANCE_SQ = 100000 * 100000;
      const baseColors = new Map<string, Cesium.Color>();

      viewerRef.current.scene.preUpdate.addEventListener(() => {
        const positions = latestPositionsRef.current;
        const currentDebris = debrisRef.current;
        const filters = satFiltersRef.current;
        const globalShow = showDebrisRef.current;
        const spyModeActive = !!(exclusiveIdsRef && exclusiveIdsRef.current !== null);
        const exclusiveIds = exclusiveIdsRef?.current;

        for (let i = 0; i < currentDebris.length; i++) {
          const deb = currentDebris[i];
          const primitive = primitivesArr[i];
          if (!primitive) continue;

          const pos = positions[deb.id];
          const shouldShow = !!(pos && globalShow && filters[deb.group as SatelliteGroup]);

          if (!shouldShow) {
            if (primitive.color.alpha <= 0.005) continue;
            Cesium.Color.clone(primitive.color, colorScratch);
            colorScratch.alpha = 0.005;
            primitive.color = colorScratch;
            primitive.position = Cesium.Cartesian3.ZERO;
            continue;
          }

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

          if (spyModeActive) {
            const isTarget = exclusiveIds!.has(deb.id);
            if (isTarget) {
              if (primitive.color.alpha !== 1.0 || primitive.color.red !== 1.0) {
                primitive.color = Cesium.Color.RED;
                primitive.pixelSize = 5;
              }
            } else if (primitive.color.alpha !== 0.15) {
              let bc = baseColors.get(deb.colorHex);
              if (!bc) { bc = Cesium.Color.fromCssColorString(deb.colorHex); baseColors.set(deb.colorHex, bc); }
              Cesium.Color.clone(bc, colorScratch);
              colorScratch.alpha = 0.15;
              primitive.color = colorScratch;
              primitive.pixelSize = 2;
            }
          } else if (primitive.color.alpha !== 0.85) {
            let bc = baseColors.get(deb.colorHex);
            if (!bc) { bc = Cesium.Color.fromCssColorString(deb.colorHex); baseColors.set(deb.colorHex, bc); }
            Cesium.Color.clone(bc, colorScratch);
            colorScratch.alpha = 0.85;
            primitive.color = colorScratch;
            primitive.pixelSize = 3;
          }
        }
      });

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

  return { debrisList, loadingDebris, debrisCount };
}

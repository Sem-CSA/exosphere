import { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import type { SatelliteData } from '../types';

interface UseSpySystemProps {
  viewerRef: React.MutableRefObject<Cesium.Viewer | null>;
  satPrimitivesRef: React.MutableRefObject<Map<string, Cesium.PointPrimitive>>;
  allSats: SatelliteData[];
  targetLocation: { lat: number; lon: number; name: string } | null;
  exclusiveIdsRef: React.MutableRefObject<Set<string> | null>;
  onDetectChange: (inZoneSats: SatelliteData[], watchingSats: SatelliteData[], level: 'green' | 'yellow' | 'red') => void;
}

export function useSpySystem({
  viewerRef,
  satPrimitivesRef,
  allSats,
  targetLocation,
  exclusiveIdsRef,
  onDetectChange,
}: UseSpySystemProps) {
  const footprintEntitiesRef = useRef<Map<string, Cesium.Entity>>(new Map());
  const targetEntityRef = useRef<Cesium.Entity | null>(null);
  const dangerLevelRef = useRef<'green' | 'yellow' | 'red'>('green');
  const lastResultsRef = useRef<{ inZoneIds: Set<string>, level: 'green' | 'yellow' | 'red' }>({
    inZoneIds: new Set(),
    level: 'green'
  });

  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;

    // Clear everything if deactivated
    if (!targetLocation) {
      if (targetEntityRef.current) {
        viewer.entities.remove(targetEntityRef.current);
        targetEntityRef.current = null;
      }
      footprintEntitiesRef.current.forEach((entity) => viewer.entities.remove(entity));
      footprintEntitiesRef.current.clear();
      exclusiveIdsRef.current = null;
      onDetectChange([], [], 'green');
      return;
    }

    // 1. Draw Target Point (scales down when zoomed in)
    const pos = Cesium.Cartesian3.fromDegrees(targetLocation.lon, targetLocation.lat);
    targetEntityRef.current = viewer.entities.add({
      position: pos,
      properties: new Cesium.PropertyBag({ type: 'spy-footprint' }),
      point: {
        pixelSize: 50,
        color: new Cesium.CallbackProperty(() => {
          if (dangerLevelRef.current === 'red') return Cesium.Color.RED;
          if (dangerLevelRef.current === 'yellow') return Cesium.Color.YELLOW;
          return Cesium.Color.GREEN;
        }, false),
        outlineColor: Cesium.Color.WHITE.withAlpha(0.8),
        outlineWidth: 2,
        scaleByDistance: new Cesium.NearFarScalar(1.0e4, 0.2, 2.0e7, 1.0),
      },
      label: {
        text: 'TARGET: ' + targetLocation.name,
        font: '14px sans-serif',
        fillColor: Cesium.Color.WHITE,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -20),
      }
    });

    // We do not want to iterate 15k satellites blindly, so we precalculate the bounds.
    const targetLatRad = targetLocation.lat * (Math.PI / 180);
    const targetLonRad = targetLocation.lon * (Math.PI / 180);
    const MAX_ALTITUDE = 500000; // 500km max altitude strictly enforced
    const MAX_GROUND_DIST = 500000; // 500km ground parameter
    const earthRadius = Cesium.Ellipsoid.WGS84.maximumRadius;
    const maxCentralAngle = MAX_GROUND_DIST / earthRadius;

    // 2. Real-time dynamic proximity check
    const updateListener = () => {
      const currentInZoneIds = new Set<string>();
      const currentInZoneSats: SatelliteData[] = [];
      const currentWatchingSats: SatelliteData[] = [];

      for (let i = 0; i < allSats.length; i++) {
        const sat = allSats[i];
        const prim = satPrimitivesRef.current.get(sat.id);
        if (!prim || !prim.position) continue;

        const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(prim.position);
        if (!cartographic || cartographic.height > MAX_ALTITUDE) continue;

        // coarse bounding box check for extreme speed
        const latDiff = Math.abs(cartographic.latitude - targetLatRad);
        if (latDiff > maxCentralAngle * 1.5) continue; 
        
        let lonDiff = Math.abs(cartographic.longitude - targetLonRad);
        if (lonDiff > Math.PI) lonDiff = 2 * Math.PI - lonDiff; // handle dateline
        if (lonDiff > maxCentralAngle * 1.5 / Math.cos(targetLatRad)) continue;

        // accurate spherical trig check
        const centralAngleToTarget = Math.acos(
          Math.sin(targetLatRad) * Math.sin(cartographic.latitude) +
          Math.cos(targetLatRad) * Math.cos(cartographic.latitude) * Math.cos(cartographic.longitude - targetLonRad)
        );

        if (centralAngleToTarget <= maxCentralAngle) {
          currentInZoneIds.add(sat.id);
          currentInZoneSats.push(sat);

          // Calculate direct sensor FOV coverage
          const groundDist = centralAngleToTarget * earthRadius;
          const altitude = cartographic.height;
          const fovRadius = altitude * Math.tan(10 * (Math.PI / 180));
          if (groundDist <= fovRadius) {
            currentWatchingSats.push(sat);
          }
        }
      }

      // Update Danger State
      let newDangerLevel: 'green' | 'yellow' | 'red' = 'green';
      if (currentWatchingSats.length > 0) newDangerLevel = 'red';
      else if (currentInZoneSats.length > 0) newDangerLevel = 'yellow';

      dangerLevelRef.current = newDangerLevel;
      
      // Update global exclusive filter directly (fast)
      exclusiveIdsRef.current = currentInZoneIds;

      // ── Throttled React Updates ──
      // Only trigger a re-render if the counts or danger level actually changed
      // to keep animations smooth (30-60fps)
      const last = lastResultsRef.current;
      const idsChanged = last.inZoneIds.size !== currentInZoneIds.size || 
                         ![...currentInZoneIds].every(id => last.inZoneIds.has(id));

      if (idsChanged || last.level !== newDangerLevel) {
        lastResultsRef.current = { inZoneIds: currentInZoneIds, level: newDangerLevel };
        onDetectChange(currentInZoneSats, currentWatchingSats, newDangerLevel);
      }

      // Dynamically add/remove individual satellite camera footprint cones 
      // as they cross the boundary of the 500km ring.
      currentInZoneIds.forEach((id: string) => {
        if (!footprintEntitiesRef.current.has(id)) {
          const sat = allSats.find(s => s.id === id);
          if (!sat) return;

          const positionCallback = new Cesium.CallbackProperty(() => {
            const p = satPrimitivesRef.current.get(id);
            if (!p || !p.position) return Cesium.Cartesian3.ZERO;
            const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(p.position);
            return c ? Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0) : p.position;
          }, false) as unknown as Cesium.PositionProperty;

          const cameraRadiusCallback = new Cesium.CallbackProperty(() => {
            const p = satPrimitivesRef.current.get(id);
            if (!p || !p.position) return 5000;
            const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(p.position);
            if (!c) return 5000;
            const altitude = c.height;
            const footprintRadius = altitude * Math.tan(10 * (Math.PI / 180));
            return Math.max(footprintRadius, 5000);
          }, false);

          const innerEntity = viewer.entities.add({
            position: positionCallback,
            properties: new Cesium.PropertyBag({ type: 'spy-footprint' }),
            ellipse: {
              semiMinorAxis: cameraRadiusCallback,
              semiMajorAxis: cameraRadiusCallback,
              material: Cesium.Color.WHITE.withAlpha(0.2),
              outline: true,
              outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
              outlineWidth: 2,
              height: 0,
            },
            polyline: {
              positions: new Cesium.CallbackProperty(() => {
                const p = satPrimitivesRef.current.get(sat.id);
                if (!p || !p.position) return [];
                const c = Cesium.Ellipsoid.WGS84.cartesianToCartographic(p.position);
                if (!c) return [];
                const groundPos = Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, 0);
                return [groundPos, p.position];
              }, false),
              width: 1,
              material: new Cesium.PolylineDashMaterialProperty({
                color: Cesium.Color.WHITE.withAlpha(0.5),
                dashLength: 15,
              }),
            }
          });
          footprintEntitiesRef.current.set(id, innerEntity);
        }
      });

      // Remove entities that flew out
      footprintEntitiesRef.current.forEach((entity, id) => {
        if (!currentInZoneIds.has(id)) {
          viewer.entities.remove(entity);
          footprintEntitiesRef.current.delete(id);
        }
      });
    };

    viewer.scene.preUpdate.addEventListener(updateListener);

    const currentFootprints = footprintEntitiesRef.current;
    return () => {
      viewer.scene.preUpdate.removeEventListener(updateListener);
      if (targetEntityRef.current) viewer.entities.remove(targetEntityRef.current);
      currentFootprints.forEach((entity) => viewer.entities.remove(entity));
      currentFootprints.clear();
      exclusiveIdsRef.current = null; // Important reset when hook unmounts or target changes
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetLocation, allSats]); 
}

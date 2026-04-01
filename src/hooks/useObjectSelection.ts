import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import * as satellite from 'satellite.js';
import { computePosition } from '../services/satelliteService';
import type { SatelliteData, LaunchData } from '../types';

interface UseObjectSelectionProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  satPrimitivesRef: MutableRefObject<Map<string, Cesium.PointPrimitive>>;
  showSats: boolean;
  onLocationSelect?: (lat: number, lon: number) => void;
  onLaunchSelect?: (launch: LaunchData) => void;
}

export function useObjectSelection({
  viewerRef,
  satPrimitivesRef,
  showSats,
  onLocationSelect,
  onLaunchSelect,
}: UseObjectSelectionProps) {
  const [selectedSat, setSelectedSat] = useState<SatelliteData | null>(null);
  const [selectedLaunch, setSelectedLaunch] = useState<LaunchData | null>(null);

  const handlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null);
  const fovEntitiesRef = useRef<Cesium.Entity[]>([]);
  const highlightedPrimitiveRef = useRef<{
    primitive: Cesium.PointPrimitive;
    origSize: number;
    origColor: Cesium.Color;
  } | null>(null);

  // Keep callback refs stable so the click handler never captures stale closures
  const onLocationSelectRef = useRef(onLocationSelect);
  const onLaunchSelectRef = useRef(onLaunchSelect);
  useEffect(() => { onLocationSelectRef.current = onLocationSelect; }, [onLocationSelect]);
  useEffect(() => { onLaunchSelectRef.current = onLaunchSelect; }, [onLaunchSelect]);

  // Deselect satellites if the master layer is hidden
  useEffect(() => {
    if (!showSats) queueMicrotask(() => setSelectedSat(null));
  }, [showSats]);

  // Set up click handler — runs ONCE after viewer mounts
  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;

    const findSelectablePick = (position: Cesium.Cartesian2) => {
      const pickedObjects = viewer.scene.drillPick(position, 20, 10, 10);

      return pickedObjects
        .filter(p => {
          if (p.id instanceof Cesium.Entity) {
            const type = p.id.properties?.type?.getValue();
            return type !== 'spy-footprint' && type !== 'orbit-helper';
          }
          return true;
        })
        .find(p => {
          if (p.id instanceof Cesium.Entity) {
            return p.id.properties?.type?.getValue() === 'launch';
          }
          return !!(p.id && typeof p.id === 'object' && 'tleLine1' in p.id);
        });
    };

    handlerRef.current = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      // ── Magnetic Picking Logic ──
      // Satellites are tiny, so use a wider pick rectangle around the click.
      const selectablePick = findSelectablePick(click.position);

      if (Cesium.defined(selectablePick)) {
        // Handle Launch Clicks
        if (selectablePick.id instanceof Cesium.Entity) {
          const entity = selectablePick.id;
          if (entity.properties && entity.properties.type?.getValue() === 'launch') {
            const launch = entity.properties.data.getValue() as LaunchData;
            setSelectedLaunch(launch);
            onLaunchSelectRef.current?.(launch);
            setSelectedSat(null);
            return;
          }
        }

        // Handle Satellite/Debris Point Clicks
        if (selectablePick.id && typeof selectablePick.id === 'object' && 'tleLine1' in selectablePick.id) {
          setSelectedSat(selectablePick.id as SatelliteData);
          setSelectedLaunch(null);
          return;
        }
      }

      // ── Secondary Search (Aero/Sticky Pick) ──
      // If we still miss, expand by a small buffer (points are tiny and fast).
      if (!Cesium.defined(selectablePick)) {
        const neighbors = [
          { x: 3, y: 0 }, { x: -3, y: 0 }, { x: 0, y: 3 }, { x: 0, y: -3 },
          { x: 5, y: 5 }, { x: 5, y: -5 }, { x: -5, y: 5 }, { x: -5, y: -5 },
          { x: 8, y: 0 }, { x: -8, y: 0 }, { x: 0, y: 8 }, { x: 0, y: -8 },
          { x: 0, y: 0 } // Re-center in case of float issues
        ];
        for (const offset of neighbors) {
          const neighborPos = new Cesium.Cartesian2(click.position.x + offset.x, click.position.y + offset.y);
          const bestNeighbor = findSelectablePick(neighborPos);
          if (bestNeighbor) {
            if (bestNeighbor.id instanceof Cesium.Entity) {
              const launch = bestNeighbor.id.properties?.data.getValue() as LaunchData;
              setSelectedLaunch(launch);
              onLaunchSelectRef.current?.(launch);
              setSelectedSat(null);
              return;
            }

            setSelectedSat(bestNeighbor.id as SatelliteData);
            setSelectedLaunch(null);
            return;
          }
        }
      }

      // Nothing was picked — treat as a globe click (deselect / spy-location)
      const ray = viewer.camera.getPickRay(click.position);
      if (ray) {
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (Cesium.defined(cartesian)) {
          const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cartesian);
          const lat = Cesium.Math.toDegrees(cartographic.latitude);
          const lon = Cesium.Math.toDegrees(cartographic.longitude);
          onLocationSelectRef.current?.(lat, lon);
          // Only deselect when the user explicitly clicks empty earth
          setSelectedSat(null);
          setSelectedLaunch(null);
        }
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      if (handlerRef.current) handlerRef.current.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef]); // Intentionally runs once — callbacks accessed via refs above

  // Draw orbit path and highlight when satellite is selected
  useEffect(() => {
    if (!viewerRef.current) return;

    // Revert previously highlighted primitive
    if (highlightedPrimitiveRef.current) {
      const hp = highlightedPrimitiveRef.current;
      hp.primitive.pixelSize = hp.origSize;
      hp.primitive.color = hp.origColor;
      hp.primitive.outlineWidth = 0;
      hp.primitive.outlineColor = Cesium.Color.TRANSPARENT;
      highlightedPrimitiveRef.current = null;
    }

    // Flush previous footprints
    if (fovEntitiesRef.current.length > 0) {
      fovEntitiesRef.current.forEach(entity => viewerRef.current!.entities.remove(entity));
      fovEntitiesRef.current = [];
    }

    if (selectedSat) {
      // Highlight the primitive
      const selectedPrim = satPrimitivesRef.current.get(selectedSat.id);
      if (selectedPrim) {
        highlightedPrimitiveRef.current = {
          primitive: selectedPrim,
          origSize: selectedPrim.pixelSize,
          origColor: selectedPrim.color,
        };
        selectedPrim.pixelSize = 14;
        selectedPrim.color = Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(1.0);
        selectedPrim.outlineColor = Cesium.Color.WHITE;
        selectedPrim.outlineWidth = 3;
      }

      const positionCallback = new Cesium.CallbackProperty(() => {
        const prim = satPrimitivesRef.current.get(selectedSat.id);
        if (!prim || !prim.position) return Cesium.Cartesian3.ZERO;
        const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(prim.position);
        if (cartographic) {
          return Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
        }
        return prim.position;
      }, false) as unknown as Cesium.PositionProperty;

      const rfFootprintRadiusCallback = new Cesium.CallbackProperty(() => {
        const prim = satPrimitivesRef.current.get(selectedSat.id);
        if (!prim || !prim.position) return 100000;
        const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(prim.position);
        if (!cartographic) return 100000;
        
        // RF LOS Horizon Formula
        const earthRadius = Cesium.Ellipsoid.WGS84.maximumRadius;
        const altitude = cartographic.height;
        const centralAngle = Math.acos(earthRadius / (earthRadius + altitude));
        const footprintRadius = earthRadius * centralAngle;
        return Math.max(footprintRadius, 50000);
      }, false);

      const cameraFootprintRadiusCallback = new Cesium.CallbackProperty(() => {
        const prim = satPrimitivesRef.current.get(selectedSat.id);
        if (!prim || !prim.position) return 5000;
        const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(prim.position);
        if (!cartographic) return 5000;
        
        // High-Resolution Camera FOV formula (assuming 10-degree half-angle)
        const altitude = cartographic.height;
        const halfAngleVar = 10 * (Math.PI / 180);
        const footprintRadius = altitude * Math.tan(halfAngleVar);
        return Math.max(footprintRadius, 5000); // minimum 5km
      }, false);

      // 1. Large Outer Circle: Maximum RF / Line of Sight Horizon
      const rfEntity = viewerRef.current.entities.add({
        id: 'fov-footprint-rf',
        position: positionCallback,
        properties: new Cesium.PropertyBag({ type: 'orbit-helper' }),
        ellipse: {
          semiMinorAxis: rfFootprintRadiusCallback,
          semiMajorAxis: rfFootprintRadiusCallback,
          material: Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(0.12),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(0.6),
          outlineWidth: 1,
          height: 0,
        },
        // Dashed line from satellite to surface
        polyline: {
          positions: new Cesium.CallbackProperty(() => {
            const prim = satPrimitivesRef.current.get(selectedSat.id);
            if (!prim || !prim.position) return [];
            const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(prim.position);
            if (!cartographic) return [];
            const groundPos = Cesium.Cartesian3.fromRadians(cartographic.longitude, cartographic.latitude, 0);
            return [groundPos, prim.position];
          }, false),
          width: 1,
          material: new Cesium.PolylineDashMaterialProperty({
            color: Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(0.5),
            dashLength: 15,
          }),
        }
      });

      // 2. Small Inner Circle: High-Resolution Camera FOV
      const cameraEntity = viewerRef.current.entities.add({
        id: 'fov-footprint-cam',
        position: positionCallback,
        properties: new Cesium.PropertyBag({ type: 'orbit-helper' }),
        ellipse: {
          semiMinorAxis: cameraFootprintRadiusCallback,
          semiMajorAxis: cameraFootprintRadiusCallback,
          material: Cesium.Color.WHITE.withAlpha(0.2), // Distinct bright core
          outline: true,
          outlineColor: Cesium.Color.WHITE.withAlpha(0.9),
          outlineWidth: 2,
          height: 0,
        }
      });

      // 3. Orbit Trajectory Path — propagate exactly one full orbital revolution
      const orbitPositions: Cesium.Cartesian3[] = [];
      const now = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime);
      // Derive period from TLE mean motion: no is in rad/min, period = 2π/no minutes
      const satrec = satellite.twoline2satrec(selectedSat.tleLine1, selectedSat.tleLine2);
      const periodMinutes = (2 * Math.PI) / satrec.no; // exact orbital period
      const STEP_SECONDS = 30;  // 30s steps for smooth curve
      const totalSeconds = Math.round(periodMinutes * 60);
      for (let s = 0; s <= totalSeconds; s += STEP_SECONDS) {
        const t = new Date(now.getTime() + s * 1000);
        const pos = computePosition(selectedSat, t);
        if (pos) {
          orbitPositions.push(Cesium.Cartesian3.fromElements(pos.x * 1000, pos.y * 1000, pos.z * 1000));
        }
      }

      if (orbitPositions.length > 2) {
        const orbitEntity = viewerRef.current.entities.add({
          id: 'orbit-trajectory',
          properties: new Cesium.PropertyBag({ type: 'orbit-helper' }),
          polyline: {
            positions: orbitPositions,
            width: 2.5,
            material: Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(0.9),
            clampToGround: false,
          },
        });
        fovEntitiesRef.current = [rfEntity, cameraEntity, orbitEntity];
      } else {
        fovEntitiesRef.current = [rfEntity, cameraEntity];
      }
    }
  }, [selectedSat]);

  return { selectedSat, selectedLaunch, setSelectedSat, setSelectedLaunch };
}

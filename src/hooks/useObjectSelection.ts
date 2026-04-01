import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { computePosition } from '../services/satelliteService';
import type { SatelliteData, LaunchData } from '../types';

interface UseObjectSelectionProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  satPrimitivesRef: MutableRefObject<Map<string, Cesium.PointPrimitive>>;
  showSats: boolean;
  onLocationSelect?: (lat: number, lon: number) => void;
}

export function useObjectSelection({
  viewerRef,
  satPrimitivesRef,
  showSats,
  onLocationSelect,
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

  // Deselect satellites if the master layer is hidden
  useEffect(() => {
    if (!showSats) queueMicrotask(() => setSelectedSat(null));
  }, [showSats]);

  // Set up click handler
  useEffect(() => {
    if (!viewerRef.current) return;
    const viewer = viewerRef.current;

    handlerRef.current = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    handlerRef.current.setInputAction((click: { position: Cesium.Cartesian2 }) => {
      // ── Magnetic Picking Logic ──
      // Since satellite points are tiny (3-5px), we perform a 'drillPick' 
      // which scans all layers under the specific pixel.
      const pickedObjects = viewer.scene.drillPick(click.position);
      
      // Filter out helper mission graphics (footprints/orbits)
      const validPicks = pickedObjects.filter(p => {
        if (p.id instanceof Cesium.Entity) {
          const type = p.id.properties?.type?.getValue();
          return type !== 'spy-footprint' && type !== 'orbit-helper';
        }
        return true;
      });

      const pickedObject = validPicks[0];

      if (Cesium.defined(pickedObject)) {
        // Handle Launch Clicks
        if (pickedObject.id instanceof Cesium.Entity) {
          const entity = pickedObject.id;
          if (entity.properties && entity.properties.type?.getValue() === 'launch') {
            setSelectedLaunch(entity.properties.data.getValue());
            setSelectedSat(null);
            return;
          }
        } 
        
        // Handle Satellite/Debris Point Clicks
        else if (pickedObject.id && typeof pickedObject.id === 'object' && 'tleLine1' in pickedObject.id) {
          setSelectedSat(pickedObject.id as SatelliteData);
          setSelectedLaunch(null);
          return;
        }
      }

      // ── Secondary Search (Aero/Sticky Pick) ──
      // If we missed the tiny 3px point by a sliver, we check a 3x3 pixel neighborhood
      // This is the 'secret sauce' for professional-feeling 3D selection.
      if (!Cesium.defined(pickedObject)) {
        const neighbors = [
          { x: 2, y: 0 }, { x: -2, y: 0 }, { x: 0, y: 2 }, { x: 0, y: -2 }
        ];
        for (const offset of neighbors) {
          const neighborPos = new Cesium.Cartesian2(click.position.x + offset.x, click.position.y + offset.y);
          const neighborPicks = viewer.scene.drillPick(neighborPos);
          const bestNeighbor = neighborPicks.find(p => p.id && typeof p.id === 'object' && 'tleLine1' in p.id);
          if (bestNeighbor) {
            setSelectedSat(bestNeighbor.id as SatelliteData);
            setSelectedLaunch(null);
            return;
          }
        }
      }

      // If nothing was picked, check for globe click
      const ray = viewer.camera.getPickRay(click.position);
      if (ray) {
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (Cesium.defined(cartesian)) {
          const cartographic = Cesium.Ellipsoid.WGS84.cartesianToCartographic(cartesian);
          const lat = Cesium.Math.toDegrees(cartographic.latitude);
          const lon = Cesium.Math.toDegrees(cartographic.longitude);
          onLocationSelect?.(lat, lon);
        }
      }

      setSelectedSat(null);
      setSelectedLaunch(null);
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    return () => {
      if (handlerRef.current) handlerRef.current.destroy();
    };
  }, [onLocationSelect, viewerRef]);

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

      // 3. Orbit Trajectory Path — propagate +90 minutes for one full orbit ahead
      const orbitPositions: Cesium.Cartesian3[] = [];
      const now = Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime);
      const ORBIT_MINUTES = 90;
      const STEP_MINUTES = 1;
      for (let m = 0; m <= ORBIT_MINUTES; m += STEP_MINUTES) {
        const t = new Date(now.getTime() + m * 60 * 1000);
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
            width: 3.5,
            material: new Cesium.PolylineDashMaterialProperty({
              color: Cesium.Color.fromCssColorString(selectedSat.colorHex).withAlpha(0.8),
              dashLength: 12,
            }),
          },
        });
        fovEntitiesRef.current = [rfEntity, cameraEntity, orbitEntity];
      } else {
        fovEntitiesRef.current = [rfEntity, cameraEntity];
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSat]);

  return { selectedSat, selectedLaunch, setSelectedSat, setSelectedLaunch };
}

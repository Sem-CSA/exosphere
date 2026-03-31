import { useEffect, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { computePosition } from '../services/satelliteService';
import type { SatelliteData } from '../types';

interface UseCameraTrackingProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  focusEntityRef: MutableRefObject<Cesium.Entity | null>;
  selectedSat: SatelliteData | null;
}

export function useCameraTracking({
  viewerRef,
  focusEntityRef,
  selectedSat,
}: UseCameraTrackingProps) {
  const [isTracking, setIsTracking] = useState(false);

  // Clear tracking when no satellite is selected
  useEffect(() => {
    if (!selectedSat) setIsTracking(false);
  }, [selectedSat]);

  // Camera tracking logic
  useEffect(() => {
    if (!viewerRef.current || !focusEntityRef.current) return;

    if (selectedSat && isTracking) {
      const positionProp = new Cesium.SampledPositionProperty();
      const currentSimTime = viewerRef.current.clock.currentTime;

      // Pre-calculate 600 minutes of orbital positions for fast-forwarding/reversing
      for (let m = -300; m <= 300; m += 2) {
        const timeOffset = Cesium.JulianDate.addMinutes(currentSimTime, m, new Cesium.JulianDate());
        const jsDate = Cesium.JulianDate.toDate(timeOffset);
        const pos = computePosition(selectedSat, jsDate);
        if (pos) {
          positionProp.addSample(
            timeOffset,
            Cesium.Cartesian3.fromElements(pos.x * 1000, pos.y * 1000, pos.z * 1000)
          );
        }
      }

      positionProp.setInterpolationOptions({
        interpolationDegree: 5,
        interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
      });

      focusEntityRef.current.position = positionProp;
      focusEntityRef.current.orientation = new Cesium.VelocityOrientationProperty(positionProp);

      // Force Cesium to re-evaluate tracking target
      viewerRef.current.trackedEntity = undefined;
      viewerRef.current.trackedEntity = focusEntityRef.current;
    } else {
      viewerRef.current.trackedEntity = undefined;
    }
  }, [selectedSat, isTracking]);

  return { isTracking, setIsTracking };
}

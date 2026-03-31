import { useEffect, useRef, type MutableRefObject, type RefObject } from 'react';
import * as Cesium from 'cesium';

export interface CesiumRefs {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  pointsRef: MutableRefObject<Cesium.PointPrimitiveCollection | null>;
  focusEntityRef: MutableRefObject<Cesium.Entity | null>;
  satPrimitivesRef: MutableRefObject<Map<string, Cesium.PointPrimitive>>;
}

export function useCesiumViewer(
  containerRef: RefObject<HTMLDivElement | null>
): CesiumRefs {
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const pointsRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const focusEntityRef = useRef<Cesium.Entity | null>(null);
  const satPrimitivesRef = useRef<Map<string, Cesium.PointPrimitive>>(new Map());

  useEffect(() => {
    if (containerRef.current && !viewerRef.current) {
      viewerRef.current = new Cesium.Viewer(containerRef.current, {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        scene3DOnly: true,
      });

      const creditDisplay = viewerRef.current.cesiumWidget.creditContainer as HTMLElement;
      if (creditDisplay) creditDisplay.style.display = 'none';

      // ── GPU Performance Tuning ──
      viewerRef.current.targetFrameRate = 30; // Cap at 30fps — plenty for orbital viz
      viewerRef.current.scene.globe.enableLighting = true;
      viewerRef.current.scene.globe.maximumScreenSpaceError = 2; // Default 2 (lower = sharper tiles, higher = blurrier but faster)
      viewerRef.current.scene.globe.tileCacheSize = 100; // Reduce GPU memory for tiles
      viewerRef.current.scene.fog.enabled = false; // Disable atmospheric fog
      viewerRef.current.scene.postProcessStages.fxaa.enabled = false; // Disable FXAA
      viewerRef.current.scene.globe.showGroundAtmosphere = true; // Re-enabled for better looking earth edge
      viewerRef.current.scene.highDynamicRange = false;
      viewerRef.current.resolutionScale = 1.0; // 1.0 = native, lower for weaker GPUs
      viewerRef.current.clock.shouldAnimate = true;
      viewerRef.current.clock.multiplier = 1;

      pointsRef.current = viewerRef.current.scene.primitives.add(
        new Cesium.PointPrimitiveCollection()
      );

      focusEntityRef.current = viewerRef.current.entities.add({
        id: 'focus-entity',
        point: {
          pixelSize: 1,
          color: Cesium.Color.TRANSPARENT,
          outlineWidth: 0,
        },
        viewFrom: new Cesium.Cartesian3(0, -4000000, 2000000),
      });

      const handleResize = () => {
        if (viewerRef.current) viewerRef.current.resize();
      };
      window.addEventListener('resize', handleResize);

      return () => {
        window.removeEventListener('resize', handleResize);
        if (viewerRef.current) {
          viewerRef.current.destroy();
          viewerRef.current = null;
        }
        satPrimitivesRef.current.clear();
      };
    }
  }, []);

  return { viewerRef, pointsRef, focusEntityRef, satPrimitivesRef };
}

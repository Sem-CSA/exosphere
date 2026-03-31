import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { fetchUpcomingLaunches } from '../services/launchService';
import type { LaunchData } from '../types';

interface UseLaunchLayerProps {
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  showLaunches: boolean;
}

export function useLaunchLayer({ viewerRef, showLaunches }: UseLaunchLayerProps) {
  const [loadingLaunches, setLoadingLaunches] = useState(true);
  const [launchCount, setLaunchCount] = useState(0);
  const [launches, setLaunches] = useState<LaunchData[]>([]);
  const mountId = useRef(0);

  // Toggle launch entity visibility when master toggle changes
  useEffect(() => {
    if (viewerRef.current) {
      viewerRef.current.entities.values.forEach(entity => {
        if (entity.properties && entity.properties.type?.getValue() === 'launch') {
          entity.show = showLaunches;
        }
      });
    }
  }, [showLaunches]);

  useEffect(() => {
    const currentMount = ++mountId.current;
    if (!viewerRef.current) return;

    const load = async () => {
      setLoadingLaunches(true);
      const launchData = await fetchUpcomingLaunches();
      if (currentMount !== mountId.current || !viewerRef.current) return;

      setLaunchCount(launchData.length);
      setLaunches(launchData);

      launchData.forEach(launch => {
        if (launch.pad.latitude && launch.pad.longitude) {
          const lat = parseFloat(launch.pad.latitude);
          const lon = parseFloat(launch.pad.longitude);

          viewerRef.current!.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat),
            point: {
              pixelSize: 8,
              color: Cesium.Color.ORANGE,
              outlineColor: Cesium.Color.WHITE,
              outlineWidth: 2,
            },
            label: {
              text: '🚀',
              font: '16px monospace',
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -20),
            },
            properties: {
              type: 'launch',
              data: launch,
            },
          });
        }
      });

      setLoadingLaunches(false);
    };

    load();
  }, []);

  return { loadingLaunches, launchCount, launches };
}

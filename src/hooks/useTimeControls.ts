import { useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';

export function useTimeControls(viewerRef: MutableRefObject<Cesium.Viewer | null>) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [timeMultiplier, setTimeMultiplier] = useState(1);

  const togglePlay = () => {
    if (viewerRef.current) {
      const newState = !viewerRef.current.clock.shouldAnimate;
      viewerRef.current.clock.shouldAnimate = newState;
      setIsPlaying(newState);
    }
  };

  const multiplyTime = () => {
    if (viewerRef.current) {
      let nextMulti = timeMultiplier * 10;
      if (nextMulti > 1000) nextMulti = 1;
      viewerRef.current.clock.multiplier = nextMulti;
      setTimeMultiplier(nextMulti);
      if (!isPlaying) togglePlay();
    }
  };

  const resetTime = () => {
    if (viewerRef.current) {
      viewerRef.current.clock.currentTime = Cesium.JulianDate.now();
      viewerRef.current.clock.multiplier = 1;
      viewerRef.current.clock.shouldAnimate = true;
      setTimeMultiplier(1);
      setIsPlaying(true);
    }
  };

  return { isPlaying, timeMultiplier, togglePlay, multiplyTime, resetTime };
}

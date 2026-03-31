import { useEffect, useState, type MutableRefObject } from 'react';
import * as Cesium from 'cesium';
import { Target } from 'lucide-react';
import { getSatelliteDetails } from '../../services/satelliteService';
import type { SatelliteData } from '../../types';

interface SatellitePanelProps {
  selectedSat: SatelliteData;
  onClose: () => void;
  isTracking: boolean;
  onToggleTracking: () => void;
  viewerRef: MutableRefObject<Cesium.Viewer | null>;
  isPlaying: boolean;
}

export default function SatellitePanel({
  selectedSat,
  onClose,
  isTracking,
  onToggleTracking,
  viewerRef,
  isPlaying,
}: SatellitePanelProps) {
  const [, setPanelRefresh] = useState(0);

  // Auto-refresh telemetry every second while playing
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (isPlaying) {
      interval = setInterval(() => setPanelRefresh(prev => prev + 1), 1000);
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  let satDetails = null;
  if (viewerRef.current) {
    satDetails = getSatelliteDetails(selectedSat, Cesium.JulianDate.toDate(viewerRef.current.clock.currentTime));
  }

  return (
    <div className="absolute top-4 right-4 glass-panel p-5 w-80 flex flex-col shadow-2xl animate-in fade-in slide-in-from-right-4 duration-300"
         style={{ zIndex: 1000 }}>
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-accent truncate max-w-[80%]">{selectedSat.name}</h2>
        <button className="text-secondary hover:text-white font-bold bg-transparent" onClick={onClose}>✕</button>
      </div>
      <div className="flex flex-col gap-3 text-sm text-secondary">
        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">NORAD ID</span>
          <span className="font-mono text-accent">{selectedSat.id}</span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Altitude</span>
          <span className="font-mono text-white">{satDetails?.altitude || 'N/A'} km</span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Velocity</span>
          <span className="font-mono text-white">{satDetails?.velocity || 'N/A'} km/s</span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Inclination</span>
          <span className="font-mono text-white">{satDetails?.inclination || 'N/A'}°</span>
        </div>

        <div className="flex justify-between border-b pb-2 border-[var(--panel-border)]">
          <span className="text-white">Revs / Day</span>
          <span className="font-mono text-white">{satDetails?.revsPerDay || 'N/A'}</span>
        </div>

        <div className="mt-1">
          <span className="text-white text-xs uppercase tracking-wider mb-2 block">Orbital Elements (TLE)</span>
          <div className="bg-black/40 p-3 rounded-md text-xs font-mono overflow-x-auto whitespace-pre border border-[var(--panel-border)] text-[var(--text-secondary)] leading-relaxed">
            {selectedSat.tleLine1}<br />{selectedSat.tleLine2}
          </div>
        </div>

        <div className="flex gap-2 mt-2 pt-3 border-t border-[var(--panel-border)]">
          <button
            className={`flex-1 py-1.5 rounded text-xs font-bold flex items-center justify-center gap-1 transition-all ${isTracking ? 'bg-accent text-black box-shadow-glow' : 'bg-white/10 text-white hover:bg-white/20'}`}
            onClick={onToggleTracking}
          >
            <Target size={14} />
            {isTracking ? 'Tracking Camera' : 'Track Camera'}
          </button>
        </div>
      </div>
    </div>
  );
}

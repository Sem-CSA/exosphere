import { useMemo } from 'react';
import { ShieldAlert, MapPin, X } from 'lucide-react';
import type { SatelliteData } from '../../types';

interface EyesAbovePanelProps {
  location: { lat: number, lon: number, name: string };
  monitoringSats: SatelliteData[];
  nearbySats: SatelliteData[];
  dangerLevel: 'green' | 'yellow' | 'red';
  onClose: () => void;
  onSelectSatellite: (sat: SatelliteData) => void;
}

export default function EyesAbovePanel({
  location,
  monitoringSats,
  nearbySats,
  dangerLevel,
  onClose,
  onSelectSatellite,
}: EyesAbovePanelProps) {
  // Filter nearby to exclude those already in monitoring (Set for O(1) lookup)
  const actualNearby = useMemo(() => {
    const monitoringIds = new Set(monitoringSats.map(m => m.id));
    return nearbySats.filter(s => !monitoringIds.has(s.id));
  }, [nearbySats, monitoringSats]);

  return (
    <div className="command-sidebar animate-in fade-in slide-in-from-right-4 duration-300" 
         style={{ left: 'auto', right: '16px', bottom: 'auto', maxHeight: '85vh' }}>
      {/* HEADER */}
      <div className="sidebar-header" style={{ justifyContent: 'space-between' }}>
        <div className="flex items-center gap-2">
          <ShieldAlert size={18} className={dangerLevel === 'red' ? 'text-red-500 animate-pulse' : 'text-accent'} />
          <span className="sidebar-title">EYES ABOVE</span>
        </div>
        <button onClick={onClose} className="text-secondary hover:text-white p-1">
          <X size={16} />
        </button>
      </div>

      <div className="sidebar-scroll">
        <div className="sidebar-section">
          {/* Target Location Card */}
          <div className="sidebar-item" style={{ marginTop: '16px' }}>
            <div className="flex items-center gap-2 mb-4" style={{ marginBottom: '16px' }}>
              <MapPin size={14} className="text-red-400" />
              <span className="text-xs font-bold text-accent truncate">{location.name}</span>
            </div>
            
            <div className="spy-status-bar" style={{
              borderColor: dangerLevel === 'red' ? 'rgba(239,68,68,0.5)' : 'rgba(234,179,8,0.5)',
              background: dangerLevel === 'red' ? 'rgba(239,68,68,0.15)' : 'rgba(234,179,8,0.15)',
            }}>
              <div className="sidebar-status-dot animate-pulse" style={{
                backgroundColor: dangerLevel === 'red' ? '#ef4444' : '#eab308',
              }} />
              <span className="text-[10px] font-mono text-white">
                {dangerLevel === 'red' ? 'CRITICAL EXPOSURE' : 'PROXIMITY WARNING'}
              </span>
            </div>
          </div>

          {/* ACTIVE MONITORING SECTION */}
          <div className="section-divider-label">ACTIVE MONITORING ({monitoringSats.length})</div>
          <div className="sidebar-sub-content">
            {monitoringSats.length > 0 ? (
              <div className="launch-list" style={{ maxHeight: '160px' }}>
                {monitoringSats.map(sat => (
                  <button
                    key={sat.id}
                    className="launch-item"
                    onClick={() => onSelectSatellite(sat)}
                    style={{ borderLeft: `3px solid ${sat.colorHex}` }}
                  >
                    <div className="launch-item-header">
                      <span className="launch-item-rocket" style={{ fontSize: '10px' }}>🛰</span>
                      <span className="launch-item-countdown" style={{ color: sat.colorHex }}>
                        {sat.id}
                      </span>
                    </div>
                    <div className="launch-item-name">{sat.name}</div>
                    <div className="launch-item-meta">
                      <span>{sat.group}</span>
                      <span>·</span>
                      <span style={{ color: '#ef4444' }}>DIRECT LINK</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 text-center text-secondary border border-dashed border-white/5 rounded-lg">
                <span className="text-[9px] uppercase tracking-tighter opacity-50">No Direct Surveillance</span>
              </div>
            )}
          </div>

          {/* NEARBY ASSETS SECTION */}
          <div className="section-divider-label" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '12px', marginTop: '12px' }}>
            NEARBY ASSETS ({actualNearby.length})
          </div>
          <div className="sidebar-sub-content">
            {actualNearby.length > 0 ? (
              <div className="launch-list" style={{ maxHeight: '200px' }}>
                {actualNearby.map(sat => (
                  <button
                    key={sat.id}
                    className="launch-item"
                    onClick={() => onSelectSatellite(sat)}
                    style={{ borderLeft: `3px solid ${sat.colorHex}` }}
                  >
                    <div className="launch-item-header">
                      <span className="launch-item-rocket" style={{ fontSize: '10px' }}>🛰</span>
                      <span className="launch-item-countdown" style={{ color: sat.colorHex }}>
                        {sat.id}
                      </span>
                    </div>
                    <div className="launch-item-name">{sat.name}</div>
                    <div className="launch-item-meta">
                      <span>{sat.group}</span>
                      <span>·</span>
                      <span className="text-accent opacity-60">IN ZONE</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 text-center text-secondary border border-dashed border-white/5 rounded-lg">
                <span className="text-[9px] uppercase tracking-tighter opacity-50">Zone Clear</span>
              </div>
            )}
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 text-[9px] text-secondary italic text-center">
            Tracking {monitoringSats.length + actualNearby.length} assets in proximity.
          </div>
        </div>
      </div>
    </div>
  );
}

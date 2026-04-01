import { useState, useEffect, useRef, useCallback, memo } from 'react';
import * as Cesium from 'cesium';
import {
  Globe2, Satellite, Rocket, ShieldAlert,
  ChevronDown, ChevronRight,
  MapPin, Loader2,
  Shield, Zap, Wind, Activity, Sun,
} from 'lucide-react';
import type { SatelliteGroup, LaunchData } from '../../types';
import { GroupColors } from '../../types';
import type { SolarWindData } from '../../hooks/useMagnetosphere';

// ═══════════════════════════════════════════════════════════════
// UNIFIED COMMAND SIDEBAR
// Combines: Layer Controls + Spy Detector + Magnetosphere
// into a single organized, scrollable panel.
// ═══════════════════════════════════════════════════════════════

// ── Helper functions for Magnetosphere ──
function getKpColor(kp: number): string {
  if (kp >= 7) return '#ff2d2d';
  if (kp >= 5) return '#ff6b35';
  if (kp >= 4) return '#ffc107';
  if (kp >= 2) return '#4caf50';
  return '#2196f3';
}
function getKpLabel(kp: number): string {
  if (kp >= 8) return 'EXTREME STORM';
  if (kp >= 7) return 'SEVERE STORM';
  if (kp >= 5) return 'GEO STORM';
  if (kp >= 4) return 'ACTIVE';
  if (kp >= 2) return 'UNSETTLED';
  return 'QUIET';
}
function getWindCategory(speed: number): { label: string; color: string } {
  if (speed >= 700) return { label: 'EXTREME', color: '#ff2d2d' };
  if (speed >= 500) return { label: 'HIGH', color: '#ff6b35' };
  if (speed >= 400) return { label: 'ELEVATED', color: '#ffc107' };
  return { label: 'NOMINAL', color: '#4caf50' };
}

// ── Nominatim suggestion type ──
interface GeoSuggestion {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  type: string;
}

interface CommandSidebarProps {
  viewerRef: React.MutableRefObject<Cesium.Viewer | null>;
  // Layer Controls
  showSatsUI: boolean;
  setShowSatsUI: (v: boolean) => void;
  showDebrisUI: boolean;
  setShowDebrisUI: (v: boolean) => void;
  showLaunchesUI: boolean;
  setShowLaunchesUI: (v: boolean) => void;
  satFilters: Record<SatelliteGroup, boolean>;
  toggleFilter: (grp: SatelliteGroup) => void;
  loadingSats: boolean;
  loadingDebris: boolean;
  loadingLaunches: boolean;
  satelliteCount: number;
  debrisCount: number;
  launchCount: number;
  launches: LaunchData[];
  // Eyes Above
  spyModeActive: boolean;
  spyTargetLocation: { lat: number; lon: number; name: string } | null;
  spyDetectCount: number;
  spyWatchingCount: number;
  spyDangerLevel: 'green' | 'yellow' | 'red';
  onToggleSpyMode: () => void;
  onSetSpyData: (target: { lat: number; lon: number; name: string } | null) => void;
  // Magnetosphere
  magnetosphereActive: boolean;
  solarWind: SolarWindData | null;
  onToggleMagnetosphere: () => void;
  onSelectLaunch: (launch: LaunchData) => void;
}

// ── Reusable Section Header ──
function SectionHeader({
  icon, label, expanded, onToggle, accentColor, rightSlot,
}: {
  icon: React.ReactNode;
  label: string;
  expanded: boolean;
  onToggle: () => void;
  accentColor?: string;
  rightSlot?: React.ReactNode;
}) {
  return (
    <button
      onClick={onToggle}
      className="flex items-center justify-between w-full py-2 transition-colors"
      style={{ color: 'white' }}
    >
      <div className="flex items-center gap-2">
        <span style={{ color: accentColor || 'var(--accent)' }}>{icon}</span>
        <span className="text-xs uppercase tracking-widest font-bold">{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {rightSlot}
        {expanded ? <ChevronDown size={14} className="text-secondary" /> : <ChevronRight size={14} className="text-secondary" />}
      </div>
    </button>
  );
}

const CommandSidebar = memo(function CommandSidebar({
  viewerRef,
  showSatsUI, setShowSatsUI,
  showDebrisUI, setShowDebrisUI,
  showLaunchesUI, setShowLaunchesUI,
  satFilters, toggleFilter,
  loadingSats, loadingDebris, loadingLaunches,
  satelliteCount, debrisCount, launchCount,
  launches,
  spyModeActive, spyTargetLocation, spyDetectCount, spyWatchingCount, spyDangerLevel,
  onToggleSpyMode, onSetSpyData,
  magnetosphereActive, solarWind, onToggleMagnetosphere,
  onSelectLaunch,
}: CommandSidebarProps) {
  
  const [isCollapsed, setIsCollapsed] = useState(false);

  // Section expanded states
  const [satsExpanded, setSatsExpanded] = useState(false);
  const [debrisExpanded, setDebrisExpanded] = useState(false);
  const [launchesExpanded, setLaunchesExpanded] = useState(false);
  const [spyExpanded, setSpyExpanded] = useState(true);
  const [magExpanded, setMagExpanded] = useState(true);

  // ── Spy Detector: address autocomplete ──
  const [address, setAddress] = useState('');
  const [suggestions, setSuggestions] = useState<GeoSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [errorLine, setErrorLine] = useState<string | null>(null);
  const [lockedTarget, setLockedTarget] = useState<{ name: string } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    if (spyModeActive) setSpyExpanded(true);
  }, [spyModeActive]);

  // Sync sidebar address/target if surveillance status changes elsewhere (e.g. globe click or panel close)
  useEffect(() => {
    if (!spyModeActive || !spyTargetLocation) {
      setAddress('');
      setLockedTarget(null);
      setSuggestions([]);
      setShowSuggestions(false);
    } else if (spyTargetLocation.name !== lockedTarget?.name) {
      setLockedTarget({ name: spyTargetLocation.name });
      setAddress(spyTargetLocation.name);
    }
  }, [spyModeActive, spyTargetLocation, lockedTarget]);

  // Debounced autocomplete fetch
  const fetchSuggestions = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&addressdetails=0`
      );
      const data: GeoSuggestion[] = await res.json();
      setSuggestions(data || []);
      setShowSuggestions(data.length > 0);
    } catch {
      setSuggestions([]);
    }
  }, []);

  // Debounce input changes
  const handleAddressChange = (value: string) => {
    setAddress(value);
    setErrorLine(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetchSuggestions(value), 300);
  };

  // Close suggestions on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fly camera to coordinates
  const flyToLocation = useCallback((lat: number, lon: number) => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lon, lat, 500000), // 500km altitude
      orientation: {
        heading: 0,
        pitch: Cesium.Math.toRadians(-90), // Look straight down at the location
        roll: 0,
      },
      duration: 2.0,
    });
  }, [viewerRef]);

  // Select a suggestion
  const handleSelectSuggestion = (suggestion: GeoSuggestion) => {
    const lat = parseFloat(suggestion.lat);
    const lon = parseFloat(suggestion.lon);
    const displayName = suggestion.display_name.split(',')[0];
    setAddress(displayName);
    setLockedTarget({ name: displayName });
    setSuggestions([]);
    setShowSuggestions(false);
    onSetSpyData({ lat, lon, name: displayName });
    flyToLocation(lat, lon);
  };

  // Manual search (Enter key)
  const handleSpySearch = async () => {
    if (!address.trim()) return;
    setIsSearching(true);
    setErrorLine(null);
    setShowSuggestions(false);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`);
      const data = await res.json();
      if (!data || data.length === 0) {
        setErrorLine('Address not found.');
        setIsSearching(false);
        return;
      }
      const lat = parseFloat(data[0].lat);
      const lon = parseFloat(data[0].lon);
      const displayName = data[0].display_name.split(',')[0];
      setLockedTarget({ name: displayName });
      onSetSpyData({ lat, lon, name: displayName });
      flyToLocation(lat, lon);
    } catch {
      setErrorLine('Geocoding failed.');
    } finally {
      setIsSearching(false);
    }
  };

  const handleSpyClear = () => {
    setAddress('');
    setLockedTarget(null);
    setSuggestions([]);
    setShowSuggestions(false);
    onSetSpyData(null);
  };

  // ── Magnetosphere computed values ──
  const kp = solarWind?.kpIndex ?? 0;
  const speed = solarWind?.speed ?? 0;
  const density = solarWind?.density ?? 0;
  const magnetopause = solarWind?.magnetopauseDistance ?? 10;
  const pressure = solarWind?.dynamicPressure ?? 0;
  const kpColor = getKpColor(kp);
  const kpLabel = getKpLabel(kp);
  const windCat = getWindCategory(speed);
  const kpSegments = Array.from({ length: 9 }, (_, i) => i + 1);

  // ── Format launch date ──
  const formatLaunchTime = (net: string) => {
    try {
      const d = new Date(net);
      const now = new Date();
      const diffMs = d.getTime() - now.getTime();
      const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
      const diffHours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      if (diffDays > 0) return `T-${diffDays}d ${diffHours}h`;
      if (diffHours > 0) return `T-${diffHours}h`;
      return 'IMMINENT';
    } catch { return net; }
  };

  const handleSatsHeaderToggle = () => {
    if (!satsExpanded && !showSatsUI) setShowSatsUI(true);
    setSatsExpanded(!satsExpanded);
  };

  const handleDebrisHeaderToggle = () => {
    if (!debrisExpanded && !showDebrisUI) setShowDebrisUI(true);
    setDebrisExpanded(!debrisExpanded);
  };

  const handleLaunchesHeaderToggle = () => {
    if (!launchesExpanded && !showLaunchesUI) setShowLaunchesUI(true);
    setLaunchesExpanded(!launchesExpanded);
  };

  const handleSpyHeaderToggle = () => {
    if (!spyExpanded && !spyModeActive) onToggleSpyMode();
    setSpyExpanded(!spyExpanded);
  };

  const handleMagHeaderToggle = () => {
    if (!magExpanded && !magnetosphereActive) onToggleMagnetosphere();
    setMagExpanded(!magExpanded);
  };

  return (
    <>
      <div 
        className="command-sidebar"
        style={{
          transform: isCollapsed ? 'translateX(calc(-100% - 24px))' : 'translateX(0)',
          transition: 'transform 300ms ease',
          pointerEvents: isCollapsed ? 'none' : 'auto',
        }}
      >
        {/* HEADER */}
        <div className="sidebar-header flex justify-between items-center bg-[rgba(15,23,42,0.9)] border-b border-[rgba(255,255,255,0.1)] pb-3 mb-2">
          <div className="flex items-center gap-2">
            <Globe2 className="text-accent" size={22} />
            <h1 className="text-lg font-black tracking-widest text-white">EXOSPHERE</h1>
          </div>
          <button 
            onClick={() => setIsCollapsed(true)} 
            className="text-gray-400 hover:text-white transition-colors p-1"
            title="Retract Sidebar"
          >
            <ChevronDown className="transform rotate-90" size={20} />
          </button>
        </div>

        <div className="sidebar-scroll">

        {/* ════════ ORBITAL TRACKING ════════ */}
        <div className="sidebar-section">
          <div className="section-divider-label">ORBITAL TRACKING</div>

          {/* Active Satellites */}
          <div className="sidebar-item">
            <SectionHeader
              icon={<Satellite size={14} />} label="Active Satellites"
              expanded={satsExpanded} onToggle={handleSatsHeaderToggle}
              accentColor="var(--accent)"
              rightSlot={
                <div className="flex items-center gap-2">
                  {loadingSats
                    ? <span className="sidebar-badge" style={{ color: 'var(--text-secondary)' }}>Loading...</span>
                    : <span className="sidebar-badge" style={{ color: 'var(--accent)' }}>{satelliteCount.toLocaleString()}</span>}
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={showSatsUI} onChange={e => setShowSatsUI(e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              }
            />
            {satsExpanded && showSatsUI && !loadingSats && (
              <div className="sidebar-sub-items">
                {(Object.keys(GroupColors) as SatelliteGroup[]).filter(g => !g.startsWith('DEBRIS_')).map(grp => {
                  const checked = satFilters[grp];
                  const color = GroupColors[grp];
                  return (
                    <label key={grp} className="filter-row">
                      <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleFilter(grp)} />
                      <div className="filter-dot" style={{ backgroundColor: checked ? color : 'rgba(255,255,255,0.1)', boxShadow: checked ? `0 0 6px ${color}` : 'none' }} />
                      <span className={checked ? 'text-white' : 'text-secondary opacity-60'}>{grp}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Space Debris */}
          <div className="sidebar-item">
            <SectionHeader
              icon={<ShieldAlert size={14} />} label="Space Debris"
              expanded={debrisExpanded} onToggle={handleDebrisHeaderToggle}
              accentColor="#ff6b35"
              rightSlot={
                <div className="flex items-center gap-2">
                  {loadingDebris
                    ? <span className="sidebar-badge" style={{ color: 'var(--text-secondary)' }}>Loading...</span>
                    : <span className="sidebar-badge" style={{ color: '#ff6b35' }}>{debrisCount.toLocaleString()}</span>}
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={showDebrisUI} onChange={e => setShowDebrisUI(e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              }
            />
            {debrisExpanded && showDebrisUI && !loadingDebris && (
              <div className="sidebar-sub-items">
                {(Object.keys(GroupColors) as SatelliteGroup[]).filter(g => g.startsWith('DEBRIS_')).map(grp => {
                  const checked = satFilters[grp];
                  const color = GroupColors[grp];
                  return (
                    <label key={grp} className="filter-row">
                      <input type="checkbox" className="hidden" checked={checked} onChange={() => toggleFilter(grp)} />
                      <div className="filter-dot" style={{ backgroundColor: checked ? color : 'rgba(255,255,255,0.1)', boxShadow: checked ? `0 0 6px ${color}` : 'none' }} />
                      <span className={checked ? 'text-white' : 'text-secondary opacity-60'}>{grp.replace('DEBRIS_', '').replace(/_/g, ' ')}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>

          {/* Upcoming Launches — now a full dropdown */}
          <div className="sidebar-item">
            <SectionHeader
              icon={<Rocket size={14} />} label="Upcoming Launches"
              expanded={launchesExpanded} onToggle={handleLaunchesHeaderToggle}
              accentColor="#f97316"
              rightSlot={
                <div className="flex items-center gap-2">
                  {loadingLaunches
                    ? <span className="sidebar-badge" style={{ color: 'var(--text-secondary)' }}>Loading...</span>
                    : <span className="sidebar-badge" style={{ color: '#f97316' }}>{launchCount}</span>}
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={showLaunchesUI} onChange={e => setShowLaunchesUI(e.target.checked)} />
                    <span className="toggle-slider" />
                  </label>
                </div>
              }
            />
            {launchesExpanded && showLaunchesUI && !loadingLaunches && launches.length > 0 && (
              <div className="sidebar-sub-content">
                <div className="launch-list">
                  {launches.map(launch => {
                    const hasCoords = launch.pad.latitude && launch.pad.longitude;
                    return (
                      <button
                        key={launch.id}
                        className="launch-item"
                        onClick={() => {
                          onSelectLaunch(launch);
                          if (hasCoords) {
                            const lat = parseFloat(launch.pad.latitude);
                            const lon = parseFloat(launch.pad.longitude);
                            flyToLocation(lat, lon);
                          }
                        }}
                      >
                        <div className="launch-item-header">
                          <span className="launch-item-rocket">🚀</span>
                          <span className="launch-item-countdown" style={{ color: '#f97316' }}>
                            {formatLaunchTime(launch.net)}
                          </span>
                        </div>
                        <div className="launch-item-name">{launch.name}</div>
                        <div className="launch-item-meta">
                          <span>{launch.provider}</span>
                          <span>·</span>
                          <span>{launch.pad.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ════════ INTELLIGENCE ════════ */}
        <div className="sidebar-section">
          <div className="section-divider-label">INTELLIGENCE</div>

          <div className="sidebar-item">
            <SectionHeader
              icon={<ShieldAlert size={14} />} label="Eyes Above"
              expanded={spyExpanded} onToggle={handleSpyHeaderToggle}
              accentColor="#ef4444"
              rightSlot={
                <div className="flex items-center gap-2">
                  {spyModeActive && (
                    <div className="sidebar-status-dot" style={{
                      backgroundColor: spyDangerLevel === 'red' ? '#ef4444' : spyDangerLevel === 'yellow' ? '#eab308' : '#22c55e',
                      boxShadow: spyDangerLevel === 'red' ? '0 0 8px rgba(239,68,68,0.8)' : spyDangerLevel === 'yellow' ? '0 0 8px rgba(234,179,8,0.8)' : 'none',
                    }} />
                  )}
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={spyModeActive} onChange={() => { onToggleSpyMode(); if (spyModeActive) handleSpyClear(); }} />
                    <span className="toggle-slider toggle-slider--red" />
                  </label>
                </div>
              }
            />

            {spyExpanded && spyModeActive && (
              <div className="sidebar-sub-content">
                {lockedTarget ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-white text-xs">
                        <MapPin size={12} style={{ color: '#ef4444' }} />
                        <span className="font-bold">{lockedTarget.name}</span>
                      </div>
                      <button onClick={handleSpyClear} className="text-xs text-secondary hover:text-red-400 transition-colors uppercase tracking-wider font-bold">Clear</button>
                    </div>
                    <div className="spy-status-bar" style={{
                      borderColor: spyDangerLevel === 'red' ? 'rgba(239,68,68,0.5)' : spyDangerLevel === 'yellow' ? 'rgba(234,179,8,0.5)' : 'rgba(34,197,94,0.3)',
                      background: spyDangerLevel === 'red' ? 'rgba(239,68,68,0.15)' : spyDangerLevel === 'yellow' ? 'rgba(234,179,8,0.15)' : 'rgba(34,197,94,0.1)',
                    }}>
                      <div className="sidebar-status-dot animate-pulse" style={{
                        backgroundColor: spyDangerLevel === 'red' ? '#ef4444' : spyDangerLevel === 'yellow' ? '#eab308' : '#22c55e',
                      }} />
                      <span className="text-xs font-mono">
                        {spyDangerLevel === 'red' ? `CRITICAL: ${spyWatchingCount} MONITORING (${spyDetectCount} NEARBY)` :
                         spyDangerLevel === 'yellow' ? `WARNING: ${spyDetectCount} IN RANGE` : 'CLEAR: NO OVERHEAD ASSETS'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1" ref={suggestionsRef} style={{ position: 'relative' }}>
                    <div className="spy-search-input">
                      <input
                        type="text"
                        placeholder="Target address or city..."
                        className="spy-search-field"
                        value={address}
                        onChange={e => handleAddressChange(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleSpySearch()}
                        onFocus={() => { if (suggestions.length > 0) setShowSuggestions(true); }}
                      />
                      <button onClick={handleSpySearch} className="spy-search-btn" disabled={isSearching}>
                        {isSearching ? <Loader2 size={14} className="animate-spin" style={{ color: '#ef4444' }} /> : <MapPin size={14} />}
                      </button>
                    </div>
                    {errorLine && <span className="text-xs" style={{ color: '#ef4444' }}>{errorLine}</span>}

                    {/* Autocomplete Suggestions Dropdown */}
                    {showSuggestions && suggestions.length > 0 && (
                      <div className="suggestion-dropdown">
                        {suggestions.map(s => (
                          <button
                            key={s.place_id}
                            className="suggestion-item"
                            onClick={() => handleSelectSuggestion(s)}
                          >
                            <MapPin size={10} style={{ color: '#ef4444', flexShrink: 0 }} />
                            <span className="suggestion-text">{s.display_name}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* ════════ SPACE WEATHER ════════ */}
        <div className="sidebar-section">
          <div className="section-divider-label">SPACE WEATHER</div>

          <div className="sidebar-item">
            <SectionHeader
              icon={<Shield size={14} />} label="Magnetosphere"
              expanded={magExpanded} onToggle={handleMagHeaderToggle}
              accentColor={magnetosphereActive ? kpColor : '#64b5f6'}
              rightSlot={
                <div className="flex items-center gap-2">
                  {magnetosphereActive && solarWind?.lastUpdate && (
                    <span className="sidebar-badge" style={{ color: kpColor }}>{kpLabel}</span>
                  )}
                  <label className="toggle-switch" onClick={e => e.stopPropagation()}>
                    <input type="checkbox" checked={magnetosphereActive} onChange={onToggleMagnetosphere} />
                    <span className="toggle-slider toggle-slider--blue" />
                  </label>
                </div>
              }
            />

            {magExpanded && magnetosphereActive && (
              <div className="sidebar-sub-content">
                {!solarWind?.lastUpdate ? (
                  <div className="flex items-center gap-2 text-secondary text-xs">
                    <Activity size={12} className="animate-pulse" />
                    <span>Connecting to NOAA DSCOVR...</span>
                  </div>
                ) : (
                  <div className="flex flex-col gap-3">
                    {/* Kp Gauge */}
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1">
                          <Activity size={11} style={{ color: kpColor }} />
                          <span className="mag-label">Kp INDEX</span>
                        </div>
                        <span className="text-xs font-bold" style={{ color: kpColor }}>{kpLabel}</span>
                      </div>
                      <div className="kp-gauge">
                        {kpSegments.map(seg => {
                          const active = seg <= Math.round(kp);
                          let c = '#2196f3';
                          if (seg >= 8) c = '#ff2d2d'; else if (seg >= 6) c = '#ff6b35'; else if (seg >= 4) c = '#ffc107'; else if (seg >= 2) c = '#4caf50';
                          return <div key={seg} className="kp-segment" style={{ background: active ? c : 'rgba(255,255,255,0.06)', boxShadow: active && seg >= 5 ? `0 0 6px ${c}88` : 'none' }} />;
                        })}
                      </div>
                      <div className="kp-labels"><span>0</span><span>3</span><span>5</span><span>7</span><span>9</span></div>
                    </div>

                    {/* Solar Wind */}
                    <div className="mag-row">
                      <div className="flex items-center gap-1">
                        <Wind size={11} style={{ color: windCat.color }} />
                        <span className="mag-label">SOLAR WIND</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-white font-bold text-xs">
                          {Math.round(speed)} <span className="text-secondary" style={{ fontSize: '10px' }}>km/s</span>
                        </span>
                        <span className="mag-badge" style={{ color: windCat.color, borderColor: `${windCat.color}44`, background: `${windCat.color}18` }}>{windCat.label}</span>
                      </div>
                    </div>

                    {/* Telemetry Grid */}
                    <div className="mag-grid">
                      <div className="mag-cell">
                        <span className="mag-cell-label">DENSITY</span>
                        <span className="mag-cell-value">{density.toFixed(1)} <span className="mag-cell-unit">cm⁻³</span></span>
                      </div>
                      <div className="mag-cell">
                        <span className="mag-cell-label">PRESSURE</span>
                        <span className="mag-cell-value">{pressure.toFixed(2)} <span className="mag-cell-unit">nPa</span></span>
                      </div>
                      <div className="mag-cell">
                        <span className="mag-cell-label">MAGNETOPAUSE</span>
                        <div className="flex items-center gap-1">
                          <Shield size={9} style={{ color: '#64b5f6' }} />
                          <span className="mag-cell-value">{magnetopause.toFixed(1)} <span className="mag-cell-unit">Rₑ</span></span>
                        </div>
                      </div>
                      <div className="mag-cell">
                        <span className="mag-cell-label">FIELD LINES</span>
                        <div className="flex items-center gap-1">
                          <Sun size={9} style={{ color: '#ffab40' }} />
                          <span className="mag-cell-value" style={{ color: '#64b5f6' }}>LIVE</span>
                        </div>
                      </div>
                    </div>

                    {kp >= 5 && (
                      <div className="storm-alert" style={{ borderColor: `${kpColor}66`, background: `${kpColor}18` }}>
                        <Zap size={12} style={{ color: kpColor }} />
                        <span style={{ color: kpColor }}>{kp >= 7 ? '⚠ SEVERE GEOMAGNETIC STORM' : '⚡ STORM CONDITIONS DETECTED'}</span>
                      </div>
                    )}

                    <div className="mag-timestamp">
                      NOAA/DSCOVR · {new Date(solarWind.lastUpdate).toLocaleTimeString()}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
      </div> {/* CLOSING command-sidebar */}

      {/* Retracted / Collapsed Button */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="fixed top-4 left-4 backdrop-blur-md border rounded-md shadow-2xl p-3 flex flex-col items-center gap-3 group"
          title="Expand Command Sidebar"
          style={{
            zIndex: 60,
            background: 'rgba(15,23,42,0.9)',
            borderColor: 'rgba(255,255,255,0.15)',
            transition: 'transform 200ms ease, background-color 200ms ease, box-shadow 200ms ease',
          }}
        >
          <div className="relative">
            <Globe2 size={24} className="text-accent" />
          </div>
          
          {/* Subtle Indicator Lights */}
          <div className="flex gap-1">
            <div className="rounded-full" style={{ width: 6, height: 6, background: showSatsUI ? '#60a5fa' : '#4b5563', boxShadow: showSatsUI ? '0 0 5px rgba(96,165,250,0.8)' : 'none' }} />
            <div className="rounded-full" style={{ width: 6, height: 6, background: spyModeActive ? '#ef4444' : '#4b5563', boxShadow: spyModeActive ? '0 0 5px rgba(239,68,68,0.8)' : 'none' }} />
            <div className="rounded-full" style={{ width: 6, height: 6, background: magnetosphereActive ? '#fb923c' : '#4b5563', boxShadow: magnetosphereActive ? '0 0 5px rgba(251,146,60,0.8)' : 'none' }} />
          </div>

          <ChevronRight size={18} className="text-secondary" />
        </button>
      )}
    </>
  );
});

export default CommandSidebar;

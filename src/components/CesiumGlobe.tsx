import { useRef, useState, useMemo, useCallback, useEffect } from 'react';
import * as Cesium from 'cesium';
import { useCesiumViewer } from '../hooks/useCesiumViewer';
import { useSatelliteLayer } from '../hooks/useSatelliteLayer';
import { useDebrisLayer } from '../hooks/useDebrisLayer';
import { useLaunchLayer } from '../hooks/useLaunchLayer';
import { useObjectSelection } from '../hooks/useObjectSelection';
import { useCameraTracking } from '../hooks/useCameraTracking';
import { useTimeControls } from '../hooks/useTimeControls';
import { useMagnetosphere } from '../hooks/useMagnetosphere';
import type { SolarWindData } from '../hooks/useMagnetosphere';
import SearchBar from './panels/SearchBar';
import CommandSidebar from './panels/CommandSidebar';
import SatellitePanel from './panels/SatellitePanel';
import EyesAbovePanel from './panels/EyesAbovePanel';
import LaunchPanel from './panels/LaunchPanel';
import TimeBar from './panels/TimeBar';
import { useSpySystem } from '../hooks/useSpySystem';
import type { SatelliteGroup, SatelliteData } from '../types';

type SeqPhase =
  | 'START' | 'WAITING_DATA' | 'START_ZOOM'
  | 'EN_LAUNCHES' | 'EN_BASE_SATS' | 'EN_ONEWEB' | 'EN_STARLINK' | 'EN_OTHER'
  | 'EN_MAGNETO' | 'LAUNCH_EYES' | 'DONE';

export default function CesiumGlobe() {
  const cesiumContainer = useRef<HTMLDivElement>(null);

  // Check if this is the first time the user has opened the app
  const isFullAnim = useMemo(() => {
    const hasPlayed = localStorage.getItem('exosphere_cinematic_played');
    if (!hasPlayed) {
      localStorage.setItem('exosphere_cinematic_played', 'true');
      return true;
    }
    return false;
  }, []);

  // ── SEQUENCE STATE ──
  const [seqPhase, setSeqPhase] = useState<SeqPhase>(isFullAnim ? 'START' : 'DONE');

  // ── Layer visibility & filter state ──
  const [showSatsUI, setShowSatsUI] = useState(true);
  const [showDebrisUI, setShowDebrisUI] = useState(false);
  const [showLaunchesUI, setShowLaunchesUI] = useState(!isFullAnim);
  const [satFilters, setSatFilters] = useState<Record<SatelliteGroup, boolean>>({
    STARLINK: !isFullAnim,
    ONEWEB: !isFullAnim,
    GPS: !isFullAnim,
    GLONASS: !isFullAnim,
    GALILEO: !isFullAnim,
    STATION: !isFullAnim,
    OTHER: !isFullAnim,
    DEBRIS_COSMOS_1408: true,
    DEBRIS_FENGYUN_1C: true,
    DEBRIS_IRIDIUM_33: true,
    DEBRIS_COSMOS_2251: true,
  });

  // ── Eyes Above State ──
  const [spyModeActive, setSpyModeActive] = useState(false);
  const [spyTargetLocation, setSpyTargetLocation] = useState<{lat: number, lon: number, name: string} | null>(null);
  const [spyDetectSats, setSpyDetectSats] = useState<SatelliteData[]>([]);
  const [spyWatchingSats, setSpyWatchingSats] = useState<SatelliteData[]>([]);
  const [spyDangerLevel, setSpyDangerLevel] = useState<'green' | 'yellow' | 'red'>('green');

  // ── Magnetosphere State ──
  const [magnetosphereActive, setMagnetosphereActive] = useState(false);
  const [solarWindData, setSolarWindData] = useState<SolarWindData | null>(null);

  const spyPrefetchedLoc = useRef<{lat: number, lon: number, name: string} | null>(null);
  const ipFetchPromise = useRef<Promise<{lat: number, lon: number, name: string}> | null>(null);
  const exclusiveIdsRef = useRef<Set<string> | null>(null);

  // Shared IP geolocation fetcher — deduplicates across cinematic prefetch and auto-init
  const getIpLocation = useCallback(() => {
    if (!ipFetchPromise.current) {
      ipFetchPromise.current = fetch('https://ipapi.co/json/')
        .then(res => res.json())
        .then(data => ({
          lat: data.latitude || 48.8566,
          lon: data.longitude || 2.3522,
          name: data.city ? `${data.city}, ${data.country_name}` : 'Paris, France'
        }))
        .catch(() => ({ lat: 48.8566, lon: 2.3522, name: 'Paris, France' }));
    }
    return ipFetchPromise.current;
  }, []);

  // ── Core Cesium viewer ──
  const { viewerRef, pointsRef, focusEntityRef, satPrimitivesRef } =
    useCesiumViewer(cesiumContainer);

  // ── Data layers ──
  const { satellites, loadingSats, satelliteCount } = useSatelliteLayer({
    viewerRef, pointsRef, satPrimitivesRef, showSats: showSatsUI, satFilters, exclusiveIdsRef
  });

  const { debrisList, loadingDebris, debrisCount } = useDebrisLayer({
    viewerRef, pointsRef, satPrimitivesRef, showDebris: showDebrisUI, satFilters, exclusiveIdsRef
  });

  const { loadingLaunches, launchCount, launches } = useLaunchLayer({
    viewerRef, showLaunches: showLaunchesUI,
  });

  // ── Combined list for search ──
  const allSats = useMemo(
    () => [...satellites, ...debrisList],
    [satellites, debrisList]
  );

  // ── Object selection & interaction ──
  const { selectedSat, selectedLaunch, setSelectedSat, setSelectedLaunch } =
    useObjectSelection({ 
      viewerRef, 
      satPrimitivesRef, 
      showSats: showSatsUI,
    onLocationSelect: useCallback((lat: number, lon: number) => {
      if (spyModeActive) {
        const name = `Manual: ${lat.toFixed(2)}, ${lon.toFixed(2)}`;
        setSpyTargetLocation({ lat, lon, name });
        
        // Fly to 500km
        if (viewerRef.current) {
          viewerRef.current.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 500000),
            orientation: {
              heading: 0,
              pitch: Cesium.Math.toRadians(-90),
              roll: 0,
            },
            duration: 1.5
          });
        }
      }
    }, [spyModeActive, viewerRef])
    });

  // ── Eyes Above Mode System ──
  useSpySystem({ 
    viewerRef, 
    satPrimitivesRef, 
    allSats: spyModeActive ? allSats : [], 
    targetLocation: spyModeActive ? spyTargetLocation : null,
    exclusiveIdsRef,
    onDetectChange: (inZone, watching, level) => {
      setSpyDetectSats(inZone);
      setSpyWatchingSats(watching);
      setSpyDangerLevel(level);
    }
  });

  // ── Auto-Initialize Eyes Above on First Load ──
  const initializedSpyRef = useRef(false);

  useEffect(() => {
    const shouldRun = (!isFullAnim && !loadingSats && allSats.length > 0) || 
                      (isFullAnim && seqPhase === 'LAUNCH_EYES');

    if (shouldRun && !initializedSpyRef.current) {
      initializedSpyRef.current = true;
      
      const proceed = (lat: number, lon: number, name: string) => {
        setSpyTargetLocation({ lat, lon, name });
        setSpyModeActive(true);
        if (viewerRef.current) {
          viewerRef.current.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(lon, lat, 3000000),
            orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
            duration: 4.0
          });
        }
        if (isFullAnim && seqPhase === 'LAUNCH_EYES') setSeqPhase('DONE');
      };

      if (spyPrefetchedLoc.current) {
        proceed(spyPrefetchedLoc.current.lat, spyPrefetchedLoc.current.lon, spyPrefetchedLoc.current.name);
      } else {
        getIpLocation().then(loc => proceed(loc.lat, loc.lon, loc.name));
      }
    }
  }, [loadingSats, allSats.length, seqPhase, isFullAnim, viewerRef, getIpLocation]);

  // ── CINEMATIC LOADING SEQUENCE ──
  // 1. Initial Position
  useEffect(() => {
    if (!isFullAnim || seqPhase !== 'START') return;
    if (viewerRef.current) {
      viewerRef.current.camera.setView({
        destination: Cesium.Cartesian3.fromDegrees(0, 20, 8000000), // Start at 20 degrees latitude
        orientation: {
          heading: 0.0,
          pitch: Cesium.Math.toRadians(-90), // Look straight down at the 20deg latitude point
          roll: 0.0,
        }
      });
      setSeqPhase('WAITING_DATA');
    }
  }, [viewerRef, seqPhase, isFullAnim]);

  // 2. Orchestration Steps
  useEffect(() => {
    if (seqPhase === 'DONE' || seqPhase === 'START') return;

    if (seqPhase === 'WAITING_DATA') {
      if (!loadingSats && allSats.length > 0) {
        // Wait an additional fixed 1.5 seconds to guarantee Earth tiles load without polling issues
        const timer = setTimeout(() => {
          setSeqPhase('START_ZOOM');
        }, 1500);
        return () => clearTimeout(timer);
      }
    } else if (seqPhase === 'START_ZOOM') {
      const timer = setTimeout(() => {
        setShowLaunchesUI(true);
        setSeqPhase('EN_LAUNCHES');
      }, 600);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_LAUNCHES') {
      const timer = setTimeout(() => {
        setSatFilters(prev => ({ ...prev, GPS: true, GLONASS: true, GALILEO: true, STATION: true }));
        setSeqPhase('EN_BASE_SATS');
      }, 700);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_BASE_SATS') {
      const timer = setTimeout(() => {
        setSatFilters(prev => ({ ...prev, ONEWEB: true }));
        setSeqPhase('EN_ONEWEB');
      }, 700);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_ONEWEB') {
      const timer = setTimeout(() => {
        setSatFilters(prev => ({ ...prev, STARLINK: true }));
        setSeqPhase('EN_STARLINK');
      }, 700);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_STARLINK') {
      const timer = setTimeout(() => {
        setSatFilters(prev => ({ ...prev, OTHER: true }));
        setSeqPhase('EN_OTHER');
      }, 700);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_OTHER') {
      const timer = setTimeout(() => {
        setMagnetosphereActive(true);
        setSeqPhase('EN_MAGNETO');
        // Pre-fetch IP location during magnetosphere scale-up (shared promise, no duplicate calls)
        getIpLocation().then(loc => {
          spyPrefetchedLoc.current = loc;
        });
      }, 900);
      return () => clearTimeout(timer);
    } else if (seqPhase === 'EN_MAGNETO') {
      const timer = setTimeout(() => {
        setSeqPhase('LAUNCH_EYES');
      }, 4000); 
      return () => clearTimeout(timer);
    }
  }, [seqPhase, loadingSats, allSats.length, getIpLocation]);

  // 3. Camera Rotation & Zoom Animation
  useEffect(() => {
    if (seqPhase === 'DONE' || seqPhase === 'START') return;
    const viewer = viewerRef.current;
    if (!viewer) return;

    let zoomVelocity = 0;
    const maxZoomVelocity = 350000; // meters per frame
    const targetHeight = 120000000; // 120,000 km

    const handleTick = () => {
      // Rotate Earth (rotate camera around origin)
      viewer.scene.camera.rotate(Cesium.Cartesian3.UNIT_Z, 0.003); 

      // Zoom out mechanics
      if (seqPhase !== 'WAITING_DATA') {
        const height = viewer.camera.positionCartographic.height;
        if (height < targetHeight) {
          // Smooth acceleration
          if (zoomVelocity < maxZoomVelocity) {
            zoomVelocity += 5000;
          }
          viewer.camera.moveBackward(zoomVelocity);
        }
      }
    };

    viewer.clock.onTick.addEventListener(handleTick);
    return () => { viewer.clock.onTick.removeEventListener(handleTick); };
  }, [seqPhase, viewerRef]);

  // ── Magnetosphere System ──
  const handleSolarWindUpdate = useCallback((data: SolarWindData) => {
    setSolarWindData(data);
  }, []);

  useMagnetosphere({
    viewerRef,
    enabled: magnetosphereActive,
    onSolarWindUpdate: handleSolarWindUpdate,
  });

  // ── Camera tracking ──
  const { isTracking, setIsTracking } = useCameraTracking({
    viewerRef, focusEntityRef, selectedSat,
  });

  // ── Time controls ──
  const { isPlaying, timeMultiplier, togglePlay, multiplyTime, resetTime } =
    useTimeControls(viewerRef);

  // ── Handlers ──
  const toggleFilter = (grp: SatelliteGroup) => {
    setSatFilters(prev => ({ ...prev, [grp]: !prev[grp] }));
  };

  const handleSearchSelect = useCallback((sat: typeof selectedSat) => {
    setSelectedSat(sat);
    setIsTracking(true);
  }, [setSelectedSat, setIsTracking]);

  // ── Render ──
  return (
    <>
      <div ref={cesiumContainer} className="w-full h-full" />

      <SearchBar 
        allSats={allSats} 
        onSelectSatellite={handleSearchSelect} 
      />

      <CommandSidebar
        viewerRef={viewerRef}
        showSatsUI={showSatsUI} setShowSatsUI={setShowSatsUI}
        showDebrisUI={showDebrisUI} setShowDebrisUI={setShowDebrisUI}
        showLaunchesUI={showLaunchesUI} setShowLaunchesUI={setShowLaunchesUI}
        satFilters={satFilters} toggleFilter={toggleFilter}
        loadingSats={loadingSats} loadingDebris={loadingDebris} loadingLaunches={loadingLaunches}
        satelliteCount={satelliteCount} debrisCount={debrisCount} launchCount={launchCount}
        launches={launches}
        spyModeActive={spyModeActive}
        spyTargetLocation={spyTargetLocation}
        spyDetectCount={spyDetectSats.length}
        spyWatchingCount={spyWatchingSats.length}
        spyDangerLevel={spyDangerLevel}
        onToggleSpyMode={() => {
          setSpyModeActive(!spyModeActive);
          if (spyModeActive) {
            setSpyTargetLocation(null);
            exclusiveIdsRef.current = null;
          }
        }}
        onSetSpyData={(target) => {
          setSpyTargetLocation(target);
          setSelectedSat(null);
        }}
        magnetosphereActive={magnetosphereActive}
        solarWind={solarWindData}
        onToggleMagnetosphere={() => setMagnetosphereActive(!magnetosphereActive)}
      />

      <TimeBar
        isPlaying={isPlaying}
        timeMultiplier={timeMultiplier}
        onTogglePlay={togglePlay}
        onMultiplyTime={multiplyTime}
        onResetTime={resetTime}
      />

      {spyModeActive && spyTargetLocation && (
        <EyesAbovePanel
          location={spyTargetLocation}
          monitoringSats={spyWatchingSats}
          nearbySats={spyDetectSats}
          dangerLevel={spyDangerLevel}
          onClose={() => {
            setSpyModeActive(false);
            setSpyTargetLocation(null);
          }}
          onSelectSatellite={(sat: SatelliteData) => {
            setSelectedSat(sat);
            setIsTracking(false);
          }}
        />
      )}

      {selectedSat && (
        <SatellitePanel
          selectedSat={selectedSat}
          onClose={() => setSelectedSat(null)}
          isTracking={isTracking}
          onToggleTracking={() => setIsTracking(!isTracking)}
          viewerRef={viewerRef}
          isPlaying={isPlaying}
        />
      )}


      {selectedLaunch && showLaunchesUI && (
        <LaunchPanel
          selectedLaunch={selectedLaunch}
          onClose={() => setSelectedLaunch(null)}
        />
      )}
    </>
  );
}

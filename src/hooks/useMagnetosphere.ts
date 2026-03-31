import { useEffect, useRef, useCallback } from 'react';
import * as Cesium from 'cesium';

// ═══════════════════════════════════════════════════════════════
// MAGNETOSPHERE VISUALIZATION ENGINE
// Renders Earth's dipole magnetic field lines in 3D space,
// dynamically compressed by real-time NOAA solar wind data.
// ═══════════════════════════════════════════════════════════════

export interface SolarWindData {
  speed: number;        // km/s
  density: number;      // particles/cm³
  kpIndex: number;      // 0-9 scale
  dynamicPressure: number; // nPa
  magnetopauseDistance: number; // Earth radii
  lastUpdate: string;
}

interface UseMagnetosphereProps {
  viewerRef: React.MutableRefObject<Cesium.Viewer | null>;
  enabled: boolean;
  onSolarWindUpdate?: (data: SolarWindData) => void;
}

// ── Physical Constants ──
const EARTH_RADIUS = 6371000; // meters
const DEFAULT_MAGNETOPAUSE_RE = 10; // ~10 Earth radii standoff distance
const TAIL_STRETCH_FACTOR = 3.5; // How much the nightside stretches
const FIELD_LINE_SEGMENTS = 80; // Points per field line curve
const AURORA_ALTITUDE = 120000; // 120km — where aurora glows

// ── Dipole field line L-shells to render ──
// These are the equatorial crossing distances in Earth radii
const L_SHELLS = [2.5, 3.5, 5, 7, 9, 11];

// ── Number of field lines per "plane" around the magnetic axis ──
const AZIMUTHAL_COUNT = 12; // 12 planes = 30° apart

// ── Color palette for field lines ──
const FIELD_LINE_COLORS: [number, number, number, number][] = [
  [0.3, 0.7, 1.0, 0.65],   // L=2.5: bright cyan-blue (inner)
  [0.2, 0.6, 0.95, 0.55],  // L=3.5
  [0.15, 0.5, 0.9, 0.45],  // L=5
  [0.1, 0.4, 0.85, 0.35],  // L=7
  [0.08, 0.35, 0.8, 0.28], // L=9
  [0.06, 0.3, 0.75, 0.22], // L=11: faint outer lines
];

/**
 * Generate a single 3D dipole field line curve.
 * 
 * Dipole equation (in polar coords from magnetic pole):
 *   r = L × cos²(λ)
 * where L is the L-shell (equatorial distance in RE), λ is magnetic latitude.
 * 
 * Compression/stretching is applied based on the angle to the Sun:
 * - Dayside: field lines are pushed inward (magnetopause compression)
 * - Nightside: field lines are stretched outward (magnetotail)
 */
function generateDipoleFieldLine(
  L: number,
  azimuthRad: number,
  sunDirectionECEF: Cesium.Cartesian3,
  magnetopauseRE: number,
  tiltRad: number // magnetic dipole tilt (simplified to ~11° from rotation axis)
): Cesium.Cartesian3[] {
  const positions: Cesium.Cartesian3[] = [];
  
  // Pre-compute solar wind parameters once per line
  const sunNorm = Cesium.Cartesian3.normalize(sunDirectionECEF, new Cesium.Cartesian3());
  const pointAzimuthInECEF_x = Math.cos(azimuthRad);
  const pointAzimuthInECEF_y = Math.sin(azimuthRad);
  const daysideFactor = pointAzimuthInECEF_x * sunNorm.x + pointAzimuthInECEF_y * sunNorm.y;

  // ── Find exact surface intersection ──
  // A perfect dipole touches Earth (R=1) at cos²(λ) = 1/L.
  // With solar wind compression/stretching, the intersection latitude changes.
  // We use a quick binary search to find exactly where r_RE = 1.0.
  let latLow = 0;
  let latHigh = 89 * (Math.PI / 180); // max 89 degrees to avoid exact pole
  let maxR_day = magnetopauseRE * 0.95;

  for (let iter = 0; iter < 12; iter++) {
    const mid = (latLow + latHigh) / 2;
    const cosLat = Math.cos(mid);
    let r_RE = L * cosLat * cosLat;

    if (daysideFactor > 0) {
      const compressionRatio = magnetopauseRE / DEFAULT_MAGNETOPAUSE_RE;
      const compression = 1.0 - daysideFactor * (1.0 - compressionRatio) * 0.7;
      r_RE *= compression;
      if (r_RE > maxR_day) r_RE = maxR_day;
    } else {
      const stretchAmount = 1.0 + Math.abs(daysideFactor) * TAIL_STRETCH_FACTOR * (1.0 - cosLat * cosLat);
      r_RE *= stretchAmount;
    }

    if (r_RE >= 1.0) {
      latLow = mid; // higher than surface -> search closer to pole
    } else {
      latHigh = mid; // lower than surface -> search closer to equator
    }
  }

  // Use the exact intersection latitude as the bounds, preventing lines crossing through Earth
  const latEnd = latLow;
  const latStart = -latLow;

  for (let i = 0; i <= FIELD_LINE_SEGMENTS; i++) {
    const t = i / FIELD_LINE_SEGMENTS;
    const magLat = latStart + t * (latEnd - latStart);
    
    // Calculate final radius at this magLat
    const cosLat = Math.cos(magLat);
    let r_RE = L * cosLat * cosLat;

    if (daysideFactor > 0) {
      const compressionRatio = magnetopauseRE / DEFAULT_MAGNETOPAUSE_RE;
      const compression = 1.0 - daysideFactor * (1.0 - compressionRatio) * 0.7;
      r_RE *= compression;
      if (r_RE > maxR_day) r_RE = maxR_day;
    } else {
      const stretchAmount = 1.0 + Math.abs(daysideFactor) * TAIL_STRETCH_FACTOR * (1.0 - cosLat * cosLat);
      r_RE *= stretchAmount;
    }

    // Convert from magnetic spherical to ECEF Cartesian
    const r_meters = r_RE * EARTH_RADIUS;

    const x_mag = r_meters * cosLat * Math.cos(azimuthRad);
    const y_mag = r_meters * cosLat * Math.sin(azimuthRad);
    const z_mag = r_meters * Math.sin(magLat);

    // Apply dipole tilt (rotate around Y axis by tilt angle)
    const x_ecef = x_mag * Math.cos(tiltRad) + z_mag * Math.sin(tiltRad);
    const y_ecef = y_mag;
    const z_ecef = -x_mag * Math.sin(tiltRad) + z_mag * Math.cos(tiltRad);

    positions.push(new Cesium.Cartesian3(x_ecef, y_ecef, z_ecef));
  }

  return positions;
}

/**
 * Generate aurora band positions from OVATION probability data
 */
function generateAuroraPositions(
  auroraData: [number, number, number][] // [lon, lat, probability]
): { position: Cesium.Cartesian3; probability: number }[] {
  const results: { position: Cesium.Cartesian3; probability: number }[] = [];

  for (const [lon, lat, prob] of auroraData) {
    if (prob < 5) continue; // Skip low probability points (< 5% barely visible)
    results.push({
      position: Cesium.Cartesian3.fromDegrees(lon, lat, AURORA_ALTITUDE),
      probability: prob,
    });
  }

  return results;
}

export function useMagnetosphere({
  viewerRef,
  enabled,
  onSolarWindUpdate,
}: UseMagnetosphereProps) {
  const fieldLinePrimitivesRef = useRef<Cesium.Primitive[]>([]);
  const auroraPointsRef = useRef<Cesium.PointPrimitiveCollection | null>(null);
  const solarWindRef = useRef<SolarWindData>({
    speed: 400,
    density: 5,
    kpIndex: 2,
    dynamicPressure: 2,
    magnetopauseDistance: DEFAULT_MAGNETOPAUSE_RE,
    lastUpdate: '',
  });
  const fetchIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const updateListenerRef = useRef<(() => void) | null>(null);

  // ── Fetch NOAA Solar Wind + Kp Index ──
  const fetchSolarData = useCallback(async () => {
    try {
      // Parallel fetch: Solar wind plasma + Kp index
      const [plasmaRes, kpRes] = await Promise.all([
        fetch('https://services.swpc.noaa.gov/products/solar-wind/plasma-5-minute.json'),
        fetch('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json'),
      ]);

      const [plasmaData, kpData] = await Promise.all([plasmaRes.json(), kpRes.json()]);

      // Parse latest solar wind plasma entry (last row, skip header)
      let speed = 400, density = 5;
      for (let i = plasmaData.length - 1; i >= 1; i--) {
        const row = plasmaData[i];
        const d = parseFloat(row[1]);
        const s = parseFloat(row[2]);
        if (!isNaN(s) && !isNaN(d)) {
          speed = s;
          density = d;
          break;
        }
      }

      // Parse latest Kp index
      let kpIndex = 2;
      if (kpData.length > 1) {
        const lastKp = kpData[kpData.length - 1];
        kpIndex = parseFloat(lastKp[1]) || 2;
      }

      // Calculate dynamic pressure: P = ½ρv² (in nPa)
      // ρ in cm⁻³ → kg/m³: multiply by proton mass (1.67e-27) and 1e6
      const rho_kgm3 = density * 1.67e-27 * 1e6;
      const v_ms = speed * 1000; // km/s → m/s
      const dynamicPressure_nPa = 0.5 * rho_kgm3 * v_ms * v_ms * 1e9;

      // Magnetopause standoff distance (Chapman-Ferraro):
      // R_mp = (B₀² / (2μ₀ρv²))^(1/6) ≈ 107.4 / (nPa)^(1/6) in RE
      // Simplified empirical: R_mp ≈ 11.6 * P^(-1/6.6) RE
      const magnetopauseDistance = Math.max(
        6,
        Math.min(15, 11.6 * Math.pow(Math.max(dynamicPressure_nPa, 0.5), -1 / 6.6))
      );

      solarWindRef.current = {
        speed,
        density,
        kpIndex,
        dynamicPressure: dynamicPressure_nPa,
        magnetopauseDistance,
        lastUpdate: new Date().toISOString(),
      };

      onSolarWindUpdate?.(solarWindRef.current);
    } catch (err) {
      console.warn('[Magnetosphere] Solar wind data fetch failed:', err);
    }
  }, [onSolarWindUpdate]);

  // ── Fetch Aurora OVATION Data ──
  const fetchAuroraData = useCallback(async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    try {
      const res = await fetch('https://services.swpc.noaa.gov/json/ovation_aurora_latest.json');
      const data = await res.json();

      if (!data?.coordinates) return;

      // Remove old aurora points
      if (auroraPointsRef.current) {
        viewer.scene.primitives.remove(auroraPointsRef.current);
        auroraPointsRef.current = null;
      }

      const auroraPoints = viewer.scene.primitives.add(
        new Cesium.PointPrimitiveCollection()
      ) as Cesium.PointPrimitiveCollection;
      auroraPointsRef.current = auroraPoints;

      const auroraPositions = generateAuroraPositions(data.coordinates);

      for (const { position, probability } of auroraPositions) {
        // Color: dark green → bright cyan/green → white as probability increases
        const normalized = Math.min(probability / 40, 1.0); // Normalize to ~40% max
        const r = normalized * normalized * 0.8;
        const g = 0.4 + normalized * 0.6;
        const b = 0.3 + normalized * 0.7;
        const a = 0.15 + normalized * 0.65;

        auroraPoints.add({
          position,
          pixelSize: 4 + normalized * 6,
          color: new Cesium.Color(r, g, b, a),
          // No disableDepthTestDistance — aurora respects globe occlusion
        });
      }
    } catch (err) {
      console.warn('[Magnetosphere] Aurora data fetch failed:', err);
    }
  }, [viewerRef]);

  // ── Main Effect: Setup Field Lines & Data Fetching ──
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !enabled) {
      // Cleanup if disabled
      return;
    }

    // Initial data fetch
    fetchSolarData();
    fetchAuroraData();

    // Periodic refresh: solar wind every 60s, aurora every 5min
    fetchIntervalRef.current = setInterval(fetchSolarData, 60_000);
    const auroraInterval = setInterval(fetchAuroraData, 300_000);

    // ── Field Line Rendering via preUpdate ──
    // We rebuild field lines every frame to react to solar wind + sun position changes
    // This is efficient because we use raw Cesium primitives, not entities

    let lastRebuildTime = 0;
    const REBUILD_INTERVAL = 5000; // Rebuild geometry every 5 seconds (not every frame)
    
    const updateFieldLines = () => {
      const now = Date.now();
      if (now - lastRebuildTime < REBUILD_INTERVAL) return;
      lastRebuildTime = now;

      // Get Sun position in ECEF
      const julianDate = viewer.clock.currentTime;
      const sunPos = Cesium.Simon1994PlanetaryPositions.computeSunPositionInEarthInertialFrame(julianDate);
      
      // Transform from inertial to ECEF (fixed frame)
      const icrfToFixed = Cesium.Transforms.computeIcrfToFixedMatrix(julianDate);
      let sunECEF: Cesium.Cartesian3;
      if (icrfToFixed) {
        sunECEF = Cesium.Matrix3.multiplyByVector(icrfToFixed, sunPos, new Cesium.Cartesian3());
      } else {
        // Fallback: use TEME to fixed
        const temeToFixed = Cesium.Transforms.computeTemeToPseudoFixedMatrix(julianDate);
        if (temeToFixed) {
          sunECEF = Cesium.Matrix3.multiplyByVector(temeToFixed, sunPos, new Cesium.Cartesian3());
        } else {
          sunECEF = sunPos; // Last resort
        }
      }

      // Remove old field line primitives
      for (const prim of fieldLinePrimitivesRef.current) {
        try { viewer.scene.primitives.remove(prim); } catch {}
      }
      fieldLinePrimitivesRef.current = [];

      const magnetopauseRE = solarWindRef.current.magnetopauseDistance;
      const dipoleTilt = 11 * (Math.PI / 180); // ~11° tilt of magnetic axis

      // Generate all field lines
      for (let shellIdx = 0; shellIdx < L_SHELLS.length; shellIdx++) {
        const L = L_SHELLS[shellIdx];
        const color = FIELD_LINE_COLORS[shellIdx];

        for (let az = 0; az < AZIMUTHAL_COUNT; az++) {
          const azimuthRad = (az / AZIMUTHAL_COUNT) * 2 * Math.PI;

          const points = generateDipoleFieldLine(
            L,
            azimuthRad,
            sunECEF,
            magnetopauseRE,
            dipoleTilt
          );

          if (points.length < 2) continue;

          // Create polyline geometry
          const geometryInstance = new Cesium.GeometryInstance({
            geometry: new Cesium.PolylineGeometry({
              positions: points,
              width: shellIdx < 2 ? 2.5 : 1.5, // Inner lines thicker
              vertexFormat: Cesium.PolylineMaterialAppearance.VERTEX_FORMAT,
            }),
          });

          const primitive = new Cesium.Primitive({
            geometryInstances: geometryInstance,
            appearance: new Cesium.PolylineMaterialAppearance({
              material: Cesium.Material.fromType('Color', {
                color: new Cesium.Color(color[0], color[1], color[2], color[3]),
              }),
            }),
            asynchronous: false,
          });

          viewer.scene.primitives.add(primitive);
          fieldLinePrimitivesRef.current.push(primitive);
        }
      }

      // ── Magnetopause Boundary (bow shock surface) ──
      // Render a translucent ellipsoid representing the magnetopause
      // This is the visible "shield" where solar wind pressure balances Earth's field
    };

    // Run once immediately, then attach to preUpdate
    updateFieldLines();
    updateListenerRef.current = updateFieldLines;
    viewer.scene.preUpdate.addEventListener(updateFieldLines);

    return () => {
      // Cleanup
      if (updateListenerRef.current) {
        try { viewer.scene.preUpdate.removeEventListener(updateListenerRef.current); } catch {}
      }
      if (fetchIntervalRef.current) clearInterval(fetchIntervalRef.current);
      clearInterval(auroraInterval);

      // Remove field line primitives
      for (const prim of fieldLinePrimitivesRef.current) {
        try { viewer.scene.primitives.remove(prim); } catch {}
      }
      fieldLinePrimitivesRef.current = [];

      // Remove aurora points
      if (auroraPointsRef.current) {
        try { viewer.scene.primitives.remove(auroraPointsRef.current); } catch {}
        auroraPointsRef.current = null;
      }
    };
  }, [enabled, viewerRef, fetchSolarData, fetchAuroraData]);
}

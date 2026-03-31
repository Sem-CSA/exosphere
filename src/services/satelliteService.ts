import { twoline2satrec, propagate, gstime, eciToEcf, eciToGeodetic } from 'satellite.js';
import type { SatelliteData, SatelliteGroup } from '../types';
import { GroupColors } from '../types';

// CelesTrak URLs — in dev, Vite proxies /celestrak-api to avoid CORS.
// In production, use direct URL (works when deployed to a real domain).
const isDev = import.meta.env.DEV;

function celestrakUrl(params: string) {
  return isDev
    ? `/celestrak-api?${params}`
    : `https://celestrak.org/NORAD/elements/gp.php?${params}`;
}

// Fallback TLE data for when all fetching strategies fail.
const STATIC_HARD_FALLBACK = `
ISS (ZARYA)
1 25544U 98067A   23284.14513889  .00015509  00000-0  28190-3 0  9997
2 25544  51.6413 227.1704 0004907 242.0256 244.7570 15.49884518420001
STARLINK-30113
1 58151U 23157J   23284.40726852  .00034600  00000-0  24500-3 0  9999
2 58151  53.0530 206.1820 0001000  63.5180 296.5920 15.06400000 12028
NAVSTAR 73 (USA 265)
1 41019U 15062A   23284.41666667 -.00000010  00000-0  00000+0 0  9990
2 41019  55.0890 286.3020 0001600 234.2000 125.6020  2.00055000 48821
GALAXY 15
1 28884U 05041A   23284.12345678  .00000150  00000-0  00000-0 0  9991
2 28884   0.0500 230.1230 0001000 120.4500 230.1500  1.00270000 10245
TIANHE
1 48274U 21035A   23284.50000000  .00015000  00000-0  25000-3 0  9998
2 48274  41.4700 210.0000 0001500  50.0000 310.0000 15.60000000  2001
`;

// Caching configuration
const CACHE_KEY = 'exosphere_tle_cache';
const DEBRIS_CACHE_KEY = 'exosphere_debris_cache';
const CACHE_EXPIRY = 24 * 60 * 60 * 1000; // 24 hours

export async function fetchActiveSatellites(): Promise<SatelliteData[]> {
  try {
    // 1. Check localStorage Cache
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        console.log("Using cached TLE data");
        return data;
      }
    }

    // 2. Fetch via Vite proxy (dev) or direct (prod)
    const url = celestrakUrl('GROUP=active&FORMAT=tle');
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch TLEs: ${response.status} ${response.statusText}`);
    }
    const data = await response.text();
    const satellites = parseTLE(data);

    // 3. Update Cache
    if (satellites.length > 0) {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        data: satellites,
        timestamp: Date.now()
      }));
    }

    return satellites;
  } catch (error) {
    console.error("Error fetching TLE data from CelesTrak:", error);
    
    // Check if we have expired cache we can use as a second fallback
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      console.warn("Using expired cache as fallback.");
      return JSON.parse(cached).data;
    }

    console.warn("Using local fallback TLE data.");
    return parseTLE(STATIC_HARD_FALLBACK.trim());
  }
}

const DEBRIS_GROUPS: Record<string, SatelliteGroup> = {
  'cosmos-1408-debris': 'DEBRIS_COSMOS_1408',
  'fengyun-1c-debris': 'DEBRIS_FENGYUN_1C',
  'iridium-33-debris': 'DEBRIS_IRIDIUM_33',
  'cosmos-2251-debris': 'DEBRIS_COSMOS_2251'
};

export async function fetchDebris(): Promise<SatelliteData[]> {
  try {
    // 1. Check localStorage Cache
    const cached = localStorage.getItem(DEBRIS_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < CACHE_EXPIRY) {
        console.log("Using cached debris TLE data");
        return data;
      }
    }

    // 2. Fetch all debris groups in parallel (was sequential — saves ~3-4s)
    console.log("Fetching fresh debris data from CelesTrak groups...");
    const groupEntries = Object.entries(DEBRIS_GROUPS);
    const results = await Promise.allSettled(
      groupEntries.map(async ([groupName, groupType]) => {
        const url = celestrakUrl(`GROUP=${groupName}&FORMAT=tle`);
        const response = await fetch(url);
        if (!response.ok) return [];
        const text = await response.text();
        if (!text || text.includes("Invalid query") || text.includes("No data found")) return [];
        return parseTLE(text, groupType);
      })
    );
    let allSats: SatelliteData[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.length > 0) {
        allSats = [...allSats, ...result.value];
      }
    }

    // 3. Update Cache
    if (allSats.length > 0) {
      localStorage.setItem(DEBRIS_CACHE_KEY, JSON.stringify({
        data: allSats,
        timestamp: Date.now()
      }));
    }

    return allSats;
  } catch (error) {
    console.error("Error fetching debris TLE data from CelesTrak:", error);
    
    const cached = localStorage.getItem(DEBRIS_CACHE_KEY);
    if (cached) {
      console.warn("Using expired debris cache as fallback.");
      return JSON.parse(cached).data;
    }

    console.warn("No debris data available.");
    return [];
  }
}

function getSatGroup(name: string): { group: SatelliteGroup, color: string } {
  const upperName = name.toUpperCase();
  if (upperName.includes('STARLINK')) return { group: 'STARLINK', color: GroupColors.STARLINK };
  if (upperName.includes('ONEWEB')) return { group: 'ONEWEB', color: GroupColors.ONEWEB };
  if (upperName.includes('NAVSTAR') || upperName.includes('GPS')) return { group: 'GPS', color: GroupColors.GPS };
  if (upperName.includes('GLONASS')) return { group: 'GLONASS', color: GroupColors.GLONASS };
  if (upperName.includes('GALILEO')) return { group: 'GALILEO', color: GroupColors.GALILEO };
  if (upperName.includes('ISS') || upperName.includes('ZARYA') || upperName.includes('TIANHE') || upperName.includes('CSS')) return { group: 'STATION', color: GroupColors.STATION };
  return { group: 'OTHER', color: GroupColors.OTHER };
}

function parseTLE(tleData: string, forceGroup?: SatelliteGroup): SatelliteData[] {
  const lines = tleData.split('\n').map(line => line.trim()).filter(line => line.length > 0);
  const satellites: SatelliteData[] = [];
  const seenIds = new Set<string>();

  for (let i = 0; i < lines.length; i += 3) {
    if (i + 2 < lines.length) {
      const name = lines[i];
      const tleLine1 = lines[i + 1];
      const tleLine2 = lines[i + 2];
      
      const id = tleLine1.substring(2, 7).trim();
      const satGroup = forceGroup 
        ? { group: forceGroup, color: GroupColors[forceGroup] }
        : getSatGroup(name);
      
      if (!seenIds.has(id)) {
        seenIds.add(id);
        satellites.push({
          id,
          name,
          tleLine1,
          tleLine2,
          group: satGroup.group,
          colorHex: satGroup.color
        });
      }
    }
  }
  
  return satellites;
}

export function computePosition(sat: SatelliteData, date: Date): { x: number, y: number, z: number } | null {
  try {
    const satrec = twoline2satrec(sat.tleLine1, sat.tleLine2);
    const positionAndVelocity = propagate(satrec, date);
    
    const positionEci = positionAndVelocity.position;
    
    if (typeof positionEci !== 'boolean' && positionEci) {
      const gmst = gstime(date);
      const positionEcf = eciToEcf(positionEci, gmst);
      
      return {
        x: positionEcf.x,
        y: positionEcf.y,
        z: positionEcf.z
      };
    }
  } catch {
    // Ignore decay or math errors during propagation
  }
  return null;
}

export function getSatelliteDetails(sat: SatelliteData, date: Date) {
  try {
    const satrec = twoline2satrec(sat.tleLine1, sat.tleLine2);
    const positionAndVelocity = propagate(satrec, date);
    const positionEci = positionAndVelocity.position;
    const velocityEci = positionAndVelocity.velocity;

    let altitude = 0;
    let velocity = 0;

    if (typeof positionEci !== 'boolean' && positionEci && typeof velocityEci !== 'boolean' && velocityEci) {
      const gmst = gstime(date);
      const positionGd = eciToGeodetic(positionEci, gmst);
      altitude = positionGd.height;
      
      velocity = Math.sqrt(
        velocityEci.x * velocityEci.x +
        velocityEci.y * velocityEci.y +
        velocityEci.z * velocityEci.z
      );
    }

    const rad2deg = 180 / Math.PI;
    const inclination = satrec.inclo * rad2deg;
    const eccentricity = satrec.ecco;
    const revsPerDay = satrec.no * (1440 / (2 * Math.PI));

    return {
      altitude: altitude.toFixed(2),
      velocity: velocity.toFixed(2),
      inclination: inclination.toFixed(2),
      eccentricity: eccentricity.toFixed(4),
      revsPerDay: revsPerDay.toFixed(2)
    };
  } catch {
    return null;
  }
}



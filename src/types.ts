export type SatelliteGroup = 
  'STARLINK' | 'ONEWEB' | 'GPS' | 'GLONASS' | 'GALILEO' | 'STATION' | 'OTHER' | 
  'DEBRIS_COSMOS_1408' | 'DEBRIS_FENGYUN_1C' | 'DEBRIS_IRIDIUM_33' | 'DEBRIS_COSMOS_2251';

export const GroupColors: Record<SatelliteGroup, string> = {
  STARLINK: '#10b981', // green
  ONEWEB: '#3b82f6',   // blue
  GPS: '#a855f7',      // purple
  GLONASS: '#ec4899',  // pink
  GALILEO: '#f59e0b',  // amber
  STATION: '#ef4444',  // red
  OTHER: '#00d2ff',    // cyan
  DEBRIS_COSMOS_1408: '#fca5a5', // pale red
  DEBRIS_FENGYUN_1C: '#fdba74',  // pale orange
  DEBRIS_IRIDIUM_33: '#f9a8d4',  // pale pink
  DEBRIS_COSMOS_2251: '#a5b4fc'  // pale indigo
};

export interface SatelliteData {
  id: string; // NORAD ID
  name: string;
  tleLine1: string;
  tleLine2: string;
  group: SatelliteGroup;
  colorHex: string;
}

export interface LaunchData {
  id: string;
  name: string;
  net: string; // Next expected time (ISO 8601 string)
  status: string;
  provider: string; // e.g., SpaceX, NASA
  pad: {
    name: string;
    latitude: string;
    longitude: string;
    location: string;
  };
  mission?: {
    name: string;
    description: string;
  };
  image?: string;
}

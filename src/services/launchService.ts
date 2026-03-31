import type { LaunchData } from '../types';

// Using TheSpaceDevs DEV API to avoid strict rate limits during development.
// mode=list returns ~40KB vs ~158KB for mode=detailed (we only need a few fields).
const LAUNCH_API_URL = 'https://lldev.thespacedevs.com/2.2.0/launch/upcoming/?limit=10&mode=list';

const LAUNCH_CACHE_KEY = 'exosphere_launch_cache';
const LAUNCH_CACHE_EXPIRY = 60 * 60 * 1000; // 1 hour — launch schedule rarely changes faster

/** Shape of a single launch from the SpaceDevs API (subset of fields we use). */
interface ApiLaunch {
  id: string;
  name: string;
  net: string;
  status?: { name?: string };
  launch_service_provider?: { name?: string };
  pad?: {
    name?: string;
    latitude?: string;
    longitude?: string;
    location?: { name?: string };
  };
  mission?: { name?: string; description?: string } | null;
  image_url?: string;
  image?: string;
}

export async function fetchUpcomingLaunches(): Promise<LaunchData[]> {
  try {
    // 1. Check localStorage cache
    const cached = localStorage.getItem(LAUNCH_CACHE_KEY);
    if (cached) {
      const { data, timestamp } = JSON.parse(cached);
      if (Date.now() - timestamp < LAUNCH_CACHE_EXPIRY) {
        return data;
      }
    }

    // 2. Fetch fresh data
    const response = await fetch(LAUNCH_API_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch launches: ${response.statusText}`);
    }
    const data = await response.json();
    
    const launches: LaunchData[] = data.results.map((launch: ApiLaunch) => ({
      id: launch.id,
      name: launch.name,
      net: launch.net,
      status: launch.status?.name || 'Unknown',
      provider: launch.launch_service_provider?.name || 'Unknown Provider',
      pad: {
        name: launch.pad?.name || 'Unknown Pad',
        latitude: launch.pad?.latitude,
        longitude: launch.pad?.longitude,
        location: launch.pad?.location?.name || 'Unknown Location',
      },
      mission: launch.mission ? {
        name: launch.mission.name,
        description: launch.mission.description
      } : undefined,
      image: launch.image_url || launch.image,
    }));

    // 3. Update cache
    if (launches.length > 0) {
      localStorage.setItem(LAUNCH_CACHE_KEY, JSON.stringify({
        data: launches,
        timestamp: Date.now()
      }));
    }

    return launches;
  } catch (error) {
    console.error("Error fetching launch data:", error);

    // Fallback to expired cache
    const cached = localStorage.getItem(LAUNCH_CACHE_KEY);
    if (cached) {
      return JSON.parse(cached).data;
    }
    return [];
  }
}

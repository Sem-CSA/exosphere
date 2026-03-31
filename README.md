# Exosphere

A real-time 3D orbital visualization platform for tracking satellites, space debris, and rocket launches on an interactive globe. Built with React, CesiumJS, and TypeScript.

![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white)
![CesiumJS](https://img.shields.io/badge/CesiumJS-1.139-6CADDF)
![Vite](https://img.shields.io/badge/Vite-8-646CFF?logo=vite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-green)

## Features

### Satellite Tracking
- **10,000+ active satellites** propagated in real-time using SGP4 via [satellite.js](https://github.com/shashwatak/satellite.js)
- TLE data sourced from [CelesTrak](https://celestrak.org/) with multi-layer caching and fallback
- Filter by constellation: Starlink, OneWeb, GPS, GLONASS, Galileo, ISS, and more
- Click any satellite for live orbital parameters (altitude, velocity, lat/lon, inclination)

### Orbital Debris
- Four tracked debris fields: Cosmos-1408, Fengyun-1C, Iridium-33, Cosmos-2251
- Parallelized fetch with dedicated Web Worker for off-thread SGP4 propagation
- Separate visual layer with per-field color coding

### Launch Tracker
- Upcoming launches from [The Space Devs API](https://thespacedevs.com/) with countdown timers
- 3D launch pad markers with mission details and provider info
- Cached locally to avoid rate limits (1-hour TTL)

### Eyes Above (Surveillance Awareness)
- Select any location on the globe to see which satellites can observe it right now
- Real-time pass detection with "danger level" classification (green → yellow → red)
- Auto-initializes to your location via IP geolocation

### Magnetosphere & Space Weather
- 3D magnetic field line visualization rendered as Cesium polylines
- Live solar wind data (speed, density, Bz) from NOAA DSCOVR/ACE at L1
- Real-time aurora probability overlay from the NOAA OVATION model
- Kp geomagnetic storm index with visual alerts

### Cinematic Boot Sequence
- First-visit orchestrated camera animation: zoom out → enable layers sequentially → fly to user location
- Subsequent visits skip directly to the interactive dashboard

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | React 19 |
| Language | TypeScript 5.9 |
| 3D Engine | CesiumJS 1.139 |
| Orbital Math | satellite.js (SGP4/SDP4) |
| Build Tool | Vite 8 |
| Icons | Lucide React |
| Propagation | Web Worker (off-main-thread) |

## Architecture

```
src/
├── main.tsx                    # Entry point
├── App.tsx                     # Root layout
├── types.ts                    # Shared TypeScript types
├── index.css                   # Global styles (utility classes)
├── components/
│   ├── CesiumGlobe.tsx         # Main orchestrator — layers, cinematic, UI
│   └── panels/
│       ├── CommandSidebar.tsx   # Primary control panel (filters, toggles, stats)
│       ├── SearchBar.tsx        # Satellite search with fuzzy filtering
│       ├── SatellitePanel.tsx   # Selected satellite detail overlay
│       ├── EyesAbovePanel.tsx   # Surveillance awareness panel
│       ├── LaunchPanel.tsx      # Launch detail overlay
│       └── TimeBar.tsx          # Playback speed controls
├── hooks/
│   ├── useCesiumViewer.ts      # Viewer initialization & config
│   ├── useSatelliteLayer.ts    # Active satellite data & rendering
│   ├── useDebrisLayer.ts       # Debris data & rendering
│   ├── useLaunchLayer.ts       # Launch markers & data
│   ├── useMagnetosphere.ts     # Field lines, aurora, solar wind
│   ├── useSpySystem.ts         # Eyes Above pass detection
│   ├── useObjectSelection.ts   # Click-to-select interaction
│   ├── useCameraTracking.ts    # Satellite camera follow mode
│   └── useTimeControls.ts      # Clock speed management
├── services/
│   ├── satelliteService.ts     # CelesTrak TLE fetch, parse, cache
│   └── launchService.ts        # Space Devs API fetch & cache
└── workers/
    └── propagation.worker.ts   # Off-thread SGP4 propagation
```

## Data Sources

| Source | Data | Auth |
|--------|------|------|
| [CelesTrak](https://celestrak.org/) | Satellite & debris TLEs | None |
| [The Space Devs](https://thespacedevs.com/) | Launch schedule | None (dev API) |
| [NOAA SWPC](https://www.swpc.noaa.gov/) | Solar wind, Kp index, aurora | None |
| [ipapi.co](https://ipapi.co/) | IP geolocation | None |
| [Nominatim](https://nominatim.openstreetmap.org/) | Geocoding (search) | None |

## Getting Started

### Prerequisites

- Node.js 18+
- npm 9+

### Install & Run

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open in browser
# http://localhost:5173
```

### Build for Production

```bash
npm run build
npm run preview
```

### Lint

```bash
npm run lint
```

## Performance

- **Production bundle**: ~277 KB JS (89 KB gzip) + 11.5 KB CSS
- **Web Worker**: SGP4 propagation runs off the main thread
- **Caching**: TLE data (24h), debris (24h), launches (1h) in `localStorage`
- **Parallelized fetches**: Debris groups fetched concurrently via `Promise.allSettled`
- **Optimized rendering**: Cesium `PointPrimitiveCollection` for thousands of satellites at 30 fps

## License

MIT

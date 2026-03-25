# Storm Maps - Hail Intelligence for Roofing Professionals

Real-time hail and storm intelligence maps that replace $8K/year IHM + HailTrace subscriptions. Built for roofing sales professionals who need to identify storm-damaged neighborhoods and generate leads.

## What This Does

- **MESH Hail Swath Overlays** - Visualize Maximum Estimated Size of Hail (MESH) swaths from the National Hail Project on a satellite map
- **NEXRAD Radar Replay** - Animate NEXRAD radar data to see exactly when and where storms hit
- **MRMS Hail Data** - Multi-Radar/Multi-Sensor hail size estimates from NOAA
- **GPS Canvassing Alerts** - Get notified when you walk into a hail-affected zone with door-knocking talking points
- **Address/ZIP Search** - Quickly navigate to any location and see historical storm damage
- **Storm Date Browser** - Browse recent storm events and filter by hail size

## Tech Stack

- **Frontend**: React 19 + TypeScript + Vite
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps
- **Styling**: Tailwind CSS v4
- **Data Sources**: NOAA Storm Events, National Hail Project, MRMS/NEXRAD
- **Deployment**: Railway

## Getting Started

```bash
# Install dependencies
npm install

# Copy environment file and add your Google Maps API key
cp .env.example .env

# Start dev server
npm run dev
```

The dev server runs on `http://localhost:5180`.

### Google Maps API Key

1. Go to [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/)
2. Create a project or select an existing one
3. Enable these APIs:
   - Maps JavaScript API
   - Places API
   - Geocoding API
4. Create an API key and add it to your `.env` file

## Project Structure

```
src/
  components/
    StormMap.tsx         - Main Google Maps component
    Sidebar.tsx          - Storm date list and layer controls
    SearchBar.tsx        - Address/ZIP search with autocomplete
    HailSwathLayer.tsx   - MESH swath polygon overlay
    NexradOverlay.tsx    - NEXRAD radar tile overlay
    MRMSOverlay.tsx      - MRMS hail tile overlay
    GpsTracker.tsx       - Blue dot GPS tracking
    DatePicker.tsx       - Storm date selection
    Legend.tsx           - Hail size color legend
  services/
    stormApi.ts          - NOAA Storm Events API
    nhpApi.ts            - National Hail Project API
    mrmsApi.ts           - MRMS tile server API
    geocodeApi.ts        - Google Geocoding
  hooks/
    useGeolocation.ts    - GPS tracking hook
    useStormData.ts      - Storm data fetching
    useHailAlert.ts      - Canvassing zone alerts
  data/
    xactimate-codes.ts   - Storm damage Xactimate codes
  types/
    storm.ts             - Shared TypeScript interfaces
```

## Data Sources

| Source | Data | Cost |
|--------|------|------|
| [NOAA Storm Events](https://www.ncdc.noaa.gov/stormevents/) | Historical hail/wind/tornado reports | Free |
| [National Hail Project](https://nationalhailproject.com/) | MESH-derived hail swath polygons | Free tier available |
| [MRMS](https://mrms.nssl.noaa.gov/) | Real-time multi-radar hail estimates | Free |
| [Iowa Mesonet NEXRAD](https://mesonet.agron.iastate.edu/) | Radar composites and archives | Free |

## Replaces

- **IHM (Interactive Hail Maps)** - $4,000/year
- **HailTrace** - $4,000/year
- Combined savings: **$8,000/year per user**

## Part of Roof-ER21

This is Project 8 in the Roof-ER21 suite.

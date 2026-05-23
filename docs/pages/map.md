# Project Map

View id: `map`
Component: `src/components/views/native/ops/RoofdocsMap.tsx`
Roles: admin, exec, employee, analytics

Leaflet map of all geolocated jobs. Shows job distribution across the service area (VA/MD/PA/DC/DE/NJ/WV). Useful for territory planning, identifying cluster opportunities, and visualizing coverage.

## Endpoints

- `GET /api/intel/map-pins` — slim location layer on mount; response `{ pins: [{ id, customer, addressLine1, city, state, zip, lat, lng, insurance, adjusterName, claimNumber, jobType, stage, salesRep, signedDate, jobTotal, stormMatch }], total, took_ms }`; supports filter params `carrier`, `zip`, `city`, `state`, `sales_rep`, `stage`, `job_type`, `since_date`, `until_date`

## Key Flows

Cluster pins at low zoom; expand to individual pins at high zoom. Clicking a pin shows a minimal job card (stage, carrier, rep). Color coding by stage: green = completed, amber = signed/active, red = dead. The `?state=` filter is passed directly to the API to reduce payload size.

## Related

The Leaflet map also appears in `customer-hub/lookup` (PropertyLookup component, which plots storm events + nearby jobs for a specific address) and in `storm-hub/intel` (StormIntel component, which plots IEM storm events). These are separate instances with different data sources.

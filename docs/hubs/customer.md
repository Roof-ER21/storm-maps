# Customer Hub

View id: `customer-hub`
Deep-link: `/?view=customer-hub&tab=<tabId>`
Roles: admin, exec, employee, analytics

Three-tab customer intelligence hub. Replaced three standalone HTML pages.

---

## Tabs

### list — Customer Roster
File: `src/components/hubs/native/customer/CustomerList.tsx`

Full customer table with client-side search, sort, and filter. Shows customer name, address, job count, and revenue. All 16k+ customers load on mount; filtering is entirely client-side.

Endpoints:
- `GET /api/intel/customers-list` — full list on mount; shape includes customer key, name, address, job count, revenue, last activity

### detail — Customer Detail
File: `src/components/hubs/native/customer/CustomerDetail.tsx`

Typeahead search to find a customer; selecting one shows full job history, storm exposure, and linked leads.

Endpoints:
- `GET /api/intel/quick-search?q=<query>` — typeahead (min 2 chars); returns matches across customers, reps, carriers, adjusters
- `GET /api/intel/customer-deep?key=<key>` — on customer select; key is the customer identifier from search results; response includes all jobs, open AR, storm hits, linked leads, and trade gaps

### lookup — Property Lookup
File: `src/components/hubs/native/customer/PropertyLookup.tsx`

Enter any address → geocode it → show nearby jobs and recent storm events on a Leaflet map.

Endpoints:
- `GET /api/intel/geocode?address=<address>` — US Census geocoder proxy; returns lat/lng for the address
- `GET /api/intel/storms-light` — full storm dataset; filtered client-side to show events near the geocoded point
- `GET /api/intel/jobs-nearby?lat=<lat>&lng=<lng>&radius=0.5` — jobs within 0.5 miles of the property

---

## Notable Behavior

- The Roster tab loads the full 16k+ customer array on mount. This is a large fetch but it enables instant client-side search with no round-trips.
- The Detail tab reuses `quick-search` (which also returns reps, carriers, adjusters) — the component filters to customer-type results only.
- Property Lookup is the primary tool for checking storm exposure and neighborhood job density before a cold-knock visit.

# Cheat Sheet

View id: `cheat-sheet`
Component: `src/components/views/native/field/CheatSheet.tsx`
Roles: admin, employee, analytics

Per-entity math-backed cheat sheets for reps to use before meetings. Covers reps, carriers, adjusters, states, and ZIPs. Also shows the carrier patent library for quick reference.

## Endpoints

- `GET /api/intel/cheat-sheets` — primary data; per-entity cheat sheets with approval rates, approval probability, typical pushback points, recommended counter-scripts, and a rep-specific or carrier-specific battle card
- `GET /api/intel/carrier-patents` — fire-and-forget; graceful on failure; appended to give reps patent-level context alongside their carrier cheat sheet

## Key Flows

Entity picker (rep / carrier / adjuster / state / ZIP) with a search box. Selecting an entity loads its pre-generated cheat sheet. The patent section (from `carrier-patents`) is collapsible and appears below the main cheat sheet for the selected carrier.

# Field Guide

View id: `field-guide`
Component: `src/components/views/native/field/FieldGuide.tsx`
Roles: admin, employee, analytics

Pattern-backed field playbook for reps. Translates mined carrier × adjuster × ZIP × hail × speed patterns into actionable talking points and knock scripts.

## Endpoints

- `GET /api/intel/patterns` — full patterns blob on mount; includes mined decision rules across carrier, adjuster, ZIP, hail size, and wind speed dimensions

## Key Flows

The guide is organized by scenario (e.g., "State Farm + hail > 1.5in + adjuster John Smith"). Each scenario card shows the approval probability, the key signals that drive it, and a recommended script. Filterable by carrier, ZIP, adjuster name, and storm type. The underlying data is the same `patterns.json` blob used by the Predictor.

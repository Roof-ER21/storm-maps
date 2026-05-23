# Notes

View id: `notes`
Component: `src/components/views/native/ops/Notes.tsx`
Roles: admin, employee, analytics

Full-text search over 9.7k free-text job notes mined from the portal. Useful for finding specific job history, identifying recurring issues, or researching what happened with a particular customer or carrier.

## Endpoints

- `GET /api/intel/notes` — full notes blob on mount; array of job notes with job ID, customer name, rep, date, and note text; all search is client-side

## Key Flows

Search box does case-insensitive substring match across the note text, customer name, and rep fields. Results are sorted by date descending. Clicking a note shows the full text and links to the job's customer detail in the Customer Hub.

Note: notes are read-only intel (there is no write endpoint). The `append_note` act tool is deferred pending a notes-write store in the portal.

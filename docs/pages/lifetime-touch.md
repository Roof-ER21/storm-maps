# Lifetime Touch Engine

View id: `lifetime-touch`
Component: `src/components/views/native/field/LifetimeTouch.tsx`
Roles: admin, employee, analytics

Math-prioritized re-engagement queue. Ranks past customers by re-engagement value based on roof age, storm exposure, and trade gaps. The primary tool for proactive outreach to existing customers.

## Endpoints

- `GET /api/intel/lifetime-touch-query?include=stats,reps` — initial load; returns aggregate stats and the rep list for the rep picker
- `GET /api/intel/lifetime-touch-query?rep=<rep>&tier=<tier>&reason=<reason>` — filtered queue on user interaction; employees see only their own customers (server-enforced)

## Key Flows

Rep picker selects whose queue to view (employees are locked to self). Tier filter (hot/warm/cold) and reason filter (storm hit / trade gap / roof age) narrow the list. Each row shows the customer name, reason for re-engagement, last touch date, and a priority score. Clicking a customer opens the detail in the Customer Hub.

# SMS Reminders

View id: `sms-reminders`
Component: `src/components/views/native/field/SmsReminders.tsx`
Roles: admin, employee

Pre-built SMS outreach queue. Combines AR-aged accounts (who need a payment reminder) and resurrection candidates (who need a storm-based re-engagement message) into two prioritized SMS lists.

## Endpoints

- `GET /api/intel/receivables` — open AR accounts; used to build the payment reminder list
- `GET /api/intel/resurrection` — dead insurance jobs hit by new storms; used to build the resurrection SMS list

## Key Flows

Two tabs: Payment Reminders (open AR sorted by days outstanding) and Resurrection Outreach (dead jobs with new storm hits). Each row shows a pre-generated SMS script with the customer name, amount owed or storm event, and a copy-to-clipboard button. Employees see only their own accounts (server-enforced for receivables; client-filtered by rep for resurrection).

# Receivables (AR / Money)

View id: `receivables`
Component: `src/components/views/native/ops/Receivables.tsx`
Roles: admin, exec, employee

Four-tab AR dashboard. Loads the primary receivables blob eagerly; three additional datasets load lazily when the user opens the corresponding tab.

## Endpoints

- `GET /api/intel/receivables` — eager on mount; open AR + downpayments + collections; full account list with amounts, carrier, stage, rep, and aging
- `GET /api/intel/receivables/rollup` — lazy (Carrier Friction tab); AR aging breakdown by carrier; filterable by `?carrier=<name>` for a single-carrier slice
- `GET /api/intel/credits` — lazy (Vendor Credits tab); 138 vendor credit records, $22.8K total unrequested (ABC Supply 115 / Superior 22 / Beacon 1)
- `GET /api/intel/adjustments-open` — lazy (Open PA Cases tab); open public-adjuster cases

## Tabs

1. **AR List** — main receivables table; filterable by rep, carrier, and aging bucket
2. **Carrier Friction** — AR aging and collection rates broken down by carrier; identifies which carriers are slowest to pay
3. **Vendor Credits** — unrequested vendor credits that can be applied to reduce costs
4. **Open PA Cases** — public adjuster assignment list

## Key Flows

The AR total tile on ExecPage and WeeklyRecap both pull from this data. The Carrier Friction tab is the key surface for identifying structural payment delays by carrier — useful context when evaluating whether to continue working with a carrier.

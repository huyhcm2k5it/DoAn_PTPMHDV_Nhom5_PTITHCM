# Backend contract decisions — 08/11/2026

User authorized implementing all44tasks. Decisions below are implementation rulings, awaiting actual owner review; no human approvals are fabricated. Existing source DOCX are retained unchanged.

## C01

Canonical sourceType APPOINTMENT/LAB_ORDER/MED_HOLD; legacy aliases require explicit owner migration, never duplicate financial keys.

## C02

Twelve-field envelope, same claim requestId in envelope/payload; BillingStatusChanged consumed by source owners.

## C03

BI-007 public sourceId denotes cancellationId; verified owner evidence and refund attempt history required.

## C04

Lease action API-ID with hyphen, max30s no expiry leeway; access/lease/service token types separate; expired401 AUTHZ_LEASE_EXPIRED.

## C05

FAILED/REJECTED LAB unresolved until audited revisioned resubmit or valid cancellation; no new HTTP operation.

## C06

Stable medication hold per prescription revision; retain reserved at COMMITTED, decrement onHand/reserved only at DISPENSED.

## C07

Notification durable technical retry/quarantine; no additional domain event beyond18.

## C08

Three recovery operations disabled by default; private SERVICE identity plus owner evidence required.

## C09

Integer VND <=9007199254740991 in interoperable JSON; immutable64hex snapshot hash; Billing must not reprice.

## C10

Source DOCX/workbook v5.2 plus Git24Oct; user overrides Node TypeScript to CommonJS; onePGsixDB and Mongo3DB.

Ruling: keep existing personal branch `quan`, as requested in earlier session; do not modify shared branches/push. All source changes remain local for review. Dependencies unlock CONTRACT_LOCAL_READY, joint actual-wire testing is required for DONE.

# Confirmed supplier returns from physical stock

Status: M17f source work. Full ERP completion, public cost-opening, supplier transit,
negotiated price adjustments, physical devices and human usability remain open.

## SR1 — Two facts, one confirmed action

`purchase-return-lots` / `pos-supplier-lot-return/v1` is an explicit command.
The purchase and optional invoice identify the **financial credit**; allocations
identify the physical product, location, batch (including unlabelled stock), and
available/held stock being handed back. These identities are not interchangeable.
The owner must record a supplier acknowledgement reference and affirm that the
supplier received the goods and accepted the displayed original-document credit.
There is no automatic shipment, cash refund, vendor inference, URL fetch, or
invented credit. Different source purchases and opening/count-found sources are
permitted only as explicit physical selections covered by that acknowledgement;
they do not become proven original deliveries from this supplier.

This action retains the existing cumulative integer-cent credit allocation and
invoice/unbilled quantity limits. An adjusted supplier credit or goods still in
transit requires its own future workflow; it cannot be disguised as this command.

## SR2 — Physical selection and original cost

Each allocation `{lineIndex,key,quantityUnits}` uses the existing physical-count
key (product, location, root batch or null, shelf/quarantined). Its positive
integer milliunits must sum exactly to each purchase line's quantity; repeated
physical keys across two lines consume disjoint intervals from the same fact.
The product and base unit must match.
The planner selects only that fact's available/held original source intervals,
excluding reservations, consumed, wasted and previously returned goods. Unknown
labels/costs remain unknown. Split/count-found links stay in their physical batch.
Only selected main available stock reduces product sale availability.

Moves go directly to supplier-returned custody at the original location. Existing
source intervals, exact cost cents, general ledger and purchase document commit
atomically. Known outgoing cost and document credit settle the existing variance
account; any unknown selected cost retains credit in suspense until all original
returned intervals are valued. No second inventory or cost ledger is introduced.

## SR3 — Authority, retry, backups and preceding writers

Owner authority is verified by native/transport adapters. Bind exact purchase,
store, epoch, stock head and raw quantities before commit. Persist original ID
before writing. Reject changed contents on the same ID. Reply loss/restart retries
the exact original request and validates the full purchase and cost receipts.
Late SQL or browser quota failure rolls back all material records. Legacy
`purchase-return` and every prior stock event retain their replay meaning.
New state declares `stock-supplier-lot-returns-v1` and a persistent setting/fence;
complete backup, restore, standalone and genuine previous readers must retain or
reject it, including attempted feature deletion with a recomputed envelope hash.

## SR4 — Plain form and recoverable drafts

Show actual returnable batches/locations with plain available or paused labels.
Start with blank raw quantities, never a default full return. Show computed
credit and actual locations before the owner acknowledgement. Keep advanced
details collapsed, touch actions at least 56px, four locales/two themes/360px.
Use existing exclusive local draft leases. Stale unsubmitted input may be kept
verbatim and reset to a fresh empty form; submitted uncertain input must retain
its ID and be reconciled first. Global retry can close only the exact matching
draft. Closed forms, corrupt/quota/conflicting storage and a second window cannot
erase input or manufacture success. Agent assistance transcribes facts only and
cannot check the owner's acknowledgements or submit.
Filling an Agent draft keeps every other physical batch choice visible and
editable, with its quantity blank; a partial transcription cannot remove choices.
An older unsubmitted partial draft exposes refreshed choices without rewriting
its original text until the owner edits; submitted originals remain unchanged.
Quantity-only Agent transcription also retains the owner's selected financial
credit document and validates its remaining quantity limits.

## SR5 — Falsifiable acceptance and continuous slimming

Freeze M17e corrected 922-file source as baseline. Reproduce inability to return
held/backroom stock while a valid legacy main-stock return remains a good control.
Run the same real database/adapter journeys on the candidate, including partial
cents, multiple locations, unknown source cost, mixed financial/physical sources,
last quantity races, role/store/head/epoch failures, postcommit reply loss and
late rollback. Verify complete backup and genuine preceding writer refusal.
Measure initial and affected-route compiled payloads using the same graph/gzip
instrument. Reuse physical-count facts, custody and draft infrastructure. Report
growth and unchanged/unmeasured claims explicitly; test counts cannot certify
zero bugs, formal security, installers, deployed services or full ERP completion.

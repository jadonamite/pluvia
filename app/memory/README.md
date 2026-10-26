# Memory engine

`hmem/` contains the unmodified TypeScript reference sources from
[Meterless H-MEM](https://github.com/Meterless/Meterless/tree/1742dec56a66e58eef9dda2d2b865823758ca8cd/engines/hmem).
The upstream revision is `1742dec56a66e58eef9dda2d2b865823758ca8cd`.
The original Apache 2.0 licence is retained in `hmem/LICENSE`.

Pluvia's integration is `pluviaMemory.ts`; `index.ts` exports the vendor facade.
The wrapper scopes station lessons to the contractual window and persists unresolved
source conflicts across processes. H-MEM performs retrieval, feedback, conflict
scanning and its 0.70 auto-resolution gate. An unresolved queue entry forces an
inspection through PolicyGate.

The vendor calls procedural memories `general`. Pluvia adds the `procedural` tag
to precedents rather than changing the vendor's type system. Recalling a lesson
can avoid a repeated evidence request; it cannot clear a failed probe.

Run `npx tsx scripts/hmem_conformance.ts` or `bash scripts/hmem_conformance.sh`.
Both execute the official, unchanged runner and vectors shipped under
`scripts/vendor/hmem/`. The scorecard is also saved to
`logs/hmem-conformance.txt`. Vendor conformance establishes engine contracts;
Pluvia's tests separately check its integration and financial guardrails.

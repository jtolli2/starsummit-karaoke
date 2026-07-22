# Karaoke Catalog Import and Search

> Working record for the single active feature. Keep its status, goals, and implementation notes
> current; append completed work only to [feature-history.md](feature-history.md).

## Status

Complete

## Goals

- Deliver a server-only, resumable, idempotent, quota-aware popular-song import pipeline with
  reproducible input provenance, candidate classification, safe checkpointing, and auditability.
- Extend the catalog minimally for normalized identity, YouTube provenance/availability,
  classification, confidence, review state, alternatives, replacement, and import-run metadata.
- Provide constrained `tablet_admin` catalog-review endpoints/UI while keeping guests restricted to
  sanitized, approved, eligible catalog search and the existing validated request workflow.
- Implement deterministic title/artist normalization, pagination and ordering, candidate scoring,
  deduplication, replacement eligibility, and explainable rejection reasons without browser
  YouTube credentials or direct public catalog writes.
- Add proportionate importer, backend contract/integration, auth, deduplication and Vue coverage;
  deliver a review, approved commit/push/deploy and retained-staging validation when inputs and
  credentials permit.

## Constraints and Notes

- The initial source is a versioned fixture/import contract carrying source URL, retrieval date,
  rank and terms notes; a live import requires a reachable declared source and a server-side
  YouTube Data API key. Do not fabricate live catalog data if either is unavailable.
- Karaoke candidates are preferred, with `fallback_lyric` and `fallback_audio` visible for review
  and replaceable when stronger candidates appear. API metadata scoring is heuristic, not semantic
  certainty.
- Preserve the retained staging volume and all unrelated party, queue, controller, tablet and
  validation records. No production or Wi-Fi interruption action is in scope.
- Delivered the immutable manifest/chunk importer, normalized identity and deduplication, explicit
  `karaoke`/`fallback_lyric`/`fallback_audio` classification, provenance/confidence/review and
  replacement metadata, constrained tablet review routes/UI, and sanitized deterministic guest
  search. YouTube discovery is server-only, quota-aware, resumable, owner-fenced, and replay-safe.
- The reproducible initial source is the committed versioned fixture/import contract carrying URL,
  retrieval date, rank, and terms notes. It proves the pipeline without fabricating popularity
  data. A real licensed/operational popular-song source is still required before a large import;
  correctness and provenance took priority over the optional 5,000-record target.
- Retained staging deployed exact product SHA
  `f4801a5ef0e8e99127cce2268bf5df3733f7c17e` to PocketBase deployment
  `kitiyw8oh5btja1b3q9bryhe` and frontend deployment `iuatkib940w1rsyenmp9xhkr`; both finished
  healthy, the existing volume was preserved, and same-origin `/api/health` returned 200.
- Live validation imported one deterministic synthetic fixture, replayed it with zero duplicates,
  and immediately rejected it as ineligible. One YouTube query imported two credible karaoke
  candidates (`nMDXPAM8RwE` and `9iQH7g_zKl8`); its exact replay imported zero and spent no further
  quota. Both remain unreviewed/ineligible for operator review. The successful query consumed 101
  quota units; total task consumption is not exactly knowable because an earlier failed diagnostic
  request may also have reached YouTube.
- Live operator validation restored the signed-in tablet route with no active party and no error,
  exposed catalog review independently of party state, and displayed 16 unreviewed records. The
  new records comprise two unreviewed `karaoke` candidates and one rejected synthetic `karaoke`
  fixture; pre-existing validation records were not changed. Unauthenticated guest search remained
  denied, and no party, queue, controller, tablet enrollment, or unrelated validation state changed.
- Additive repair migrations corrected retained checkpoint schema state using the PocketBase 0.39.7
  field API without dropping data. Pinned-runtime offset-zero preservation/idempotency, importer,
  auth, quota/replay, deduplication/concurrency, classification, Vue, production-build, and live
  staging checks passed; independent reviews found no remaining blocking findings.
- Remaining limitations: YouTube classification is explainable metadata heuristics rather than
  semantic certainty; availability can only reflect the API at check time; no broad popular-song
  source or 5,000-record import was selected; fallbacks remain intentionally reviewable and
  replaceable rather than enforced by an irreversible karaoke-only constraint.

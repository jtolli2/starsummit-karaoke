// Narrow forward repair for the documented retained canary claim. The first
// lifecycle migration quarantined this PocketBase 0.39.7 JSON byte-wrapper and
// its audit wrapper became `[0]`, so no generic migration may safely infer its
// prior state. Repair only this known claim after validating every retained
// invariant recorded during the approved staging handoff.
migrate((app) => {
  let claim = null
  try { claim = app.findRecordById('karaoke_youtube_claims', 'dy36tlhzi17ew1p') } catch (_) {}
  if (!claim || String(claim.get('error_code') || '') !== 'legacy_payload_quarantined') return
  if (String(claim.get('batch_key') || '') !== 'mb-series-b2f47574d772-0000') return
  if (Number(claim.get('spent_units') || 0) !== 101 || Number(claim.get('reserved_units') || 0) !== 0) return
  const decodeJson = (record, field) => {
    let stored = ''; try { stored = record.getString(field) } catch (_) {}
    if (stored && /^(?:\[|\{)/.test(stored.trim())) { try { return JSON.parse(stored) } catch (_) {} }
    const raw = record.get(field); if (typeof raw === 'string') { try { return JSON.parse(raw) } catch (_) { return null } }
    try { const decoded = JSON.parse(JSON.stringify(raw)); return typeof decoded === 'string' ? JSON.parse(decoded) : decoded } catch (_) { return null }
  }
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') { const out = {}; Object.keys(value).sort().forEach((key) => { out[key] = canonicalize(value[key]) }); return out }
    return value
  }
  const payload = decodeJson(claim, 'payload_json'); const items = payload?.items
  const total = Number(payload?.total); const spent = Number(payload?.spent)
  const orderedIdentity = Array.isArray(items) ? items.map((item) => String(item?.youtubeId || item?.id || '')) : []
  const expectedOrder = ['KCI3qN_c3k0', 'NQ7k19pDRIw', 'iEr_Y8DKx84', 'wBz3sceWu9g', 'h0n-mYqB9WQ', '4G-YQA_bsOU', 'WrcwRt6J32o', 'eX9GAhjI2ak', '9gG9hMPvT58']
  if (!Array.isArray(items) || total !== 9 || total !== items.length || spent !== 101 || JSON.stringify(orderedIdentity) !== JSON.stringify(expectedOrder)) return
  let batch = null; try { batch = app.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: 'mb-series-b2f47574d772-0000' }) } catch (_) {}
  const sourceFingerprint = String(batch?.get('source_fingerprint') || '')
  const claimKey = String(claim.get('claim_key') || ''); const prefix = 'mb-series-b2f47574d772-0000:'
  const chunkFingerprint = claimKey.startsWith(prefix) ? claimKey.slice(prefix.length) : ''
  if (sourceFingerprint !== 'b2f47574d7727bb143be393691928bbb20a5a54dc1f3824748785ad205ff3993' || claimKey !== 'mb-series-b2f47574d772-0000:62161f11f34dc9d2688413e0b14c41c42902165eb1fac98ae658635089529d9b') return
  const canonical = { items, total, spent }; const payloadDigest = $security.sha256(JSON.stringify(canonicalize(canonical)))
  const repaired = { ...canonical, sourceFingerprint, chunkFingerprint, payloadDigest, orderedIdentity }
  claim.set('payload_json', repaired); claim.set('source_fingerprint', sourceFingerprint); claim.set('chunk_fingerprint', chunkFingerprint)
  claim.set('payload_digest', payloadDigest); claim.set('ordered_identity_json', orderedIdentity)
  claim.set('audit_json', [{ action: 'retained_canary_repaired', from: 'failed', to: 'ready', at: new Date().toISOString() }])
  claim.set('status', 'ready'); claim.set('error_code', ''); claim.set('lifecycle_reason', 'retained_canary_repaired'); claim.set('reserved_units', 0)
  app.save(claim)
}, () => {})

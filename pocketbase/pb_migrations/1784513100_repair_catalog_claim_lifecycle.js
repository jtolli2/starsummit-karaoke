// Forward-only repair for retained claim rows. Schema fields are provided by
// 1784513000_claim_audit_fields.js; this migration only audits/quarantines rows.
migrate((app) => {
  let claims = null
  try { claims = app.findCollectionByNameOrId('karaoke_youtube_claims') } catch (_) {}
  if (!claims) return
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') { const out = {}; Object.keys(value).sort().forEach((key) => { out[key] = canonicalize(value[key]) }); return out }
    return value
  }
  const records = app.findRecordsByFilter('karaoke_youtube_claims', '', '+id', 100000, 0)
  for (const claim of records) {
    let events = claim.get('audit_json'); if (typeof events === 'string') { try { events = JSON.parse(events) } catch (_) { events = [] } }
    if (!Array.isArray(events)) events = []
    const status = String(claim.get('status') || '')
    let payload = claim.get('payload_json'); if (typeof payload === 'string') { try { payload = JSON.parse(payload) } catch (_) { payload = null } }
    const items = payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.items) ? payload.items : null
    const total = Number(payload?.total); const spent = Number(payload?.spent)
    const orderedIdentity = items ? items.map((item) => String(item?.youtubeId || item?.id || '')) : []
    const batchKey = String(claim.get('batch_key') || '')
    const claimKey = String(claim.get('claim_key') || '')
    const chunkFingerprint = claimKey.startsWith(`${batchKey}:`) ? claimKey.slice(batchKey.length + 1) : ''
    let batch = null; try { batch = batchKey ? app.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }) : null } catch (_) {}
    const sourceFingerprint = String(batch?.get('source_fingerprint') || '')
    const validPayload = Boolean(items && Number.isInteger(total) && total === items.length && Number.isFinite(spent) && spent >= 0 && orderedIdentity.every(Boolean) && /^[a-f0-9]{64}$/i.test(sourceFingerprint) && chunkFingerprint)
    let marker = validPayload ? 'legacy_shape_normalized' : 'legacy_payload_quarantined'
    if (validPayload && ['ready', 'complete'].includes(status)) {
      const canonical = { items, total, spent }
      const payloadDigest = $security.sha256(JSON.stringify(canonicalize(canonical)))
      payload = { ...canonical, sourceFingerprint, chunkFingerprint, payloadDigest, orderedIdentity }
      claim.set('payload_json', JSON.stringify(payload)); claim.set('source_fingerprint', sourceFingerprint)
      claim.set('chunk_fingerprint', chunkFingerprint); claim.set('payload_digest', payloadDigest)
      claim.set('ordered_identity_json', JSON.stringify(orderedIdentity)); claim.set('lifecycle_reason', 'legacy_ready_backfilled')
      marker = 'legacy_ready_backfilled'
    }
    if (events.some((event) => event && event.action === marker)) continue
    events.push({ action: marker, from: status || 'unknown', at: new Date().toISOString() })
    claim.set('audit_json', JSON.stringify(events)); claim.set('lifecycle_version', 1); claim.set('replay_count', Number(claim.get('replay_count') || 0))
    if (!validPayload && ['ready', 'complete'].includes(status)) {
      // Preserve spent_units; reservation release must never erase actual spend.
      claim.set('status', 'failed'); claim.set('lifecycle_reason', 'legacy_payload_quarantined'); claim.set('error_code', 'legacy_payload_quarantined')
    }
    app.save(claim)
  }
}, () => {})

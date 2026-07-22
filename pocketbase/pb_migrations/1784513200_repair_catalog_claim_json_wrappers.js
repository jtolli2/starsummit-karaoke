// Forward repair for claims quarantined by the first lifecycle migration when
// PocketBase 0.39.7 exposed retained JSON as a native byte wrapper. Payload,
// spend, and audit history are preserved; only audit-proven ready/complete
// claims with deterministic source identity are restored.
migrate((app) => {
  let claims = null
  try { claims = app.findCollectionByNameOrId('karaoke_youtube_claims') } catch (_) {}
  if (!claims) return
  const canonicalize = (value) => {
    if (Array.isArray(value)) return value.map(canonicalize)
    if (value && typeof value === 'object') { const out = {}; Object.keys(value).sort().forEach((key) => { out[key] = canonicalize(value[key]) }); return out }
    return value
  }
  const decodeJson = (record, field) => {
    let raw = record.get(field)
    let stored = ''; try { stored = record.getString(field) } catch (_) {}
    if (stored && /^(?:\[|\{)/.test(stored.trim())) { try { return JSON.parse(stored) } catch (_) {} }
    if (typeof raw === 'string') { try { return JSON.parse(raw) } catch (_) { return null } }
    if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw
    try { const decoded = JSON.parse(JSON.stringify(raw)); return typeof decoded === 'string' ? JSON.parse(decoded) : decoded } catch (_) { return null }
  }
  const records = app.findRecordsByFilter('karaoke_youtube_claims', 'error_code = "legacy_payload_quarantined"', '+id', 100000, 0)
  for (const claim of records) {
    const events = decodeJson(claim, 'audit_json')
    const quarantine = Array.isArray(events) ? events.find((event) => event?.action === 'legacy_payload_quarantined' && ['ready', 'complete'].includes(String(event.from || ''))) : null
    const payload = decodeJson(claim, 'payload_json')
    const items = payload && typeof payload === 'object' && !Array.isArray(payload) && Array.isArray(payload.items) ? payload.items : null
    const total = Number(payload?.total); const spent = Number(payload?.spent)
    const orderedIdentity = items ? items.map((item) => String(item?.youtubeId || item?.id || '')) : []
    const batchKey = String(claim.get('batch_key') || ''); const claimKey = String(claim.get('claim_key') || '')
    const chunkFingerprint = claimKey.startsWith(`${batchKey}:`) ? claimKey.slice(batchKey.length + 1) : ''
    let batch = null; try { batch = batchKey ? app.findFirstRecordByFilter('karaoke_catalog_imports', 'batch_key = {:batch}', { batch: batchKey }) : null } catch (_) {}
    const sourceFingerprint = String(batch?.get('source_fingerprint') || '')
    const valid = Boolean(quarantine && items && Number.isInteger(total) && total === items.length && Number.isFinite(spent) && spent >= 0 && orderedIdentity.every(Boolean) && /^[a-f0-9]{64}$/i.test(sourceFingerprint) && chunkFingerprint)
    if (!valid) continue
    const canonical = { items, total, spent }; const payloadDigest = $security.sha256(JSON.stringify(canonicalize(canonical)))
    const repaired = { ...canonical, sourceFingerprint, chunkFingerprint, payloadDigest, orderedIdentity }
    const audit = events.concat({ action: 'legacy_wrapper_repaired', from: 'failed', to: quarantine.from, at: new Date().toISOString() }).slice(-50)
    claim.set('payload_json', JSON.stringify(repaired)); claim.set('source_fingerprint', sourceFingerprint)
    claim.set('chunk_fingerprint', chunkFingerprint); claim.set('payload_digest', payloadDigest)
    claim.set('ordered_identity_json', JSON.stringify(orderedIdentity)); claim.set('audit_json', JSON.stringify(audit))
    claim.set('status', quarantine.from); claim.set('error_code', ''); claim.set('lifecycle_reason', 'legacy_wrapper_repaired')
    claim.set('reserved_units', 0); app.save(claim)
  }
}, () => {})

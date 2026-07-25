import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  authenticateTablet,
  commitMatchedApprovals,
  correctCatalogIdentity,
  importTrustedPlaylist,
  issuePlaybackCommand,
  loadActiveParty,
  loadCatalog,
  loadCatalogReport,
  loadTabletStatus,
  previewMatchedApprovals,
  previewTrustedPlaylist,
  replaceCatalogSong,
  reviewCatalogSong,
  revalidateTrustedPlaylist,
  transitionQueue,
  previewPublicPlaylist,
  importConfirmedPlaylist,
  createApprovalSelection,
  commitApprovalSelection,
  updateApprovalSelection,
} from '@/services/tabletApi'

describe('tablet API', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('authenticates through the constrained users collection', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await authenticateTablet(' tablet@example.test ', 'secret')
    expect(result.token).toBe('tablet-token')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/collections/users/auth-with-password')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ identity: 'tablet@example.test', password: 'secret' })
  })

  it('sends only a bearer token to sanitized status and transition routes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ party: {}, queue: [] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await loadTabletStatus('tablet-token', 'party-1')
    await transitionQueue('tablet-token', 'queue-1', 'playing', 'completed')
    await issuePlaybackCommand('tablet-token', 'party-1', 'pause', 'tablet-pause-request-1')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    const statusHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(statusHeaders.get('authorization')).toBe('Bearer tablet-token')
    const transitionBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(transitionBody).toEqual({ queueId: 'queue-1', from: 'playing', to: 'completed' })
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/karaoke/tablet/controller/playback')
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      partyId: 'party-1',
      action: 'pause',
      idempotencyKey: 'tablet-pause-request-1',
    })
  })

  it('exposes backend error codes for recovery messaging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'stale_transition', message: 'changed' }), { status: 409 })))
    await expect(transitionQueue('tablet-token', 'queue-1', 'playing', 'completed')).rejects.toMatchObject({ code: 'stale_transition', status: 409 })
  })

  it('uses the tablet-scoped active-party recovery route', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ party: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await loadActiveParty('tablet-token')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/karaoke/tablet/active')
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer tablet-token')
  })

  it('uses the catalog review contract and pagination response fields', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ page: 2, perPage: 20, totalItems: 21, totalPages: 2, songs: [{ id: 'song-1', youtubeId: 'abcdefghijk', title: 'Song', artist: 'Artist', reviewState: 'unreviewed' }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'song-1', reviewState: 'approved', eligible: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'song-1', youtubeId: 'abcdefghijk' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'song-1', identityStatus: 'operator_corrected' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, missingIdentity: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const catalog = await loadCatalog('tablet-token', { review: 'unreviewed', page: 2, perPage: 20 })
    await reviewCatalogSong('tablet-token', 'song-1', 'approved', 'Looks good')
    await replaceCatalogSong('tablet-token', 'song-1', { youtubeId: 'abcdefghijk' })
    await correctCatalogIdentity('tablet-token', 'song-1', { title: 'Song', artist: 'Artist', reason: 'Source verified' })
    await loadCatalogReport('tablet-token')
    expect(catalog).toMatchObject({ totalItems: 21, totalPages: 2, songs: [{ reviewState: 'unreviewed' }] })
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/karaoke/tablet/catalog?review=unreviewed&page=2&perPage=20')
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ reviewState: 'approved', note: 'Looks good' })
    expect(String(fetchMock.mock.calls[2]?.[0])).toContain('/api/karaoke/tablet/catalog/song-1/replace')
    expect(JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))).toEqual({ title: 'Song', artist: 'Artist', reason: 'Source verified' })
    expect(fetchMock.mock.calls[4]?.[0]).toBe('/api/karaoke/tablet/catalog/report')
  })

  it('binds unavailable revalidation to the exact retained snapshot', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ unavailable: 2, unavailableReasons: { total: 2, metadataMissing: 1, nonEmbeddable: 1, privacy: {}, uploadStatus: {} }, revalidated: true, replay: false }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await revalidateTrustedPlaylist('tablet-token', 'UCchannel:PLplaylist', 'a'.repeat(64), 25, 'next')
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ sourceKey: 'UCchannel:PLplaylist', snapshotFingerprint: 'a'.repeat(64), maxItems: 25, pageToken: 'next', dryRun: false, revalidate: true })
  })

  it('forwards trusted-playlist preview page tokens through the tablet contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ source: { sourceKey: 'UCchannel:PLplaylist' }, expectedItems: 1, pageToken: 'next', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { total: 3 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await previewTrustedPlaylist('tablet-token', 'UCchannel:PLplaylist', 25, 'next')
    const body = JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))
    expect(body).toEqual({ sourceKey: 'UCchannel:PLplaylist', maxItems: 25, pageToken: 'next', dryRun: true })
  })

  it('returns the import continuation token for explicit next-page preview', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ imported: 1, duplicates: 0, unavailable: 0, nextPageToken: 'next' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await importTrustedPlaylist('tablet-token', 'UCchannel:PLplaylist', 'a'.repeat(64))
    expect(result.nextPageToken).toBe('next')
  })

  it('binds public preview and confirmed import to server-issued confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ playlistName: 'Public', ownerChannelTitle: 'Owner', visibility: 'public', expectedItems: 2, expectedQuota: 101, knownParser: false, snapshotFingerprint: 'fp', confirmationToken: 'opaque', source: { sourceKey: 'UC1:PL1', channelName: 'Owner', playlistName: 'Public', rationale: '' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 2, duplicates: 1, unavailable: 0, completed: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const preview = await previewPublicPlaylist('tablet-token', { playlist: 'https://www.youtube.com/playlist?list=PL1', maxItems: 25 })
    expect(preview.playlistName).toBe('Public')
    expect(preview.ownerChannelTitle).toBe('Owner')
    expect(preview.expectedQuota).toBe(101)
    await importConfirmedPlaylist('tablet-token', preview, 'op-1')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ playlistUrl: 'https://www.youtube.com/playlist?list=PL1', maxItems: 25, dryRun: true })
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ confirmationToken: 'opaque', snapshotFingerprint: 'fp', dryRun: false, operationId: 'op-1' })
  })

  it('uses opaque server selection snapshots for bulk approval', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ digest: 'sel-1', selectedCount: 3, excludedCount: 2, recordIds: ['a', 'b', 'c'] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ approved: 3, excluded: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await createApprovalSelection('tablet-token', { source: 'PL1', filter: { review: 'needs_review' } })
    await commitApprovalSelection('tablet-token', 'sel-1', 'bulk-op-1')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toMatchObject({ source: 'PL1', filter: { review: 'needs_review' } })
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({ digest: 'sel-1', operationId: 'bulk-op-1' })
  })

  it('updates the opaque selection digest when an operator deselects a row', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ digest: 'sel-1', selectedCount: 1, recordIds: ['a'] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    await updateApprovalSelection('tablet-token', 'sel-1', ['a'])
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ digest: 'sel-1', recordIds: ['a'] })
  })

  it('previews and resumes approvals against one completed matcher job', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dryRun: true,
            jobId: 'sqwd85vrfrwrzym',
            matched: 2,
            approvable: 2,
            excluded: 0,
            exclusions: {},
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            dryRun: false,
            jobId: 'sqwd85vrfrwrzym',
            operationId: 'matcher:operation-1',
            matched: 2,
            approved: 2,
            excluded: 0,
            exclusions: {},
            complete: true,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)

    await previewMatchedApprovals('tablet-token', 'sqwd85vrfrwrzym')
    await commitMatchedApprovals('tablet-token', 'sqwd85vrfrwrzym', 'matcher:operation-1')

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/karaoke/tablet/catalog/legacy-playlist/approve-matched',
      '/api/karaoke/tablet/catalog/legacy-playlist/approve-matched',
    ])
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({
      jobId: 'sqwd85vrfrwrzym',
      dryRun: true,
    })
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toEqual({
      jobId: 'sqwd85vrfrwrzym',
      operationId: 'matcher:operation-1',
      dryRun: false,
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateTablet, correctCatalogIdentity, loadActiveParty, loadCatalog, loadCatalogReport, loadTabletStatus, replaceCatalogSong, reviewCatalogSong, transitionQueue } from '@/services/tabletApi'

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
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const statusHeaders = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers)
    expect(statusHeaders.get('authorization')).toBe('Bearer tablet-token')
    const transitionBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(transitionBody).toEqual({ queueId: 'queue-1', from: 'playing', to: 'completed' })
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
})

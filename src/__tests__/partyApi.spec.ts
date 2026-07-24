import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fallbackSearchSongs, joinParty, loadCatalogIndex, normalizeSearchText, partyCredential, requestFallbackSong, requestSong } from '@/services/partyApi'

describe('party API', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('normalizes party codes and stores only the temporary credential', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ credential: 'temporary-credential-123456', expiresAt: 'x' }), { status: 201 })))
    await joinParty(' abcd1234 ')
    expect(partyCredential('ABCD1234')).toBe('temporary-credential-123456')
    expect(sessionStorage.length).toBe(1)
  })

  it('sends requests with bearer credentials and the YouTube id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'q' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestSong('temporary-credential-123456', 'abcdefghijk')
    const call = fetchMock.mock.calls[0]
    expect(call).toBeDefined()
    const init = call?.[1] as RequestInit
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer temporary-credential-123456')
    expect(JSON.parse(String(init.body))).toEqual({ youtubeId: 'abcdefghijk' })
  })

  it('normalizes accents and punctuation for deterministic local matching', () => {
    expect(normalizeSearchText('Beyoncé — Halo!')).toBe('beyonce halo')
    expect(normalizeSearchText('  AC/DC  ')).toBe('ac dc')
  })

  it('loads and caches a versioned sanitized catalog index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ indexVersion: '42', songs: [{ id: 'b', youtubeId: 'zzzzzzzzzzz', title: 'Zulu', artist: 'B' }, { id: 'a', youtubeId: 'aaaaaaaaaaa', title: 'Alpha', artist: 'A' }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await loadCatalogIndex('temporary-credential-123456', true)
    const second = await loadCatalogIndex('temporary-credential-123456')
    expect(first.version).toBe('42')
    expect(first.songs.map((song) => song.title)).toEqual(['Alpha', 'Zulu'])
    expect(second).toBe(first)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes stale indexes after the bounded TTL but serves stale data offline', async () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-07-22T12:00:00Z'))
      const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ version: '1', songs: [{ id: 'a', youtubeId: 'aaaaaaaaaaa', title: 'Alpha', artist: 'A' }] }), { status: 200 }))
        .mockRejectedValueOnce(new Error('offline'))
      vi.stubGlobal('fetch', fetchMock)
      const first = await loadCatalogIndex('temporary-credential-123456', true)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1)
      const stale = await loadCatalogIndex('temporary-credential-123456')
      expect(stale).toStrictEqual(first)
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
  })

  it('keeps fallback search party-scoped and bounded', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ songs: [{ id: 'yt', youtubeId: 'abcdefghijk', title: 'Halo karaoke', artist: '', channelTitle: 'KaraFun' }], quota: 'cached' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await fallbackSearchSongs('temporary-credential-123456', '  obscure song  ')
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe('/api/karaoke/parties/songs/fallback')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ query: 'obscure song' })
    expect(new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer temporary-credential-123456')
    expect(result.songs?.[0]).toMatchObject({ source: 'youtube', channelTitle: 'KaraFun' })
  })

  it('uses the audited fallback request path with an idempotency key', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: 'q' }), { status: 201 }))
    vi.stubGlobal('fetch', fetchMock)
    await requestFallbackSong('temporary-credential-123456', 'abcdefghijk', 'guest-key-1')
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/karaoke/parties/songs/fallback/request')
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit).body))).toEqual({ youtubeId: 'abcdefghijk', idempotencyKey: 'guest-key-1' })
  })
})

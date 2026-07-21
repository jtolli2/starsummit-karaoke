import { beforeEach, describe, expect, it, vi } from 'vitest'
import { joinParty, partyCredential, requestSong } from '@/services/partyApi'

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
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { authenticateTablet, loadActiveParty, loadTabletStatus, transitionQueue } from '@/services/tabletApi'

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
})

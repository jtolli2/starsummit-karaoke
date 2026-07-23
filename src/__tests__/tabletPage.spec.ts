import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import TabletPage from '@/pages/tablet/index.vue'

const activeStatus = (overrides: Record<string, unknown> = {}) => ({
  party: { id: 'party-1', codeHint: 'CD34', expiresAt: new Date(Date.now() + 3600000).toISOString(), status: 'active', joinCount: 2 },
  queue: [{ id: 'queue-1', sequence: 1, status: 'queued', song: { id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' } }],
  controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'dQw4w9WgXcQ' } },
  ...overrides,
})

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('tablet operator page', () => {
  afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks() })

  it('restores only the constrained session, party id, and locally created QR code after reload', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1', partyCode: 'AB12CD34' }))
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(activeStatus()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(wrapper.text()).toContain('AB12CD34')
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/api/karaoke/tablet/status?partyId=party-1')
    expect(sessionStorage.getItem('karaoke:tablet:session')).toContain('tablet-token')
  })

  it('restores an active party after sign-in without automatically creating an orphan party', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('No active party')
    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      '/api/collections/users/auth-with-password',
      '/api/karaoke/tablet/active',
    ])
  })

  it('shows catalog review after sign-in when there is no active party', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [{ id: 'catalog-1', title: 'Unreviewed Song', artist: 'Artist', youtubeId: 'dQw4w9WgXcQ', reviewState: 'unreviewed' }], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 1, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('Catalog review')
    await wrapper.get('.catalog button.quiet').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Unreviewed Song')
    expect(wrapper.text()).toContain('Canonical artist: Artist')
    expect(wrapper.text()).toContain('uploader unknown')
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/api/karaoke/tablet/catalog?review=unreviewed')
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/karaoke/tablet/catalog/report')
  })

  it('disables starting the next song while the controller is unavailable and renders nested state', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(activeStatus({ controller: { connected: false, connectionState: 'disconnected', state: { playerState: 'paused', videoId: 'dQw4w9WgXcQ' } } })), { status: 200 })))
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(wrapper.get('button').text()).toBe('Refresh')
    const playButton = wrapper.findAll('button').find((button) => button.text() === 'Play next')
    expect(playButton?.attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('paused')
    expect(wrapper.text()).toContain('dQw4w9WgXcQ')
  })

  it('issues party-scoped play and pause commands only for the matching active item', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    const playingQueue = [{ id: 'queue-1', sequence: 1, status: 'playing', song: { id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' } }]
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(activeStatus({ queue: playingQueue })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'command-1', action: 'play', sequence: 3, status: 'pending' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(activeStatus({ queue: playingQueue, controller: { connected: true, connectionState: 'connected', state: { playerState: 'playing', videoId: 'dQw4w9WgXcQ' } } })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    const play = wrapper.findAll('button').find((button) => button.text() === 'Play')
    const pause = wrapper.findAll('button').find((button) => button.text() === 'Pause')
    expect(play?.attributes('disabled')).toBeUndefined()
    expect(pause?.attributes('disabled')).toBeDefined()
    await play?.trigger('click')
    await settle()
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/karaoke/tablet/controller/playback')
    expect(JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))).toMatchObject({
      partyId: 'party-1',
      action: 'play',
    })
    expect(wrapper.text()).toContain('Playback resumed.')
    expect(wrapper.findAll('button').find((button) => button.text() === 'Pause')?.attributes('disabled')).toBeUndefined()
  })

  it('reuses an ambiguous playback request and reports it as pending until confirmed', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    const playingQueue = [{ id: 'queue-1', sequence: 1, status: 'playing', song: { id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' } }]
    const paused = activeStatus({ queue: playingQueue })
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(paused), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('response lost'))
      .mockResolvedValueOnce(new Response(JSON.stringify(paused), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'command-1', action: 'play', sequence: 3, status: 'pending', idempotent: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(paused), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    const play = wrapper.findAll('button').find((button) => button.text() === 'Play')
    await play?.trigger('click')
    await settle()
    const firstBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(wrapper.text()).toContain('retry will reuse the same request')
    await play?.trigger('click')
    await settle()
    const retryBody = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey)
    expect(firstBody.idempotencyKey).toMatch(/^tablet:party-1:queue-1:play:/)
    expect(wrapper.text()).toContain('Play requested; waiting for controller confirmation')
  })

  it('disables transport controls while controller video lags the active queue', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    const playingQueue = [{ id: 'queue-1', sequence: 1, status: 'playing', song: { id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' } }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(activeStatus({
      queue: playingQueue,
      controller: { connected: true, connectionState: 'connected', state: { playerState: 'playing', videoId: 'different01' } },
    })), { status: 200 })))
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(wrapper.text()).toContain('Waiting for controller playback confirmation')
    expect(wrapper.findAll('button').find((button) => button.text() === 'Play')?.attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('button').find((button) => button.text() === 'Pause')?.attributes('disabled')).toBeDefined()
  })

  it('clears a retained playback request when its queue item is no longer active', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    sessionStorage.setItem('karaoke:tablet:pending-playback', JSON.stringify({
      partyId: 'party-1',
      queueId: 'old-queue',
      action: 'pause',
      key: 'tablet:party-1:old-queue:pause:retry-key',
    }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(activeStatus()), { status: 200 })))
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(wrapper.text()).not.toContain('Pause request pending')
    expect(sessionStorage.getItem('karaoke:tablet:pending-playback')).toBeNull()
  })

  it('renders expired party recovery instead of active queue controls', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify(activeStatus({ party: { id: 'party-1', codeHint: 'CD34', expiresAt: new Date(Date.now() - 1000).toISOString(), status: 'expired' } })), { status: 200 })))
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(wrapper.text()).toContain('This party has expired')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Play next')).toBe(false)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Create new party')).toBe(true)
  })
})

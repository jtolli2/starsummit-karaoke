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

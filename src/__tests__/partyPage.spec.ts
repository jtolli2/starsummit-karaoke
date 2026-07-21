import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartyPage from '@/pages/party/[code].vue'

const api = vi.hoisted(() => ({
  joinParty: vi.fn(), partyCredential: vi.fn(), loadQueue: vi.fn(), searchSongs: vi.fn(), requestSong: vi.fn(), startQueueWakeHint: vi.fn(),
}))
vi.mock('@/services/partyApi', () => api)
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { code: 'ABCD1234' } }) }))

describe('party page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.partyCredential.mockReturnValue('credential-1234567890')
    api.loadQueue.mockResolvedValue({ queue: [] })
    api.searchSongs.mockResolvedValue({ songs: [{ id: 's1', youtubeId: 'abcdefghijk', title: 'Song', artist: 'Artist' }] })
    api.startQueueWakeHint.mockResolvedValue(() => undefined)
  })

  it('queues a song and reports duplicate rejection', async () => {
    api.requestSong.mockResolvedValueOnce({}).mockRejectedValueOnce({ code: 'duplicate_song' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('was added to the queue')
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('already queued')
  })

  it('shows actionable rate-limit and expiry messages', async () => {
    api.requestSong.mockRejectedValue({ code: 'rate_limited' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('wait a moment')

    api.loadQueue.mockRejectedValue({ code: 'party_expired' })
    const expired = mount(PartyPage)
    await flushPromises()
    expect(expired.text()).toContain('party has ended')
  })

})

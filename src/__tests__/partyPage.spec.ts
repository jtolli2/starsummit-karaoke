import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartyPage from '@/pages/party/[code].vue'

const api = vi.hoisted(() => ({
  joinParty: vi.fn(), partyCredential: vi.fn(), loadQueue: vi.fn(), searchSongs: vi.fn(), loadCatalogIndex: vi.fn(), fallbackSearchSongs: vi.fn(), requestFallbackSong: vi.fn(), normalizeCatalogSong: (song: any) => song, normalizeSearchText: (value: string) => value.toLowerCase(), requestSong: vi.fn(), startQueueWakeHint: vi.fn(),
}))
vi.mock('@/services/partyApi', () => api)
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { code: 'ABCD1234' } }) }))

describe('party page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    api.partyCredential.mockReturnValue('credential-1234567890')
    api.loadQueue.mockResolvedValue({ queue: [] })
    api.loadCatalogIndex.mockResolvedValue({ version: 'test', songs: [{ id: 's1', youtubeId: 'abcdefghijk', title: 'Song', artist: 'Artist' }] })
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

  it('does not spend fallback quota during debounce, but does on explicit action', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({ songs: [] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('unknown song')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(api.fallbackSearchSongs).not.toHaveBeenCalled()
    const fallbackButton = wrapper.findAll('button').find((button) => button.text() === 'Search YouTube')
    expect(fallbackButton).toBeDefined()
    await fallbackButton!.trigger('click')
    await flushPromises()
    expect(api.fallbackSearchSongs).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })

  it('invalidates a weak fallback suggestion when the query changes', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({ songs: [] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('unknown song')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(wrapper.find('button').text()).toBe('Search YouTube')
    await wrapper.get('#song-search').setValue('Song')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Search YouTube')).toBe(false)
    expect(api.fallbackSearchSongs).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('does not suggest fallback for an exact local Fuse match with score zero', async () => {
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('input').setValue('Song')
    await new Promise((resolve) => setTimeout(resolve, 350))
    await flushPromises()
    expect(wrapper.text()).not.toContain('Search YouTube')
  })

  it('renders the YouTube channel for fallback results', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({ songs: [
      { id: 'yt', youtubeId: 'qwertyuiopa', title: 'All Night Long karaoke', artist: '', channelTitle: 'KaraFun' },
      { id: 'yt-legacy', youtubeId: 'zyxwvutsrqp', title: 'Legacy fallback', artist: '', channelTitle: '' },
    ] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('all night long')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('KaraFun')
    expect(wrapper.text()).toContain('KaraFun · YouTube fallback')
    expect(wrapper.text()).toContain('Legacy fallback')
    expect(wrapper.text()).not.toContain('YouTube fallback · YouTube fallback')
    vi.useRealTimers()
  })

  it('keeps an ordinary multi-character typo in the local catalog flow', async () => {
    vi.useFakeTimers()
    api.loadCatalogIndex.mockResolvedValue({ version: 'test', songs: [{ id: 's2', youtubeId: 'zyxwvutsrqp', title: 'Never Gonna Give You Up', artist: 'Rick Astley' }] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('nevver gona give you up')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(wrapper.text()).toContain('Never Gonna Give You Up')
    expect(wrapper.text()).not.toContain('Search YouTube')
    expect(api.fallbackSearchSongs).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

})

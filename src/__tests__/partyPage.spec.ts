import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartyPage from '@/pages/party/[code].vue'

const api = vi.hoisted(() => ({
  clearPartyCredential: vi.fn(), joinParty: vi.fn(), partyCredential: vi.fn(), loadQueue: vi.fn(), searchSongs: vi.fn(), loadCatalogIndex: vi.fn(), fallbackSearchSongs: vi.fn(), requestFallbackSong: vi.fn(), normalizeCatalogSong: (song: any) => song, normalizeSearchText: (value: string) => value.toLowerCase(), requestSong: vi.fn(), startQueueWakeHint: vi.fn(),
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
    const fallbackButton = wrapper.findAll('button').find((button) => button.text() === 'Search YouTube for this song')
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
    expect(wrapper.find('button').text()).toBe('Search YouTube for this song')
    await wrapper.get('#song-search').setValue('Song')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Search YouTube for this song')).toBe(false)
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
    expect(wrapper.text()).toContain('YouTube search completed: 2 eligible results added below')
    expect(wrapper.text()).toContain('Catalog')
    expect(wrapper.text()).toContain('Legacy fallback')
    expect(wrapper.text()).not.toContain('YouTube fallback · YouTube fallback')
    vi.useRealTimers()
  })

  it('makes an explicit YouTube result unmistakable even when it resembles a reviewed song', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({
      songs: [
        {
          id: 'whitney',
          youtubeId: 'aaaaaaaaaaa',
          title: "It's Not Right but It's Okay",
          artist: '',
          channelTitle: 'KaraFun Karaoke',
        },
      ],
    })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(api.fallbackSearchSongs).toHaveBeenCalledWith(
      'credential-1234567890',
      'i write sins',
    )
    expect(wrapper.text()).toContain('YouTube search completed: 1 eligible result shown below')
    expect(wrapper.text()).toContain("It's Not Right but It's Okay")
    expect(wrapper.text()).toContain('KaraFun Karaoke · YouTube fallback')
    expect(wrapper.text()).not.toContain('Whitney Houston · Catalog')
    vi.useRealTimers()
  })

  it('reports when an explicit YouTube search has no eligible results', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({ songs: [] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('YouTube search completed, but no eligible YouTube results')
    vi.useRealTimers()
  })

  it('coalesces repeated Enter presses while a YouTube search is in flight', async () => {
    vi.useFakeTimers()
    let resolveSearch!: (value: { songs: never[] }) => void
    api.fallbackSearchSongs.mockReturnValue(
      new Promise((resolve) => {
        resolveSearch = resolve
      }),
    )
    const wrapper = mount(PartyPage)
    await flushPromises()
    const input = wrapper.get('#song-search')
    await input.setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await input.trigger('keyup.enter')
    await input.trigger('keyup.enter')
    expect(api.fallbackSearchSongs).toHaveBeenCalledTimes(1)
    resolveSearch({ songs: [] })
    await flushPromises()
    expect(wrapper.text()).toContain('YouTube search completed')
    vi.useRealTimers()
  })

  it('retries an expired guest credential inside the same guarded YouTube search', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
      .mockResolvedValueOnce({ songs: [] })
    api.joinParty.mockResolvedValue({ credential: 'credential-refreshed' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(api.fallbackSearchSongs.mock.calls).toEqual([
      ['credential-1234567890', 'i write sins'],
      ['credential-refreshed', 'i write sins'],
    ])
    expect(wrapper.text()).toContain('YouTube search completed')
    expect(wrapper.text()).not.toContain('party session expired')
    vi.useRealTimers()
  })

  it('does not retry YouTube after the query changes during credential refresh', async () => {
    vi.useFakeTimers()
    let resolveJoin!: (value: { credential: string }) => void
    api.fallbackSearchSongs.mockRejectedValueOnce({ code: 'guest_credential_expired' })
    api.joinParty.mockReturnValue(
      new Promise((resolve) => {
        resolveJoin = resolve
      }),
    )
    const wrapper = mount(PartyPage)
    await flushPromises()
    const input = wrapper.get('#song-search')
    await input.setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await input.setValue('different song')
    resolveJoin({ credential: 'credential-refreshed' })
    await flushPromises()
    await flushPromises()
    expect(api.fallbackSearchSongs).toHaveBeenCalledTimes(1)
    expect(api.fallbackSearchSongs).toHaveBeenCalledWith(
      'credential-1234567890',
      'i write sins',
    )
    vi.useRealTimers()
  })

  it('counts only YouTube results that remain visible after truncation', async () => {
    vi.useFakeTimers()
    api.fallbackSearchSongs.mockResolvedValue({
      songs: Array.from({ length: 13 }, (_, index) => {
        const youtubeId = `video${String(index).padStart(6, '0')}`
        return {
          id: youtubeId,
          youtubeId,
          title: `Candidate ${index}`,
          artist: '',
          channelTitle: 'KaraFun Karaoke',
        }
      }),
    })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('unknown song')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('YouTube search completed: 12 eligible results shown below')
    expect(wrapper.text()).not.toContain('13 eligible results')
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

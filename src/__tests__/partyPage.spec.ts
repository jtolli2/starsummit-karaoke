import { flushPromises, mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import PartyPage from '@/pages/party/[code].vue'

const api = vi.hoisted(() => ({
  clearPartyCredential: vi.fn(), joinParty: vi.fn(), partyCredential: vi.fn(), loadQueue: vi.fn(), searchSongs: vi.fn(), loadCatalogIndex: vi.fn(), fallbackSearchSongs: vi.fn(), requestFallbackSong: vi.fn(), normalizeCatalogSong: (song: any) => song, normalizeSearchText: (value: string) => value.toLowerCase(), requestSong: vi.fn(), startQueueWakeHint: vi.fn(),
}))
vi.mock('@/services/partyApi', () => api)
vi.mock('vue-router', () => ({ useRoute: () => ({ params: { code: 'ABCD1234' } }) }))

const acknowledgement = (id = 'queue-row-1', youtubeId = 'abcdefghijk') => ({ id, song: { youtubeId } })

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
    api.requestSong.mockResolvedValueOnce(acknowledgement()).mockRejectedValueOnce({ code: 'duplicate_song' })
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

  it('keeps request confirmation and search feedback separate from later queue refresh failures', async () => {
    vi.useFakeTimers()
    let wake!: () => void
    api.startQueueWakeHint.mockImplementation((_credential: string, reconcile: () => void) => {
      wake = reconcile
      return () => undefined
    })
    api.fallbackSearchSongs.mockResolvedValue({ songs: [
      { id: 'yt-song', youtubeId: 'zyxwvutsrqp', title: 'Song', artist: '', channelTitle: 'KaraFun', source: 'youtube' },
    ] })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('#song-search').setValue('unknown song')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Search YouTube for this song')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('YouTube search completed')

    let rejectLateRefresh!: (error: Error) => void
    api.requestFallbackSong.mockResolvedValueOnce(acknowledgement('queue-row-fallback', 'zyxwvutsrqp'))
    api.loadQueue.mockReturnValueOnce(new Promise((_resolve, reject) => { rejectLateRefresh = reject }))
    await wrapper.findAll('button').find((button) => button.text() === 'Queue')!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    expect(wrapper.text()).toContain('YouTube search completed')

    api.loadQueue.mockResolvedValueOnce({ queue: [] })
    wake()
    await flushPromises()
    rejectLateRefresh(new Error('offline'))
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    expect(wrapper.text()).toContain('YouTube search completed')
    expect(wrapper.text()).toContain('Queue could not be loaded.')

    api.loadQueue.mockResolvedValueOnce({ queue: [] })
    wake()
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    expect(wrapper.text()).toContain('YouTube search completed')
    expect(wrapper.text()).not.toContain('Queue could not be loaded.')
    vi.useRealTimers()
  })

  it('keeps a confirmed request after a background session rejoin failure and a later successful refresh', async () => {
    let wake!: () => void
    api.startQueueWakeHint.mockImplementation((_credential: string, reconcile: () => void) => {
      wake = reconcile
      return () => undefined
    })
    api.requestSong.mockResolvedValueOnce(acknowledgement())
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')

    api.loadQueue.mockRejectedValueOnce({ code: 'guest_credential_expired' })
    api.joinParty.mockRejectedValueOnce({ code: 'party_expired' })
    wake()
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    expect(wrapper.text()).toContain('This party has ended.')

    api.loadQueue.mockResolvedValueOnce({ queue: [] })
    wake()
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    expect(wrapper.text()).not.toContain('This party has ended.')
  })

  it('retries an initial definite credential expiry once with a refreshed credential and the same request key', async () => {
    api.joinParty.mockResolvedValue({ credential: 'credential-refreshed' })
    api.requestSong
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
      .mockResolvedValueOnce(acknowledgement())
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    const firstCall = api.requestSong.mock.calls[0]
    const retriedCall = api.requestSong.mock.calls[1]
    expect(api.joinParty).toHaveBeenCalledTimes(1)
    expect(firstCall).toEqual(['credential-1234567890', 'abcdefghijk', expect.any(String)])
    expect(retriedCall?.[0]).toBe('credential-refreshed')
    expect(retriedCall?.[1]).toBe('abcdefghijk')
    expect(retriedCall?.[2]).toBe(firstCall?.[2])
    expect(wrapper.text()).toContain('Song was added to the queue.')
  })

  it('automatically replays an ambiguous catalog request with the same key and confirms its receipt', async () => {
    api.requestSong
      .mockRejectedValueOnce({ ambiguous: true })
      .mockResolvedValueOnce(acknowledgement())
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(api.requestSong).toHaveBeenCalledTimes(2)
    expect(api.requestSong.mock.calls[1]).toEqual(api.requestSong.mock.calls[0])
    expect(wrapper.text()).toContain('Song was added to the queue.')
  })

  it('stops after one credential rejoin when the retried catalog request is still expired', async () => {
    api.joinParty.mockResolvedValue({ credential: 'credential-refreshed' })
    api.requestSong
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(api.joinParty).toHaveBeenCalledTimes(1)
    expect(api.requestSong).toHaveBeenCalledTimes(2)
    expect(api.requestSong.mock.calls[1]?.[0]).toBe('credential-refreshed')
    expect(wrapper.text()).toContain('Your party session expired.')
    expect(wrapper.text()).not.toContain('Retry same request')
  })

  it('retains uncertainty and the original identity when explicit retry reports credential expiry', async () => {
    api.requestSong
      .mockRejectedValueOnce({ ambiguous: true })
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
      .mockRejectedValueOnce({ code: 'guest_credential_expired' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('may already be in the queue')
    const retryButton = wrapper.findAll('button').find((button) => button.text() === 'Retry same request')
    expect(retryButton).toBeDefined()
    await retryButton!.trigger('click')
    await flushPromises()
    expect(api.joinParty).not.toHaveBeenCalled()
    expect(api.requestSong).toHaveBeenCalledTimes(3)
    const [first, automaticRetry, explicitRetry] = api.requestSong.mock.calls
    expect(first).toEqual(['credential-1234567890', 'abcdefghijk', expect.any(String)])
    expect(automaticRetry).toEqual(first)
    expect(explicitRetry).toEqual(first)
    expect(wrapper.text()).toContain('may already be in the queue')
    expect(wrapper.text()).toContain('original party session expired')
    expect(wrapper.text()).toContain('Ask the host to check the queue')
    expect(wrapper.text()).not.toContain('Reload this page')
    expect(wrapper.text()).not.toContain('rejoin')
    expect(wrapper.text()).toContain('Retry same request')
  })

  it('does not submit the same song twice while its first request is pending', async () => {
    let resolveRequest!: (value: ReturnType<typeof acknowledgement>) => void
    api.requestSong.mockReturnValue(new Promise((resolve) => { resolveRequest = resolve }))
    const wrapper = mount(PartyPage)
    await flushPromises()
    const queueButton = wrapper.get('#song-suggestions button')
    await queueButton.trigger('click')
    await flushPromises()
    const pendingButton = wrapper.get('#song-suggestions button')
    expect(pendingButton.text()).toBe('Adding…')
    expect(pendingButton.attributes('disabled')).toBeDefined()
    expect(api.requestSong).toHaveBeenCalledTimes(1)
    await pendingButton.trigger('click')
    expect(api.requestSong).toHaveBeenCalledTimes(1)
    resolveRequest(acknowledgement())
    await flushPromises()
  })

  it('keeps an uncertain fallback request retryable after its search result disappears', async () => {
    vi.useFakeTimers()
    let resolveRetry!: (value: ReturnType<typeof acknowledgement>) => void
    api.fallbackSearchSongs.mockResolvedValue({ songs: [
      { id: 'fallback-song', youtubeId: 'zyxwvutsrqp', title: 'Song', artist: '', channelTitle: 'KaraFun', source: 'youtube' },
    ] })
    api.requestFallbackSong
      .mockRejectedValueOnce({ ambiguous: true })
      .mockRejectedValueOnce({ ambiguous: true })
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveRetry = resolve
      }))
    const wrapper = mount(PartyPage)
    await flushPromises()
    const input = wrapper.get('#song-search')
    await input.setValue('totally unknown')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    api.loadCatalogIndex.mockResolvedValueOnce({ version: 'refreshed', songs: [
      { id: 'same-video', youtubeId: 'zyxwvutsrqp', title: 'Song', artist: 'Artist' },
    ] })
    await wrapper.findAll('button').find((button) => button.text() === 'Search YouTube for this song')!.trigger('click')
    await flushPromises()
    await wrapper.findAll('button').find((button) => button.text() === 'Queue')!.trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.text()).toContain('may already be in the queue')

    await input.setValue('Song')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(wrapper.get('#song-suggestions').text()).toContain('Artist · Catalog')

    await input.setValue('qzxvblah')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(wrapper.find('#song-suggestions').exists()).toBe(false)
    const pendingSection = wrapper.get('section[aria-labelledby="pending-requests-title"]')
    expect(pendingSection.text()).toContain('Song')
    const retryButton = pendingSection.get('button')
    await retryButton.trigger('click')
    await flushPromises()
    expect(retryButton.text()).toBe('Checking…')
    expect(retryButton.attributes('disabled')).toBeDefined()
    expect(api.requestFallbackSong).toHaveBeenCalledTimes(3)
    const firstCall = api.requestFallbackSong.mock.calls[0]
    expect(firstCall).toEqual(['credential-1234567890', 'zyxwvutsrqp', expect.any(String)])
    expect(api.requestFallbackSong.mock.calls[1]).toEqual(firstCall)
    expect(api.requestFallbackSong.mock.calls[2]).toEqual(firstCall)
    expect(api.requestSong).not.toHaveBeenCalled()
    await retryButton.trigger('click')
    expect(api.requestFallbackSong).toHaveBeenCalledTimes(3)
    resolveRetry(acknowledgement('queue-row-fallback', 'zyxwvutsrqp'))
    await flushPromises()
    expect(wrapper.text()).toContain('Song was added to the queue.')
    vi.useRealTimers()
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

  it('uses dark-surface classes for guest feedback and errors', async () => {
    api.requestSong.mockRejectedValue({ code: 'rate_limited' })
    const wrapper = mount(PartyPage)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    const message = wrapper.get('.message')
    expect(message.classes()).toContain('message')
    expect(message.attributes('data-error')).toBe('true')
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

  it('refreshes the sanitized catalog before fallback and skips YouTube for a newly approved match', async () => {
    vi.useFakeTimers()
    api.loadCatalogIndex
      .mockResolvedValueOnce({
        version: 'before-approval',
        songs: [
          {
            id: 'whitney',
            youtubeId: 'aaaaaaaaaaa',
            title: "It's Not Right but It's Okay",
            artist: 'Whitney Houston',
          },
        ],
      })
      .mockResolvedValueOnce({
        version: 'after-approval',
        songs: [
          {
            id: 'whitney',
            youtubeId: 'aaaaaaaaaaa',
            title: "It's Not Right but It's Okay",
            artist: 'Whitney Houston',
          },
          {
            id: 'panic',
            youtubeId: 'bbbbbbbbbbb',
            title: 'I Write Sins Not Tragedies',
            artist: 'Panic! At The Disco',
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
    expect(api.loadCatalogIndex).toHaveBeenLastCalledWith('credential-1234567890', true)
    expect(api.fallbackSearchSongs).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Catalog refreshed: a newly approved song is now available.')
    expect(wrapper.text()).toContain('I Write Sins Not Tragedies')
    expect(wrapper.text()).toContain('Panic! At The Disco · Catalog')
    vi.useRealTimers()
  })

  it('does not search YouTube when the query changes during the catalog refresh', async () => {
    vi.useFakeTimers()
    let resolveRefresh!: (value: { version: string; songs: { id: string; youtubeId: string; title: string; artist: string }[] }) => void
    api.loadCatalogIndex
      .mockResolvedValueOnce({
        version: 'initial',
        songs: [
          {
            id: 'whitney',
            youtubeId: 'aaaaaaaaaaa',
            title: "It's Not Right but It's Okay",
            artist: 'Whitney Houston',
          },
        ],
      })
      .mockReturnValueOnce(
        new Promise((resolve) => {
          resolveRefresh = resolve
        }),
      )
    const wrapper = mount(PartyPage)
    await flushPromises()
    const input = wrapper.get('#song-search')
    await input.setValue('i write sins')
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    await wrapper.get('button').trigger('click')
    await input.setValue('different song')
    resolveRefresh({ version: 'stale', songs: [] })
    await flushPromises()
    await vi.advanceTimersByTimeAsync(350)
    await flushPromises()
    expect(api.fallbackSearchSongs).not.toHaveBeenCalled()
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

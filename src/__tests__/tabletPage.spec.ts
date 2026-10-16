import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import TabletPage from '@/pages/tablet/index.vue'

const status = (overrides: Record<string, unknown> = {}) => ({
  party: {
    id: 'party-1',
    code: 'AB12CD34',
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
    status: 'active',
    joinCount: 2,
  },
  queue: [
    {
      id: 'queue-1',
      sequence: 1,
      status: 'playing',
      song: { id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Song', artist: 'Artist' },
    },
  ],
  controller: {
    connected: true,
    connectionState: 'connected',
    state: { playerState: 'paused', videoId: 'dQw4w9WgXcQ' },
  },
  ...overrides,
})

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
function mountPage(options: { attachTo?: Element } = {}) {
  const plannedFetch = globalThis.fetch
  if (typeof plannedFetch === 'function') {
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>((input, init) => {
        if (String(input).includes('/api/karaoke/tablet/active')) {
          const saved = JSON.parse(sessionStorage.getItem('karaoke:tablet:session') || '{}')
          return Promise.resolve(
            new Response(
              JSON.stringify({
                party: saved.partyId
                  ? {
                      id: saved.partyId,
                      code: saved.partyCode,
                      codeHint: saved.partyCode?.slice(-4) || '1234',
                      status: 'active',
                      expiresAt: new Date(Date.now() + 3600000).toISOString(),
                    }
                  : null,
              }),
              { status: 200 },
            ),
          )
        }
        return plannedFetch(input, init)
      }),
    )
  }
  return mount(TabletPage, { ...options, global: { stubs: { QrcodeVue: true } } })
}

describe('simplified tablet operator', () => {
  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('keeps party identity and QR context visible while the queue drawer opens and closes', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1', partyCode: 'AB12CD34' }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(status()), { status: 200 })),
    )
    const wrapper = mountPage()
    await settle()
    expect(wrapper.text()).toContain('Party AB12CD34')
    expect(wrapper.get('.now').attributes('style')).toContain(
      'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
    )
    expect(wrapper.findComponent({ name: 'QrcodeVue' }).exists()).toBe(true)
    await wrapper.get('[aria-controls="queue-drawer"]').trigger('click')
    expect(wrapper.get('#queue-drawer').attributes('data-open')).toBe('true')
    expect(wrapper.get('.layout').classes()).toContain('queue-open')
    expect(wrapper.text()).toContain('Song')
    expect(wrapper.text()).toContain('Party AB12CD34')
    await wrapper.get('#queue-drawer button.quiet').trigger('click')
    expect(wrapper.get('#queue-drawer').attributes('data-open')).toBe('false')
    expect(wrapper.get('.layout').classes()).not.toContain('queue-open')
  })

  it('uses one accessible Play control only after confirmed paused state', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status()), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'command-1', action: 'play', status: 'pending' }), {
          status: 201,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify(
            status({
              controller: {
                connected: true,
                connectionState: 'connected',
                state: { playerState: 'playing', videoId: 'dQw4w9WgXcQ' },
              },
            }),
          ),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await settle()
    const transport = wrapper.get('.transport')
    expect(transport.text()).toContain('Play')
    expect(transport.attributes('aria-label')).toBe('Play confirmed playback')
    await transport.trigger('click')
    await settle()
    const commandInit = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined
    expect(commandInit).toBeDefined()
    expect(JSON.parse(String(commandInit?.body))).toMatchObject({
      partyId: 'party-1',
      action: 'play',
    })
    expect(wrapper.get('.transport').text()).toContain('Pause')
    expect(wrapper.text()).toContain('Playback resumed.')
    expect(wrapper.text()).toContain('NOW PLAYING')
    expect(wrapper.text()).not.toContain('SELECTED SONG')
  })

  it.each([
    { action: 'play', initial: 'paused', target: 'playing', confirmed: 'Pause' },
    { action: 'pause', initial: 'playing', target: 'paused', confirmed: 'Play' },
  ] as const)(
    'refreshes authoritative playback promptly after $action without treating command acceptance as confirmation',
    async ({ action, initial, target, confirmed }) => {
      vi.useFakeTimers()
      sessionStorage.setItem(
        'karaoke:tablet:session',
        JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
      )
      const state = (playerState: string) => ({
        connected: true,
        connectionState: 'connected',
        state: { playerState, videoId: 'dQw4w9WgXcQ' },
      })
      const snapshots = [
        status({ controller: state(initial) }),
        status({ controller: state(initial) }),
        status({ controller: state(target) }),
      ]
      const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input)
        if (url.includes('/controller/playback')) {
          return new Response(JSON.stringify({ id: 'command-1', action, status: 'pending' }), {
            status: 201,
          })
        }
        if (url.includes('/tablet/active'))
          return new Response(JSON.stringify({ party: null }), { status: 200 })
        const snapshot = snapshots.shift() ?? status()
        return new Response(JSON.stringify(snapshot), { status: 200 })
      })
      vi.stubGlobal('fetch', fetchMock)
      const wrapper = mountPage()
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()
      await wrapper.get('.transport').trigger('click')
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()

      expect(wrapper.get('.transport').text()).toContain(initial === 'paused' ? 'Play' : 'Pause')
      expect(wrapper.text()).not.toContain('Playback resumed.')
      const readsBeforeFollowUp = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/tablet/status'),
      ).length

      await vi.advanceTimersByTimeAsync(1000)
      await nextTick()

      const readsAfterFollowUp = fetchMock.mock.calls.filter(([url]) =>
        String(url).includes('/tablet/status'),
      ).length
      expect(readsAfterFollowUp).toBeGreaterThan(readsBeforeFollowUp)
      expect(wrapper.get('.transport').text()).toContain(confirmed)
      if (target === 'playing') expect(wrapper.text()).toContain('NOW PLAYING')
      else
        expect(wrapper.text()).not.toContain(
          'Pause requested — waiting for controller confirmation.',
        )
      const callsAfterConfirmation = fetchMock.mock.calls.length
      wrapper.unmount()
      await vi.advanceTimersByTimeAsync(5000)
      expect(fetchMock.mock.calls).toHaveLength(callsAfterConfirmation)
      vi.useRealTimers()
    },
  )

  it('bounds unconfirmed playback polling and stops follow-ups after sign-out', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/controller/playback')) {
        return new Response(
          JSON.stringify({ id: 'command-1', action: 'play', status: 'pending' }),
          {
            status: 201,
          },
        )
      }
      return new Response(JSON.stringify(status()), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await wrapper.get('.transport').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await vi.advanceTimersByTimeAsync(30_000)
    await nextTick()
    expect(wrapper.get('.transport').text()).toContain('Play')
    const statusCallsAtBound = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/tablet/status'),
    ).length
    expect(statusCallsAtBound).toBeLessThanOrEqual(40)
    await vi.advanceTimersByTimeAsync(1000)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/tablet/status')),
    ).toHaveLength(statusCallsAtBound)
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Sign out')!
      .trigger('click')
    const callsAtSignOut = fetchMock.mock.calls.filter(([url]) =>
      String(url).includes('/tablet/status'),
    ).length
    await vi.advanceTimersByTimeAsync(10_000)
    expect(
      fetchMock.mock.calls.filter(([url]) => String(url).includes('/tablet/status')),
    ).toHaveLength(callsAtSignOut)
    wrapper.unmount()
  })

  it('keeps a newly started queue row selected until controller state confirms its video', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1', partyCode: 'AB12CD34' }),
    )
    const queued = {
      id: 'queue-2',
      sequence: 2,
      status: 'queued',
      song: { id: 'song-2', youtubeId: '9bZkp7q19f0', title: 'Next Song', artist: 'Next Artist' },
    }
    const playing = { ...queued, status: 'playing' }
    const snapshot = (queue: unknown[], controllerState: Record<string, unknown>) =>
      status({
        queue,
        controller: { connected: true, connectionState: 'connected', state: controllerState },
      })
    let statusReads = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/queue/next'))
        return new Response(JSON.stringify({ queue: queued }), { status: 200 })
      if (url.includes('/queue/transition'))
        return new Response(JSON.stringify({ id: 'queue-2', status: 'playing' }), { status: 200 })
      if (url.includes('/tablet/active'))
        return new Response(JSON.stringify({ party: null }), { status: 200 })
      statusReads++
      const state = { playerState: 'IDLE', videoId: '' }
      return new Response(
        JSON.stringify(snapshot(statusReads === 1 ? [queued] : [playing], state)),
        { status: 200 },
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await wrapper.get('.next button').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(wrapper.text()).toContain('SELECTED SONG')
    expect(wrapper.text()).not.toContain('NOW PLAYING')

    const readsAfterQueueAcceptance = statusReads
    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(statusReads).toBeGreaterThan(readsAfterQueueAcceptance)
    expect(wrapper.text()).toContain('SELECTED SONG')
    expect(wrapper.text()).not.toContain('NOW PLAYING')
    wrapper.unmount()
  })

  it('refreshes selected-video recovery within one second and waits for the matching video', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1', partyCode: 'AB12CD34' }),
    )
    const mismatch = status({
      controller: {
        connected: true,
        connectionState: 'connected',
        state: { playerState: 'paused', videoId: 'other-video' },
      },
    })
    const confirmed = status({
      controller: {
        connected: true,
        connectionState: 'connected',
        state: { playerState: 'playing', videoId: 'dQw4w9WgXcQ' },
      },
    })
    let statusReads = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.includes('/controller/playback')) {
        return new Response(
          JSON.stringify({ id: 'recovery-1', action: 'open_video', status: 'pending' }),
          { status: 201 },
        )
      }
      if (url.includes('/tablet/active'))
        return new Response(JSON.stringify({ party: null }), { status: 200 })
      statusReads++
      return new Response(JSON.stringify(statusReads < 3 ? mismatch : confirmed), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await wrapper.get('.recovery button').trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(wrapper.text()).not.toContain('NOW PLAYING')

    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(statusReads).toBeGreaterThanOrEqual(3)
    expect(wrapper.text()).toContain('NOW PLAYING')
    wrapper.unmount()
  })

  it('discovers a newer owned active party in an open tablet tab and shows its guest entry code', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'old-party', partyCode: 'OLD12345' }),
    )
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockImplementation(async (input) => {
        const url = String(input)
        calls.push(url)
        if (url.includes('/tablet/active')) {
          return new Response(
            JSON.stringify({
              party: {
                id: 'new-party',
                code: 'NEW12345',
                codeHint: '2345',
                status: 'active',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              },
            }),
            { status: 200 },
          )
        }
        return new Response(
          JSON.stringify(
            status({
              party: {
                id: 'new-party',
                code: 'NEW12345',
                codeHint: '2345',
                status: 'active',
                expiresAt: new Date(Date.now() + 3600000).toISOString(),
              },
            }),
          ),
          { status: 200 },
        )
      }),
    )
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(calls.some((url) => url.includes('/tablet/active'))).toBe(true)
    expect(wrapper.text()).toContain('Party NEW12345')
    expect(wrapper.text()).not.toContain('Party OLD12345')
    expect(wrapper.findComponent({ name: 'QrcodeVue' }).exists()).toBe(true)
    expect(sessionStorage.getItem('karaoke:tablet:session')).toContain('new-party')
  })

  it('isolates a late playback response from a newly discovered party and keeps its controls usable', async () => {
    vi.useFakeTimers()
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-a', partyCode: 'PARTYA01' }),
    )
    const parties: Record<string, { id: string; code: string; codeHint: string; status: string }> = {
      'party-a': { id: 'party-a', code: 'PARTYA01', codeHint: 'A001', status: 'active' },
      'party-b': { id: 'party-b', code: 'PARTYB02', codeHint: 'B002', status: 'active' },
    }
    const partyStatus = (partyId: string) => ({
      party: { ...parties[partyId], expiresAt: '2099-01-01T00:00:00Z' },
      queue: [
        {
          id: `${partyId}-queue`,
          sequence: 1,
          status: 'playing',
          song: {
            id: `${partyId}-song`,
            youtubeId: partyId === 'party-a' ? 'video-a' : 'video-b',
            title: partyId === 'party-a' ? 'Song A' : 'Song B',
            artist: 'Artist',
          },
        },
      ],
      controller: {
        connected: true,
        connectionState: 'connected',
        state: {
          playerState: 'paused',
          videoId: partyId === 'party-a' ? 'video-a' : 'video-b',
        },
      },
    })
    let activePartyId = 'party-a'
    let resolvePartyACommand: ((value: Response) => void) | undefined
    const playbackBodies: Record<string, unknown>[] = []
    const statusReads: string[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party: parties[activePartyId] }), { status: 200 })
      if (url.includes('/tablet/status')) {
        const partyId = new URL(url, 'http://localhost').searchParams.get('partyId') || ''
        statusReads.push(partyId)
        return new Response(JSON.stringify(partyStatus(partyId)), { status: 200 })
      }
      if (url.includes('/controller/playback')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        playbackBodies.push(body)
        if (body.partyId === 'party-a')
          return new Promise<Response>((resolve) => {
            resolvePartyACommand = resolve
          })
        return new Response(JSON.stringify({ id: 'command-b', status: 'completed' }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    const flush = async () => {
      await vi.advanceTimersByTimeAsync(0)
      await nextTick()
      await Promise.resolve()
    }
    try {
      await flush()
      expect(wrapper.text()).toContain('Party PARTYA01')
      await wrapper.get('.transport').trigger('click')
      await flush()
      expect(playbackBodies).toHaveLength(1)
      expect(playbackBodies[0]).toMatchObject({ partyId: 'party-a', action: 'play' })

      activePartyId = 'party-b'
      window.dispatchEvent(new Event('focus'))
      await flush()
      expect(wrapper.text()).toContain('Party PARTYB02')
      expect(wrapper.text()).toContain('Song B')
      expect(wrapper.get('.transport').text()).toContain('Play')

      await wrapper.get('.transport').trigger('click')
      await flush()
      expect(playbackBodies).toHaveLength(2)
      expect(playbackBodies[1]).toMatchObject({ partyId: 'party-b', action: 'play' })

      const readsBeforeLateResponse = [...statusReads]
      resolvePartyACommand!(
        new Response(JSON.stringify({ id: 'command-a', action: 'play', status: 'pending' }), {
          status: 201,
        }),
      )
      await flush()
      expect(sessionStorage.getItem('karaoke:tablet:session')).toContain('party-b')
      expect(sessionStorage.getItem('karaoke:tablet:pending-playback') || '').not.toContain('party-a')
      expect(wrapper.text()).toContain('Party PARTYB02')
      expect(wrapper.text()).toContain('Song B')

      await vi.advanceTimersByTimeAsync(1000)
      await nextTick()
      expect(statusReads.filter((partyId) => partyId === 'party-a')).toEqual(['party-a'])
      expect(statusReads.filter((partyId) => partyId === 'party-b')).toEqual(
        readsBeforeLateResponse.filter((partyId) => partyId === 'party-b'),
      )
    } finally {
      resolvePartyACommand?.(
        new Response(JSON.stringify({ id: 'command-a', action: 'play', status: 'pending' }), {
          status: 201,
        }),
      )
      wrapper.unmount()
    }
  })

  it('closes an A-party queue confirmation when discovery switches the tablet to party B', async () => {
    const parties: Record<string, { id: string; code: string; status: string }> = {
      'party-a': { id: 'party-a', code: 'PARTYA01', status: 'active' },
      'party-b': { id: 'party-b', code: 'PARTYB02', status: 'active' },
    }
    let activePartyId = 'party-a'
    const transitions: string[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party: parties[activePartyId] }), { status: 200 })
      if (url.includes('/tablet/status')) {
        const partyId = new URL(url, 'http://localhost').searchParams.get('partyId') || ''
        const party = parties[partyId as keyof typeof parties]
        return new Response(
          JSON.stringify({
            party: { ...party, expiresAt: '2099-01-01T00:00:00Z' },
            queue: [
              {
                id: `${partyId}-queue`,
                sequence: 1,
                status: 'playing',
                song: {
                  id: `${partyId}-song`,
                  youtubeId: 'dQw4w9WgXcQ',
                  title: partyId === 'party-a' ? 'Song A' : 'Song B',
                  artist: 'Artist',
                },
              },
            ],
            controller: null,
          }),
          { status: 200 },
        )
      }
      if (url.endsWith('/queue/transition')) {
        transitions.push(String(init?.body))
        return new Response(JSON.stringify({ status: 'completed' }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-a', partyCode: 'PARTYA01' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    try {
      await settle()
      await wrapper.get('.item-actions button').trigger('click')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)

      activePartyId = 'party-b'
      window.dispatchEvent(new Event('focus'))
      await settle()
      expect(wrapper.text()).toContain('Party PARTYB02')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(transitions).toHaveLength(0)
    } finally {
      wrapper.unmount()
    }
  })

  it('keeps a B queue action busy and its feedback intact when A transition resolves late', async () => {
    const parties: Record<string, { id: string; code: string; status: string }> = {
      'party-a': { id: 'party-a', code: 'PARTYA01', status: 'active' },
      'party-b': { id: 'party-b', code: 'PARTYB02', status: 'active' },
    }
    let activePartyId = 'party-a'
    let resolvePartyATransition: ((value: Response) => void) | undefined
    let resolvePartyBTransition: ((value: Response) => void) | undefined
    const transitionParties: string[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party: parties[activePartyId] }), { status: 200 })
      if (url.includes('/tablet/status')) {
        const partyId = new URL(url, 'http://localhost').searchParams.get('partyId') || ''
        const party = parties[partyId as keyof typeof parties]
        return new Response(
          JSON.stringify({
            party: { ...party, expiresAt: '2099-01-01T00:00:00Z' },
            queue: [
              {
                id: `${partyId}-queue`,
                sequence: 1,
                status: 'playing',
                song: {
                  id: `${partyId}-song`,
                  youtubeId: 'dQw4w9WgXcQ',
                  title: partyId === 'party-a' ? 'Song A' : 'Song B',
                  artist: 'Artist',
                },
              },
            ],
            controller: null,
          }),
          { status: 200 },
        )
      }
      if (url.endsWith('/queue/transition')) {
        const queueId = JSON.parse(String(init?.body)).queueId as string
        transitionParties.push(queueId)
        return new Promise<Response>((resolve) => {
          if (queueId === 'party-a-queue') resolvePartyATransition = resolve
          else resolvePartyBTransition = resolve
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-a', partyCode: 'PARTYA01' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
    try {
      await settle()
      await wrapper.get('.item-actions button').trigger('click')
      await wrapper.get('[role="dialog"] button:not(.quiet)').trigger('click')
      await settle()
      expect(transitionParties).toEqual(['party-a-queue'])

      activePartyId = 'party-b'
      window.dispatchEvent(new Event('focus'))
      await settle()
      expect(wrapper.text()).toContain('Party PARTYB02')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)

      await wrapper.get('.item-actions button').trigger('click')
      await wrapper.get('[role="dialog"] button:not(.quiet)').trigger('click')
      await settle()
      expect(transitionParties).toEqual(['party-a-queue', 'party-b-queue'])
      expect(wrapper.get('[role="dialog"] button:not(.quiet)').attributes('disabled')).toBeDefined()

      resolvePartyATransition!(
        new Response(JSON.stringify({ id: 'party-a-queue', status: 'completed' }), { status: 200 }),
      )
      await settle()
      expect(wrapper.text()).toContain('Party PARTYB02')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
      expect(wrapper.get('[role="dialog"] button:not(.quiet)').attributes('disabled')).toBeDefined()

      resolvePartyBTransition!(
        new Response(JSON.stringify({ id: 'party-b-queue', status: 'completed' }), { status: 200 }),
      )
      await settle()
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(wrapper.text()).toContain('Song marked complete.')
      expect(wrapper.text()).toContain('Party PARTYB02')
    } finally {
      resolvePartyATransition?.(
        new Response(JSON.stringify({ id: 'party-a-queue', status: 'completed' }), { status: 200 }),
      )
      resolvePartyBTransition?.(
        new Response(JSON.stringify({ id: 'party-b-queue', status: 'completed' }), { status: 200 }),
      )
      wrapper.unmount()
    }
  })

  it('shows pending separately and reuses the same idempotency key after an ambiguous request', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status()), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(new Response(JSON.stringify(status()), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: 'command-1', action: 'play', status: 'pending' }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(status()), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await settle()
    await wrapper.get('.transport').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Play requested — waiting for controller confirmation.')
    expect(sessionStorage.getItem('karaoke:tablet:pending-playback')).toContain('queue-1')
    expect(wrapper.get('.transport').attributes('disabled')).toBeUndefined()
    const firstInit = fetchMock.mock.calls[1]![1] as RequestInit
    const firstBody = JSON.parse(String(firstInit.body))
    await wrapper.get('.transport').trigger('click')
    await settle()
    const retryInit = fetchMock.mock.calls[3]![1] as RequestInit
    const retryBody = JSON.parse(String(retryInit.body))
    expect(retryBody.idempotencyKey).toBe(firstBody.idempotencyKey)
  })

  it('keeps transport disabled on video drift and offers an actionable recovery', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify(
            status({
              controller: {
                connected: true,
                connectionState: 'connected',
                state: { playerState: 'playing', videoId: 'other-video' },
              },
            }),
          ),
          { status: 200 },
        ),
      ),
    )
    const wrapper = mountPage()
    await settle()
    expect(wrapper.text()).toContain('Video mismatch')
    expect(wrapper.text()).toContain('SELECTED SONG')
    expect(wrapper.text()).not.toContain('NOW PLAYING')
    expect(wrapper.get('.transport').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.recovery button').text()).toBe('Retry selected video')
    expect(wrapper.get('.recovery button').attributes('disabled')).toBeUndefined()
  })

  it('reuses an ambiguous recovery key, then creates a new one after server expiry', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'other-video' } },
      })), { status: 200 }))
      .mockRejectedValueOnce(new TypeError('lost response'))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'other-video' } },
      })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'expired-command', action: 'open_video', status: 'pending', expiresAt: new Date(Date.now() - 1).toISOString(),
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'other-video' } },
      })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        id: 'new-command', action: 'open_video', status: 'pending', expiresAt: new Date(Date.now() + 60_000).toISOString(),
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({
        controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'other-video' } },
      })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await settle()

    await wrapper.get('.recovery button').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Playback was uncertain; retry will reuse the same request.')
    expect(wrapper.get('.recovery button').attributes('disabled')).toBeUndefined()
    const firstBody = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))

    await wrapper.get('.recovery button').trigger('click')
    await settle()
    const secondBody = JSON.parse(String((fetchMock.mock.calls[3]?.[1] as RequestInit).body))

    await wrapper.get('.recovery button').trigger('click')
    await settle()
    const thirdBody = JSON.parse(String((fetchMock.mock.calls[5]?.[1] as RequestInit).body))

    expect(firstBody).toMatchObject({ partyId: 'party-1', action: 'open_video' })
    expect(secondBody).toMatchObject({ partyId: 'party-1', action: 'open_video' })
    expect(secondBody.idempotencyKey).toBe(firstBody.idempotencyKey)
    expect(thirdBody.idempotencyKey).not.toBe(firstBody.idempotencyKey)
    expect(wrapper.text()).toContain('Video mismatch')
    expect(wrapper.text()).not.toContain('Playback confirmed')
  })

  it('offers simple no-party recovery and keeps advanced administration intentional', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    const wrapper = mountPage()
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    expect(wrapper.text()).toContain('No active party')
    expect(wrapper.get('button.quiet').text()).toBe('Advanced Admin')
    await wrapper.get('button.quiet').trigger('click')
    expect(window.confirm).toHaveBeenCalledWith(
      'Open Advanced Admin? Party controls stay available there.',
    )
  })

  it('confirms and prevents duplicate terminal queue transitions', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    let resolveTransition: ((value: Response) => void) | undefined
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status()), { status: 200 }))
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveTransition = resolve
          }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify(status({ queue: [] })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage({ attachTo: document.body })
    await settle()
    await wrapper.get('.item-actions button').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Complete this song?')
    expect(wrapper.get('main').attributes('inert')).toBeDefined()
    expect(wrapper.get('[role="dialog"]').element.closest('[inert]')).toBeNull()
    const confirm = wrapper.get('[role="dialog"] button:not(.quiet)')
    await confirm.trigger('click')
    await confirm.trigger('click')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    resolveTransition!(
      new Response(JSON.stringify({ id: 'queue-1', status: 'completed' }), { status: 200 }),
    )
    await settle()
    expect(document.activeElement).toBe(wrapper.get('#queue-drawer button.quiet').element)
  })

  it('returns focus to the queue action after cancelling a confirmation', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    vi.stubGlobal(
      'fetch',
      vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(JSON.stringify(status()), { status: 200 })),
    )
    const wrapper = mountPage({ attachTo: document.body })
    await settle()
    const complete = wrapper.get('.item-actions button')
    await complete.trigger('click')
    await wrapper.get('[role="dialog"] button.quiet').trigger('click')
    await nextTick()
    expect(document.activeElement).toBe(complete.element)
  })

  it('recovers an expired party without rendering an active transport action', async () => {
    sessionStorage.setItem(
      'karaoke:tablet:session',
      JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }),
    )
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify(
            status({
              party: {
                id: 'party-1',
                code: 'AB12CD34',
                expiresAt: new Date(Date.now() - 1).toISOString(),
                status: 'expired',
              },
            }),
          ),
          { status: 200 },
        ),
      ),
    )
    const wrapper = mountPage()
    await settle()
    expect(wrapper.text()).toContain('This party has expired')
    expect(wrapper.get('.transport').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).toContain('Create new party')
  })

  it('shows move controls only for queued songs and reconciles after reorder', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    const queued = [
      { id: 'queue-playing', sequence: 0, status: 'playing', song: { id: 'p', youtubeId: 'x'.repeat(11), title: 'Playing', artist: 'P' } },
      { id: 'queue-a', sequence: 1, status: 'queued', fairPosition: 1, song: { id: 'a', youtubeId: 'dQw4w9WgXcQ', title: 'First', artist: 'A' } },
      { id: 'queue-b', sequence: 2, status: 'queued', fairPosition: 2, song: { id: 'b', youtubeId: '9bZkp7q19f0', title: 'Second', artist: 'B' } },
    ]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status({ queue: queued, queueOrderRevision: 2, queueOrderDigest: 'digest-1' })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ moved: true, revision: 2, digest: 'digest-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({ queue: queued.slice().reverse(), queueOrderRevision: 2, queueOrderDigest: 'digest-2' })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await settle()
    expect(wrapper.findAll('.reorder-actions')).toHaveLength(2)
    expect(wrapper.findAll('.item-actions').some((node) => node.text().includes('Complete'))).toBe(true)
    expect(wrapper.findAll('.reorder-actions')[0]!.findAll('button')[0]!.attributes('disabled')).toBeDefined()
    await wrapper.findAll('.reorder-actions')[0]!.findAll('button')[1]!.trigger('click')
    await settle()
    const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
    expect(body).toMatchObject({ queueId: 'queue-a', direction: 'down', expectedRevision: 2, expectedDigest: 'digest-1' })
  })

  it('refetches and reports a stale reorder conflict', async () => {
    sessionStorage.setItem('karaoke:tablet:session', JSON.stringify({ token: 'tablet-token', partyId: 'party-1' }))
    const queued = [
      { id: 'queue-a', sequence: 1, status: 'queued', fairPosition: 1, song: { id: 'a', youtubeId: 'dQw4w9WgXcQ', title: 'First', artist: 'A' } },
      { id: 'queue-b', sequence: 2, status: 'queued', fairPosition: 2, song: { id: 'b', youtubeId: '9bZkp7q19f0', title: 'Second', artist: 'B' } },
    ]
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify(status({ queue: queued, queueOrderRevision: 2, queueOrderDigest: 'digest-1' })), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'stale_reorder', message: 'Queue reorder rejected' }), { status: 409 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(status({ queue: queued, queueOrderRevision: 3, queueOrderDigest: 'digest-3' })), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mountPage()
    await settle()
    await wrapper.findAll('.reorder-actions')[0]!.findAll('button')[1]!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('queue changed elsewhere')
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

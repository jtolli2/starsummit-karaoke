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
function mountPage() {
  return mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
}

describe('simplified tablet operator', () => {
  afterEach(() => {
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
    expect(wrapper.findComponent({ name: 'QrcodeVue' }).exists()).toBe(true)
    await wrapper.get('[aria-controls="queue-drawer"]').trigger('click')
    expect(wrapper.get('#queue-drawer').attributes('data-open')).toBe('true')
    expect(wrapper.text()).toContain('Song')
    expect(wrapper.text()).toContain('Party AB12CD34')
    await wrapper.get('#queue-drawer button.quiet').trigger('click')
    expect(wrapper.get('#queue-drawer').attributes('data-open')).toBe('false')
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

  it('disables transport and names video drift rather than implying controller success', async () => {
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
    expect(wrapper.get('.transport').attributes('disabled')).toBeDefined()
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
    const wrapper = mount(TabletPage, {
      attachTo: document.body,
      global: { stubs: { QrcodeVue: true } },
    })
    await settle()
    await wrapper.get('.item-actions button').trigger('click')
    expect(wrapper.get('[role="dialog"]').text()).toContain('Complete this song?')
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
    const wrapper = mount(TabletPage, {
      attachTo: document.body,
      global: { stubs: { QrcodeVue: true } },
    })
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
})

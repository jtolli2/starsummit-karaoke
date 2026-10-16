import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AdminPage from '@/pages/admin/index.vue'
import QrcodeVue from 'qrcode.vue'

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('advanced administration route', () => {
  it('defines sanitized mappings for every snapshot-save phase', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/pages/admin/index.vue'), 'utf8')
    for (const stage of ['identity', 'page', 'digest', 'ids', 'dates']) expect(source).toContain(`playlist_import_snapshot_${stage}_save_failed`)
  })
  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  it('retains catalog review under /admin after the simplified route is split out', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            songs: [
              {
                id: 'song-1',
                youtubeId: 'dQw4w9WgXcQ',
                title: 'Review song',
                artist: 'Review artist',
                reviewState: 'unreviewed',
              },
            ],
            totalPages: 1,
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            total: 1,
            unresolvedReviewBacklog: 1,
            missingIdentity: 0,
            alternatives: 0,
          }),
          { status: 200 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.catalog button.quiet').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Catalog review')
    expect(wrapper.text()).toContain('Review song')
    expect(fetchMock.mock.calls[2]?.[0]).toContain('/api/karaoke/tablet/catalog?review=unreviewed')
  })

  it('keeps queue acceptance separate from confirmed Now Playing state', async () => {
    const party = {
      id: 'party-start',
      code: 'START123',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }
    const item = {
      id: 'queue-start',
      sequence: 1,
      status: 'queued',
      song: { id: 'song-start', youtubeId: 'dQw4w9WgXcQ', title: 'Start Song', artist: 'Artist' },
    }
    let statusReads = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth-with-password'))
        return new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 })
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party }), { status: 200 })
      if (url.includes('/queue/next'))
        return new Response(JSON.stringify({ queue: item }), { status: 200 })
      if (url.endsWith('/queue/transition'))
        return new Response(JSON.stringify({ id: item.id, status: 'playing' }), { status: 200 })
      if (url.includes('/tablet/status')) {
        statusReads++
        const playing = { ...item, status: 'playing' }
        const controller =
          statusReads < 5
            ? {
                connected: true,
                connectionState: 'connected',
                state: { playerState: 'IDLE', videoId: '' },
              }
            : {
                connected: true,
                connectionState: 'connected',
                state: { playerState: 'playing', videoId: item.song.youtubeId },
              }
        return new Response(
          JSON.stringify({ party, queue: statusReads === 1 ? [item] : [playing], controller }),
          { status: 200 },
        )
      }
      if (url.endsWith('/controller/pairing'))
        return new Response(JSON.stringify({ state: 'none' }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Play next')!
      .trigger('click')
    await settle()

    expect(wrapper.text()).toContain('Waiting for controller playback confirmation…')
    expect(wrapper.text()).not.toContain('Start Song is now playing.')
    expect(wrapper.text()).toContain('Start Song started in the queue; waiting for TV confirmation.')
    wrapper.unmount()
  })

  it('does not transition a party-A preview that resolves after discovery switches to party B', async () => {
    const parties: Record<string, { id: string; code: string; status: string; expiresAt: string }> = {
      'party-a': {
        id: 'party-a',
        code: 'PARTYA01',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      'party-b': {
        id: 'party-b',
        code: 'PARTYB02',
        status: 'active',
        expiresAt: '2099-01-02T00:00:00Z',
      },
    }
    const queueA = {
      id: 'queue-a',
      sequence: 1,
      status: 'queued',
      song: { id: 'song-a', youtubeId: 'video-a', title: 'Party A song', artist: 'Artist' },
    }
    let activePartyId = 'party-a'
    let resolvePartyAPreview: ((value: Response) => void) | undefined
    const transitions: Record<string, unknown>[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth-with-password'))
        return new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 })
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party: parties[activePartyId] }), { status: 200 })
      if (url.includes('/tablet/status')) {
        const partyId = new URL(url, 'http://localhost').searchParams.get('partyId') || ''
        const party = parties[partyId]
        const queue =
          partyId === 'party-a'
            ? [queueA]
            : [
                {
                  ...queueA,
                  id: 'queue-b',
                  status: 'playing',
                  song: { ...queueA.song, id: 'song-b', youtubeId: 'video-b', title: 'Party B song' },
                },
              ]
        return new Response(
          JSON.stringify({
            party,
            queue,
            controller: {
              connected: true,
              connectionState: 'connected',
              state: {
                playerState: 'paused',
                videoId: partyId === 'party-a' ? 'video-a' : 'video-b',
              },
            },
          }),
          { status: 200 },
        )
      }
      if (url.includes('/queue/next'))
        return new Promise<Response>((resolve) => {
          resolvePartyAPreview = resolve
        })
      if (url.endsWith('/queue/transition')) {
        transitions.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response(JSON.stringify({ id: 'queue-a', status: 'playing' }), { status: 200 })
      }
      if (url.endsWith('/controller/pairing'))
        return new Response(JSON.stringify({ state: 'none' }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    try {
      await wrapper.get('#identity').setValue('tablet@example.test')
      await wrapper.get('#password').setValue('secret')
      await wrapper.get('form').trigger('submit')
      await settle()
      expect(wrapper.text()).toContain('PARTYA01')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Play next')!
        .trigger('click')
      await settle()
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/queue/next'))).toBe(
        true,
      )
      expect(transitions).toHaveLength(0)

      activePartyId = 'party-b'
      window.dispatchEvent(new Event('focus'))
      await settle()
      expect(wrapper.text()).toContain('PARTYB02')
      expect(wrapper.text()).not.toContain('PARTYA01')

      resolvePartyAPreview!(new Response(JSON.stringify({ queue: queueA }), { status: 200 }))
      await settle()
      expect(transitions).toHaveLength(0)
      expect(wrapper.text()).toContain('PARTYB02')
      expect(wrapper.text()).not.toContain('Party A song is now playing.')
    } finally {
      resolvePartyAPreview?.(new Response(JSON.stringify({ queue: queueA }), { status: 200 }))
      wrapper.unmount()
    }
  })

  it('clears an A-party failure confirmation when active-party discovery switches to B', async () => {
    const parties: Record<string, { id: string; code: string; status: string; expiresAt: string }> = {
      'party-a': {
        id: 'party-a',
        code: 'PARTYA01',
        status: 'active',
        expiresAt: '2099-01-01T00:00:00Z',
      },
      'party-b': {
        id: 'party-b',
        code: 'PARTYB02',
        status: 'active',
        expiresAt: '2099-01-02T00:00:00Z',
      },
    }
    let activePartyId = 'party-a'
    const transitions: string[] = []
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth-with-password'))
        return new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 })
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party: parties[activePartyId] }), { status: 200 })
      if (url.includes('/tablet/status')) {
        const partyId = new URL(url, 'http://localhost').searchParams.get('partyId') || ''
        const party = parties[partyId]
        const queue = {
          id: `${partyId}-queue`,
          sequence: 1,
          status: 'playing',
          song: { id: `${partyId}-song`, youtubeId: 'video-a', title: 'Current song', artist: 'Artist' },
        }
        return new Response(
          JSON.stringify({
            party,
            queue: [queue],
            controller: { connected: true, connectionState: 'connected', state: { playerState: 'paused', videoId: 'video-a' } },
          }),
          { status: 200 },
        )
      }
      if (url.endsWith('/queue/transition')) {
        transitions.push(JSON.parse(String(init?.body)).queueId as string)
        return new Response(JSON.stringify({ status: 'failed' }), { status: 200 })
      }
      if (url.endsWith('/controller/pairing'))
        return new Response(JSON.stringify({ state: 'none' }), { status: 200 })
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    try {
      await wrapper.get('#identity').setValue('tablet@example.test')
      await wrapper.get('#password').setValue('secret')
      await wrapper.get('form').trigger('submit')
      await settle()
      expect(wrapper.text()).toContain('PARTYA01')
      await wrapper
        .findAll('button')
        .find((button) => button.text() === 'Skip / fail')!
        .trigger('click')
      expect(wrapper.get('[role="dialog"]').text()).toContain('Skip this song?')

      activePartyId = 'party-b'
      window.dispatchEvent(new Event('focus'))
      await settle()
      expect(wrapper.text()).toContain('PARTYB02')
      expect(wrapper.text()).not.toContain('PARTYA01')
      expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
      expect(transitions).toHaveLength(0)
    } finally {
      wrapper.unmount()
    }
  })

  it('polls for authoritative Pause confirmation promptly after the command is accepted', async () => {
    vi.useFakeTimers()
    const party = {
      id: 'party-pause',
      code: 'PAUSE123',
      status: 'active',
      expiresAt: '2099-01-01T00:00:00Z',
    }
    const item = {
      id: 'queue-pause',
      sequence: 1,
      status: 'playing',
      song: { id: 'song-pause', youtubeId: 'dQw4w9WgXcQ', title: 'Pause Song', artist: 'Artist' },
    }
    let statusReads = 0
    let pauseAccepted = false
    let readsAfterPause = 0
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input) => {
      const url = String(input)
      if (url.endsWith('/auth-with-password'))
        return new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 })
      if (url.endsWith('/tablet/active'))
        return new Response(JSON.stringify({ party }), { status: 200 })
      if (url.includes('/controller/playback')) {
        pauseAccepted = true
        return new Response(
          JSON.stringify({ id: 'pause-command', action: 'pause', status: 'pending' }),
          { status: 201 },
        )
      }
      if (url.includes('/tablet/status')) {
        statusReads++
        if (pauseAccepted) readsAfterPause++
        const paused = pauseAccepted && readsAfterPause > 1
        const controller = {
          connected: true,
          connectionState: 'connected',
          state: { playerState: paused ? 'paused' : 'playing', videoId: item.song.youtubeId },
        }
        return new Response(JSON.stringify({ party, queue: [item], controller }), { status: 200 })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    await wrapper
      .findAll('.playback-controls button')
      .find((button) => button.text() === 'Pause')!
      .trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()
    expect(wrapper.text()).toContain('Pause request pending.')
    const readsAfterAcceptance = statusReads

    await vi.advanceTimersByTimeAsync(1000)
    await nextTick()
    expect(statusReads).toBeGreaterThan(readsAfterAcceptance)
    expect(wrapper.text()).not.toContain('Pause request pending.')
    expect(wrapper.text()).toContain('Controllerconnected · paused')
    wrapper.unmount()
  })

  it('keeps the newest created party through a late discovery response and restores its code on a fresh sign-in', async () => {
    const parties = [
      { id: 'party-one', code: 'PARTY001', status: 'active', expiresAt: '2099-01-01T00:00:00Z' },
      { id: 'party-two', code: 'PARTY002', status: 'active', expiresAt: '2099-01-02T00:00:00Z' },
    ]
    const staleParty = { ...parties[0] }
    let currentParty: (typeof parties)[number] | null = null
    let activeReads = 0
    let releaseStale: ((response: Response) => void) | undefined
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async (input, init) => {
      const url = String(input)
      if (url.endsWith('/auth-with-password'))
        return new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 })
      if (url.endsWith('/tablet/active')) {
        activeReads++
        if (activeReads === 2)
          return new Promise<Response>((resolve) => {
            releaseStale = resolve
          })
        return new Response(JSON.stringify({ party: currentParty }), { status: 200 })
      }
      if (url.endsWith('/api/karaoke/parties') && init?.method === 'POST') {
        currentParty = parties.shift() || null
        return new Response(JSON.stringify(currentParty), { status: 201 })
      }
      if (url.includes('/tablet/status') && currentParty) {
        return new Response(JSON.stringify({ party: currentParty, queue: [], controller: null }), {
          status: 200,
        })
      }
      return new Response(JSON.stringify({}), { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create party')!
      .trigger('click')
    await settle()
    expect(wrapper.text()).toContain('PARTY001')

    window.dispatchEvent(new Event('focus'))
    await nextTick()
    await wrapper
      .findAll('button')
      .find((button) => button.text() === 'Create another party')!
      .trigger('click')
    await settle()
    expect(wrapper.text()).toContain('PARTY002')
    releaseStale!(new Response(JSON.stringify({ party: staleParty }), { status: 200 }))
    await settle()
    expect(wrapper.text()).toContain('PARTY002')
    expect(wrapper.text()).not.toContain('PARTY001')
    expect(wrapper.findAllComponents(QrcodeVue).length).toBeGreaterThan(0)
    expect(wrapper.findComponent(QrcodeVue).props('value')).toContain('/party/PARTY002')
    wrapper.unmount()

    sessionStorage.clear()
    currentParty = {
      id: 'party-two',
      code: 'PARTY002',
      status: 'active',
      expiresAt: '2099-01-02T00:00:00Z',
    }
    activeReads = 2
    const reload = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await reload.get('#identity').setValue('tablet@example.test')
    await reload.get('#password').setValue('secret')
    await reload.get('form').trigger('submit')
    await settle()
    expect(reload.text()).toContain('PARTY002')
    expect(reload.findAllComponents(QrcodeVue).length).toBeGreaterThan(0)
    expect(reload.findComponent(QrcodeVue).props('value')).toContain('/party/PARTY002')
  })

  it('searches YouTube titles while retaining review filters and shows a title-aware empty state', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], page: 1, totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], page: 1, totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 0, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.catalog button.quiet').trigger('click')
    await settle()
    await wrapper.get('#catalog-youtube-title').setValue('Live + Karaoke?')
    await wrapper.get('#catalog-youtube-title').trigger('keyup.enter')
    await settle()
    expect(String(fetchMock.mock.calls[4]?.[0])).toContain('review=unreviewed')
    expect(new URL(String(fetchMock.mock.calls[4]?.[0]), 'https://example.test').searchParams.get('videoTitle')).toBe('Live + Karaoke?')
    expect(wrapper.text()).toContain('No songs match YouTube title “Live + Karaoke?”.')
  })

  it('flags approved rows that no longer satisfy authoritative approval policy and removes approval affordances', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [{
        id: 'song-invalid', youtubeId: 'dQw4w9WgXcQ', title: 'Dubious', artist: 'Artist',
        reviewState: 'approved', classification: 'karaoke', classificationConfidence: 0.99,
        identityStatus: 'verified_source', eligible: false, approvalReason: 'identity_conflict',
      }], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.catalog button.quiet').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Approved record is currently invalid for playback policy')
    expect(wrapper.text()).toContain('identity conflicts with another catalog song')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Approve')).toBe(false)
  })

  it('distinguishes canonical identity conflicts from catalog save failures', async () => {
    const conflict = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [{ id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Old', artist: 'Artist', reviewState: 'unreviewed', identityStatus: 'missing' }], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 1, missingIdentity: 1, alternatives: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'identity_conflict', message: 'private detail' }), { status: 409 }))
    vi.stubGlobal('fetch', conflict)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('.catalog button.quiet').trigger('click')
    await settle()
    await wrapper.find('input[aria-label="Canonical title"]').setValue('Taken title')
    await wrapper.find('input[aria-label="Canonical artist"]').setValue('Taken artist')
    await wrapper.find('input[aria-label="Correction reason"]').setValue('operator review')
    await wrapper.findAll('button').find((button) => button.text() === 'Save identity')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Identity conflict:')
    expect(wrapper.text()).not.toContain('private detail')

    sessionStorage.clear()
    const saveFailure = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [{ id: 'song-1', youtubeId: 'dQw4w9WgXcQ', title: 'Old', artist: 'Artist', reviewState: 'unreviewed', identityStatus: 'missing' }], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 1, missingIdentity: 1, alternatives: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'identity_correction_failed', message: 'schema detail' }), { status: 500 }))
    vi.stubGlobal('fetch', saveFailure)
    const second = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await second.get('#identity').setValue('tablet@example.test')
    await second.get('#password').setValue('secret')
    await second.get('form').trigger('submit')
    await settle()
    await second.get('.catalog button.quiet').trigger('click')
    await settle()
    await second.find('input[aria-label="Canonical title"]').setValue('New title')
    await second.find('input[aria-label="Canonical artist"]').setValue('New artist')
    await second.find('input[aria-label="Correction reason"]').setValue('operator review')
    await second.findAll('button').find((button) => button.text() === 'Save identity')!.trigger('click')
    await settle()
    expect(second.text()).toContain('catalog storage rejected the change')
  })

  it('creates a one-time controller link and polls sanitized enrollment status', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-1', token: 'opaque-grant', shortCode: '482901', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Manual fallback code:')
    expect(wrapper.text()).toContain('482901')
    expect(wrapper.html()).not.toContain('opaque-grant')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/karaoke/controllers/enrollment-grants')
    expect(JSON.parse(String((fetchMock.mock.calls[2]?.[1] as RequestInit).body))).toEqual({
      expectedServerHost: window.location.hostname,
      destination: 'controller',
    })
    expect(fetchMock.mock.calls[3]?.[0]).toBe('/api/karaoke/controllers/enrollment-grants/grant-1')
  })

  it('persists only pairing metadata and hydrates the same grant after reload', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-reload', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()

    const stored = JSON.parse(sessionStorage.getItem('karaoke:tablet:pairing') || '{}')
    expect(stored).toEqual({ id: 'grant-reload', expiresAt: '2099-01-01T00:00:00Z', state: 'pending' })
    expect(JSON.stringify(stored)).not.toMatch(/token|shortCode|deepLink|opaque-grant/i)

    wrapper.unmount()
    const reloadFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', reloadFetch)
    const reloaded = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await settle()
    expect(reloaded.text()).toContain('waiting for companion')
    expect(String(reloadFetch.mock.calls[1]?.[0])).toContain('/enrollment-grants/grant-reload')
    expect(JSON.stringify(reloadFetch.mock.calls)).not.toMatch(/opaque-grant|ABCDEFGHIJKLMNOP|deepLink/i)
  })

  it('keeps one issued grant shared by easy-open, QR, and manual fallback surfaces', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-shared', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z', apiBaseUrl: 'https://karaoke-test.app.starsummit.net' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'issued', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()

    expect(wrapper.text()).toContain('One grant, three options:')
    expect(wrapper.text()).toContain('Open Starsummit companion')
    expect(wrapper.text()).toContain('ABCDEFGHIJKLMNOP')
    expect(wrapper.findAllComponents(QrcodeVue).length).toBeGreaterThan(0)
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).includes('enrollment-grants')).length).toBe(2)
    expect(sessionStorage.getItem('karaoke:tablet:pairing')).toContain('grant-shared')
    expect(wrapper.html()).not.toContain('opaque-grant')
    await wrapper.findAll('button').find((button) => button.text() === 'Open Starsummit companion')!.trigger('click')
    expect(wrapper.text()).toContain('ABCDEFGHIJKLMNOP')
  })

  it('binds the exact redeemed device and requires authoritative connected refresh before success', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: { id: 'party-1', code: 'ABCD', expiresAt: '2099-01-01T00:00:00Z' } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: { id: 'party-1', code: 'ABCD', expiresAt: '2099-01-01T00:00:00Z' }, queue: [], controller: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-connect', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'connected', expiresAt: '2099-01-01T00:00:00Z', device: { id: 'device-exact', name: 'Fire tablet' }, sessionActive: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ bound: true, partyId: 'party-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: { id: 'party-1', code: 'ABCD', expiresAt: '2099-01-01T00:00:00Z' }, queue: [], controller: { connected: true, connectionState: 'connected', device: { id: 'device-exact', name: 'Fire tablet' }, state: { playerState: 'IDLE', observedAt: '2099-01-01T00:00:00Z' } } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()

    const bindCall = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/api/karaoke/tablet/controller/bind'))
    expect(bindCall).toBeTruthy()
    expect(JSON.parse(String((bindCall?.[1] as RequestInit).body))).toEqual({ partyId: 'party-1', deviceId: 'device-exact' })
    expect(wrapper.text()).toContain('Controller connected')
    expect(wrapper.text()).not.toContain('ABCDEFGHIJKLMNOP')
    expect(wrapper.text()).not.toContain('Retry pairing confirmation')
    expect(sessionStorage.getItem('karaoke:tablet:pairing')).toBeNull()
  })

  it('keeps unavailable pairing retryable and does not bind without a device or party', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-retry', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'connected', expiresAt: '2099-01-01T00:00:00Z', device: null }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Pairing status: temporarily unavailable')
    expect(wrapper.text()).toContain('Retry pairing confirmation')
    expect(fetchMock.mock.calls.some((call) => String(call[0]).endsWith('/controller/bind'))).toBe(false)
    expect(sessionStorage.getItem('karaoke:tablet:pairing')).toContain('grant-retry')
  })

  it('maps transient status failure to an actionable retry and then returns to pending', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-error', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporary', message: 'private server detail' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Pairing status: temporarily unavailable')
    expect(wrapper.text()).not.toContain('private server detail')
    await wrapper.findAll('button').find((button) => button.text() === 'Retry pairing confirmation')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('waiting for companion')
  })

  it('clears pairing metadata and secrets on terminal sign-out', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'grant-signout', token: 'opaque-grant', shortCode: 'ABCDEFGHIJKLMNOP', expiresAt: '2099-01-01T00:00:00Z' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ state: 'pending', expiresAt: '2099-01-01T00:00:00Z' }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Create one-tap pairing link')!.trigger('click')
    await settle()
    const pairingBeforeSignOut = sessionStorage.getItem('karaoke:tablet:pairing')
    expect(pairingBeforeSignOut).toBeTruthy()
    expect(pairingBeforeSignOut).toContain('grant-signout')
    await wrapper.findAll('button').find((button) => button.text() === 'Sign out')!.trigger('click')
    expect(sessionStorage.getItem('karaoke:tablet:pairing')).toBeNull()
    expect(wrapper.text()).toContain('Sign in')
  })

  it('previews a pasted public playlist and requires explicit confirmation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ playlist: { id: 'PL1', title: 'Public Mix', visibility: 'public', itemCount: 2 }, owner: { channelId: 'UC1', title: 'Owner' }, expectedItems: 2, trust: 'unknown_public', confirmationToken: 'opaque', modeledCost: { total: 3 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#public-playlist').setValue('https://www.youtube.com/playlist?list=PL1')
    await wrapper.get('#public-playlist + button').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Public Mix')
    expect(wrapper.text()).toContain('Review import confirmation')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/karaoke/tablet/catalog/playlists/import')
  })

  it('previews public playlist continuation pages explicitly', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ playlist: { id: 'PL1', title: 'Public Mix', visibility: 'public', itemCount: 50 }, expectedItems: 25, nextPageToken: 'NEXT', confirmationToken: 'opaque', snapshotFingerprint: 'fp', modeledCost: { total: 3 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ playlist: { id: 'PL1', title: 'Public Mix', visibility: 'public', itemCount: 50 }, expectedItems: 25, nextPageToken: '', confirmationToken: 'opaque2', snapshotFingerprint: 'fp2', modeledCost: { total: 3 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#public-playlist').setValue('PL1')
    await wrapper.get('#public-playlist + button').trigger('click')
    await settle()
    const nextPageButton = wrapper.findAll('button.quiet').find((button) => button.text() === 'Preview next page')
    expect(nextPageButton).toBeTruthy()
    await nextPageButton!.trigger('click')
    await settle()
    expect(JSON.parse(String(fetchMock.mock.calls[3]?.[1]?.body)).pageToken).toBe('NEXT')
    expect(wrapper.text()).toContain('Review import confirmation')
  })

  it('shows actionable sanitized trusted-playlist preview errors', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ error: 'playlist_source_key_invalid', message: 'internal detail omitted' }),
          { status: 422 },
        ),
      )
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('bad')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    expect(wrapper.text()).toContain('valid source key')
    expect(wrapper.text()).not.toContain('internal detail omitted')
  })

  it.each([
    ['playlist_snapshot_not_found', 'retained preview is no longer available'],
    ['playlist_revalidation_in_progress', 'revalidation is already running'],
  ])('maps %s to actionable sanitized wording', async (code, wording) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: code, message: 'secret detail' }), { status: 409 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCchannel:PLplaylist')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    expect(wrapper.text().toLowerCase()).toContain(wording)
    expect(wrapper.text()).not.toContain('secret detail')
  })

  it('keeps playlist pagination preview-bound and forwards the returned continuation token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCchannel:PLplaylist', channelName: 'Channel' }, expectedItems: 1, pageToken: '', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { playlistsList: 1, playlistItemsList: 1, videosList: 1, total: 3 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, duplicates: 0, unavailable: 0, nextPageToken: 'page-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCchannel:PLplaylist', channelName: 'Channel' }, expectedItems: 1, pageToken: 'page-2', nextPageToken: '', snapshotFingerprint: 'b'.repeat(64), modeledCost: { playlistsList: 0, playlistItemsList: 1, videosList: 1, total: 2 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCchannel:PLplaylist')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Import preview page')!.trigger('click')
    await settle()
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Preview next page')!.trigger('click')
    await settle()
    const previewBody = JSON.parse(String((fetchMock.mock.calls[6]?.[1] as RequestInit).body))
    expect(previewBody).toEqual({ sourceKey: 'UCchannel:PLplaylist', maxItems: 25, pageToken: 'page-2', dryRun: true })
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(false)
  })

  it('does not show a next-page control when an import returns the final page', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCchannel:PLplaylist' }, expectedItems: 1, pageToken: '', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, duplicates: 0, unavailable: 0, nextPageToken: '' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCchannel:PLplaylist')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Import preview page')!.trigger('click')
    await settle()
    expect(wrapper.text()).not.toContain('Preview next page')
    expect(wrapper.text()).toContain('This was the final page.')
  })

  it('invalidates a continuation when the playlist source is edited', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCone:PLone' }, expectedItems: 1, pageToken: '', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, duplicates: 0, unavailable: 0, nextPageToken: 'page-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCone:PLone')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Import preview page')!.trigger('click')
    await settle()
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(true)
    await wrapper.get('#playlist-source').setValue('UCtwo:PLtwo')
    await settle()
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(false)
  })

  it('preserves the bound continuation for a transient next-page preview failure and retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCone:PLone' }, expectedItems: 1, pageToken: '', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 1, duplicates: 0, unavailable: 0, nextPageToken: 'page-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'youtube_network_error', message: 'secret detail' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCone:PLone' }, expectedItems: 1, pageToken: 'page-2', nextPageToken: '', snapshotFingerprint: 'b'.repeat(64), modeledCost: { total: 1 } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCone:PLone')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Import preview page')!.trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Preview next page')!.trigger('click')
    await settle()
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(true)
    await wrapper.findAll('button').find((button) => button.text() === 'Preview next page')!.trigger('click')
    await settle()
    const retryBody = JSON.parse(String((fetchMock.mock.calls[7]?.[1] as RequestInit).body))
    expect(retryBody).toEqual({ sourceKey: 'UCone:PLone', maxItems: 25, pageToken: 'page-2', dryRun: true })
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(false)
  })

  it('handles sparse unavailable reasons on a successful replay and retains continuation', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: 'tablet-token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ party: null }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: { sourceKey: 'UCone:PLone' }, expectedItems: 1, pageToken: '', nextPageToken: '', snapshotFingerprint: 'a'.repeat(64), modeledCost: { total: 1 } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ imported: 0, duplicates: 0, unavailable: 0, unavailableReasons: {}, nextPageToken: 'page-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ songs: [], totalPages: 1 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ total: 1, unresolvedReviewBacklog: 0, missingIdentity: 0, alternatives: 0 }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const wrapper = mount(AdminPage, { global: { stubs: { QrcodeVue: true } } })
    await wrapper.get('#identity').setValue('tablet@example.test')
    await wrapper.get('#password').setValue('secret')
    await wrapper.get('form').trigger('submit')
    await settle()
    await wrapper.get('#playlist-source').setValue('UCone:PLone')
    await wrapper.get('#playlist-source + button').trigger('click')
    await settle()
    await wrapper.findAll('button').find((button) => button.text() === 'Import preview page')!.trigger('click')
    await settle()
    expect(wrapper.text()).toContain('Preview next page when ready.')
    expect(wrapper.findAll('button').some((button) => button.text() === 'Preview next page')).toBe(true)
  })
})

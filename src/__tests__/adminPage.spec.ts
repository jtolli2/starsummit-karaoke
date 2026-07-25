import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AdminPage from '@/pages/admin/index.vue'

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

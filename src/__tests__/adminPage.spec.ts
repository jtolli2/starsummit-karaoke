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
})

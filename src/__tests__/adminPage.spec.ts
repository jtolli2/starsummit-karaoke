import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import AdminPage from '@/pages/admin/index.vue'

async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}

describe('advanced administration route', () => {
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
})

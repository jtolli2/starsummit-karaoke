import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import TabletPage from '@/pages/tablet/index.vue'

const originalCapture = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'setPointerCapture')
const originalElementFromPoint = Object.getOwnPropertyDescriptor(document, 'elementFromPoint')

const playing = {
  id: 'playing',
  sequence: 1,
  status: 'playing',
  song: { id: 'p', youtubeId: 'dQw4w9WgXcQ', title: 'Playing song', artist: 'P' },
}
const first = {
  id: 'first',
  sequence: 2,
  status: 'queued',
  fairPosition: 1,
  song: { id: 'a', youtubeId: '9bZkp7q19f0', title: 'First song', artist: 'A' },
}
const second = {
  id: 'second',
  sequence: 3,
  status: 'queued',
  fairPosition: 2,
  song: { id: 'b', youtubeId: 'J---aiyznGQ', title: 'Second song', artist: 'B' },
}
function snapshot(reordered = false) {
  return {
    party: {
      id: 'party-1',
      code: 'AB12CD34',
      status: 'active',
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    },
    queue: reordered
      ? [
          playing,
          { ...second, sequence: 2, fairPosition: 1 },
          { ...first, sequence: 3, fairPosition: 2 },
        ]
      : [playing, first, second],
    queueOrderRevision: 3,
    queueOrderDigest: reordered ? 'new-digest' : 'old-digest',
    controller: null,
  }
}
function response(value: unknown) {
  return new Response(JSON.stringify(value), { status: 200 })
}
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await nextTick()
}
afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  if (originalCapture)
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', originalCapture)
  else Reflect.deleteProperty(HTMLElement.prototype, 'setPointerCapture')
  if (originalElementFromPoint)
    Object.defineProperty(document, 'elementFromPoint', originalElementFromPoint)
  else Reflect.deleteProperty(document, 'elementFromPoint')
})

it('waits for an authoritative order after a reorder overlaps an older status read', async () => {
  sessionStorage.setItem(
    'karaoke:tablet:session',
    JSON.stringify({ token: 'local-fixture', partyId: 'party-1' }),
  )
  let releaseOld!: (value: Response) => void
  let releaseFresh!: (value: Response) => void
  const oldRead = new Promise<Response>((resolve) => {
    releaseOld = resolve
  })
  const freshRead = new Promise<Response>((resolve) => {
    releaseFresh = resolve
  })
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(snapshot()))
    .mockReturnValueOnce(oldRead)
    .mockResolvedValueOnce(response({ moved: true, revision: 3, digest: 'new-digest' }))
    .mockReturnValueOnce(freshRead)
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
  try {
    await settle()
    window.dispatchEvent(new Event('focus'))
    await settle()
    await wrapper.get('[aria-label="Move First song down"]').trigger('click')
    await settle()
    releaseOld(response(snapshot()))
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(wrapper.get('[aria-label="Move First song down"]').attributes('disabled')).toBeDefined()
    expect(wrapper.text()).not.toContain('Queue order updated.')
    releaseFresh(response(snapshot(true)))
    await settle()
    expect(wrapper.findAll('#queue-drawer li strong').map((node) => node.text())).toEqual([
      'Playing song',
      'Second song',
      'First song',
    ])
    expect(wrapper.text()).toContain('Queue order updated.')
  } finally {
    releaseOld(response(snapshot()))
    releaseFresh(response(snapshot(true)))
    wrapper.unmount()
  }
})

const queuedIds = ['a', 'b', 'c', 'd']
const songTitles: Record<string, string> = { a: 'Song A', b: 'Song B', c: 'Song C', d: 'Song D' }
function queueSnapshot(ids: string[], revision = 4, digest = 'order-before') {
  return {
    ...snapshot(),
    queue: [
      playing,
      ...ids.map((id, index) => ({
        id: `queue-${id}`,
        sequence: index + 2,
        status: 'queued',
        fairPosition: index + 1,
        song: { id, youtubeId: '9bZkp7q19f0', title: songTitles[id] || `Song ${id}`, artist: id },
      })),
    ],
    queueOrderRevision: revision,
    queueOrderDigest: digest,
  }
}

async function mountReorderPage(fetchMock: ReturnType<typeof vi.fn>) {
  sessionStorage.setItem(
    'karaoke:tablet:session',
    JSON.stringify({ token: 'local-fixture', partyId: 'party-1' }),
  )
  vi.stubGlobal('fetch', fetchMock)
  const wrapper = mount(TabletPage, { global: { stubs: { QrcodeVue: true } } })
  await settle()
  return wrapper
}

function installPointerHelpers(target: Element | null) {
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', {
    configurable: true,
    value: vi.fn(),
  })
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => target),
  })
}

function sendPointer(target: Element, type: string, pointerId: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  for (const [key, value] of Object.entries({
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    button: 0,
    clientX: 10,
    clientY: 20,
  })) {
    Object.defineProperty(event, key, { value })
  }
  target.dispatchEvent(event)
}

it('reports uncertainty when reorder succeeds but its authoritative read fails', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
    .mockResolvedValueOnce(response({ moved: true, revision: 5, digest: 'order-after' }))
    .mockResolvedValueOnce(new Response('{}', { status: 503 }))
  const wrapper = await mountReorderPage(fetchMock)
  try {
    await wrapper.get('[aria-label="Move Song A down"]').trigger('click')
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(wrapper.get('[role="status"]').attributes('data-error')).toBe('true')
    expect(wrapper.text()).toContain(
      'Queue change saved, but the latest order could not be confirmed.',
    )
    expect(wrapper.text()).not.toContain('Queue order updated.')
  } finally {
    wrapper.unmount()
  }
})

it.each([
  { refreshed: true, expected: ['a', 'guest', 'b', 'c', 'd'] },
  { refreshed: false, expected: null },
])(
  'reconciles a stale reorder from a fresh read or reports uncertainty',
  async ({ refreshed, expected }) => {
    const authoritative = queueSnapshot(expected || queuedIds, 5, 'guest-added')
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'stale_reorder', message: 'Queue order changed' }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(
        refreshed ? response(authoritative) : new Response('{}', { status: 503 }),
      )
    const wrapper = await mountReorderPage(fetchMock)
    try {
      await wrapper.get('[aria-label="Move Song A down"]').trigger('click')
      await settle()
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(wrapper.get('[role="status"]').attributes('data-error')).toBe('true')
      expect(wrapper.text()).not.toContain('Queue order updated.')
      if (refreshed) {
        expect(
          wrapper.findAll('#queue-drawer li').map((row) => row.attributes('data-queue-id')),
        ).toEqual(['playing', ...expected!.map((id) => `queue-${id}`)])
        expect(wrapper.text()).toContain('The queue changed elsewhere. The latest order is shown.')
      } else {
        expect(wrapper.text()).toContain(
          'Queue order is uncertain because the latest state could not be loaded.',
        )
      }
    } finally {
      wrapper.unmount()
    }
  },
)

it.each([
  { moving: 'a', target: 'd', expected: ['b', 'c', 'd', 'a'], side: 'drop-after' },
  { moving: 'd', target: 'a', expected: ['d', 'a', 'b', 'c'], side: 'drop-before' },
])(
  'places a dragged row at the target prior index with one target request',
  async ({ moving, target, expected, side }) => {
    const originalIds = [...queuedIds]
    const finalIds = expected
    const targetSelector = `[data-queue-id="queue-${target}"]`
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(queueSnapshot(originalIds)))
      .mockResolvedValueOnce(response({ moved: true, revision: 5, digest: 'order-after' }))
      .mockResolvedValueOnce(response(queueSnapshot(finalIds, 5, 'order-after')))
    const wrapper = await mountReorderPage(fetchMock)
    const targetRow = wrapper.get(targetSelector).element
    installPointerHelpers(targetRow)
    try {
      const handle = wrapper.get(`[data-queue-id="queue-${moving}"] .reorder-handle`)
      sendPointer(handle.element, 'pointerdown', 14)
      sendPointer(handle.element, 'pointermove', 14)
      await nextTick()
      expect(targetRow.classList.contains(side)).toBe(true)
      sendPointer(handle.element, 'pointerup', 14)
      await settle()

      expect(fetchMock).toHaveBeenCalledTimes(3)
      const body = JSON.parse(String((fetchMock.mock.calls[1]?.[1] as RequestInit).body))
      expect(body).toMatchObject({
        partyId: 'party-1',
        queueId: `queue-${moving}`,
        targetQueueId: `queue-${target}`,
        expectedRevision: 4,
        expectedDigest: 'order-before',
      })
      expect(body).not.toHaveProperty('direction')
      expect(
        wrapper.findAll('#queue-drawer li').map((row) => row.attributes('data-queue-id')),
      ).toEqual(['playing', ...finalIds.map((id) => `queue-${id}`)])
      expect(wrapper.text()).toContain('Queue order updated.')
    } finally {
      wrapper.unmount()
    }
  },
)

it('does not expose a drag handle on the playing row or allow it as a drop target', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
    .mockResolvedValueOnce(response(queueSnapshot(queuedIds, 5, 'order-after')))
  const wrapper = await mountReorderPage(fetchMock)
  installPointerHelpers(wrapper.get('[data-queue-id="playing"]').element)
  try {
    expect(wrapper.find('[data-queue-id="playing"] .reorder-handle').exists()).toBe(false)
    const handle = wrapper.get('[data-queue-id="queue-a"] .reorder-handle')
    sendPointer(handle.element, 'pointerdown', 15)
    sendPointer(handle.element, 'pointermove', 15)
    sendPointer(handle.element, 'pointerup', 15)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  } finally {
    wrapper.unmount()
  }
})

it('starts touch reordering only from the dedicated handle', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
  const wrapper = await mountReorderPage(fetchMock)
  installPointerHelpers(wrapper.get('[data-queue-id="queue-d"]').element)
  try {
    const row = wrapper.get('[data-queue-id="queue-a"]').element
    sendPointer(row, 'pointerdown', 18)
    sendPointer(row, 'pointermove', 18)
    sendPointer(row, 'pointerup', 18)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.drop-before, .drop-after').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

it.each(['self', 'outside'] as const)(
  'does not reorder after a %s invalid drop',
  async (ending) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
    const wrapper = await mountReorderPage(fetchMock)
    const source = wrapper.get('[data-queue-id="queue-a"] .reorder-handle')
    const invalidTarget =
      ending === 'self' ? wrapper.get('[data-queue-id="queue-a"]').element : null
    installPointerHelpers(invalidTarget)
    try {
      sendPointer(source.element, 'pointerdown', 16)
      sendPointer(source.element, 'pointermove', 16)
      await nextTick()
      sendPointer(source.element, 'pointerup', 16)
      await settle()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(wrapper.find('.drop-before, .drop-after').exists()).toBe(false)
    } finally {
      wrapper.unmount()
    }
  },
)

it.each(['pointercancel', 'lostpointercapture'] as const)(
  'clears valid drop feedback and prevents reorder after %s',
  async (ending) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
    const wrapper = await mountReorderPage(fetchMock)
    const source = wrapper.get('[data-queue-id="queue-a"] .reorder-handle')
    const target = wrapper.get('[data-queue-id="queue-d"]').element
    installPointerHelpers(target)
    try {
      sendPointer(source.element, 'pointerdown', 19)
      sendPointer(source.element, 'pointermove', 19)
      await nextTick()
      expect(target.classList.contains('drop-after')).toBe(true)
      sendPointer(source.element, ending, 19)
      await nextTick()
      expect(wrapper.find('.drop-before, .drop-after').exists()).toBe(false)
      sendPointer(source.element, 'pointerup', 19)
      await settle()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      wrapper.unmount()
    }
  },
)

it('cancels a drag when the authoritative queue snapshot changes', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response(queueSnapshot(queuedIds)))
    .mockResolvedValueOnce(response(queueSnapshot(['b', 'a', 'c', 'd'], 5, 'changed-order')))
  const wrapper = await mountReorderPage(fetchMock)
  installPointerHelpers(wrapper.get('[data-queue-id="queue-d"]').element)
  try {
    const handle = wrapper.get('[data-queue-id="queue-a"] .reorder-handle')
    sendPointer(handle.element, 'pointerdown', 17)
    window.dispatchEvent(new Event('focus'))
    await settle()
    sendPointer(handle.element, 'pointermove', 17)
    sendPointer(handle.element, 'pointerup', 17)
    await settle()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.drop-before, .drop-after').exists()).toBe(false)
  } finally {
    wrapper.unmount()
  }
})

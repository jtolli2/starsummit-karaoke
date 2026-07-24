<script setup lang="ts">
import QrcodeVue from 'qrcode.vue'
import { useTabletOperator } from '@/composables/useTabletOperator'

const operator = useTabletOperator()
</script>

<template>
  <main
    class="tablet"
    :inert="Boolean(operator.confirmation) || undefined"
    aria-labelledby="tablet-title"
  >
    <header class="topbar">
      <div>
        <p>STARSUMMIT KARAOKE</p>
        <h1 id="tablet-title">Party controls</h1>
      </div>
      <button v-if="operator.token" class="quiet" type="button" @click="operator.openAdmin">
        Advanced Admin
      </button>
    </header>
    <p v-if="operator.message" class="notice" :data-error="operator.error" role="status">
      {{ operator.message }}
    </p>
    <form v-if="!operator.token" class="login" @submit.prevent="operator.signIn">
      <h2>Sign in</h2>
      <label for="identity">Tablet account</label
      ><input id="identity" v-model="operator.identity" autocomplete="username" required /><label
        for="password"
        >Password</label
      ><input
        id="password"
        v-model="operator.password"
        type="password"
        autocomplete="current-password"
        required
      /><button type="submit" :disabled="operator.loading">
        {{ operator.loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>
    <section v-else-if="!operator.status" class="empty">
      <h2>No active party</h2>
      <p>Create a party when guests are ready, or use Advanced Admin for setup.</p>
      <button type="button" :disabled="operator.loading" @click="operator.createActiveParty">
        Create party
      </button>
    </section>
    <section v-else class="layout" :class="{ 'queue-open': operator.queueOpen }">
      <aside class="party" aria-labelledby="party-heading">
        <h2 id="party-heading">
          Party {{ operator.partyCode || `••••${operator.status.party.codeHint || ''}` }}
        </h2>
        <p v-if="operator.partyExpired">Party expired</p>
        <p v-else>Join: {{ operator.joinUrl || 'QR code is available for this active party.' }}</p>
        <p v-if="!operator.partyExpired">
          Ends {{ new Date(operator.status.party.expiresAt).toLocaleTimeString() }}
        </p>
        <QrcodeVue
          v-if="operator.joinUrl && !operator.partyExpired"
          :value="operator.joinUrl"
          :size="190"
          level="M"
          aria-label="Party join QR code"
        /><button
          class="quiet"
          type="button"
          :disabled="operator.refreshing"
          @click="operator.refresh"
        >
          {{ operator.refreshing ? 'Refreshing…' : 'Refresh' }}</button
        ><button class="quiet" type="button" @click="operator.signOut">Sign out</button>
      </aside>
      <section class="main-control">
        <section class="control-panel" aria-label="Playback controls">
          <section
            class="now"
            aria-labelledby="now-heading"
            :style="
              operator.nowPlayingThumbnailUrl
                ? { backgroundImage: `url(${operator.nowPlayingThumbnailUrl})` }
                : undefined
            "
          >
            <p class="eyebrow">NOW PLAYING</p>
            <h2 id="now-heading">{{ operator.nowPlayingTitle }}</h2>
            <p v-if="operator.nowPlayingArtist">{{ operator.nowPlayingArtist }}</p>
            <p v-if="!operator.playing">Choose Start next when the queue has a song.</p>
            <p v-else-if="!operator.controllerReady">
              Controller unavailable or stale. Reconnecting to authoritative state.
            </p>
            <p v-else-if="!operator.controllerMatchesPlaying">
              Video mismatch: the TV has not confirmed this queue item. Recovery is still needed.
            </p>
            <p v-else>
              Controller reports {{ operator.playerState }}. Elapsed time is not currently reported
              by the controller.
            </p>
            <p v-if="operator.pendingPlayback" class="pending">
              {{ operator.pendingPlayback.action === 'play' ? 'Play' : 'Pause' }} requested —
              waiting for controller confirmation.
            </p>
          </section>
          <div class="control-actions">
            <button
              class="transport icon-button"
              type="button"
              :disabled="Boolean(operator.playbackDisabledReason)"
              :aria-label="
                operator.playbackAction === 'pause'
                  ? 'Pause confirmed playback'
                  : 'Play confirmed playback'
              "
              @click="operator.controlPlayback"
            >
              <span aria-hidden="true">{{ operator.playbackAction === 'pause' ? 'Ⅱ' : '▶' }}</span>
              <span class="sr-only">{{
                operator.playbackAction === 'pause' ? 'Pause' : 'Play'
              }}</span>
              <small v-if="operator.playbackDisabledReason">{{
                operator.playbackDisabledReason
              }}</small>
            </button>
            <button
              class="queue-toggle icon-button"
              type="button"
              :aria-expanded="operator.queueOpen"
              aria-controls="queue-drawer"
              @click="operator.queueOpen = !operator.queueOpen"
            >
              <span aria-hidden="true">☷</span>
              <span class="sr-only">{{ operator.queueOpen ? 'Hide queue' : 'Show queue' }}</span>
              <span>{{ operator.queued.length }}</span>
            </button>
          </div>
        </section>
        <section v-if="operator.partyExpired" class="recovery">
          <h2>This party has expired</h2>
          <button type="button" :disabled="operator.loading" @click="operator.createActiveParty">
            Create new party
          </button>
        </section>
        <section v-else-if="!operator.playing" class="next">
          <h2>Ready for the next singer?</h2>
          <button
            type="button"
            :disabled="operator.busy || !operator.queued.length || !operator.controllerReady"
            @click="operator.startNext"
          >
            {{ operator.busy ? 'Working…' : 'Start next' }}
          </button>
        </section>
      </section>
      <section
        id="queue-drawer"
        class="drawer"
        :data-open="operator.queueOpen"
        :aria-hidden="!operator.queueOpen"
      >
        <div class="drawer-head">
          <h2>Queue</h2>
          <button type="button" class="quiet" @click="operator.queueOpen = false">
            Close queue
          </button>
        </div>
        <p v-if="!operator.queue.length">No songs queued.</p>
        <ol v-else>
          <li v-for="item in operator.queue" :key="item.id" :data-status="item.status">
            <div>
              <strong>{{ item.song?.title || 'Requested song' }}</strong
              ><span>{{ item.song?.artist || 'Video requested by a guest' }}</span
              ><span>Requested by {{ item.requesterLabel || 'a guest' }}</span
              ><small>{{
                item.status === 'playing'
                  ? 'Playing now'
                  : item.status === 'queued'
                    ? `Fair order · next ${item.fairPosition || '?'}`
                    : item.status
              }}</small>
            </div>
            <div v-if="item.status === 'playing'" class="item-actions">
              <button
                type="button"
                :disabled="operator.busy"
                @click="operator.openQueueConfirmation(item, 'completed', $event)"
              >
                Complete</button
              ><button
                type="button"
                class="danger"
                :disabled="operator.busy"
                @click="operator.openQueueConfirmation(item, 'failed', $event)"
              >
                Skip
              </button>
            </div>
          </li>
        </ol>
      </section>
    </section>
    <div v-if="operator.confirmation" class="backdrop" @keydown.esc="operator.dismissConfirmation">
      <section
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-heading"
        tabindex="-1"
      >
        <h2 id="confirm-heading">
          {{
            operator.confirmation.action === 'completed' ? 'Complete this song?' : 'Skip this song?'
          }}
        </h2>
        <p>
          {{ operator.confirmation.item.song?.title || 'This song' }} will be marked
          {{ operator.confirmation.action === 'completed' ? 'complete' : 'skipped' }}.
        </p>
        <label v-if="operator.confirmation.action === 'failed'" for="failure-reason">Reason</label
        ><input
          v-if="operator.confirmation.action === 'failed'"
          id="failure-reason"
          v-model="operator.failureReason"
          maxlength="160"
        />
        <div>
          <button autofocus type="button" class="quiet" @click="operator.dismissConfirmation">
            Cancel</button
          ><button type="button" :disabled="operator.busy" @click="operator.confirmQueueAction">
            Confirm
          </button>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.tablet {
  min-height: 100dvh;
  padding: max(1rem, env(safe-area-inset-top)) max(1rem, env(safe-area-inset-right))
    max(1rem, env(safe-area-inset-bottom)) max(1rem, env(safe-area-inset-left));
  box-sizing: border-box;
  background: #161220;
  color: #fff;
  font-family: system-ui, sans-serif;
}
.topbar,
.drawer-head,
.item-actions,
.dialog > div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}
.topbar p,
.eyebrow {
  margin: 0;
  color: #e3b8ff;
  font-size: 0.75rem;
  font-weight: 800;
  letter-spacing: 0.12em;
}
.topbar h1 {
  margin: 0.25rem 0;
  font-size: clamp(1.6rem, 4vw, 2.4rem);
}
button {
  min-height: 3.4rem;
  border: 0;
  border-radius: 0.8rem;
  padding: 0.75rem 1.2rem;
  font: inherit;
  font-weight: 800;
  background: #a56cff;
  color: #160d20;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.quiet {
  background: #30283e;
  color: #fff;
}
.notice,
.login,
.empty,
.party,
.now,
.next,
.recovery,
.drawer,
.dialog {
  border-radius: 1rem;
  background: #241d31;
  padding: 1rem;
}
.notice[data-error='true'] {
  background: #5a2432;
}
.login,
.empty {
  max-width: 28rem;
  margin: 4rem auto;
}
.login label,
.dialog label {
  display: block;
  margin-top: 0.8rem;
  font-weight: 700;
}
input {
  width: 100%;
  box-sizing: border-box;
  margin: 0.25rem 0 0.8rem;
  padding: 0.8rem;
  border-radius: 0.6rem;
  border: 1px solid #cdb8db;
  font: inherit;
}
.layout {
  display: grid;
  grid-template-columns: minmax(13rem, 18rem) minmax(0, 1fr);
  gap: 1rem;
  max-width: 74rem;
  margin: auto;
}
.layout.queue-open {
  grid-template-columns: minmax(13rem, 18rem) minmax(16rem, 1fr) minmax(18rem, 24rem);
}
.party {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  align-items: flex-start;
}
.party h2,
.party p,
.now h2,
.now p {
  margin: 0;
}
.party canvas {
  max-width: 100%;
  height: auto;
  background: #fff;
  padding: 0.5rem;
  border-radius: 0.5rem;
}
.main-control {
  display: grid;
  gap: 1rem;
  align-content: start;
}
.control-panel {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 1rem;
  background: #241d31;
}
.now {
  position: relative;
  isolation: isolate;
  min-height: 0;
  padding: 0.75rem;
  overflow: hidden;
  background-position: center;
  background-size: cover;
}
.now::before {
  position: absolute;
  z-index: 0;
  inset: 0;
  background: linear-gradient(105deg, #161220f2, #161220b8 60%, #161220d9);
  content: '';
}
.now > * {
  position: relative;
  z-index: 1;
}
.control-actions {
  display: flex;
  gap: 0.75rem;
}
.icon-button {
  min-height: 3.4rem;
  flex: 1;
  padding: 0.5rem;
  font-size: 1.5rem;
  background: #ffffff26;
  color: #fff;
  border: 1px solid #ffffff4d;
  backdrop-filter: blur(8px);
}
.icon-button small {
  display: block;
  font-size: 0.7rem;
}
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
.transport {
  min-height: 3.4rem;
  font-size: clamp(1.5rem, 4vw, 2.25rem);
}
.transport small {
  display: block;
  margin-top: 0.5rem;
  font-size: 0.9rem;
}
.queue-toggle {
  font-size: 1.1rem;
}
.queue-toggle span {
  display: inline-grid;
  min-width: 1.8rem;
  place-items: center;
  border-radius: 99px;
  background: #152821;
  color: #fff;
}
.next {
  text-align: center;
}
.next button {
  min-width: min(100%, 20rem);
}
.drawer {
  grid-column: 3;
  grid-row: 1;
  display: block;
  min-width: 0;
  overflow: hidden;
  visibility: hidden;
}
.drawer[data-open='true'] {
  visibility: visible;
}
.drawer ol {
  padding-left: 1.4rem;
}
.drawer li {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  padding: 1rem 0;
  border-top: 1px solid #483b5b;
}
.drawer span,
.drawer small {
  display: block;
  color: #dfd5e8;
}
.danger {
  background: #ff9cab;
}
.pending {
  color: #f3c949;
  font-weight: 800;
}
.backdrop {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  padding: 1rem;
  background: #000a;
}
.dialog {
  width: min(100%, 32rem);
}
.dialog > div {
  justify-content: flex-end;
  margin-top: 1rem;
}
@media (max-width: 700px) {
  .layout {
    grid-template-columns: 1fr;
  }
  .layout.queue-open {
    grid-template-columns: 1fr;
  }
  .party {
    align-items: center;
    text-align: center;
  }
  .party button {
    width: 100%;
  }
  .drawer {
    grid-column: auto;
    grid-row: auto;
  }
  .item-actions {
    flex-direction: column;
  }
  .item-actions button {
    min-width: 7rem;
  }
}
</style>

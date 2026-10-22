/**
 * Desktop pet renderer: paints the mascot and its progress bubble from the
 * state the main process pushes. Framework-free, because this window exists
 * even while the application's own UI is still booting.
 *
 * Both mascot states are embedded as data URLs so this window needs no asset
 * pipeline of its own.
 */

/** Mascot artwork for the working and settled states. */
const ARTWORK = {
  working: 'data:image/webp;base64,'
    + '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'
    + 'd0AZ3tAAAAA=',
  done: 'data:image/webp;base64,'
    + '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'
    + 'C2sLpRNf/23MAEGkAAA=',
}

const pet = document.querySelector('#pet')
const sprite = document.querySelector('#sprite')
const bubble = document.querySelector('#bubble')
const headline = document.querySelector('#headline')
const detail = document.querySelector('#detail')
const meter = document.querySelector('#meter')
const meterFill = document.querySelector('#meter-fill')

/**
 * Apply one state pushed by the main process.
 * @param {object} state - phase, running count, followed task tally, and copy.
 */
function render(state) {
  const phase = state.phase
  pet.dataset.phase = phase
  sprite.src = ARTWORK[phase === 'done' ? 'done' : 'working']
  sprite.dataset.phase = phase
  if (phase === 'idle') {
    bubble.hidden = true
    return
  }
  bubble.hidden = false
  if (phase === 'done') {
    headline.textContent = state.text.done
    detail.textContent = ''
    meter.hidden = true
    return
  }
  headline.textContent = state.text.headline
  const task = state.task
  if (task === undefined) {
    detail.textContent = ''
    meter.hidden = true
    return
  }
  const percent = task.total === 0 ? 0 : Math.round((task.done / task.total) * 100)
  detail.textContent = task.current ?? task.title ?? ''
  meter.hidden = false
  meterFill.style.width = percent + '%'
  meter.setAttribute('aria-label', task.done + '/' + task.total)
}

/**
 * Begin the window's state stream and drag gestures.
 */
async function main() {
  const api = window.dshDesktop
  const locale = await api.locale()
  document.documentElement.lang = locale.id
  sprite.alt = locale.messages.petTitle
  pet.title = locale.messages.petHint
  const first = await api.pet.state()
  if (first !== undefined) render(first)
  api.pet.subscribe(render)

  // Drag: pointer deltas go to the main process, which owns window position.
  // Pointer capture keeps the gesture alive when the pointer leaves the window.
  let dragging = false
  pet.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    event.preventDefault()
    dragging = true
    // Capture keeps the gesture alive outside the window; a host without the
    // pointer-capture API still drags while the pointer stays inside.
    try {
      pet.setPointerCapture(event.pointerId)
    } catch {
      // Capture is unavailable for this pointer; the in-window gesture stands.
    }
  })
  pet.addEventListener('pointermove', (event) => {
    if (!dragging) return
    api.pet.drag({ dx: event.movementX, dy: event.movementY })
  })
  const end = (event) => {
    if (!dragging) return
    dragging = false
    try {
      if (pet.hasPointerCapture(event.pointerId)) pet.releasePointerCapture(event.pointerId)
    } catch {
      // The pointer was already released by the host.
    }
    api.pet.dragEnd()
  }
  pet.addEventListener('pointerup', end)
  pet.addEventListener('pointercancel', end)
}

void main()

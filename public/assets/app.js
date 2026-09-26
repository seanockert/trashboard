// htmx swaps body, does not run script again: listeners on document.
import { play as cue, setEnabled } from './vendor/cuelume/audio/engine.js';

const INTRO_KEY = 'trashboard_intro';
const SOUND_KEY = 'trashboard_sound';
const $ = (selector, root = document) => root.querySelector(selector);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- Intro, menu, keys ----------

const showIntro = () => {
  const intro = document.getElementById('intro');
  if (intro && !localStorage.getItem(INTRO_KEY)) intro.showModal();
};

document.addEventListener('close', (e) => { if (e.target.id === 'intro') localStorage.setItem(INTRO_KEY, '1'); }, true);

document.addEventListener('click', (e) => {
  if (e.target.id === 'intro') e.target.close();
  document.querySelectorAll('details.menu[open]').forEach((menu) => { if (!menu.contains(e.target)) menu.open = false; });
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach((menu) => { menu.open = false; $('summary', menu).focus(); });
  if (e.key !== '/' || e.target.closest('input, select, textarea')) return;
  e.preventDefault();
  $('#q')?.focus();
});

// ---------- Sound: off by default ----------

let soundOn = localStorage.getItem(SOUND_KEY) === '1';
setEnabled(soundOn);
const play = (name) => cue(name);

const syncSound = () => document.querySelectorAll('[data-sound]').forEach((el) => el.setAttribute('aria-checked', String(soundOn)));

document.addEventListener('click', (e) => {
  if (!e.target.closest('[data-sound]')) return;
  soundOn = !soundOn;
  setEnabled(soundOn);
  localStorage.setItem(SOUND_KEY, soundOn ? '1' : '0');
  syncSound();
  play('toggle');
});

// Click and pick sounds. Controls with own sound: skip.
const CLICKABLE = 'a[href], button, summary, select, textarea, input:not([type=checkbox], [type=radio], [type=hidden])';
const OWN_SOUND = '[data-sound], [data-out], [data-undo]';

document.addEventListener('click', (e) => {
  const el = e.target.closest(CLICKABLE);
  if (el && !el.closest(OWN_SOUND) && !el.disabled) play('press');
});

document.addEventListener('change', (e) => {
  if (e.target.matches('select, input[type=checkbox], input[type=radio]')) play('tick');
});

const start = () => {
  showIntro();
  syncSound();
};
start();
document.addEventListener('htmx:afterSwap', start);
// htmx keeps <html>: class marks page as swapped, not loaded.
document.addEventListener('htmx:beforeSwap', () => document.documentElement.classList.add('swapped'));

// ---------- Triage: card flies out, saves in background, undo ----------

const TAB_OF = { new: 'new', acting: 'acting', done: 'done', dismissed: 'done' };
const TOAST_TEXT = { new: 'Back on the pile.', acting: 'On the truck.', done: 'Done and dusted.', dismissed: 'Chucked.' };

const save = async (fields) => {
  const res = await fetch('/triage', { method: 'POST', body: new URLSearchParams(fields), headers: { 'X-Triage': '1' } });
  if (!res.ok) throw new Error(`Triage failed: ${res.status}`);
};

const bump = (tab, delta) => {
  const el = document.getElementById(`count-${TAB_OF[tab]}`);
  if (!el) return;
  const count = Number(el.textContent) + delta;
  el.textContent = count > 0 ? String(count) : '';
  el.classList.remove('bump');
  void el.offsetWidth;
  el.classList.add('bump');
};

let toastTimer;
const toast = (text, undoable) => {
  const el = $('#toast');
  if (!el) return;
  el.classList.add('on');
  $('[data-undo]', el).hidden = !undoable;
  // Text after show, so screen readers read it.
  requestAnimationFrame(() => { $('span', el).textContent = text; });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.classList.remove('on'); last = null; }, 5000);
};

const hideToast = () => $('#toast')?.classList.remove('on');

const flyOut = async (slot, dir, fromX) => {
  const card = $('.card', slot);
  slot.dataset.dir = dir;
  if (!reduced()) {
    const to = dir === 'act'
      ? 'translate(110%, -20px) rotate(10deg) scale(0.9)'
      : 'translate(-90%, 60px) rotate(-24deg) scale(0.8)';
    await card.animate(
      [{ transform: `translateX(${fromX}px) rotate(${fromX / 25}deg)` }, { transform: to, opacity: 0 }],
      { duration: 380, easing: 'cubic-bezier(.5,0,.75,0)' },
    ).finished;
    card.style.visibility = 'hidden';
    await slot.animate([{ height: `${slot.offsetHeight}px` }, { height: '0px', paddingBottom: '0px' }], { duration: 260, easing: 'cubic-bezier(.4,0,.2,1)' }).finished;
  }
  slot.classList.remove('swiping', 'armed');
  slot.remove();
};

const putBack = (slot, before, parent) => {
  const card = $('.card', slot);
  card.style.visibility = '';
  delete slot.dataset.dir;
  slot.style.setProperty('--i', '0');
  parent.insertBefore(slot, before?.isConnected ? before : null);
};

// Last change, for Undo.
let last = null;

document.addEventListener('submit', async (e) => {
  const form = e.target;
  const button = e.submitter;
  if (!form.matches('[data-triage]') || !button?.dataset.out) return;
  e.preventDefault();
  const slot = form.closest('.slot');
  const parent = slot.parentElement;
  const before = slot.nextElementSibling;
  const from = form.dataset.status;
  const to = button.value;
  const data = new FormData(form);
  data.set('status', to);
  // Undo puts back status and note.
  const undo = { itemId: data.get('itemId'), status: from, ...(data.has('note') ? { note: data.get('note') } : {}) };
  const keyboard = button.matches(':focus-visible');
  const next = [before, slot.previousElementSibling].find((el) => el?.matches('.slot'));

  play(button.dataset.out === 'act' ? 'success' : 'droplet');
  const saved = save(data);
  await flyOut(slot, button.dataset.out, Number(slot.dataset.x ?? 0));
  delete slot.dataset.x;
  try {
    await saved;
  } catch {
    putBack(slot, before, parent);
    play('error');
    return toast('That didn’t stick. Try again.', false);
  }
  bump(from, -1);
  bump(to, 1);
  last = { slot, parent, before, undo, from, to };
  toast(TOAST_TEXT[to], true);
  if (keyboard && next?.isConnected) $('.title', next)?.focus();
  // List empty: fetch page again for next page or inbox zero.
  if (!parent.querySelector('.slot')) htmx.ajax('GET', location.pathname + location.search, { target: 'body', swap: 'innerHTML' });
}, true);

document.addEventListener('click', async (e) => {
  if (!e.target.closest('[data-undo]') || !last) return;
  const { slot, parent, before, undo, from, to } = last;
  last = null;
  hideToast();
  try {
    await save(undo);
  } catch {
    return toast('Undo didn’t stick. Try again.', false);
  }
  if (parent.isConnected) putBack(slot, before, parent);
  bump(to, -1);
  bump(from, 1);
  play('page');
  $('.title', slot)?.focus();
});

// ---------- Swipe: right to act, left to chuck ----------
// touch-action: pan-y keeps vertical scroll.

const ARM = 0.3;
let drag = null;

document.addEventListener('pointerdown', (e) => {
  const card = e.target.closest('[data-swipe] > .card');
  if (!card || e.button !== 0 || e.target.closest('a, button, input, select, textarea')) return;
  drag = { card, slot: card.parentElement, x0: e.clientX, y0: e.clientY, x: 0, live: false, id: e.pointerId, t: performance.now() };
});

document.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x0;
  const dy = e.clientY - drag.y0;
  if (!drag.live) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return (drag = null);
    if (Math.abs(dx) < 10) return;
    drag.live = true;
    drag.card.setPointerCapture(e.pointerId);
    drag.card.classList.add('dragging');
    drag.slot.classList.add('swiping');
    getSelection()?.removeAllRanges();
  }
  drag.x = dx;
  drag.slot.dataset.dir = dx > 0 ? 'act' : 'dismiss';
  const armed = Math.abs(dx) > drag.card.offsetWidth * ARM;
  if (armed !== drag.slot.classList.contains('armed')) {
    drag.slot.classList.toggle('armed', armed);
    if (armed) play('tick');
    navigator.vibrate?.(8);
  }
  drag.card.style.transform = `translateX(${dx}px) rotate(${dx / 25}deg)`;
});

const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const { card, slot, x, live, t } = drag;
  drag = null;
  if (!live) return;
  card.classList.remove('dragging');
  const fast = Math.abs(x) / (performance.now() - t) > 0.8 && Math.abs(x) > 40;
  const button = $(`[data-out="${x > 0 ? 'act' : 'dismiss'}"]`, slot);
  if (button && (Math.abs(x) > card.offsetWidth * ARM || fast)) {
    card.style.transform = '';
    slot.dataset.x = String(x);
    return button.form.requestSubmit(button);
  }
  // Spring back.
  card.animate([{ transform: card.style.transform }, { transform: 'none' }], { duration: reduced() ? 1 : 500, easing: getComputedStyle(document.documentElement).getPropertyValue('--spring') });
  card.style.transform = '';
  slot.classList.remove('swiping', 'armed');
  delete slot.dataset.dir;
};

document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

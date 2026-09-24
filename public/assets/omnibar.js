// Suggestions for the omni-bar. See OmniBar in src/web/pages.tsx.
// The form has the filter keys and values in `data-spec`: [{ key, label, options: [{ token, label }] }].
(() => {
  const form = document.querySelector('form.omni');
  if (!form) return;
  const input = form.querySelector('input[name=q]');
  const mirror = form.querySelector('.omni-mirror');
  const pop = form.querySelector('.omni-pop');
  const spec = JSON.parse(form.dataset.spec);
  const TOKEN = /^([a-z]+):(.*)$/i;
  const MAX_MATCHES = 8;

  let items = [];
  let active = -1;

  const fieldOf = (key) => spec.find((f) => f.key === key.toLowerCase());
  const has = (text, part) => text.toLowerCase().includes(part.toLowerCase());

  // The words that are not filter tokens. The AI search gets these.
  const freeText = () =>
    input.value
      .split(/\s+/)
      .filter((w) => w !== '' && !TOKEN.test(w))
      .join(' ');

  // The word at the caret: its start and end, and the part before the caret.
  const wordAt = () => {
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const start = value.lastIndexOf(' ', caret - 1) + 1;
    const next = value.indexOf(' ', caret);
    return { start, end: next === -1 ? value.length : next, typed: value.slice(start, caret) };
  };

  // The same text as the input, with the keys and values in colour. The input text is transparent.
  const paint = () => {
    mirror.replaceChildren(
      ...input.value.split(/(\s+)/).map((word) => {
        const match = TOKEN.exec(word);
        const field = match && fieldOf(match[1]);
        if (!field) return document.createTextNode(word);
        const known = field.options.some((o) => o.token.toLowerCase() === match[2].toLowerCase());
        const part = document.createElement('span');
        const key = document.createElement('span');
        key.className = 'k';
        key.textContent = `${match[1]}:`;
        const value = document.createElement('span');
        value.className = known ? 'v' : 'v bad';
        value.textContent = match[2];
        part.append(key, value);
        return part;
      }),
    );
    mirror.scrollLeft = input.scrollLeft;
  };

  const suggest = () => {
    const { typed } = wordAt();
    const match = TOKEN.exec(typed);
    const field = match && fieldOf(match[1]);
    if (field) {
      const options = field.options.filter((o) => has(o.token, match[2]) || has(o.label, match[2]));
      return [{ head: field.label }, ...options.map((o) => ({ kind: 'value', field, option: o }))];
    }
    const keys = spec.filter((f) => typed === '' || has(f.key, typed) || has(f.label, typed));
    const values =
      typed === ''
        ? []
        : spec
            .flatMap((f) => f.options.filter((o) => has(o.token, typed) || has(o.label, typed)).map((o) => ({ kind: 'value', field: f, option: o })))
            .slice(0, MAX_MATCHES);
    const text = freeText();
    return [
      ...(keys.length > 0 ? [{ head: 'Filter by' }, ...keys.map((f) => ({ kind: 'key', field: f }))] : []),
      ...(values.length > 0 ? [{ head: 'Matching filters' }, ...values] : []),
      ...(text !== '' ? [{ head: 'Search' }, { kind: 'match', text }, { kind: 'ai', text }] : []),
    ];
  };

  const row = (item, i) => {
    const el = document.createElement('div');
    el.id = `omni-${i}`;
    el.setAttribute('role', 'option');
    el.className = 'omni-item';
    const main = document.createElement('div');
    const note = document.createElement('div');
    note.className = 'note';
    if (item.kind === 'key') {
      main.className = 'k';
      main.textContent = `${item.field.key}:`;
      note.textContent = item.field.label;
    } else if (item.kind === 'value') {
      main.innerHTML = '<span class="k"></span><span class="v"></span>';
      main.firstChild.textContent = `${item.field.key}:`;
      main.lastChild.textContent = item.option.token;
      note.textContent = item.option.label;
    } else if (item.kind === 'match') {
      main.textContent = `Match the words “${item.text}”`;
      note.textContent = 'Enter';
    } else {
      main.textContent = `✦ Ask AI: “${item.text}”`;
      note.textContent = 'Searches all items';
    }
    el.append(main, note);
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      pick(item);
    });
    return el;
  };

  const render = () => {
    const list = suggest();
    items = list.filter((entry) => !entry.head);
    // After "key:" the first value is ready for Enter. Else Enter sends the form as typed.
    active = TOKEN.test(wordAt().typed) && items[0]?.kind === 'value' ? 0 : -1;
    let i = 0;
    pop.replaceChildren(
      ...list.map((entry) => {
        if (!entry.head) return row(entry, i++);
        const head = document.createElement('div');
        head.className = 'omni-head';
        head.textContent = entry.head;
        return head;
      }),
    );
    const open = list.length > 0;
    pop.hidden = !open;
    input.setAttribute('aria-expanded', String(open));
    highlight();
  };

  const highlight = () => {
    pop.querySelectorAll('.omni-item').forEach((el, i) => el.classList.toggle('on', i === active));
    if (active >= 0) {
      input.setAttribute('aria-activedescendant', `omni-${active}`);
      pop.querySelector(`#omni-${active}`)?.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };

  const close = () => {
    pop.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };

  // Puts `text` in place of the word at the caret. A value token also removes other tokens for the same key.
  const replaceWord = (text, key) => {
    const { start, end } = wordAt();
    const drop = (part) => (key ? part.split(' ').filter((w) => !w.toLowerCase().startsWith(`${key}:`)).join(' ') : part);
    const before = drop(input.value.slice(0, start));
    const after = drop(input.value.slice(end)).trimStart();
    input.value = `${before}${text}${after === '' ? '' : ` ${after}`}`;
    const caret = before.length + text.length;
    input.setSelectionRange(caret, caret);
  };

  const pick = (item) => {
    if (item.kind === 'key') replaceWord(`${item.field.key}:`);
    else if (item.kind === 'value') replaceWord(`${item.field.key}:${item.option.token} `, item.field.key);
    else if (item.kind === 'match') return form.requestSubmit();
    else return (location.href = `/search?${new URLSearchParams({ q: item.text })}`);
    paint();
    render();
  };

  input.addEventListener('focus', render);
  input.addEventListener('click', render);
  input.addEventListener('blur', close);
  input.addEventListener('scroll', () => (mirror.scrollLeft = input.scrollLeft));
  input.addEventListener('input', () => {
    paint();
    render();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (pop.hidden) input.blur();
      else close();
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (pop.hidden) return render();
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      active = (active + step + items.length + 1) % (items.length + 1);
      if (active === items.length) active = -1;
      return highlight();
    }
    if ((e.key === 'Enter' || e.key === 'Tab') && !pop.hidden && active >= 0 && items[active]) {
      e.preventDefault();
      return pick(items[active]);
    }
  });
  // Arrow keys and Home or End move the caret. The suggestions follow the word at the caret.
  input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) render();
    mirror.scrollLeft = input.scrollLeft;
  });

  paint();
})();

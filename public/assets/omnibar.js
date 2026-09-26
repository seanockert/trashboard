// htmx swaps body without reload: init again on each new form.
const startOmni = () => {
  const form = document.querySelector('form.omni');
  if (!form || form.dataset.started) return;
  form.dataset.started = '1';
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

  const freeText = () =>
    input.value
      .split(/\s+/)
      .filter((w) => w !== '' && !TOKEN.test(w))
      .join(' ');

  const wordAt = () => {
    const value = input.value;
    const caret = input.selectionStart ?? value.length;
    const start = value.lastIndexOf(' ', caret - 1) + 1;
    const next = value.indexOf(' ', caret);
    return { start, end: next === -1 ? value.length : next, typed: value.slice(start, caret) };
  };

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
    // Key already in bar is not listed. User changes its value in place.
    const { start, end } = wordAt();
    const others = `${input.value.slice(0, start)} ${input.value.slice(end)}`.split(/\s+/);
    const used = new Set(others.map((w) => TOKEN.exec(w)?.[1].toLowerCase()).filter(Boolean));
    const keys = spec.filter((f) => !used.has(f.key) && (typed === '' || has(f.key, typed) || has(f.label, typed)));
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
      main.textContent = `Search for “${item.text}”`;
      note.textContent = 'Digs through everything';
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
    // After "key:" first value is ready for Enter. Else Enter sends as typed.
    active = TOKEN.test(wordAt().typed) && items[0]?.kind === 'value' ? 0 : -1;
    let i = 0;
    pop.replaceChildren(
      ...list.map((entry) => {
        if (!entry.head) return row(entry, i++);
        const head = document.createElement('div');
        head.className = 'omni-head';
        head.setAttribute('role', 'presentation');
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
    pop.querySelectorAll('.omni-item').forEach((el, i) => {
      el.classList.toggle('on', i === active);
      el.setAttribute('aria-selected', String(i === active));
    });
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

  // Value token also removes other tokens for same key.
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
    else if (item.kind === 'value') {
      replaceWord(`${item.field.key}:${item.option.token}`, item.field.key);
      return form.requestSubmit();
    } else if (item.kind === 'match') return form.requestSubmit();
    else return (location.href = `/search?${new URLSearchParams({ q: item.text })}`);
    paint();
    render();
  };

  // Focus adds trailing space, so "Filter by" shows at once.
  input.addEventListener('focus', () => {
    if (input.value !== '' && !input.value.endsWith(' ')) {
      input.value += ' ';
      input.setSelectionRange(input.value.length, input.value.length);
      paint();
    }
    render();
  });
  input.addEventListener('click', render);
  input.addEventListener('blur', () => {
    input.value = input.value.trimEnd();
    paint();
    close();
  });
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
  input.addEventListener('keyup', (e) => {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) render();
    mirror.scrollLeft = input.scrollLeft;
  });

  paint();
};
startOmni();
document.addEventListener('htmx:afterSwap', startOmni);

((markerOnly = false) => {
  if (!document.body) return null;
  const cache = window.__jevFast ||= {ids: new WeakMap(), nodes: new Map(), next: 1};
  const roles = ['button','link','checkbox','radio','switch','tab','menuitem','menuitemradio',
    'option','gridcell','combobox','textbox','searchbox','spinbutton'];
  const selector = 'a[href],button,input,textarea,select,summary,[contenteditable="true"],' +
    roles.map(role => '[role="' + role + '"]').join(',') + ',label';
  // A page can paint a whole dialog inside an open shadow root: a query on the document never
  // reaches it, and elementFromPoint answers with the host, so the reader walks the roots of
  // that tree and takes the deepest element in them as the one that speaks for the click. A
  // closed root is left alone: nothing inside it can be named or reached by a click. The read is
  // one synchronous pass, so the tree cannot change under it and the roots are looked for once;
  // the answers go with the pass, because a later call has to read the page as it stands then.
  const found = new Map();
  const roots = root => {
    if (found.has(root)) return found.get(root);
    const all = [root,
      ...[...root.querySelectorAll('*')].flatMap(e => e.shadowRoot ? roots(e.shadowRoot) : [])];
    found.set(root, all);
    return all;
  };
  const deepest = (x, y) => {
    let top = document.elementFromPoint(x, y);
    while (top?.shadowRoot) {
      const inner = top.shadowRoot.elementFromPoint(x, y);
      if (!inner || inner === top) break;
      top = inner;
    }
    return top;
  };
  // A document does not end at a shadow boundary: a walk that steps from a node to its parent,
  // and from the root of a shadow tree to the host that holds it, reaches every ancestor a click
  // and a style come from, which `closest` alone never does.
  const up = (node, step) => {
    for (; node; node = node.parentElement ?? node.getRootNode()?.host ?? null) {
      if (step(node)) return node;
    }
    return null;
  };
  const nearest = (e, matches) => up(e, node => node.matches?.(matches));
  // The click of a point lands on the deepest element under it, and every element on the way up
  // answers with it: a host and the content of its shadow tree answer together, while a veil that
  // covers on a branch of its own is on nobody's way and leaves the options it hides hidden.
  const owns = (e, top) => up(top, node => node === e) === e;
  const identity = e => {
    if (!cache.ids.has(e)) cache.ids.set(e, cache.next++);
    const id = cache.ids.get(e);
    cache.nodes.set(id, e);
    return id;
  };
  const safe = e => !['password','file','hidden'].includes(e.type);
  // A styled toggle hides its own input at 0×0 and paints a label in its place: the label is then
  // the only thing a click can reach, so it answers for the control it names — its role, its
  // checked state — as long as the control itself is not something the reader offers anyway.
  const control = e => e.tagName === 'LABEL' ? (e.control || null) : e;
  const armed = c => !!c && !c.matches(':disabled') && !nearest(c, '[aria-disabled="true"],[inert]');
  const toggle = e => {
    const c = control(e);
    return e.tagName === 'LABEL' && armed(c) && ['checkbox','radio'].includes(c.type) ? c : null;
  };
  const stated = e => roles.includes(e.getAttribute('role'));
  const visible = e => !nearest(e, '[aria-hidden="true"],[inert]') &&
    e.checkVisibility({checkOpacity:true, checkVisibilityCSS:true});
  // An id belongs to the tree the element lives in, and a shadow root keeps its own: the name
  // of a control that names it is never looked up in the document alone.
  const byId = (e, id) => e.getRootNode()?.getElementById?.(id) ?? document.getElementById(id);
  const name = (e, seen = new Set()) => {
    if (!e || seen.has(e)) return '';
    seen.add(e);
    const referenced = (e.getAttribute('aria-labelledby') || '').split(/\s+/)
      .map(id => name(byId(e, id), seen)).filter(Boolean).join(' ');
    return referenced || e.getAttribute('aria-label') ||
      [...(e.labels || [])].map(l => name(l, seen)).filter(Boolean).join(' ') ||
      (['button','submit','reset'].includes(e.type) ? e.value : '') || e.getAttribute('alt') ||
      (e.tagName === 'INPUT' ? '' : [...e.childNodes].map(n => n.nodeType === 3 ? n.textContent :
        n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' ? name(n, seen) : '').join(' ').trim()) ||
      e.getAttribute('title') || e.getAttribute('placeholder') || '';
  };
  const role = e => {
    const explicit = e.getAttribute('role');
    if (roles.includes(explicit)) return explicit;
    const c = toggle(e);
    if (c) return role(c);
    if (e.tagName === 'BUTTON' || e.tagName === 'SUMMARY') return 'button';
    if (e.tagName === 'A') return 'link';
    if (e.tagName === 'SELECT') return 'combobox';
    if (e.tagName === 'TEXTAREA' || e.isContentEditable) return 'textbox';
    if (e.tagName !== 'INPUT') return null;
    if (['checkbox','radio'].includes(e.type)) return e.type;
    if (['button','submit','reset','image'].includes(e.type)) return 'button';
    if (e.type === 'search') return 'searchbox';
    if (e.type === 'number') return 'spinbutton';
    if (['text','email','url','tel'].includes(e.type)) return 'textbox';
    return null;
  };
  const prune = () => {
    for (const [id, e] of cache.nodes) if (!e.isConnected) cache.nodes.delete(id);
  };
  const rectOf = e => e.getBoundingClientRect();
  // The protocol copies values, and a live DOMRect has none of its geometry on the object itself.
  const boxOf = r => ({x: r.x, y: r.y, w: r.width, h: r.height});
  const centre = r => ({x: r.x + r.width / 2, y: r.y + r.height / 2});
  // The same hit test the executor runs before it clicks: an element that a veil, a header or a
  // pointer-events: none sibling answers for instead is an option that could never be taken.
  const hit = e => {
    const r = rectOf(e);
    if (!r.width || !r.height) return false;
    const {x, y} = centre(r);
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false;
    return owns(e, deepest(x, y));
  };
  const inView = r => r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight &&
    r.right > 0 && r.left < innerWidth;
  // The label of a plain checkbox would be the same click twice: it is offered only where the
  // control it names could not be offered itself, which is what a styled toggle leaves behind.
  const substitute = e => { const c = toggle(e); return !!c && !usable(c); };
  const usable = e => {
    if (e.tagName === 'LABEL' && !stated(e) && !substitute(e)) return false;
    return safe(e) && visible(e) && !e.matches(':disabled') &&
      !nearest(e, '[aria-disabled="true"]') && !!role(e) && hit(e) &&
      !(role(e) === 'gridcell' && e.querySelector('button,[role="button"]'));
  };
  const dialogs = 'dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]';
  const large = e => {
    const r = rectOf(e);
    return r.width * r.height >= innerWidth * innerHeight / 5;
  };
  // A dialog that took the page over owns the options, and the frame drawn from them, because
  // what it covers cannot be clicked. It states that it is modal, or it is a modal dialog, or
  // it is a dialog big enough to be one; the last one wins, so a dialog opened over a dialog —
  // in the document or in an open shadow root of it — is the one that is read.
  const takeover = () => roots(document).flatMap(root => [...root.querySelectorAll(dialogs)])
    .filter(e => (e.getAttribute('aria-modal') === 'true' ||
      (e.tagName === 'DIALOG' ? e.matches(':modal') : large(e))) && visible(e)).at(-1) || null;
  const ariaKeys = e => Object.fromEntries(['checked','selected','expanded']
    .map(key => [key, e.getAttribute('aria-' + key)])
    .filter(entry => entry[1] !== null));
  const checkedKey = e => {
    const c = control(e);
    return ['checkbox','radio'].includes(c?.type) ? {checked: String(c.checked)} : {};
  };
  const details = e => {
    const fields = {};
    if (e.required || e.getAttribute('aria-required') === 'true') fields.required = true;
    const invalid = e.getAttribute('aria-invalid');
    if (invalid && invalid !== 'false') fields.invalid = invalid;
    const description = (e.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean)
      .map(id => name(byId(e, id))).filter(Boolean).join(' ').slice(0, 240);
    if (description) fields.description = description;
    return fields;
  };
  const base = e => Object.assign({node: identity(e), role: role(e), label: name(e) || role(e),
    rect: boxOf(rectOf(e))}, ariaKeys(e), checkedKey(e), details(e));
  const options = e => [...e.options];
  const optionUsable = o => !o.selected && !o.disabled && !o.closest('optgroup[disabled]');
  const selectActions = (e, root) => {
    const current_value = [...e.selectedOptions].map(s => s.label).join(', ');
    return options(e).filter(optionUsable).map(o => Object.assign({}, root, {
      kind: 'select', value: o.value, current_value, label: root.label + ' → ' + o.label}));
  };
  const fieldValue = e => 'value' in e ? String(e.value) :
    e.isContentEditable || role(e) === 'combobox' ? e.innerText.trim() : '';
  const editable = e => !e.readOnly && e.getAttribute('aria-readonly') !== 'true' &&
    (['textbox','searchbox','spinbutton'].includes(role(e)) ||
      (role(e) === 'combobox' && ['INPUT','TEXTAREA'].includes(e.tagName)));
  const fieldActions = (e, root) => {
    const value = fieldValue(e);
    if (!editable(e)) return [Object.assign({}, root, {kind: 'click', value})];
    return [Object.assign({}, root, {kind: 'fill', value}),
      Object.assign({}, root, {kind: 'click', value, label: 'Open ' + root.label})];
  };
  const actionsFor = e => e.tagName === 'SELECT' ?
    selectActions(e, base(e)) : fieldActions(e, base(e));
  cache.pageKey = () => [performance.timeOrigin, location.href, scrollX, scrollY, innerWidth,
    innerHeight, roots(document).flatMap(root => [...root.querySelectorAll('input,textarea,select')])
      .filter(safe).map(e => [identity(e), e.value, e.checked, e.selectedIndex, e.disabled, e.readOnly])];
  // Shared rows/forms can contain many controls. Read their rendered text once per
  // synchronous snapshot, but never reuse it in a later freshness probe.
  let reading = true;
  const scopeTexts = new Map();
  const scopeText = scope => {
    if (!scope) return '';
    if (!reading) return scope.innerText?.slice(0, 6000) || '';
    if (!scopeTexts.has(scope)) scopeTexts.set(scope, scope.innerText?.slice(0, 6000) || '');
    return scopeTexts.get(scope);
  };
  const release = () => { reading = false; scopeTexts.clear(); found.clear(); };
  cache.guard = e => {
    if (!e?.isConnected || !visible(e)) return null;
    const scope = nearest(e, 'form,dialog,[role="dialog"],article,li,tr,[role="row"]') ||
      e.parentElement || e.getRootNode()?.host || null;
    return [identity(e), role(e), name(e), e.value ?? null, e.checked ?? null, e.selectedIndex ?? null,
      e.readOnly ?? null, e.matches(':disabled'), e.getAttribute('aria-disabled'),
      e.getAttribute('aria-expanded'), e.getAttribute('aria-checked'), e.getAttribute('aria-selected'),
      e.getAttribute('href'), details(e), scopeText(scope)];
  };
  prune();
  const scope = takeover();
  const actions = roots(scope || document).flatMap(root => [...root.querySelectorAll(selector)])
    .filter(usable).flatMap(actionsFor);
  // Identical labels (for example several "Book" buttons) need the observed row
  // context. Do not copy container text onto every uniquely named control.
  const labelled = new Map();
  for (const action of actions) {
    const nodes = labelled.get(action.label) || new Set();
    nodes.add(action.node);
    labelled.set(action.label, nodes);
  }
  for (const action of actions) {
    if (labelled.get(action.label).size < 2) continue;
    const e = cache.nodes.get(action.node);
    const group = nearest(e, 'article,li,tr,fieldset,[role="row"],[role="group"]');
    const context = scopeText(group).replace(/\s+/g, ' ').trim().slice(0, 240);
    if (context) action.context = context;
  }
  const words = [], range = document.createRange();
  let length = 0;
  // A host is entered where it stands, so the text of a shadow tree reads where the page puts
  // it, and a banner that exists only inside one is not lost to the model. The whole element
  // root is read, because a page can hang such a banner on the document element itself, and
  // the head is skipped as the body alone used to be.
  const read = root => {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode()) && length < 6000) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        if (node.shadowRoot) read(node.shadowRoot);
        continue;
      }
      const value = node.textContent.trim(), parent = node.parentElement;
      if (!value || !parent || nearest(parent, 'head,script,style,noscript,template') ||
        !visible(parent)) continue;
      range.selectNodeContents(node);
      if (!inView(range.getBoundingClientRect())) continue;
      words.push(value);
      length += value.length;
    }
  };
  // A modal owns both the offered controls and the text budget: background
  // navigation must not crowd its instructions and validation errors out.
  if (scope) read(scope);
  else read(document.documentElement);
  const text = words.join('\n').slice(0, 6000), height = document.documentElement.scrollHeight;
  const page_key = cache.pageKey(), guards = {};
  found.clear(); // A later call runs outside the pass, and reads the page as it stands then.
  // Compare meaning and identity. Geometry is always resolved and hit-tested just before input.
  const semantics = actions.map(({rect, ...action}) => action);
  const marker = [performance.timeOrigin, location.href, scrollX, scrollY, innerWidth, innerHeight,
    document.title, text, semantics, page_key[6]];
  // Freshness needs full semantics, but no per-target guards or action numbering.
  if (markerOnly) { release(); return {marker}; }
  const omitted_actions = Math.max(0, actions.length - 250);
  actions.splice(250);
  for (const action of actions) if (!(action.node in guards)) guards[action.node] = cache.guard(cache.nodes.get(action.node));
  actions.forEach((action, index) => Object.assign(action, {id: 'e' + (index + 1)}));
  if (scrollY + innerHeight < height - 2) actions.push({id: 'scroll_down', kind: 'scroll', label: 'Scroll down', delta: 560});
  if (scrollY > 0) actions.push({id: 'scroll_up', kind: 'scroll', label: 'Scroll up', delta: -560});
  actions.push({id: 'wait', kind: 'wait', label: 'Wait for the page to update'});
  release();
  return {url: location.href, title: document.title, w: innerWidth, h: innerHeight, text,
    scroll: {y: scrollY, height}, actions, marker, page_key, guards, omitted_actions};
})

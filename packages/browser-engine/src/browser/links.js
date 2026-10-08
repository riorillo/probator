/**
 * Keeps every navigation a click starts in the tab the harness is watching. A link, a form or
 * a `base` element that would open a second tab takes the run away from it: the watched tab
 * never changes, so the step looks like a page that stood still, and the loop guard stops a
 * run that is in fact still moving. A click is not touched, only what it navigates: the
 * target of an opener is pointed back at this tab, and `window.open` navigates here.
 * A target that names a frame of this page is left alone, because that frame is this page.
 * The rewrite is invisible to the state reader: no fingerprint, marker or guard reads `target`.
 * The harness runs it in every document of the tab, before any page script does.
 */
(() => {
  const SELF = '_self';
  // Elements whose click can be sent to another tab: `target` on the opener itself, and the
  // `formtarget` a submit button overrides its form with.
  const OPENERS = '[target],[formtarget]';
  const framed = name => [...document.querySelectorAll('iframe,frame')].some(f => f.name === name);
  const opens = name => !!name && name !== SELF && name !== '_top' && name !== '_parent' &&
    (name === '_blank' || !framed(name));
  const fix = e => {
    if (opens(e.target)) e.target = SELF;
    if (opens(e.formTarget)) e.formTarget = SELF;
  };
  const sweep = root => {
    if (root.nodeType === 1) fix(root);
    for (const e of root.querySelectorAll(OPENERS)) fix(e);
  };
  new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'attributes') fix(record.target);
      else for (const node of record.addedNodes) if (node.nodeType === 1) sweep(node);
    }
  }).observe(document, {subtree: true, childList: true, attributes: true,
    attributeFilter: ['target', 'formtarget']});
  sweep(document);
  const open = window.open;
  window.open = function (url, name, features) {
    if (name && framed(name)) return open.call(window, url, name, features);
    const target = typeof url === 'string' ? url.trim() : '';
    if (target && target !== 'about:blank') location.assign(target);
    return null;
  };
})()

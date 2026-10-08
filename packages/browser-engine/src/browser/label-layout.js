/** Pure viewport-space layout. IDs and target rectangles are never changed. */
(rects, width, height, text = []) => {
  const placed = [];
  const overlap = (a, b) => {
    const ar = a.left + a.width, br = b.left + b.width;
    const ab = a.top + a.height, bb = b.top + b.height;
    if (a.left >= br || b.left >= ar || a.top >= bb || b.top >= ab) return 0;
    return ((ar < br ? ar : br) - (a.left > b.left ? a.left : b.left)) *
      ((ab < bb ? ab : bb) - (a.top > b.top ? a.top : b.top));
  };
  for (const {rect, index} of rects) {
    const w = Math.min(width, String(index).length * 8 + 10), h = Math.min(height, 20);
    const right = rect.left + rect.width, bottom = rect.top + rect.height;
    const candidates = [
      [rect.left, rect.top - h - 2], [right - w, rect.top - h - 2],
      [rect.left, bottom + 2], [right - w, bottom + 2],
      [rect.left - w - 2, rect.top], [right + 2, rect.top],
      [rect.left, rect.top], [right - w, rect.top],
      [rect.left, bottom - h], [right - w, bottom - h],
    ];
    // Dense calendars/toolbars may need another row of labels. Keep displacement bounded.
    for (const offset of [-44, -22, 22, 44]) {
      candidates.push([rect.left + offset, rect.top - h - 2], [rect.left + offset, bottom + 2]);
    }
    let best = null, score = Infinity;
    for (const [x, y] of candidates) {
      const box = {left: Math.max(0, Math.min(width - w, x)), top: Math.max(0, Math.min(height - h, y)), width: w, height: h};
      const collisions = placed.reduce((sum, other) => sum + overlap(box, other), 0);
      if (collisions * 1000 >= score) continue;
      const covered = rects.reduce((sum, target) => sum + overlap(box, target.rect) * (target.rect === rect ? 2 : 100), 0);
      if (collisions * 1000 + covered >= score) continue;
      const obscuredText = text.reduce((sum, bounds) => sum + overlap(box, bounds), 0);
      const dx = Math.max(rect.left - (box.left + w), box.left - right, 0);
      const dy = Math.max(rect.top - (box.top + h), box.top - bottom, 0);
      const cost = collisions * 1000 + covered + obscuredText * 100 + Math.hypot(dx, dy);
      if (cost < score) { best = box; score = cost; }
    }
    placed.push({...best, index, rect});
  }
  return placed;
}

// Drag-and-drop (and keyboard) re-ordering for a row of items: the broker tabs on the board and the broker list in System.
//
//   makeSortable(container, { items, id, onReorder, axis })
//     items()   -> the draggable elements currently in the container, in display order
//     id(el)    -> the stable name of an element (the broker name)
//     onReorder(namesInNewOrder)  called once after a drop or a keyboard move
//     axis      'x' for a horizontal row of tabs, 'y' for a vertical list
//
// Mouse / pen: native HTML5 drag and drop (a drop line shows where the item will land). Keyboard: focus an item and press
// Alt + Arrow keys to move it. Nothing here touches innerHTML, so the app's strict CSP stays valid.

const DRAG_TYPE = 'text/x-freight-signal-order';

export function makeSortable(container, { items, id, onReorder, axis = 'x' }) {
  let dragging = null;
  const horizontal = axis === 'x';
  const names = () => items().map(id);
  const clearMarks = () => items().forEach((el) => el.classList.remove('drop-before', 'drop-after', 'dragging'));

  /** Where would a drop at (x, y) land? -> { target element, after: boolean } */
  const hit = (x, y) => {
    let best = null;
    for (const el of items()) {
      if (el === dragging) continue;
      const r = el.getBoundingClientRect();
      const mid = horizontal ? r.left + r.width / 2 : r.top + r.height / 2;
      const pos = horizontal ? x : y;
      const sameLine = horizontal ? (y >= r.top - 12 && y <= r.bottom + 12) : true;   // wrapped tab rows: only compare within the row under the pointer
      if (!sameLine) continue;
      const d = Math.abs(pos - mid);
      if (!best || d < best.d) best = { el, d, after: pos > mid };
    }
    return best;
  };

  items().forEach((el) => {
    el.draggable = true;
    el.addEventListener('dragstart', (e) => {
      dragging = el; el.classList.add('dragging');
      try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData(DRAG_TYPE, id(el)); e.dataTransfer.setData('text/plain', id(el)); } catch { /* some browsers restrict dataTransfer */ }
    });
    el.addEventListener('dragend', () => { dragging = null; clearMarks(); });
    el.addEventListener('keydown', (e) => {
      if (!e.altKey || !/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
      const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp';
      const list = names(); const i = list.indexOf(id(el)); const j = i + (back ? -1 : 1);
      if (j < 0 || j >= list.length) return;
      e.preventDefault();
      const next = list.slice(); next.splice(i, 1); next.splice(j, 0, id(el));
      onReorder(next);
    });
  });

  container.addEventListener('dragover', (e) => {
    if (!dragging) return;
    e.preventDefault();
    try { e.dataTransfer.dropEffect = 'move'; } catch { /* ignore */ }
    const h = hit(e.clientX, e.clientY);
    items().forEach((el) => el.classList.remove('drop-before', 'drop-after'));
    if (h) h.el.classList.add(h.after ? 'drop-after' : 'drop-before');
  });
  container.addEventListener('drop', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const h = hit(e.clientX, e.clientY);
    const moved = id(dragging);
    clearMarks();
    if (!h) { dragging = null; return; }
    const list = names().filter((n) => n !== moved);
    let at = list.indexOf(id(h.el)) + (h.after ? 1 : 0);
    if (at < 0) at = list.length;
    list.splice(at, 0, moved);
    dragging = null;
    if (list.join('\u0000') !== names().join('\u0000')) onReorder(list);
  });
  container.addEventListener('dragleave', (e) => { if (!container.contains(e.relatedTarget)) items().forEach((el) => el.classList.remove('drop-before', 'drop-after')); });
}

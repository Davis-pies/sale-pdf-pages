const COLS = ['id', 'description', 'category', 'size', 'price', 'flags', 'tag'];
const HEADERS = ['ID', 'Description', 'Category', 'Size', 'Price', 'Flags', 'Tag Printed?'];
const center = (t) => t.x + t.w / 2;

export function parseItems(textItems) {
  const total = textItems.map((t) => t.str.match(/^Total Items:\s*(\d+)/)).find(Boolean);
  const pages = Map.groupBy(textItems, (t) => t.page);
  let bounds = null;
  const rows = [];
  for (const [, items] of [...pages].sort((a, b) => a[0] - b[0])) {
    let body = items;
    const desc = items.find((t) => t.str.trim() === 'Description');
    if (desc) {
      const centers = HEADERS.map((h) => center(items.find((t) => t.str.trim().replace(/^Item /, '') === h && Math.abs(t.y - desc.y) < 15)));
      bounds = centers.slice(1).map((c, i) => (centers[i] + c) / 2);
      body = items.filter((t) => t.y < desc.y - 10); // ponytail: 10pt clears the two-line "Item/ID" header cell
    }
    if (!bounds) continue;
    // The PDF emits text row by row, each row as ID then cells left to right, so rows are read in
    // stream order: text before a page's first ID continues the previous page's row, and text in a
    // column left of the last one seen starts a row whose ID is on the next page.
    let last = -1;
    for (const f of body) {
      const c = bounds.filter((b) => center(f) > b).length;
      if (c === 0 && /^\d+$/.test(f.str.trim())) {
        const id = Number(f.str.trim());
        if (rows.at(-1)?.id === null) rows.at(-1).id = id;
        else rows.push({ id, cells: {} });
      } else {
        if (c < last) rows.push({ id: null, cells: {} });
        if (!rows.length) continue;
        (rows.at(-1).cells[COLS[c]] ??= []).push(f);
      }
      last = c;
    }
  }
  const items = rows.map(({ id, cells }) => {
    const text = (c, sep) => (cells[c] ?? []).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x).map((t) => t.str.replace(/\s+/g, ' ').trim()).join(sep).trim();
    return { id, description: text('description', ' '), category: text('category', ' '), size: text('size', ' '), price: text('price', ' '), flags: text('flags', ', ') };
  });
  return { items, expectedTotal: total ? Number(total[1]) : null };
}

// Youngest → oldest. Revise once more reports are seen; unknown sizes sort after these, A–Z.
export const SIZE_ORDER = ['Infant (0-12 mo)', 'Toddler (1 -2 yr)', '3T/3'];

const sizeRank = (s) => { const i = SIZE_ORDER.indexOf(s); return i < 0 ? SIZE_ORDER.length : i; };

export const compareGroups = (a, b) =>
  a.period - b.period || a.category.localeCompare(b.category) || sizeRank(a.size) - sizeRank(b.size) ||
  a.size.localeCompare(b.size) || a.flags.join(', ').localeCompare(b.flags.join(', '));

// The Flags cell reads like "Discount, No Donate"; pick the part ending in `word`.
const flag = (item, word) => item.flags.split(', ').find((f) => f.endsWith(word)) ?? '';

export function groupItems(items, { discount = false, donate = false } = {}) {
  const groups = new Map();
  for (const item of items) {
    const period = item.description.trim().endsWith('.');
    const flags = [discount && flag(item, 'Discount'), donate && flag(item, 'Donate')].filter((f) => f !== false);
    const key = JSON.stringify([period, item.category, item.size, flags]);
    if (!groups.has(key)) groups.set(key, { period, category: item.category, size: item.size, flags, items: [] });
    groups.get(key).items.push(item);
  }
  for (const g of groups.values()) g.items = sortItems(g.items, 'id');
  return [...groups.values()].sort(compareGroups);
}

const price = (item) => Number(item.price.replace(/[^\d.]/g, ''));

// key: 'id' | 'price'; dir: 'asc' | 'desc'; id breaks ties in the same direction. Returns a new array.
export const sortItems = (items, key, dir = 'asc') =>
  [...items].sort((a, b) => ((key === 'price' ? price(a) - price(b) : 0) || a.id - b.id) * (dir === 'desc' ? -1 : 1));

// Reads a PDF printed from this page back into its tables, in print order: [{ title, ids: [{ id, page, y, bottom }], page, y }].
// Titles are the text 2pt larger than the rows; a "(cont.)" title, or none (One table), continues the table above.
export function parseExport(textItems) {
  const count = new Map();
  for (const t of textItems) count.set(Math.round(t.h), (count.get(Math.round(t.h)) ?? 0) + 1);
  const fontSize = [...count].sort((a, b) => b[1] - a[1])[0]?.[0];
  const size = (t) => Math.round(t.h) - fontSize;
  const captions = Map.groupBy(textItems.filter((t) => size(t) === 2), (t) => `${t.page} ${Math.round(t.y)}`);
  const entries = [...captions.values()].map((line) => {
    line.sort((a, b) => a.x - b.x);
    const text = line.map((t, i) => (i && t.x > line[i - 1].x + line[i - 1].w + 1 ? ' ' : '') + t.str).join('');
    return { page: line[0].page, y: line[0].y, title: text.replace(/\s+/g, ' ').trim().replace(/ \(cont\.\)$/, '') };
  });
  // ponytail: 60pt = 0.5in margin + the 4.5% ID column of 7.5in; move it if the ID column is widened
  const byPosition = (a, b) => a.page - b.page || b.y - a.y;
  let id = null;
  for (const t of textItems.filter((t) => size(t) === 0 && t.x < 60 && /^\d+$/.test(t.str.trim())).sort(byPosition)) {
    // An ID too wide for its column (at larger fonts) wraps onto the next line; rows are further apart than lines.
    if (id?.page === t.page && id.end - t.y < 1.25 * fontSize + 3) id.id = Number(`${id.id}${t.str.trim()}`);
    else entries.push(id = { page: t.page, y: t.y, id: Number(t.str.trim()) });
    id.end = t.y;
  }
  entries.sort(byPosition);
  // A row's lowest line of text, down to the next row or title: what the gap under a table is measured from.
  const body = textItems.filter((t) => size(t) === 0);
  entries.forEach((e, i) => {
    if (e.id == null) return;
    const next = entries[i + 1]?.page === e.page ? entries[i + 1].y : -Infinity;
    e.bottom = Math.min(...body.filter((t) => t.page === e.page && t.y <= e.y && t.y > next).map((t) => t.y));
  });
  const tables = [];
  let table = null;
  for (const e of entries) {
    if (e.title == null) table?.ids.push(e);
    else if (e.title !== table?.title) {
      table = tables.find((t) => t.title === e.title);
      if (!table) tables.push(table = { title: e.title, page: e.page, y: e.y, ids: [] });
    }
  }
  const headers = textItems.some((t) => size(t) === 0 && t.str.trim() === 'Description');
  return { fontSize, headers, tables };
}

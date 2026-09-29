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

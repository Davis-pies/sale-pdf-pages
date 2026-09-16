const COLS = ['id', 'description', 'category', 'size', 'price', 'flags', 'tag'];
const HEADERS = ['ID', 'Description', 'Category', 'Size', 'Price', 'Flags', 'Tag Printed?'];
const center = (t) => t.x + t.w / 2;
const median = (a) => { const s = [...a].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };

export function parseItems(textItems) {
  const total = textItems.map((t) => t.str.match(/^Total Items:\s*(\d+)/)).find(Boolean);
  const pages = Map.groupBy(textItems, (t) => t.page);
  let bounds = null;
  const parsed = []; // { page, anchor, frags, rows? }
  for (const [page, items] of [...pages].sort((a, b) => a[0] - b[0])) {
    let body = items;
    const desc = items.find((t) => t.str.trim() === 'Description');
    if (desc) {
      const centers = HEADERS.map((h) => center(items.find((t) => t.str.trim() === h && Math.abs(t.y - desc.y) < 15)));
      bounds = centers.slice(1).map((c, i) => (centers[i] + c) / 2);
      body = items.filter((t) => t.y < desc.y - 10); // ponytail: 10pt clears the two-line "Item/ID" header cell
    }
    if (!bounds) continue;
    const col = (t) => COLS[bounds.filter((b) => center(t) > b).length];
    const anchors = body.filter((t) => col(t) === 'id' && /^\d+$/.test(t.str.trim())).sort((a, b) => b.y - a.y);
    parsed.push({ anchors, frags: body.filter((t) => !anchors.includes(t)), col });
  }
  const gaps = parsed.flatMap((p) => p.anchors.slice(1).map((a, i) => p.anchors[i].y - a.y));
  const maxLead = 0.75 * (gaps.length ? median(gaps) : 24);

  const rows = [];
  for (const { anchors, frags, col } of parsed) {
    const prev = rows.at(-1);
    const pageRows = anchors.map((a) => ({ id: Number(a.str.trim()), y: a.y, cells: {} }));
    for (const f of frags) {
      let row;
      if (!pageRows.length || f.y > pageRows[0].y + maxLead) row = prev; // continuation of a row split across pages
      else row = pageRows.reduce((best, r) => (Math.abs(r.y - f.y) < Math.abs(best.y - f.y) ? r : best), pageRows[0]);
      if (!row) continue;
      (row.cells[col(f)] ??= []).push(f);
    }
    rows.push(...pageRows);
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

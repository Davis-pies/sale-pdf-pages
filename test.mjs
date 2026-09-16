import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseItems, groupItems, sortItems, SIZE_ORDER } from './lib.mjs';

// Synthetic report text laid out like a real Consignor Inventory Report: every cell is
// centered on its column, and wrapped lines sit 11.2pt apart around the row's center.
const CENTERS = { id: 66.35, description: 138.75, category: 240.15, size: 331.75, price: 394.65, flags: 451.9, tag: 527.35 };
const frag = (page, str, cx, y) => ({ page, str, x: cx - str.length * 2.25, y, w: str.length * 4.5 });
const cell = (page, col, y, lines) => lines.map((s, i) => frag(page, s, CENTERS[col], y + ((lines.length - 1) / 2 - i) * 11.2));
const header = (page) => [
  frag(page, 'Item', CENTERS.id, 628.6), frag(page, 'ID', CENTERS.id, 617.4),
  ...['Description', 'Category', 'Size', 'Price', 'Flags'].map((h) => frag(page, h, CENTERS[h.toLowerCase()], 623)),
  frag(page, 'Tag Printed?', CENTERS.tag, 623),
];
const row = (page, y, id, { description, category = ['Toys'], size = ['Leave Blank'], price = ['$1.00'], flags = ['Discount', 'No Donate'] }) => [
  frag(page, String(id), CENTERS.id, y),
  ...cell(page, 'description', y, description), ...cell(page, 'category', y, category), ...cell(page, 'size', y, size),
  ...cell(page, 'price', y, price), ...cell(page, 'flags', y, flags), frag(page, 'No', CENTERS.tag, y),
];
const report = [
  frag(1, 'Test Sale', 300, 730), frag(1, 'Consignor #1 - Test Person', 300, 685), frag(1, 'Total Items: 4', 300, 658),
  ...header(1),
  ...row(1, 599, 7, { description: ['Red Wagon', 'Metal Frame'], category: ['Outdoor Play'], price: ['$9.00'] }),
  ...row(1, 569.4, 8, { description: ['Wooden Blocks', 'Set of 40', 'With Bag'], size: ['Toddler (1 -2 yr)'], flags: ['No Discount', 'No Donate'] }),
  ...row(1, 534.2, 9, { description: ['Puzzle Pieces', '12'], category: ['Kitchen Supplies and Utensils Bundle'] }),
  ...row(1, 510.2, 10, { description: ['Rain Boots.'], flags: ['Discount'] }),
];

test('parses every row and the expected total', () => {
  const { items, expectedTotal } = parseItems(report);
  assert.equal(expectedTotal, 4);
  assert.deepEqual(items.map((i) => i.id), [7, 8, 9, 10]);
});

test('joins cells that wrap across multiple lines', () => {
  const byId = Object.fromEntries(parseItems(report).items.map((i) => [i.id, i]));
  assert.deepEqual(byId[7], {
    id: 7, description: 'Red Wagon Metal Frame', category: 'Outdoor Play',
    size: 'Leave Blank', price: '$9.00', flags: 'Discount, No Donate',
  });
  assert.equal(byId[8].description, 'Wooden Blocks Set of 40 With Bag');
  assert.equal(byId[8].flags, 'No Discount, No Donate');
  assert.equal(byId[9].description, 'Puzzle Pieces 12'); // numeric line outside the ID column is not a row
  // wide centered text starts left of the Category header but still belongs to Category:
  assert.equal(byId[9].category, 'Kitchen Supplies and Utensils Bundle');
  assert.equal(byId[10].description, 'Rain Boots.');
});

test('no header or title text leaks into rows', () => {
  const text = JSON.stringify(parseItems(report).items);
  for (const s of ['Description', 'Tag Printed', 'Consignor', 'Total Items', 'Test Sale']) assert.ok(!text.includes(s), s);
});

test('row split across a page break is rejoined', () => {
  const page2 = [
    ...header(2),
    frag(2, 'Extra Line', CENTERS.description, 590), // tail of row 10, well above row 11
    ...row(2, 540, 11, { description: ['Solo'] }),
  ];
  const { items } = parseItems([...report, ...page2]);
  assert.deepEqual(items.map((i) => i.id).slice(-2), [10, 11]);
  assert.equal(items.at(-2).description, 'Rain Boots. Extra Line');
  assert.equal(items.at(-1).description, 'Solo');
});

test('continuation on a page with no row IDs is kept', () => {
  const page2 = [...header(2), frag(2, 'TAIL', CENTERS.description, 590)];
  const { items } = parseItems([...report, ...page2]);
  assert.equal(items.length, 4);
  assert.equal(items.at(-1).description, 'Rain Boots. TAIL');
});

const item = (id, description, category, size) => ({ id, description, category, size, price: '$1.00', flags: '' });

test('groups by owner, category and size; period groups come last', () => {
  const groups = groupItems([
    item(5, 'Owner B item.', 'Books', 'Leave Blank'),
    item(3, 'Shirt', 'Tops', SIZE_ORDER[2]),
    item(1, 'Shirt', 'Tops', SIZE_ORDER[0]),
    item(4, 'Owner B shirt.', 'Tops', SIZE_ORDER[0]),
    item(2, 'Rattle', 'Toys', SIZE_ORDER[0]),
    item(6, 'Another', 'Tops', SIZE_ORDER[0]),
  ]);
  assert.deepEqual(groups.map((g) => [g.period, g.category, g.size, g.items.map((i) => i.id)]), [
    [false, 'Tops', SIZE_ORDER[0], [1, 6]],
    [false, 'Tops', SIZE_ORDER[2], [3]],
    [false, 'Toys', SIZE_ORDER[0], [2]],
    [true, 'Books', 'Leave Blank', [5]],
    [true, 'Tops', SIZE_ORDER[0], [4]],
  ]);
});

test('sizes follow SIZE_ORDER, unknown sizes last A–Z', () => {
  const sizes = groupItems([
    item(1, 'a', 'Toys', 'Zeta'),
    item(2, 'a', 'Toys', 'Alpha'),
    item(3, 'a', 'Toys', SIZE_ORDER[1]),
    item(4, 'a', 'Toys', SIZE_ORDER[0]),
  ]).map((g) => g.size);
  assert.deepEqual(sizes, [SIZE_ORDER[0], SIZE_ORDER[1], 'Alpha', 'Zeta']);
});

test('sortItems by id or numeric price, id breaks price ties', () => {
  const items = [
    { id: 3, price: '$10.00' }, { id: 1, price: '$2.50' }, { id: 4, price: '$2.50' }, { id: 2, price: '$9.00' },
  ];
  assert.deepEqual(sortItems(items, 'id').map((i) => i.id), [1, 2, 3, 4]);
  assert.deepEqual(sortItems(items, 'price').map((i) => i.id), [1, 4, 2, 3]);
  assert.deepEqual(items.map((i) => i.id), [3, 1, 4, 2]); // input untouched
});

test('sortItems descending reverses both key and id tie-break', () => {
  const items = [
    { id: 3, price: '$10.00' }, { id: 1, price: '$2.50' }, { id: 4, price: '$2.50' }, { id: 2, price: '$9.00' },
  ];
  assert.deepEqual(sortItems(items, 'id', 'desc').map((i) => i.id), [4, 3, 2, 1]);
  assert.deepEqual(sortItems(items, 'price', 'desc').map((i) => i.id), [3, 2, 4, 1]);
});

test('groupItems optionally splits on Discount and Donate flags', () => {
  const f = (id, flags) => ({ id, description: 'x', category: 'Toys', size: 'Leave Blank', price: '$1.00', flags });
  const items = [f(1, 'No Discount, Donate'), f(2, 'Discount, No Donate'), f(3, 'Discount, Donate'), f(4, 'No Discount, No Donate')];
  const summary = (groups) => groups.map((g) => [g.flags, g.items.map((i) => i.id)]);
  assert.deepEqual(summary(groupItems(items)), [[[], [1, 2, 3, 4]]]);
  assert.deepEqual(summary(groupItems(items, { discount: true })), [[['Discount'], [2, 3]], [['No Discount'], [1, 4]]]);
  assert.deepEqual(summary(groupItems(items, { donate: true })), [[['Donate'], [1, 3]], [['No Donate'], [2, 4]]]);
  assert.deepEqual(summary(groupItems(items, { discount: true, donate: true })), [
    [['Discount', 'Donate'], [3]], [['Discount', 'No Donate'], [2]], [['No Discount', 'Donate'], [1]], [['No Discount', 'No Donate'], [4]],
  ]);
});

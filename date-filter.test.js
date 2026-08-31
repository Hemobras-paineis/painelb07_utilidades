const assert = require('assert');
const { filterDateRange, normalizeDateValue, resolveBlockSeries, buildDataStateFromCsv } = require('./script.js');

assert.strictEqual(normalizeDateValue('2026-08-01'), '2026-08-01');
assert.deepStrictEqual(
  filterDateRange(['01/08', '02/08', '03/08', '04/08'], '2026-08-02', '2026-08-03'),
  { labels: ['02/08', '03/08'], indexes: [1, 2] }
);
assert.deepStrictEqual(
  resolveBlockSeries({ all: [10, 20, 30], '7A': [40, 50, 60], '7B': [70, 80, 90] }, '7A'),
  [40, 50, 60]
);

const googleLikeCsv = [
  'DATA,DW7,DW7B,NITROGENIO,TESTE DE CLORO',
  '01/08/2026,"29,7","167,3","143,8","1,31"',
  '02/08/2026,"14,9","158,2","137,2","1,53"'
].join('\n');

const parsed = buildDataStateFromCsv(googleLikeCsv);
assert.deepStrictEqual(parsed.dw7A.slice(0, 2), [167.3, 158.2]);
assert.deepStrictEqual(parsed.dw7B.slice(0, 2), [29.7, 14.9]);
assert.deepStrictEqual(parsed.nitrogenNivel.slice(0, 2), [143.8, 137.2]);
assert.deepStrictEqual(parsed.cloroPpm.slice(0, 2), [1.31, 1.53]);

console.log('date-filter.test.js: OK');

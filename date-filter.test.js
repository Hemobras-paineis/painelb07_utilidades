const assert = require('assert');
const {
  filterDateRange,
  normalizeDateValue,
  resolveBlockSeries,
  parseCsvText,
  extractChlorineSeries,
  buildDataStateFromCsv,
  parseNumberValue,
  extractExtraColumns,
  extractColumnUnit,
  formatChartValueWithUnit,
  getDailyBoilerConsumption,
  getDailyColumnValues,
  getDailyChlorineValues
} = require('./script.js');

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

const obsCsv = [
  'DATA,DW7B,Obervação,DW7A,Observação,NITROGENIO',
  '01/08/2026,"29,7",obs B,"167,3",obs A,"143,8"',
  '02/08/2026,"14,9",,"158,2",,"137,2"'
].join('\n');
const parsedObs = buildDataStateFromCsv(obsCsv);
assert.deepStrictEqual(parsedObs.obsDw7A, ['obs A', '']);
assert.deepStrictEqual(parsedObs.obsDw7B, ['obs B', '']);
assert.deepStrictEqual(parsedObs.dw7A, [167.3, 158.2]);

const multilineHeaderCsv = [
  'DATA,"CONSUMO GÁS NATURAL',
  'TOTAL ((Nm³/h))",OBSERVAÇÃO',
  '01/02/2026,"12,5",Leitura válida',
  '02/02/2026,"13,2",Leitura válida'
].join('\n');
assert.strictEqual(parseCsvText(multilineHeaderCsv).length, 2);
const extraColumns = extractExtraColumns(multilineHeaderCsv);
const gasColumn = extraColumns.columns.find(column => column.numeric);
assert.ok(gasColumn);
assert.strictEqual(gasColumn.unit, 'Nm³/h');
assert.deepStrictEqual(extraColumns.rows.map(row => row.values[gasColumn.key]), ['12,5', '13,2']);
assert.strictEqual(parseNumberValue('12,5 Nm³/h'), 12.5);
assert.strictEqual(extractColumnUnit('Temperatura [°C]'), '°C');
assert.strictEqual(formatChartValueWithUnit('12,5', 'Nm³/h'), '12,5 Nm³/h');
assert.strictEqual(formatChartValueWithUnit('12,5 Nm³/h', 'Nm³/h'), '12,5 Nm³/h');
assert.strictEqual(formatChartValueWithUnit('-', 'Nm³/h'), '-');

const boilerCsv = [
  'DATA,"CONSUMO GÁS NATURAL - B07 CALDEIRA 02 (Nm³/h)","CONSUMO GÁS NATURAL - B07 CALDEIRA 03 (Nm³/h)","CONSUMO GÁS NATURAL - B10 CALDEIRA 01 (Nm³/h)","CONSUMO GÁS NATURAL - B10 CALDEIRA 02 (Nm³/h)"',
  '23/10/2026,"75,0","-","45,2","44,8"'
].join('\n');
const boilerData = extractExtraColumns(boilerCsv);
assert.deepStrictEqual(
  getDailyBoilerConsumption(boilerData.columns, boilerData.rows, '23/10/2026'),
  {
    b07Caldeira02: '75,0 Nm³/h',
    b07Caldeira03: '-',
    b10Caldeira01: '45,2 Nm³/h',
    b10Caldeira02: '44,8 Nm³/h'
  }
);
assert.deepStrictEqual(
  getDailyBoilerConsumption(boilerData.columns, boilerData.rows, '22/10/2026'),
  { b07Caldeira02: '--', b07Caldeira03: '--', b10Caldeira01: '--', b10Caldeira02: '--' }
);

const wellsCsv = [
  'DATA,"CONSUMO DO POÇO 1 (m³)","CONSUMO DO POÇO 2 (m³)","CONSUMO DO POÇO 3 (m³)"',
  '23/10/2026,"120,5","98,0","-"'
].join('\n');
const wellsData = extractExtraColumns(wellsCsv);
assert.deepStrictEqual(
  getDailyColumnValues(wellsData.columns, wellsData.rows, '23/10/2026', [
    { key: 'poco1', pattern: /pocos?[^0-9]*0?1(?:$|[^0-9])/ },
    { key: 'poco2', pattern: /pocos?[^0-9]*0?2(?:$|[^0-9])/ },
    { key: 'poco3', pattern: /pocos?[^0-9]*0?3(?:$|[^0-9])/ }
  ]),
  { poco1: '120,5 m³', poco2: '98,0 m³', poco3: '-' }
);
assert.deepStrictEqual(
  getDailyChlorineValues([
    { name: 'TESTE DE CLORO - B07', values: [1.25] },
    { name: 'TESTE DE CLORO - B12', values: [null] },
    { name: 'TESTE DE CLORO - B14', values: [2] }
  ], 0),
  { b07: '1.25 ppm', b12: '--', b14: '2.00 ppm' }
);
const chlorineSeries = extractChlorineSeries([
  'DATA,"B07 TESTE DE CLORO","B12 TESTE DE CLORO","B14 TESTE DE CLORO"',
  '23/10/2026,"1,25","1,50","2,00"'
].join('\n'));
assert.deepStrictEqual(getDailyChlorineValues(chlorineSeries, 0), {
  b07: '1.25 ppm',
  b12: '1.50 ppm',
  b14: '2.00 ppm'
});

console.log('date-filter.test.js: OK');

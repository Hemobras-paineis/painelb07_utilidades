const DEFAULT_YEAR = 2026;
const DASHBOARD_RECENT_DAYS = 10;
const AUTO_REFRESH_INTERVAL_MS = 60 * 1000;

// Register ChartJS Datalabels plugin
if (typeof Chart !== 'undefined' && typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

function normalizeDateValue(dateValue) {
    if (!dateValue && dateValue !== 0) return '';
    const value = String(dateValue).trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }

    const shortMatch = value.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
    if (!shortMatch) {
        return value;
    }

    const [, day, month, year = DEFAULT_YEAR] = shortMatch;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

function filterDateRange(labels, startDate, endDate, fallbackYear = DEFAULT_YEAR) {
    const start = normalizeDateValue(startDate);
    const end = normalizeDateValue(endDate);

    if (!start || !end) {
        return { labels: [...labels], indexes: labels.map((_, index) => index) };
    }

    const startDateTime = new Date(`${start}T00:00:00`).getTime();
    const endDateTime = new Date(`${end}T23:59:59`).getTime();

    const filtered = [];
    const indexes = [];

    labels.forEach((label, index) => {
        const parsedLabel = normalizeDateValue(label);
        const normalisedValue = parsedLabel.includes('-') ? parsedLabel : `${fallbackYear}-${parsedLabel.slice(3, 5)}-${parsedLabel.slice(0, 2)}`;
        const dateValue = new Date(`${normalisedValue}T00:00:00`).getTime();

        if (!Number.isNaN(dateValue) && dateValue >= startDateTime && dateValue <= endDateTime) {
            filtered.push(label);
            indexes.push(index);
        }
        });

    return { labels: filtered, indexes };
}

function resolveBlockSeries(seriesByBlock, selectedBlock) {
    if (!selectedBlock || selectedBlock === 'all') {
        return seriesByBlock.all || [];
    }

    return seriesByBlock[selectedBlock] || [];
}

function normalizeCsvHeader(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-zA-Z0-9]/g, '')
        .toLowerCase();
}

function splitCsvLine(line) {
    const delimiter = line.includes(';') && !line.includes(',') ? ';' : ',';
    const values = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i += 1;
            } else {
                inQuotes = !inQuotes;
            }
            continue;
        }

        if (char === delimiter && !inQuotes) {
            values.push(current.trim());
            current = '';
            continue;
        }

        current += char;
    }

    values.push(current.trim());
    return values;
}

function splitCsvRecords(csvText) {
    const text = String(csvText || '').replace(/^\uFEFF/, '').trim();
    if (!text) return [];

    const records = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i += 1) {
        const char = text[i];

        if (char === '"') {
            if (inQuotes && text[i + 1] === '"') {
                current += '""';
                i += 1;
                continue;
            }
            inQuotes = !inQuotes;
            current += char;
            continue;
        }

        if (char === '\n' && !inQuotes) {
            if (current.trim()) records.push(current);
            current = '';
            continue;
        }

        if (char !== '\r' || inQuotes || text[i + 1] !== '\n') {
            current += char;
        }
    }

    if (current.trim()) records.push(current);
    return records;
}

function parseCsvText(csvText) {
    if (!csvText || !csvText.trim()) return [];

    const records = splitCsvRecords(csvText);
    if (!records.length) return [];

const headerCounts = new Map();
const headers = splitCsvLine(records[0]).map((cell) => {
const header = normalizeCsvHeader(cell);
const count = (headerCounts.get(header) || 0) + 1;
headerCounts.set(header, count);
return count === 1 ? header : `${header}${count}`;
});
    return records.slice(1).map((line) => {
        const values = splitCsvLine(line);
        const row = {};
        headers.forEach((header, index) => {
            row[header] = values[index] ?? '';
        });
        return row;
    });
}

function parseNumberValue(rawValue) {
    if (rawValue === undefined || rawValue === null || String(rawValue).trim() === '') {
        return 0;
    }

    const numericPrefix = String(rawValue).trim().replace(/\s+/g, '').match(/^-?[\d.,]+/);
    const sanitized = numericPrefix ? numericPrefix[0] : '';
    if (!sanitized) return 0;

    const hasComma = sanitized.includes(',');
    const hasDot = sanitized.includes('.');

    let normalized = sanitized;

    if (hasComma && hasDot) {
        normalized = sanitized.replace(/\./g, '').replace(',', '.');
    } else if (hasComma) {
        normalized = sanitized.replace(',', '.');
    } else if (hasDot && sanitized.split('.').length > 2) {
        normalized = sanitized.replace(/\./g, '');
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
}

function formatHoursValue(rawValue) {
    const numeric = parseNumberValue(rawValue);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return '0h';
    }
    return `${numeric.toFixed(1).replace(/\.0$/, '')}h`;
}

function extractChlorineSeries(csvText) {
    const records = splitCsvRecords(csvText);
    if (records.length < 2) return [];
    const cells = splitCsvLine(records[0]);
    const norm = cells.map((cell) => normalizeCsvHeader(cell));
    const dataRows = records.slice(1).map((line) => splitCsvLine(line));
    const toNumber = (raw) => {
        const text = String(raw ?? '').trim();
        return text ? parseNumberValue(text) : null;
    };
    const series = [];
    norm.forEach((header, index) => {
        if (!/^(testedecloro|testecloro|cloro|b(?:07|12|14).*cloro)/.test(header)) return;
        const hasReteste = (norm[index + 1] || '').startsWith('reteste');
        series.push({
            name: cells[index].replace(/\s+/g, ' ').trim(),
            retesteName: hasReteste ? cells[index + 1].replace(/\s+/g, ' ').trim() : '',
            values: dataRows.map((row) => toNumber(row[index])),
            reteste: hasReteste ? dataRows.map((row) => toNumber(row[index + 1])) : dataRows.map(() => null)
        });
    });
    return series;
}

function buildDataStateFromCsv(csvText) {
    const rows = parseCsvText(csvText);
    if (!rows.length) {
        return null;
    }

    const getValue = (row, keys) => {
        const normalizedAliases = new Set(keys.map(key => normalizeCsvHeader(key)));

        for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null && String(value).trim() !== '') {
                return String(value).trim();
            }
        }

        for (const [rowKey, value] of Object.entries(row)) {
            if (normalizedAliases.has(normalizeCsvHeader(rowKey))) {
                const textValue = String(value ?? '').trim();
                if (textValue) {
                    return textValue;
                }
            }
        }

        // Nomes com sufixo (ex.: "TESTE DE CLORO - B07") casam pelo início; vence a primeira coluna.
        for (const [rowKey, value] of Object.entries(row)) {
            const normalizedKey = normalizeCsvHeader(rowKey);
            if ([...normalizedAliases].some((alias) => alias.length >= 5 && normalizedKey.startsWith(alias))) {
                const textValue = String(value ?? '').trim();
                if (textValue) {
                    return textValue;
                }
            }
        }

        return '';
    };

    const diasAgosto = rows.map((row) => getValue(row, ['data', 'date', 'dia', 'datas'])).filter(Boolean);

    const dwValues = rows.map((row) => {
        const raw7A = getValue(row, ['dw7a', 'dw7A', 'dw7aValue', 'dwa', 'dw 7a', 'dw7 a']);
        const raw7B = getValue(row, ['dw7b', 'dw7B', 'dw7bValue', 'dwb', 'dw 7b', 'dw7 b']);
        const raw7 = getValue(row, ['dw7', 'dw7value', 'dw7Total']);

        const value7A = parseNumberValue(raw7A);
        const value7B = parseNumberValue(raw7B);
        const value7 = parseNumberValue(raw7);

        if (!raw7A && !raw7B && value7 > 0) {
            return { dw7A: value7, dw7B: 0 };
        }

        if (!raw7A && raw7B && value7 > 0) {
            return {
                dw7A: value7B,
                dw7B: value7,
            };
        }

        if (raw7A || raw7B || raw7) {
            if (value7B > 0 && value7 > 0 && value7B > value7) {
                return {
                    dw7A: value7B,
                    dw7B: value7,
                };
            }

            if (value7A > 0 && value7B > 0) {
                return {
                    dw7A: value7A,
                    dw7B: value7B,
                };
            }
        }

        return {
            dw7A: value7A || value7 || 0,
            dw7B: value7B || 0,
        };
    });

    const dw7A = dwValues.map(item => item.dw7A);
    const dw7B = dwValues.map(item => item.dw7B);

    // A observação de cada DW é a coluna imediatamente à direita dele na planilha.
const rowKeys = Object.keys(rows[0] || {});
const getObservations = (dwKey) => {
    const dwIndex = rowKeys.indexOf(dwKey);
    const obsKey = dwIndex >= 0 && /^ob[a-z]*rvacao/.test(rowKeys[dwIndex + 1] || '') ? rowKeys[dwIndex + 1] : null;
    return rows.map((row) => (obsKey ? String(row[obsKey] ?? '').trim() : ''));
};
const obsDw7A = getObservations('dw7a');
const obsDw7B = getObservations('dw7b');
const nitrogenNivel = rows.map((row) => parseNumberValue(getValue(row, ['nitrogenio', 'nitrogenioppm', 'nitrogenioNivel', 'nitrogenioN', 'nitrogenioL', 'n2', 'nitrogenio1', 'nitrogenioff'])));
const cloroPpm = rows.map((row) => parseNumberValue(getValue(row, ['cloro', 'cloroppm', 'cloroPpm', 'testecloro', 'testedecloro', 'testedecloroppm', 'chlor', 'teste de cloro'])));
const retestePpm = rows.map((row) => {
    const value = getValue(row, ['reteste', 'retestecloro', 'testedereteste']);
    return value ? parseNumberValue(value) : null;
});

    const nitroData = rows
        .map((row) => ({
            d: getValue(row, ['data', 'date', 'dia', 'datas']),
            n: getValue(row, ['nitrogenio', 'nitrogenioppm', 'nitrogenioNivel', 'nitrogenioN', 'nitrogenioL', 'n2', 'nitrogenio1', 'nitrogenioff']),
            r: getValue(row, ['reabastecimento', 'refill', 'reposicao'])
        }))
        .filter((item) => item.d && item.r && item.r !== '-');

    return { diasAgosto, dw7A, dw7B, obsDw7A, obsDw7B, nitrogenNivel, cloroPpm, retestePpm, nitroData, cloroSeries: extractChlorineSeries(csvText) };
}

function buildDowntimeStateFromCsv(csvText) {
    const records = splitCsvRecords(csvText);
    if (records.length < 2) return [];

    // O cabeçalho pode não ser a primeira linha (ex.: linha em branco acima na aba).
    let headerRow = -1;
    let headers = [];
    for (let r = 0; r < Math.min(records.length, 15); r += 1) {
        const candidate = splitCsvLine(records[r]).map(cell => normalizeCsvHeader(cell));
        if (candidate.includes('utilidade') && candidate.includes('paradas')) {
            headerRow = r;
            headers = candidate;
            break;
        }
    }
    if (headerRow < 0) return [];

    const utilityIndex = headers.indexOf('utilidade');
    const dateIndex = headers.reduce((found, header, index) => (header === 'data' && index < utilityIndex ? index : found), -1);
    const stopsIndex = headers.indexOf('paradas');
    const hoursIndex = headers.findIndex(header => header.includes('tempoindisponivel'));
    const commentIndex = headers.findIndex(header => header.includes('comentario'));

    if ([dateIndex, utilityIndex, stopsIndex, hoursIndex, commentIndex].some(index => index < 0)) {
        return [];
    }

    return records.slice(headerRow + 1).map((line) => {
        const values = splitCsvLine(line);
        const utility = values[utilityIndex]?.trim();
        const hours = formatHoursValue(values[hoursIndex]);

        if (!utility || hours === '0h') return null;

        return {
            d: values[dateIndex]?.trim() || 'N/D',
            u: utility,
            p: values[stopsIndex]?.trim() || '0',
            h: hours,
            m: values[commentIndex]?.trim() || 'Sem detalhe'
        };
    }).filter(Boolean);
}

// Detecta colunas novas da planilha (não mapeadas nos módulos existentes) para exibição automática.
const KNOWN_COLUMN_PATTERN = /^(data|date|dia|datas|dw7|dw7a|dw7b|dwa|dwb|dw7value|nitrogenio\w*|n2|cloro\w*|chlor|testecloro\w*|testedecloro\w*|reteste\w*|testedereteste|reabastecimento|refill|reposicao|utilidade|paradas|tempoindisponivel\w*|comentario\w*)\d*$/;

function extractExtraColumns(csvText) {
    const records = splitCsvRecords(csvText);
    if (records.length < 2) return { columns: [], rows: [] };

    const labels = splitCsvLine(records[0]);
    const norm = labels.map(normalizeCsvHeader);
    const dateIndexes = [];
    norm.forEach((header, index) => { if (/^(data|date|dia|datas)$/.test(header)) dateIndexes.push(index); });
    if (!dateIndexes.length) return { columns: [], rows: [] };

    const extras = [];
    norm.forEach((header, index) => {
        if (!header || dateIndexes.includes(index)) return;
        const isDwObservation = /^ob[a-z]*rvacao\d*$/.test(header) && /^dw7[ab]$/.test(norm[index - 1] || '');
        if (isDwObservation || KNOWN_COLUMN_PATTERN.test(header)) return;
        const dateIndex = [...dateIndexes].reverse().find(di => di < index) ?? dateIndexes[0];
        const label = labels[index].replace(/\s+/g, ' ').trim() || `Coluna ${index + 1}`;
        extras.push({ index, dateIndex, label, unit: extractColumnUnit(label), key: `${header}_${index}` });
    });
    if (!extras.length) return { columns: [], rows: [] };

    const byDate = new Map();
    const parsedLines = records.slice(1).map(splitCsvLine);
    extras.forEach((col) => {
        let numericCount = 0;
        let filledCount = 0;
        parsedLines.forEach((values) => {
            const date = (values[col.dateIndex] || '').trim();
            const raw = (values[col.index] || '').trim();
            if (!date || !raw) return;
            filledCount += 1;
            if (/^-?[\d.,]+/.test(raw) && Number.isFinite(parseNumberValue(raw))) numericCount += 1;
            if (!byDate.has(date)) byDate.set(date, {});
            byDate.get(date)[col.key] = raw;
        });
        col.numeric = filledCount > 0 && numericCount === filledCount;
    });

    const columns = extras.filter(col => parsedLines.some(values => (values[col.index] || '').trim()));
    const rows = [...byDate.entries()]
        .map(([date, values]) => ({ date, values }))
        .sort((a, b) => normalizeDateValue(a.date).localeCompare(normalizeDateValue(b.date)));
    return { columns, rows };
}

function extractColumnUnit(label) {
    const match = String(label || '').trim().match(/\(\(([^()]*)\)\)\s*$|\(([^()]*)\)\s*$|\[([^\]]+)\]\s*$/);
    return (match?.[1] || match?.[2] || match?.[3] || '').trim();
}

function isGnB07Column(col) {
    const key = normalizeCsvHeader(col.label);
    return Boolean(col.numeric) && /b07/.test(key) && /caldeira0?[23]($|[^0-9])/.test(key) && /caldeira|gn|gasnatural/.test(key);
}

function formatChartValueWithUnit(rawValue, unit) {
    const value = String(rawValue ?? '').trim();
    if (!value || value === '-' || value === '—' || !unit || value.toLowerCase().endsWith(unit.toLowerCase())) return value;
    return `${value} ${unit}`;
}

function getDailyBoilerConsumption(columns, rows, date) {
    const columnByBoiler = {
        b07Caldeira02: /b07caldeira0?2/,
        b07Caldeira03: /b07caldeira0?3/,
        b10Caldeira01: /b10caldeira0?1/,
        b10Caldeira02: /b10caldeira0?2/
    };
    const normalizedDate = normalizeDateValue(date);
    const row = rows.find(item => normalizeDateValue(item.date) === normalizedDate);
    const values = {};

    Object.entries(columnByBoiler).forEach(([key, pattern]) => {
        const column = columns.find(item => pattern.test(normalizeCsvHeader(item.label)));
        const rawValue = column && row ? row.values[column.key] : '';
        values[key] = rawValue
            ? formatChartValueWithUnit(rawValue, column.unit)
            : '--';
    });

    return values;
}

function getDailyColumnValues(columns, rows, date, selectors) {
    const normalizedDate = normalizeDateValue(date);
    const row = rows.find(item => normalizeDateValue(item.date) === normalizedDate);
    const values = {};

    selectors.forEach(({ key, pattern }) => {
        const column = columns.find(item => pattern.test(normalizeCsvHeader(item.label)));
        const rawValue = column && row ? row.values[column.key] : '';
        values[key] = rawValue
            ? formatChartValueWithUnit(rawValue, column.unit)
            : '--';
    });

    return values;
}

function getDailyChlorineValues(series, index) {
    const targets = ['b07', 'b12', 'b14'];
    const values = Object.fromEntries(targets.map(target => [target, '--']));

    series.forEach(item => {
        const normalizedName = normalizeCsvHeader(item.name);
        const target = targets.find(block => normalizedName.includes(block));
        const value = item.values[index];
        if (target && value !== null && value !== undefined) {
            values[target] = `${Number(value).toFixed(2)} ppm`;
        }
    });

    return values;
}

const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/export?format=csv&gid=0';
const DATA_SOURCE_URL = GOOGLE_SHEETS_CSV_URL;
const DATA_SOURCE_CANDIDATES = [DATA_SOURCE_URL];

const GOOGLE_SHEETS_PAGE2_CANDIDATES = [
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/export?format=csv&gid=1340556769',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/export?format=csv&gid=0',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/export?format=csv&gid=1',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Página%201',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Página1',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Page%201',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Page1',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Sheet1',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Tabela%202',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Tabela2',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Página%202',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Página2',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Page%202',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Page2',
    'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/gviz/tq?tqx=out:csv&sheet=Sheet2',
].filter(Boolean);

function updateDataSourceStatus(message) {
    const el = document.getElementById('dataSourceStatus');
    if (el) {
        el.textContent = message;
    }
}

if (typeof document !== 'undefined') {
    // --- Lógica do Relógio e Data do Dia ---
    function updateLiveClock() {
        const now = new Date();
        const dias = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
        const meses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
        const dia = String(now.getDate()).padStart(2, '0');
        const hora = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const seg = String(now.getSeconds()).padStart(2, '0');
        
        document.getElementById('liveClock').innerHTML = `<i class="far fa-clock"></i> ${dias[now.getDay()]}, ${dia} de ${meses[now.getMonth()]} - ${hora}:${min}:${seg}`;
        
        // Atualiza o Badge do Dia Atual no Dashboard
        const badge = document.getElementById('dailyDateBadge');
        if(badge) badge.innerText = `${dia}/${String(now.getMonth()+1).padStart(2,'0')}/${now.getFullYear()}`;
    }
    setInterval(updateLiveClock, 1000);
    updateLiveClock();

    // --- Lógica de Navegação (Abas) ---
    function openView(targetId, viewTitle) {
        document.querySelectorAll('.sidebar-nav li').forEach(li => li.classList.remove('active'));
        const targetLink = document.querySelector(`.sidebar-nav a[data-target="${targetId}"]`);
        if(targetLink) targetLink.parentElement.classList.add('active');
        
        if(viewTitle) document.getElementById('pageTitle').innerText = viewTitle;
        
        document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active'));
        document.getElementById(targetId).classList.add('active');
    }

document.querySelector('.sidebar-nav').addEventListener('click', (e) => {
const link = e.target.closest('a[data-target]');
if (!link) return;
e.preventDefault();
openView(link.getAttribute('data-target'), link.innerText.trim());
setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
});

// --- Recolher/Expandir Menu Lateral ---
const btnSidebarToggle = document.getElementById('btnSidebarToggle');
if (btnSidebarToggle) {
btnSidebarToggle.addEventListener('click', () => {
document.body.classList.toggle('sidebar-collapsed');
const isCollapsed = document.body.classList.contains('sidebar-collapsed');
btnSidebarToggle.innerHTML = isCollapsed ? '<i class="fas fa-angle-double-right"></i>' : '<i class="fas fa-bars"></i>';
setTimeout(() => window.dispatchEvent(new Event('resize')), 450);
});
}

    // --- Lógica de Tela Cheia ---
    const btnFullscreen = document.getElementById('btnFullscreen');
    btnFullscreen.addEventListener('click', () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    });
    document.addEventListener('fullscreenchange', () => {
        btnFullscreen.innerHTML = document.fullscreenElement ? '<i class="fas fa-compress"></i> Sair' : '<i class="fas fa-expand"></i> Tela Cheia';
    });

    // --- MODO TV (Animação Apenas Gráficos, Sidebar Oculta) ---
    let isTvModeActive = false;
    let tvIntervalId = null;
    let currentViewIndex = 0;
    // Views que contém os gráficos
    const tvViews = [
    { id: 'view-disponibilidade', title: 'Disponibilidade Diária' },
    { id: 'view-indisponibilidade', title: 'Indisponibilidade das Utilidades' },
    { id: 'view-nitrogenio', title: 'Nitrogênio' },
    { id: 'view-dw', title: 'DW' },
    { id: 'view-cloro', title: 'Teste de Cloro' }
];
const getExtraViewId = (col) => `view-extra-${col.key}`;
const EXTRA_ICON_RULES = [
   [/temperatura|temp\b|calor/, 'fa-temperature-high'],
   [/pressao|pressure|bar\b|psi/, 'fa-tachometer-alt'],
   [/vapor|caldeira/, 'fa-cloud'],
   [/ar ?comp|compress/, 'fa-wind'],
   [/cw|torre|chiller|agua ?gelada|hvac|clima/, 'fa-snowflake'],
   [/wfi|sfi|agua|dw|vazao|consumo|litro|m3/, 'fa-tint'],
   [/nitrog|n2|gas|co2|oxig/, 'fa-flask'],
   [/cloro|reteste|ph\b|condutiv|toc|quimic|analise/, 'fa-vial'],
   [/energia|eletric|kwh|tensao|corrente|gerador|potencia/, 'fa-bolt'],
   [/parada|falha|alarme|indispon|defeito|manutenc/, 'fa-exclamation-triangle'],
   [/status|situacao|disponib/, 'fa-check-circle'],
   [/obs|coment|nota|detalhe/, 'fa-comment-alt'],
   [/resp|operador|turno|equipe|tecnico/, 'fa-user'],
   [/umidade|humid/, 'fa-water'],
   [/nivel|tanque|volume|estoque/, 'fa-fill-drip']
];
const GN_ICON_HTML = '<span class="icon-gn" style="display:inline-flex;align-items:center;gap:3px;vertical-align:middle;" title="Gás Natural"><svg width="18" height="12" viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="3" y="3" width="12" height="6" rx="1"/><rect x="0.8" y="1.5" width="2.4" height="9" rx="0.5" fill="currentColor"/><rect x="14.8" y="1.5" width="2.4" height="9" rx="0.5" fill="currentColor"/></svg><b style="font-size:0.7em;letter-spacing:0.3px;">GN</b></span>';
const getExtraIconHtml = (col) => {
    const text = String(col.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    if (/gas ?natural|\bgn\b/.test(text)) return GN_ICON_HTML;
    return `<i class="fas ${getExtraIcon(col)}"></i>`;
};
const getExtraIcon = (col) => {
   const text = String(col.label || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
   const match = EXTRA_ICON_RULES.find(([pattern]) => pattern.test(text));
   if (match) return match[1];
   return col.numeric ? 'fa-chart-line' : 'fa-table-columns';
};
let tvModeKind = 'standard';
const getTvViews = () => {
   const numeric = extraData.columns.filter(col => col.numeric);
   if (tvModeKind === 'full') {
      return [...tvViews, ...numeric.map(col => ({ id: getExtraViewId(col), title: col.label }))];
   }
   const views = [...tvViews];
   if (numeric.some(isGnB07Column)) views.push({ id: 'view-gn-b07', title: 'Consumo de GN - B07 (Caldeiras 02 e 03)' });
   return views;
};
    const TIME_PER_SLIDE = 20000;
const TV_DAYS_RANGE = 7; // Dia atual + 6 dias anteriores
const btnTvMode = document.getElementById('btnTvMode');
const progressBar = document.getElementById('tvProgressBar');
let preTvDateFilter = null;

function applyTvDateFilter() {
const dateStart = document.getElementById('dateStart');
const dateEnd = document.getElementById('dateEnd');
if (!dateStart || !dateEnd) return;

preTvDateFilter = { start: dateStart.value, end: dateEnd.value };

const today = new Date();
const rangeStart = new Date(today);
rangeStart.setDate(rangeStart.getDate() - (TV_DAYS_RANGE - 1));

dateEnd.value = today.toISOString().slice(0, 10);
dateStart.value = rangeStart.toISOString().slice(0, 10);

applyDateFilters();
}

function restorePreTvDateFilter() {
if (!preTvDateFilter) return;
const dateStart = document.getElementById('dateStart');
const dateEnd = document.getElementById('dateEnd');
if (dateStart) dateStart.value = preTvDateFilter.start;
if (dateEnd) dateEnd.value = preTvDateFilter.end;
preTvDateFilter = null;

applyDateFilters();
}

const btnTvModeFull = document.getElementById('btnTvModeFull');
const TV_BUTTON_IDLE_HTML = { standard: '<i class="fas fa-tv"></i> Iniciar Modo TV', full: '<i class="fas fa-th"></i> Modo TV Completo' };

function toggleTvMode(kind = 'standard') {
isTvModeActive = !isTvModeActive;
if (isTvModeActive) {
tvModeKind = kind === 'full' ? 'full' : 'standard';
document.body.classList.add('tv-mode-active');
document.body.classList.toggle('tv-mode-full', tvModeKind === 'full');
(tvModeKind === 'full' ? btnTvModeFull : btnTvMode).innerHTML = '<i class="fas fa-stop"></i> Parar TV';

applyTvDateFilter();
try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
} catch (e) {}
startTvCarousel();
if (window.setIndispChartTvFonts) window.setIndispChartTvFonts(true);
} else {
document.body.classList.remove('tv-mode-active', 'tv-mode-full');
btnTvMode.innerHTML = TV_BUTTON_IDLE_HTML.standard;
if (btnTvModeFull) btnTvModeFull.innerHTML = TV_BUTTON_IDLE_HTML.full;
stopTvCarousel();
restorePreTvDateFilter();
if (window.setIndispChartTvFonts) window.setIndispChartTvFonts(false);
setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}
}

btnTvMode.addEventListener('click', () => toggleTvMode('standard'));
if (btnTvModeFull) btnTvModeFull.addEventListener('click', () => toggleTvMode('full'));

document.addEventListener('keydown', (event) => {
    if (event.key !== '*') return;
    if (event.repeat) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    toggleTvMode('standard');
});

    function animateTvProgress() {
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
        setTimeout(() => {
            progressBar.style.transition = `width ${TIME_PER_SLIDE}ms linear`;
            progressBar.style.width = '100%';
        }, 50);
    }

    function startTvCarousel() {
        currentViewIndex = 0;
const firstView = getTvViews()[0];
openView(firstView.id, firstView.title);
animateTvProgress();
setTimeout(() => window.dispatchEvent(new Event('resize')), 200);

tvIntervalId = setInterval(() => {
const views = getTvViews();
currentViewIndex = (currentViewIndex + 1) % views.length;
openView(views[currentViewIndex].id, views[currentViewIndex].title);
            animateTvProgress();
            setTimeout(() => window.dispatchEvent(new Event('resize')), 200);
        }, TIME_PER_SLIDE);
    }

    function stopTvCarousel() {
        clearInterval(tvIntervalId);
        progressBar.style.transition = 'none';
        progressBar.style.width = '0%';
    }

    // --- RENDENRIZAÇÃO DE DADOS (GRÁFICOS E TABELAS) ---
    const defaultData = {
        diasAgosto: ['01/08','02/08','03/08','04/08','05/08','06/08','07/08','08/08','09/08','10/08','11/08','12/08','13/08','14/08','15/08','16/08','17/08','18/08','19/08','20/08','21/08','22/08','23/08','24/08','25/08','26/08','27/08','28/08','29/08'],
        dw7A: [167.3, 158.2, 54, 109.7, 137.1, 163.3, 133, 154.4, 141.3, 160.5, 142.4, 146.8, 146.2, 176, 173.7, 132, 124.4, 144.1, 124.7, 144.2, 119, 125.3, 123.6, 129.4, 121, 140.5, 140.5, 140.5, 140.5],
        dw7B: [29.7, 14.9, 8.5, 13, 25.6, 46.9, 20.4, 35.6, 19.4, 16.4, 25.2, 21.3, 20.9, 18.7, 54.5, 66.3, 59.3, 80.6, 23.6, 11.9, 20.4, 33.2, 18.5, 20.9, 17.1, 29.3, 29.3, 29.3, 29.3],
        nitrogenNivel: [143.8, 137.2, 131.7, 123.8, 116.3, 267, 251.5, 235.3, 219.1, 204.5, 191.5, 181.5, 176.7, 170.9, 167.9, 166.9, 166.2, 161.3, 152, 134.8, 118.4, 231.1, 85.6, 67.7, 231.1, 218.9, 218.9, 218.9, 218.9],
    cloroPpm: [1.31, 1.53, 1.90, 1.85, 2.75, 1.78, 1.82, 1.95, 1.14, 1.04, 1.38, 1.56, 1.80, 2.05, 1.88, 1.54, 1.91, 1.61, 2.29, 1.91, 1.79, 1.53, 1.86, 1.83, 1.90, 1.90, 1.90, 1.90, 1.90],
    retestePpm: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 2.05, null, null, null, null, null, null, null, null, null, null],
    };

    const baseDataState = { ...defaultData };

    let diasAgosto = [...baseDataState.diasAgosto];
    let dw7A = [...baseDataState.dw7A];
    let dw7B = [...baseDataState.dw7B];
    let obsDw7A = baseDataState.diasAgosto.map(() => '');
    let obsDw7B = baseDataState.diasAgosto.map(() => '');
    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
    const dwRowHtml = (dia, i) => `<tr><td><strong>${String(dia).split('/').length > 2 ? dia : dia + '/2026'}</strong></td><td>${dw7A[i].toFixed(1)}</td><td>${escapeHtml(obsDw7A[i]) || '-'}</td><td>${dw7B[i].toFixed(1)}</td><td>${escapeHtml(obsDw7B[i]) || '-'}</td></tr>`;
    let nitrogenNivel = [...baseDataState.nitrogenNivel];
    let cloroPpm = [...baseDataState.cloroPpm];
    let retestePpm = [...baseDataState.retestePpm];
    let cloroSeries = [];
    const getChlorineSeries = () => cloroSeries.length
        ? cloroSeries
        : [{ name: 'Teste de Cloro', retesteName: 'Reteste', values: cloroPpm.map((v) => (v !== null && v !== undefined ? v : null)), reteste: retestePpm }];
    const chlorineColors = ['#34495e', '#8e44ad', '#16a085', '#2980b9', '#d35400'];
    const chlorineSeriesColor = (name, index) => {
        const normalizedName = normalizeCsvHeader(name);
        if (normalizedName.includes('b07')) return '#0369a1';
        if (normalizedName.includes('b12')) return '#7e22ce';
        if (normalizedName.includes('b14')) return '#b45309';
        return chlorineColors[index % chlorineColors.length];
    };
    const selectedChlorineIndexes = (selectedModules) => {
        const all = getChlorineSeries().map((_, k) => k);
        if (!selectedModules || selectedModules.includes('all') || selectedModules.includes('cloro')) return all;
        return all.filter((k) => selectedModules.includes(`cloro:${k}`));
    };
    const chlorineLabelStyle = (color, large, placement) => ({
        display: true,
        color,
        align: placement === 'alternate'
            ? (context) => context.dataIndex % 2 === 0 ? 'top' : 'bottom'
            : placement === 'horizontal'
                ? (context) => context.dataIndex % 2 === 0 ? 'right' : 'left'
                : placement,
        anchor: placement === 'horizontal'
            ? 'center'
            : placement === 'bottom' ? 'start' : 'end',
        offset: large ? 10 : 6,
        clamp: true,
        backgroundColor: '#ffffff',
        borderColor: color,
        borderWidth: 1,
        borderRadius: 3,
        padding: large ? 4 : 3,
        font: { weight: 'bold', size: large ? 13 : 10 },
        formatter: (value) => (value === null || value === undefined ? '' : Number(value).toFixed(2))
    });
    const chlorineDatasets = (indexList, large, allowed = null) => {
        const datasets = [];
        getChlorineSeries().forEach((serie, k) => {
            if (allowed && !allowed.includes(k)) return;
            const color = chlorineSeriesColor(serie.name, k);
            const normalizedName = normalizeCsvHeader(serie.name);
            const labelPlacement = normalizedName.includes('b14')
                ? 'top'
                : normalizedName.includes('b12')
                    ? 'top'
                    : normalizedName.includes('b07')
                        ? 'bottom'
                        : 'alternate';
            const labelStyle = chlorineLabelStyle(color, large, labelPlacement);
            if (normalizedName.includes('b14')) {
                Object.assign(labelStyle, { backgroundColor: color, color: '#ffffff', borderColor: '#ffffff', offset: large ? 18 : 14, padding: large ? 5 : 4, font: { weight: 'bold', size: large ? 15 : 12 } });
            }
            datasets.push({ label: serie.name, data: indexList.map((i) => serie.values[i] ?? null), borderColor: color, backgroundColor: color, borderWidth: large ? 3 : 2, fill: false, tension: 0.1, spanGaps: true, pointRadius: large ? 5 : 3, datalabels: labelStyle });
            if (serie.reteste.some((v) => v !== null && v !== undefined)) {
                const suffix = (serie.name.match(/[-–]\s*(.+)$/) || [])[1];
                datasets.push({ label: serie.retesteName ? (suffix ? `${serie.retesteName} - ${suffix}` : serie.retesteName) : 'Reteste', data: indexList.map((i) => serie.reteste[i] ?? null), borderColor: '#f39c12', backgroundColor: '#f39c12', borderWidth: 2, pointRadius: large ? 6 : 5, pointStyle: 'rectRot', spanGaps: false, showLine: false, fill: false, datalabels: chlorineLabelStyle('#d35400', large, 'right') });
            }
        });
        datasets.push({ label: 'Limite inferior (1,00)', isLimit: true, data: indexList.map(() => 1), borderColor: '#27ae60', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false });
        datasets.push({ label: 'Limite superior (2,00)', isLimit: true, data: indexList.map(() => 2), borderColor: '#e74c3c', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false });
        return datasets;
    };
    const blockChlorineCharts = {};
    const renderChlorineBlocks = (containerId, indexList, large, allowed) => {
        const container = document.getElementById(containerId);
        if (!container || typeof Chart === 'undefined') return;
        const series = getChlorineSeries();
        const ids = series.map((_, k) => k).filter((k) => !allowed || allowed.includes(k));
        const signature = ids.map((k) => `${k}:${series[k].name}`).join('|');
        if (container.dataset.signature !== signature) {
            Object.keys(blockChlorineCharts).filter((key) => key.startsWith(`${containerId}:`)).forEach((key) => {
                blockChlorineCharts[key].destroy();
                delete blockChlorineCharts[key];
            });
            container.innerHTML = '';
            ids.forEach((k) => {
                const block = document.createElement('div');
                block.className = 'chlorine-block';
                block.dataset.block = normalizeCsvHeader(series[k].name).includes('b07') ? 'b07' : 'other';
                const title = document.createElement('h4');
                title.textContent = series[k].name;
                const wrap = document.createElement('div');
                wrap.className = 'chlorine-block-canvas';
                const canvas = document.createElement('canvas');
                wrap.appendChild(canvas);
                block.append(title, wrap);
                container.appendChild(block);
                blockChlorineCharts[`${containerId}:${k}`] = new Chart(canvas.getContext('2d'), {
                    type: 'line',
                    data: { labels: [], datasets: [] },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: { padding: { top: 28, right: large ? 40 : 28 } },
                        scales: {
                            y: { min: 0, suggestedMax: 3.5, ticks: { stepSize: 0.5, font: { size: large ? 12 : 11 }, callback: (v) => Number(v).toFixed(1) }, title: { display: !large, text: 'ppm' } },
                            x: { ticks: { font: { size: large ? 11 : 10 }, maxRotation: large ? 0 : 60, autoSkip: !large } }
                        },
                        plugins: { legend: { display: true, labels: { boxWidth: 18, boxHeight: 8, font: { size: large ? 11 : 11 }, filter: (item) => !String(item.text).startsWith('Limite') } }, datalabels: { display: (context) => !context.dataset.isLimit && context.dataset.data[context.dataIndex] !== null } }
                    }
                });
            });
            container.dataset.signature = signature;
        }
        ids.forEach((k) => {
            const chart = blockChlorineCharts[`${containerId}:${k}`];
            if (!chart) return;
            chart.data.labels = indexList.map((i) => diasAgosto[i]);
            chart.data.datasets = chlorineDatasets(indexList, large, [k]);
            chart.update();
        });
    };
    const hasChlorineData = (i) => getChlorineSeries().some((s) =>
        (s.values[i] !== null && s.values[i] !== undefined) ||
        (s.reteste[i] !== null && s.reteste[i] !== undefined)
    );
    let extraData = { columns: [], rows: [] };
    const extraCharts = [];
    const dashboardBoilerCharts = [];
    let nitroData = [{d: '05/08/2026', n: '116,3', r: '280,2 pol'}, {d: '26/08/2026', n: '218,9', r: 'pol'}];
    const downtimeData = [
        {d: '08/08/2026', u: 'DW 7A', p: '1', h: '2.5h'},
        {d: '15/08/2026', u: 'Nitrogênio', p: '1', h: '4h'},
        {d: '22/08/2026', u: 'DW 7B', p: '1', h: '1.5h'},
        {d: '28/08/2026', u: 'Cloro', p: '1', h: '0.5h'}
    ];
    const downtimeComments = [];
    const availabilityData = [
        { name: 'Vapor Ind 7A', status: 'disponivel' },
        { name: 'Vapor Ind 7B', status: 'disponivel' },
        { name: 'CW Processo 7A', status: 'disponivel' },
        { name: 'CW Processo 7B', status: 'disponivel' },
        { name: 'CW HVAC 7A', status: 'disponivel' },
        { name: 'CW HVAC 7B', status: 'disponivel' },
        { name: 'Ar Comp 7A', status: 'indisponivel' },
        { name: 'Ar Comp 7B', status: 'indisponivel' },
        { name: 'WFI 7A', status: 'disponivel' },
        { name: 'WFI 7B', status: 'disponivel' },
        { name: 'SFI 7A', status: 'indisponivel' },
        { name: 'SFI 7B', status: 'indisponivel' }
    ];
    const logData = [ { data: '05/08/2026', utilidade: 'CW Processo 7B / WFI 7B / SFI 7B', comentario: 'Vazamento na linha de retorno da torre 7B.' }, { data: '12/08/2026', utilidade: 'SFI 7A / CW Processo 7A', comentario: 'Alarmes de temperaturas altas.' } ];
let availabilityReferenceDate = '';

function syncAvailabilityForDate(referenceDate) {
    availabilityReferenceDate = normalizeDateValue(referenceDate);
        const unavailableUtilities = new Set(
            downtimeData
            .filter((item) => normalizeDateValue(item.d) === availabilityReferenceDate)
                .map((item) => normalizeCsvHeader(item.u))
        );

        availabilityData.forEach((item) => {
            item.status = unavailableUtilities.has(normalizeCsvHeader(item.name)) ? 'indisponivel' : 'disponivel';
        });

        return availabilityReferenceDate;
    }

    function renderAvailabilityView() {
        const tableBody = document.getElementById('availabilityTableBody');
        const summary = document.getElementById('availabilitySummary');
        if (!tableBody) return;

        const availableCount = availabilityData.filter(item => item.status === 'disponivel').length;
        if (summary) {
            const [year, month, day] = availabilityReferenceDate.split('-');
            const displayDate = year && month && day ? `${day}/${month}/${year}` : 'data selecionada';
            summary.textContent = `${availableCount}/${availabilityData.length} disponíveis em ${displayDate}`;
        }

        tableBody.innerHTML = availabilityData.map((item) => {
            const isAvailable = item.status === 'disponivel';
            return `
              <div class="utility-status-row ${isAvailable ? 'is-available' : 'is-unavailable'}" data-status="${item.status}">
                <div class="utility-name">${item.name}</div>
                                <span class="utility-status-indicator ${isAvailable ? 'available' : 'unavailable'}">
                                    <i class="fas ${isAvailable ? 'fa-check-circle' : 'fa-times-circle'}"></i>
                                    ${isAvailable ? 'Disponível' : 'Indisponível'}
                                </span>
              </div>
            `;
        }).join('');
    }
    let downtimeSheetUrl = '';
    // Acha a tabela de paradas pelo conteúdo: aba principal, abas descobertas e candidatas.
    async function findDowntime(mainCsvText, mainUrl) {
        const own = buildDowntimeStateFromCsv(mainCsvText);
        if (own.length) {
            downtimeSheetUrl = '';
            return own;
        }
        const base = GOOGLE_SHEETS_CSV_URL.split('/export')[0];
        let discovered = [];
        try {
            const html = await (await fetch(`${base}/htmlview`, { cache: 'no-store' })).text();
            discovered = [...new Set([...html.matchAll(/gid[=:]\s*"?(\d+)/g)].map(m => m[1]))]
                .map(g => `${base}/export?format=csv&gid=${g}`);
        } catch (e) { /* sem acesso à lista de abas */ }
        const candidates = [...new Set([downtimeSheetUrl, ...discovered, ...GOOGLE_SHEETS_PAGE2_CANDIDATES].filter(u => u && u !== mainUrl))];
        for (const candidate of candidates) {
            try {
                const response = await fetch(`${candidate}${candidate.includes('?') ? '&' : '?'}_=${Date.now()}`, { cache: 'no-store' });
                if (!response.ok) continue;
                const result = buildDowntimeStateFromCsv(await response.text());
                if (result.length) {
                    downtimeSheetUrl = candidate;
                    return result;
                }
            } catch (e) { continue; }
        }
        return [];
    }

    async function loadDataFromCsv(csvUrl = DATA_SOURCE_CANDIDATES[0]) {
        const sourceUrls = csvUrl
            ? [csvUrl, ...DATA_SOURCE_CANDIDATES.filter(url => url !== csvUrl)]
            : DATA_SOURCE_CANDIDATES;

        for (const url of sourceUrls) {
            try {
                updateDataSourceStatus(`Buscando: ${url}`);
                const requestUrl = `${url}${url.includes('?') ? '&' : '?'}_=${Date.now()}`;
                const response = await fetch(requestUrl, { cache: 'no-store' });
                if (!response.ok) {
                    throw new Error(`CSV não encontrado (${response.status})`);
                }

                const csvText = await response.text();
                const parsed = buildDataStateFromCsv(csvText);

                if (!parsed) {
                    continue;
                }

                diasAgosto = [...parsed.diasAgosto];
                dw7A = [...parsed.dw7A];
                dw7B = [...parsed.dw7B];
                obsDw7A = [...parsed.obsDw7A];
                obsDw7B = [...parsed.obsDw7B];
                nitrogenNivel = [...parsed.nitrogenNivel];
                cloroPpm = [...parsed.cloroPpm];
                retestePpm = [...parsed.retestePpm];
                cloroSeries = parsed.cloroSeries || [];
                nitroData = [...parsed.nitroData];
                extraData = extractExtraColumns(csvText);

const downtimeFromSource = await findDowntime(csvText, url);
if (downtimeFromSource.length) {
downtimeData.length = 0;
downtimeData.push(...downtimeFromSource);
downtimeComments.length = 0;
downtimeComments.push(...downtimeFromSource);
}

                syncAvailabilityForDate(document.getElementById('dateEnd')?.value);
                renderAvailabilityView();

                const sourceLabel = url.includes('docs.google.com') ? 'Google Sheets' : url.includes('painelb07') ? 'CSV local' : 'CSV fallback';
                updateDataSourceStatus(`Fonte ativa: ${sourceLabel} • ${new Date().toLocaleString('pt-BR')}`);
                populateBaseDataTable();
renderChlorineModuleOptions();
applyDateFilters();
return true;
            } catch (error) {
                continue;
            }
        }

        diasAgosto = [...defaultData.diasAgosto];
        dw7A = [...defaultData.dw7A];
        dw7B = [...defaultData.dw7B];
        obsDw7A = defaultData.diasAgosto.map(() => '');
        obsDw7B = defaultData.diasAgosto.map(() => '');
        nitrogenNivel = [...defaultData.nitrogenNivel];
        cloroPpm = [...defaultData.cloroPpm];
    retestePpm = [...defaultData.retestePpm];
    cloroSeries = [];
        extraData = { columns: [], rows: [] };
                syncAvailabilityForDate(document.getElementById('dateEnd')?.value);
                renderAvailabilityView();
        updateDataSourceStatus('Google Sheets indisponível; exibindo dados locais temporariamente');
        populateBaseDataTable();
renderChlorineModuleOptions();
applyDateFilters();
return false;
    }

    function getCsvValue(row, keys) {
        const normalized = new Set(keys.map(key => normalizeCsvHeader(key)));
        for (const [rowKey, value] of Object.entries(row)) {
            if (normalized.has(normalizeCsvHeader(rowKey))) {
                const text = String(value ?? '').trim();
                if (text) return text;
            }
        }
        return '';
    }

    async function loadPage2DowntimeData() {
        const sourceUrls = [...new Set([DATA_SOURCE_URL, ...GOOGLE_SHEETS_PAGE2_CANDIDATES].filter(Boolean))];

        for (const url of sourceUrls) {
            try {
                const response = await fetch(url, { cache: 'no-store' });
                if (!response.ok) continue;

                const csvText = await response.text();
                const rows = parseCsvText(csvText);
                if (!rows.length) continue;

                const values = [];
                const comments = [];
                let readingComments = false;
                for (const row of rows) {
                    const utilityValue = getCsvValue(row, ['utilidade', 'utility', 'utilidades', 'unidade', 'equipamento', 'maquina', 'servico', 'setor', 'linha', 'parada', 'item', 'nomeutilidade', 'utilidadeparada', 'nome']);
                    const stopCountValue = getCsvValue(row, ['paradas', 'quantidadeparadas', 'numeroparadas', 'qtdparadas', 'ocorrencias']);
                    const downtimeValue = getCsvValue(row, ['horas', 'horasparadas', 'tempo', 'duracao', 'tempoindisponivel', 'tempoemhoras', 'duracaohoras', 'tempohoras', 'paradahoras', 'totalhoras', 'tempoemhorasparadas', 'tempoindisponivelhoras']);

                    if (normalizeCsvHeader(utilityValue) === 'data' && normalizeCsvHeader(downtimeValue).includes('comentario')) {
                        readingComments = true;
                        continue;
                    }

                    if (readingComments) {
                        if (utilityValue && stopCountValue && downtimeValue) {
                            comments.push({ d: utilityValue, u: stopCountValue, m: downtimeValue });
                        }
                        continue;
                    }

                    const d = getCsvValue(row, ['data', 'date', 'dia', 'dataparada', 'datadaparada', 'datadaindisponibilidade', 'datahoraparada', 'inicio', 'horainicio', 'dataocorrencia']);
                    const h = formatHoursValue(downtimeValue || 0);
                    if (!utilityValue || h === '0h') continue;

                    values.push({
                        d,
                        u: utilityValue,
                        p: stopCountValue || '0',
                        h,
                        m: 'Sem detalhe'
                    });
                }

                if (!values.length) continue;

                const normalized = values.map((item) => ({
                    d: item.d || 'N/D',
                    u: item.u || 'Indisponibilidade das Utilidades',
                    p: item.p || '0',
                    h: item.h || '0h',
                    m: item.m || 'Sem detalhe'
                }));

                if (normalized.length) {
                    downtimeData.length = 0;
                    normalized.forEach((item) => downtimeData.push(item));
                    downtimeComments.length = 0;
                    comments.forEach((item) => downtimeComments.push(item));
                    return true;
                }
            } catch (error) {
                continue;
            }
        }

        return false;
    }

    function bindBaseDataInputs() {
        const inputs = document.querySelectorAll('#baseDataTableBody input');
        if (!inputs.length) return;

        inputs.forEach((input) => {
            input.oninput = null;
            input.onchange = null;
        });
    }

function renderChlorineModuleOptions() {
    const menu = document.getElementById('reportModuleFilter');
    const container = menu?.querySelector('.multi-select-menu');
    const base = menu?.querySelector('input[value="cloro"]')?.parentElement;
    if (!container || !base) return;
    const previous = new Set([...menu.querySelectorAll('input[value^="cloro:"]')].filter((i) => i.checked).map((i) => i.value));
    menu.querySelectorAll('label[data-chloro]').forEach((label) => label.remove());
    const series = getChlorineSeries();
    if (series.length < 2) return;
    let anchor = base;
    series.forEach((serie, k) => {
        const label = document.createElement('label');
        label.dataset.chloro = '1';
        label.style.paddingLeft = '18px';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.value = `cloro:${k}`;
        input.checked = previous.has(input.value);
        label.append(input, ` ${serie.name}`);
        anchor.after(label);
        anchor = label;
    });
    updateReportModuleSummary();
}

function getSelectedReportModules() {
    const menu = document.getElementById('reportModuleFilter');
    const checked = menu ? [...menu.querySelectorAll('input[type="checkbox"]:checked')].map(input => input.value) : [];
    return checked.length === 0 || checked.includes('all') ? ['all'] : checked;
}

function updateReportModuleSummary() {
    const menu = document.getElementById('reportModuleFilter');
    const summary = document.getElementById('reportModuleSummary');
    if (!menu || !summary) return;
    const selected = getSelectedReportModules();
    if (selected.includes('all')) {
        summary.textContent = 'Todos os módulos';
        return;
    }
    const labels = selected.map(value => menu.querySelector(`input[value="${value}"]`)?.parentElement.textContent.trim()).filter(Boolean);
    summary.textContent = labels.length > 2 ? `${labels.length} módulos selecionados` : labels.join(', ');
}

function initReportModuleFilter() {
    const menu = document.getElementById('reportModuleFilter');
    if (!menu || menu.dataset.bound) return;
    menu.dataset.bound = '1';
    menu.addEventListener('change', (event) => {
        const inputs = [...menu.querySelectorAll('input[type="checkbox"]')];
        const allInput = inputs.find(input => input.value === 'all');
        if (event.target.value === 'all' && event.target.checked) {
            inputs.forEach(input => { input.checked = input === allInput; });
        } else if (event.target.checked && allInput) {
            allInput.checked = false;
        }
        if (!inputs.some(input => input.checked) && allInput) allInput.checked = true;
        updateReportModuleSummary();
    });
    document.addEventListener('click', (event) => {
        if (!menu.contains(event.target)) menu.removeAttribute('open');
    });
}

function renderExtraColumnsView() {
    const navList = document.querySelector('.sidebar-nav ul');
    const container = document.getElementById('extraViewsContainer');
    const reportSelect = document.getElementById('reportModuleFilter');
    const { columns, rows } = extraData;
    if (!navList || !container) return;
    initReportModuleFilter();

    const activeBefore = container.querySelector('.view-section.active')?.id;
    extraCharts.splice(0).forEach(item => item.chart.destroy());
    dashboardBoilerCharts.splice(0).forEach(chart => chart.destroy());
    const boilerContainer = document.getElementById('dashboardBoilerCharts');
    if (boilerContainer) boilerContainer.innerHTML = '';
    container.innerHTML = '';
    navList.querySelectorAll('.extra-nav-item').forEach(li => li.remove());
    reportSelect?.querySelectorAll('label[data-extra]').forEach(option => option.remove());

    if (reportSelect) {
        reportSelect.querySelectorAll('input[value^="extra:"]').forEach(input => {
            if (!columns.some(col => `extra:${col.key}` === input.value)) input.parentElement.remove();
        });
        if (!reportSelect.querySelector('input:checked')) {
            const allInput = reportSelect.querySelector('input[value="all"]');
            if (allInput) allInput.checked = true;
        }
        updateReportModuleSummary();
    }
    if (!columns.length) {
        if (activeBefore) openView('view-dashboard', 'Dashboard Geral');
        return;
    }

    const dateStart = document.getElementById('dateStart')?.value;
    const dateEnd = document.getElementById('dateEnd')?.value;
    const filtered = filterDateRange(rows.map(row => row.date), dateStart, dateEnd, DEFAULT_YEAR);
    const palette = ['#2980b9', '#27ae60', '#e67e22', '#8e44ad', '#c0392b', '#16a085'];

    columns.forEach((col, i) => {
        const viewId = getExtraViewId(col);
        const li = document.createElement('li');
        li.className = 'extra-nav-item';
        li.innerHTML = `<a href="#" data-target="${viewId}">${getExtraIconHtml(col)} ${escapeHtml(col.label)}</a>`;
        navList.appendChild(li);

        if (reportSelect) {
            const option = document.createElement('label');
            option.dataset.extra = '1';
            option.innerHTML = `<input type="checkbox" value="extra:${escapeHtml(col.key)}"> ${escapeHtml(col.label)}`;
            reportSelect.querySelector('.multi-select-menu').appendChild(option);
        }

        const visibleRows = filtered.indexes.map(index => rows[index]).filter(row => row.values[col.key] !== undefined);
        const view = document.createElement('div');
        view.id = viewId;
        view.className = 'view-section';
        view.innerHTML = `<div class="module-container">
            ${col.numeric ? `<div class="chart-card tv-chart"><h3>${escapeHtml(col.label)}</h3><div class="chart-wrapper"><canvas></canvas></div></div>` : ''}
            <section class="reference-section tv-hide"><div class="table-card">
                <div class="table-header-custom">${getExtraIconHtml(col)} <h3>${escapeHtml(col.label)}</h3></div>
                <div class="table-responsive"><table>
                    <thead><tr><th>Data</th><th>${escapeHtml(col.label)}</th></tr></thead>
                    <tbody>${visibleRows.map(row => {
                        const date = String(row.date).split('/').length > 2 || row.date.includes('-') ? row.date : `${row.date}/${DEFAULT_YEAR}`;
                        return `<tr><td><strong>${escapeHtml(date)}</strong></td><td>${escapeHtml(row.values[col.key]) || '-'}</td></tr>`;
                    }).join('')}</tbody>
                </table></div>
            </div></section>
        </div>`;
        container.appendChild(view);

        const canvas = view.querySelector('canvas');
        const isGas = /gas ?natural/.test(normalizeCsvHeader(col.label).replace(/[^a-z ]/g, ' ')) || /gasnatural/.test(normalizeCsvHeader(col.label));
        if (canvas && typeof Chart !== 'undefined') {
            const color = palette[i % palette.length];
            const numbers = visibleRows.map(row => parseNumberValue(row.values[col.key]));
            if (isGas) canvas.closest('.chart-wrapper').style.minHeight = '520px';
            extraCharts.push({ key: col.key, chart: new Chart(canvas, {
                type: 'line',
                data: {
                    labels: visibleRows.map(row => row.date),
                    datasets: [{
                        label: col.label,
                        data: numbers,
                        borderColor: color,
                        backgroundColor: color,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: isGas ? { top: 70, right: 40 } : { top: 30, right: 24 } },
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            display: 'auto',
                            clamp: true,
                            color: '#34495e',
                            backgroundColor: 'rgba(255,255,255,0.85)',
                            borderRadius: 3,
                            padding: 2,
                            font: { weight: 'bold', size: isGas ? 16 : 11 },
                            textAlign: 'center',
                            anchor: 'end',
                            align: 'top',
                            offset: 6,
                            formatter: (value, context) => formatChartValueWithUnit(
                                visibleRows[context.dataIndex]?.values[col.key],
                                col.unit
                            )
                        }
                    },
                    scales: {
                        x: { ticks: { font: { size: isGas ? 16 : 12 }, maxRotation: 60, autoSkip: true } },
                        y: {
                            grace: '20%',
                            ticks: { font: { size: isGas ? 16 : 12 } },
                            title: { display: Boolean(col.unit), text: col.unit, font: { size: isGas ? 16 : 12 } }
                        }
                    }
                }
            }) });
        }

        if (boilerContainer && col.numeric && /caldeira|poco/.test(normalizeCsvHeader(col.label)) && typeof Chart !== 'undefined') {
            const card = document.createElement('div');
            card.className = 'chart-card';
            card.innerHTML = `<h3>${escapeHtml(col.label)}</h3><div class="chart-wrapper small-chart"><canvas></canvas></div>`;
            boilerContainer.appendChild(card);
            const color = palette[i % palette.length];
            const withValue = visibleRows.filter(row => String(row.values[col.key] ?? '').trim() !== '');
            const boilerRows = dateStart && dateEnd ? withValue : withValue.slice(-DASHBOARD_RECENT_DAYS);
            dashboardBoilerCharts.push(new Chart(card.querySelector('canvas'), {
                type: 'line',
                data: {
                    labels: boilerRows.map(row => row.date),
                    datasets: [{
                        label: col.label,
                        data: boilerRows.map(row => parseNumberValue(row.values[col.key])),
                        borderColor: color,
                        backgroundColor: color,
                        tension: 0.3
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 30, right: 20 } },
                    plugins: {
                        legend: { display: false },
                        datalabels: {
                            display: 'auto',
                            clamp: true,
                            color: '#34495e',
                            backgroundColor: 'rgba(255,255,255,0.85)',
                            borderRadius: 3,
                            padding: 2,
                            font: { weight: 'bold', size: 10 },
                            anchor: 'end',
                            align: 'top',
                            offset: 4,
                            formatter: (value) => Number.isFinite(value) ? String(value).replace('.', ',') : ''
                        }
                    },
                    scales: { x: { ticks: { maxRotation: 60, autoSkip: true } }, y: { grace: '20%', title: { display: Boolean(col.unit), text: col.unit } } }
                }
            }));
        }
    });

    const gnColumns = columns.filter(isGnB07Column);
    if (gnColumns.length && typeof Chart !== 'undefined') {
        const gnView = document.createElement('div');
        gnView.id = 'view-gn-b07';
        gnView.className = 'view-section';
        gnView.innerHTML = '<div class="module-container gn-b07-grid">' + gnColumns.map(col => `<div class="chart-card tv-chart"><h3>${escapeHtml(col.label)}</h3><div class="chart-wrapper"><canvas data-key="${escapeHtml(col.key)}"></canvas></div></div>`).join('') + '</div>';
        container.appendChild(gnView);
        gnColumns.forEach((col) => {
            const color = palette[columns.indexOf(col) % palette.length];
            const gnRows = filtered.indexes.map(index => rows[index]).filter(row => String(row.values[col.key] ?? '').trim() !== '');
            const canvas = [...gnView.querySelectorAll('canvas')].find(item => item.dataset.key === col.key);
            dashboardBoilerCharts.push(new Chart(canvas, {
                type: 'line',
                data: { labels: gnRows.map(row => row.date), datasets: [{ label: col.label, data: gnRows.map(row => parseNumberValue(row.values[col.key])), borderColor: color, backgroundColor: color, borderWidth: 3, pointRadius: 5, tension: 0.3 }] },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: { padding: { top: 36, right: 30 } },
                    plugins: {
                        legend: { display: false },
                        datalabels: { display: 'auto', clamp: true, color: '#34495e', backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 3, padding: 2, font: { weight: 'bold', size: 16 }, anchor: 'end', align: 'top', offset: 6, formatter: (value) => Number.isFinite(value) ? String(value).replace('.', ',') : '' }
                    },
                    scales: { x: { ticks: { font: { size: 16 }, autoSkip: true } }, y: { grace: '20%', ticks: { font: { size: 16 } }, title: { display: Boolean(col.unit), text: col.unit, font: { size: 16 } } } }
                }
            }));
        });
    }

    if (activeBefore) {
        const stillExists = document.getElementById(activeBefore);
        if (stillExists) {
            const col = columns.find(c => getExtraViewId(c) === activeBefore);
            openView(activeBefore, col?.label);
        } else {
            openView('view-dashboard', 'Dashboard Geral');
        }
    }
}

function populateBaseDataTable() {
        const tbody = document.getElementById('baseDataTableBody');
        if (!tbody) return;

        tbody.innerHTML = diasAgosto.map((day, index) => `
            <tr data-index="${index}">
                <td><strong>${day}</strong></td>
                <td><input type="number" step="0.1" value="${dw7A[index]}" data-field="dw7A" data-index="${index}"></td>
                <td><input type="number" step="0.1" value="${dw7B[index]}" data-field="dw7B" data-index="${index}"></td>
                <td><input type="number" step="0.1" value="${nitrogenNivel[index]}" data-field="nitrogenNivel" data-index="${index}"></td>
                <td><input type="number" step="0.01" value="${cloroPpm[index]}" data-field="cloroPpm" data-index="${index}"></td>
            </tr>
        `).join('');

        bindBaseDataInputs();
    }

    function syncBaseDataFromInputs() {
        const inputs = document.querySelectorAll('#baseDataTableBody input');
        if (!inputs.length) return;

        inputs.forEach((input) => {
            const field = input.dataset.field;
            const index = Number(input.dataset.index);
            const value = Number(input.value);

            if (Number.isNaN(value)) return;

            if (field === 'dw7A') dw7A[index] = value;
            if (field === 'dw7B') dw7B[index] = value;
            if (field === 'nitrogenNivel') nitrogenNivel[index] = value;
            if (field === 'cloroPpm') cloroPpm[index] = value;
        });
    }

    function applyBaseDataChanges() {
        syncBaseDataFromInputs();
        applyDateFilters();
        window.dispatchEvent(new Event('resize'));
    }

    function renderSummaryForRange(indexes, selectedBlock = 'all') {
        const summaryTarget = document.getElementById('dailyNitro');
        const summaryDw7A = document.getElementById('dailyDw7a');
        const summaryDw7B = document.getElementById('dailyDw7b');
        const dateBadge = document.getElementById('dailyDateBadge');
const boilerConsumption = {
    b07Caldeira02: document.getElementById('dailyGasB07Boiler02'),
    b07Caldeira03: document.getElementById('dailyGasB07Boiler03'),
    b10Caldeira01: document.getElementById('dailyGasB10Boiler01'),
    b10Caldeira02: document.getElementById('dailyGasB10Boiler02')
};
const chlorineByBlock = {
    b07: document.getElementById('dailyCloroB07'),
    b12: document.getElementById('dailyCloroB12'),
    b14: document.getElementById('dailyCloroB14')
};
const wellConsumption = {
    poco1: document.getElementById('dailyPoco1'),
    poco2: document.getElementById('dailyPoco2'),
    poco3: document.getElementById('dailyPoco3')
};

        if (!summaryTarget || !summaryDw7A || !summaryDw7B) {
            return;
        }

        const today = new Date();
        const todayLabel = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const todayIndex = diasAgosto.findIndex((valor) => normalizeDateValue(valor) === normalizeDateValue(todayLabel));

        if (!indexes.length) {
            summaryTarget.innerText = '--';
            summaryDw7A.innerText = '--';
            summaryDw7B.innerText = '--';
Object.values(boilerConsumption).forEach(element => {
    if (element) element.innerText = '--';
});
Object.values(chlorineByBlock).forEach(element => {
    if (element) element.innerText = '--';
});
Object.values(wellConsumption).forEach(element => {
    if (element) element.innerText = '--';
});
if (dateBadge) dateBadge.innerText = todayLabel;
return;
}

        const referenceIndex = todayIndex >= 0 ? todayIndex : indexes[indexes.length - 1];
        const displayDate = diasAgosto[referenceIndex] || todayLabel;

        const pickReference = (has) => {
            if (todayIndex >= 0 && has(todayIndex)) return todayIndex;
            const own = indexes.filter(has);
            return own.length ? own[own.length - 1] : -1;
        };
        const nitroRef = pickReference((i) => nitrogenNivel[i] > 0);
        const dwRef = pickReference((i) => dw7A[i] > 0 || dw7B[i] > 0);

        summaryTarget.innerText = nitroRef >= 0 ? nitrogenNivel[nitroRef].toFixed(1) + ' pol' : '--';
        summaryDw7A.innerText = dwRef >= 0 ? dw7A[dwRef].toFixed(1) + ' m³' : '--';
        summaryDw7B.innerText = dwRef >= 0 ? dw7B[dwRef].toFixed(1) + ' m³' : '--';

        if (dateBadge) dateBadge.innerText = displayDate;
const dailyGasValues = getDailyBoilerConsumption(extraData.columns, extraData.rows, displayDate);
Object.entries(boilerConsumption).forEach(([key, element]) => {
    if (element) element.innerText = dailyGasValues[key];
});
const dailyChlorineValues = getDailyChlorineValues(getChlorineSeries(), referenceIndex);
Object.entries(chlorineByBlock).forEach(([key, element]) => {
    if (element) element.innerText = dailyChlorineValues[key];
});
const dailyWellValues = getDailyColumnValues(extraData.columns, extraData.rows, displayDate, [
    { key: 'poco1', pattern: /pocos?[^0-9]*0?1(?:$|[^0-9])/ },
    { key: 'poco2', pattern: /pocos?[^0-9]*0?2(?:$|[^0-9])/ },
    { key: 'poco3', pattern: /pocos?[^0-9]*0?3(?:$|[^0-9])/ }
]);
Object.entries(wellConsumption).forEach(([key, element]) => {
    if (element) element.innerText = dailyWellValues[key];
});

        // Encontrar parada mais recente de utilidade
        const latestDowntime = [...downtimeData]
            .sort((a, b) => new Date(normalizeDateValue(b.d)) - new Date(normalizeDateValue(a.d)))[0];
        
        const kpiDowntime = document.getElementById('kpiDowntime');
        const kpiDowntimeLabel = document.getElementById('kpiDowntimeLabel');
        const kpiDowntimeComment = document.getElementById('kpiDowntimeComment');
        const latestUtilityComment = latestDowntime
            ? [...downtimeComments]
                .filter((item) => normalizeCsvHeader(item.u) === normalizeCsvHeader(latestDowntime.u))
                .sort((a, b) => new Date(normalizeDateValue(b.d)) - new Date(normalizeDateValue(a.d)))[0]
            : null;
        if (kpiDowntime && latestDowntime) {
            kpiDowntime.textContent = latestDowntime.u;
        } else if (kpiDowntime) {
            kpiDowntime.textContent = '--';
        }
        if (kpiDowntimeLabel && latestDowntime) {
            kpiDowntimeLabel.textContent = `Tempo: ${latestDowntime.h} | Paradas: ${latestDowntime.p}`;
        } else if (kpiDowntimeLabel) {
            kpiDowntimeLabel.textContent = 'Sem paradas no período';
        }
        if (kpiDowntimeComment) {
            kpiDowntimeComment.textContent = latestUtilityComment
                ? `Último registro (${latestUtilityComment.d}): ${latestUtilityComment.m}`
                : 'Sem comentário para esta utilidade';
        }

        // Exibir o mesmo último reabastecimento registrado na fonte de dados.
        const nitroRefillDay = [...nitroData]
            .filter((item) => item.r && String(item.r).trim() !== '' && String(item.r).trim() !== '-')
            .sort((a, b) => new Date(normalizeDateValue(b.d)) - new Date(normalizeDateValue(a.d)))[0];
        
        const kpiIndisponibilidade = document.getElementById('kpiIndisponibilidade');
        const kpiIndisponibilidadeLabel = document.getElementById('kpiIndisponibilidadeLabel');
        if (kpiIndisponibilidade) {
            if (nitroRefillDay && nitroRefillDay.r) {
                const refillValue = String(nitroRefillDay.r).trim();
                kpiIndisponibilidade.textContent = /\bpol\b/i.test(refillValue) ? refillValue : `${refillValue} pol`;
            } else {
                const totalConsumption = indexes.map((index) => (Number(dw7A[index]) || 0) + (Number(dw7B[index]) || 0));
                const maxConsumption = Math.max(...totalConsumption.filter(value => Number.isFinite(value)));
                kpiIndisponibilidade.textContent = `${maxConsumption.toFixed(1)} m³`;
            }
        }
        if (kpiIndisponibilidadeLabel) {
            if (nitroRefillDay) {
                kpiIndisponibilidadeLabel.textContent = `Reabastecimento em ${nitroRefillDay.d}`;
            } else {
                const totalConsumption = indexes.map((index) => (Number(dw7A[index]) || 0) + (Number(dw7B[index]) || 0));
                const maxConsumption = Math.max(...totalConsumption.filter(value => Number.isFinite(value)));
                const maxConsumptionIndex = totalConsumption.indexOf(maxConsumption);
                kpiIndisponibilidadeLabel.textContent = `Maior consumo total em ${diasAgosto[maxConsumptionIndex] || 'N/D'}`;
            }
        }

        const avgAvailability = document.getElementById('avgAvailability');
        if (avgAvailability) {
    const { start: startDate, end: endDate } = getEffectiveDateRange();
    const periodStart = new Date(`${startDate}T00:00:00`);
    const periodEnd = new Date(`${endDate}T23:59:59`);
    const utilitiesInBlock = availabilityData.filter((item) => selectedBlock === 'all' || item.name.endsWith(selectedBlock));
    const downtimeHours = downtimeData
        .filter((item) => {
            const date = new Date(`${normalizeDateValue(item.d)}T00:00:00`);
            const matchesBlock = selectedBlock === 'all' || item.u.endsWith(selectedBlock);
            return matchesBlock && date >= periodStart && date <= periodEnd;
        })
        .reduce((total, item) => total + parseNumberValue(item.h), 0);
    const periodDays = Math.max(1, Math.ceil((periodEnd - periodStart) / (24 * 60 * 60 * 1000)));
    const totalPeriodHours = utilitiesInBlock.length * periodDays * 24;
    const percentage = totalPeriodHours
        ? Math.max(0, ((totalPeriodHours - downtimeHours) / totalPeriodHours) * 100)
        : 0;
            const color = percentage >= 80 ? '#2ecc71' : percentage >= 50 ? '#f39c12' : '#e74c3c';
            avgAvailability.textContent = `${percentage.toFixed(1)}%`;
            avgAvailability.style.color = color;
        }
    }

    function renderFilteredTables(labels, indexes) {
        const dwTbody = document.getElementById('dwTableBody');
        if (dwTbody) {
dwTbody.innerHTML = indexes.filter((i) => dw7A[i] > 0 || dw7B[i] > 0).map((i) => dwRowHtml(diasAgosto[i], i)).join('');
        }

        const cloroTbody = document.getElementById('cloroTableBody');
        if (cloroTbody) {
const cloroRows = indexes.filter(hasChlorineData);
cloroTbody.innerHTML = cloroRows.map((originalIndex) => {
const dia = diasAgosto[originalIndex];
const formattedDate = /\/\d{4}$/.test(String(dia)) ? dia : `${dia}/2026`;
return getChlorineSeries().map((serie) => {
    const value = serie.values[originalIndex];
    const reteste = serie.reteste[originalIndex];
    const hasValue = value !== null && value !== undefined;
    const hasReteste = reteste !== null && reteste !== undefined;
    if (!hasValue && !hasReteste) return '';
    const color = hasValue && (value < 1.0 || value > 2.0) ? 'color: #e74c3c; font-weight: bold;' : '';
    return `<tr><td><strong>${formattedDate}</strong></td><td>${escapeHtml(serie.name)}</td><td>1.00</td><td style="${color}">${hasValue ? value.toFixed(2) : '-'}</td><td>2.00</td><td>${hasReteste ? reteste.toFixed(2) : '-'}</td><td>${hasReteste ? 'Reteste realizado' : ''}</td></tr>`;
}).join('');
}).join('');
        }

        const nitroTbody = document.getElementById('nitroTableBody');
        if (nitroTbody) {
            const selectedNitro = nitroData.filter((item) => {
                const date = new Date(normalizeDateValue(item.d).replace(/-/g, '/'));
const { start: rangeStartValue, end: rangeEndValue } = getEffectiveDateRange();
const startDate = new Date(`${rangeStartValue}T00:00:00`);
const endDate = new Date(`${rangeEndValue}T23:59:59`);
                return date >= startDate && date <= endDate;
            });

            nitroTbody.innerHTML = (selectedNitro.length ? selectedNitro : [{d: 'Sem dados', n: '-', r: '-'}]).map(item => `<tr><td>${item.d}</td><td>${item.n}</td><td>${item.r}</td></tr>`).join('');
        }

        const logTbody = document.getElementById('logTableBody');
        if (logTbody) {
const occurrences = getFilteredDowntimeData()
                .sort((a, b) => new Date(normalizeDateValue(a.d)) - new Date(normalizeDateValue(b.d)));
logTbody.innerHTML = (occurrences.length ? occurrences : [{ d: 'Sem dados', u: '-', p: '-', h: '-', m: 'Nenhuma ocorrência registrada no período selecionado.' }])
        .map((item) => `<tr><td><strong>${item.d}</strong></td><td><span style="color:#2980b9; font-weight:500">${item.u}</span></td><td>${item.p}</td><td>${item.h}</td><td>${item.m}</td></tr>`)
                .join('');
        }

        const availabilityCommentsTbody = document.getElementById('availabilityCommentsTableBody');
        if (availabilityCommentsTbody) {
const occurrences = getFilteredDowntimeData()
                .sort((a, b) => new Date(normalizeDateValue(a.d)) - new Date(normalizeDateValue(b.d)));
availabilityCommentsTbody.innerHTML = (occurrences.length ? occurrences : [{ d: 'Sem dados', u: '-', p: '-', h: '-', m: 'Nenhuma ocorrência registrada no período selecionado.' }])
        .map((item) => `<tr><td><strong>${item.d}</strong></td><td><span style="color:#2980b9; font-weight:500">${item.u}</span></td><td>${item.p}</td><td>${item.h}</td><td>${item.m}</td></tr>`)
                .join('');
        }
    }

function getEffectiveDateRange() {
const startValue = document.getElementById('dateStart')?.value;
const endValue = document.getElementById('dateEnd')?.value;
const dataDates = diasAgosto.map((label) => normalizeDateValue(label)).filter(Boolean).sort();
return {
    start: startValue || dataDates[0] || '',
    end: endValue || dataDates[dataDates.length - 1] || ''
};
}

function getFilteredDowntimeData() {
const dateStartValue = document.getElementById('dateStart')?.value;
const dateEndValue = document.getElementById('dateEnd')?.value;

if (!dateStartValue || !dateEndValue) {
    return [...downtimeData];
}

const periodStart = new Date(`${normalizeDateValue(dateStartValue)}T00:00:00`).getTime();
const periodEnd = new Date(`${normalizeDateValue(dateEndValue)}T23:59:59`).getTime();

return downtimeData.filter((item) => {
    const itemDate = new Date(`${normalizeDateValue(item.d)}T00:00:00`).getTime();
    return !Number.isNaN(itemDate) && itemDate >= periodStart && itemDate <= periodEnd;
});
}

    function renderDowntimeChart() {
        const indispChart = window.indispChart;
        if (!indispChart) return;

        const byUtility = getFilteredDowntimeData().reduce((totals, item) => {
            const name = item.u || 'Não informado';
            const existing = totals.get(name) || { hours: 0, stops: 0 };
            totals.set(name, {
                hours: existing.hours + parseNumberValue(item.h),
                stops: existing.stops + parseNumberValue(item.p)
            });
            return totals;
        }, new Map());

        const entries = [...byUtility.entries()].sort(([, firstTotal], [, secondTotal]) => secondTotal.hours - firstTotal.hours);
        indispChart.data.labels = entries.map(([name]) => name);
        indispChart.data.datasets[0].data = entries.map(([, total]) => total.hours);
        indispChart.data.datasets[1].data = entries.map(([, total]) => total.stops);
        const largestStopCount = Math.max(...entries.map(([, total]) => total.stops), 1);
        indispChart.options.scales.yStops.max = Math.max(5, largestStopCount * 3);
        indispChart.update();
    }

    function applyDateFilters() {
        const dateStart = document.getElementById('dateStart');
        const dateEnd = document.getElementById('dateEnd');
        const blocoFilter = document.getElementById('blocoFilter');

        if (!dateStart || !dateEnd) {
            return;
        }

if (dateStart.value && dateEnd.value && dateStart.value > dateEnd.value) {
    const previousStart = dateStart.value;
    dateStart.value = dateEnd.value;
    dateEnd.value = previousStart;
}

const filtered = filterDateRange(diasAgosto, dateStart.value, dateEnd.value, DEFAULT_YEAR);
const labels = filtered.labels;
const indexes = filtered.indexes;
const noDateFilter =   !dateStart.value || !dateEnd.value;
const recentIndexes = noDateFilter ? indexes.slice(-DASHBOARD_RECENT_DAYS) : indexes;
const recentLabels = recentIndexes.map((index) => diasAgosto[index]);
const selectedBlock = blocoFilter ? blocoFilter.value : 'all';
// Cada módulo usa só as datas em que a sua própria coluna tem valor.
const hasDwData = (index) => dw7A[index] > 0 || dw7B[index] > 0;
const hasNitroData = (index) => nitrogenNivel[index] > 0;
const hasCloroData = hasChlorineData;
const pickIndexes = (has) => {
    const own = indexes.filter(has);
    return noDateFilter ? own.slice(-DASHBOARD_RECENT_DAYS) : own;
};
const dwRecent = pickIndexes(hasDwData);
const nitroRecent = pickIndexes(hasNitroData);
const cloroRecent = pickIndexes(hasCloroData);
const labelsOf = (list) => list.map((index) => diasAgosto[index]);
const dwIndexes = indexes.filter(hasDwData);
const nitroIndexes = indexes.filter(hasNitroData);
const cloroIndexes = indexes.filter(hasCloroData);
syncAvailabilityForDate(dateEnd.value || (diasAgosto.length ? diasAgosto[diasAgosto.length - 1] : ''));
renderAvailabilityView();
renderExtraColumnsView();

const blockDw7A = dwIndexes.map((index) => dw7A[index]);
const blockDw7B = dwIndexes.map((index) => dw7B[index]);
const blockNitrogen = nitroIndexes.map((index) => nitrogenNivel[index]);
const blockCloro = cloroIndexes.map((index) => cloroPpm[index]);
    const blockReteste = cloroIndexes.map((index) => retestePpm[index]);

        const filteredDw7A = selectedBlock === '7A'
            ? blockDw7A
            : selectedBlock === '7B'
                ? blockDw7A.map(() => 0)
                : blockDw7A;

        const filteredDw7B = selectedBlock === '7B'
            ? blockDw7B
            : selectedBlock === '7A'
                ? blockDw7B.map(() => 0)
                : blockDw7B;

        const filteredNitrogen = blockNitrogen;
        const filteredCloro = blockCloro;
    const filteredReteste = blockReteste;

const dwChart = window.dwChart;
if (dwChart) {
dwChart.data.labels = labelsOf(dwRecent);
dwChart.data.datasets[0].data = dwRecent.map((index) => dw7A[index]);
dwChart.data.datasets[1].data = dwRecent.map((index) => dw7B[index]);
dwChart.update();
}

const nitrogenChart = window.nitrogenChart;
if (nitrogenChart) {
nitrogenChart.data.labels = labelsOf(nitroRecent);
nitrogenChart.data.datasets[0].data = nitroRecent.map((index) => nitrogenNivel[index]);
nitrogenChart.update();
}

const chlorineChart = window.chlorineChart;
if (chlorineChart) {
chlorineChart.$indexes = cloroRecent;
chlorineChart.data.labels = labelsOf(cloroRecent);
chlorineChart.data.datasets = chlorineDatasets(cloroRecent, false, selectedChlorineIndexes(getSelectedReportModules()));
chlorineChart.update();
}
renderChlorineBlocks('chlorineBlocks', cloroRecent, false, selectedChlorineIndexes(getSelectedReportModules()));
renderChlorineBlocks('chlorineBlocksTv', cloroIndexes, true, selectedChlorineIndexes(getSelectedReportModules()));

const dwChartTv = window.dwChartTv;
if (dwChartTv) {
dwChartTv.data.labels = labelsOf(dwIndexes);
            dwChartTv.data.datasets[0].data = filteredDw7A;
            dwChartTv.data.datasets[1].data = filteredDw7B;
            dwChartTv.data.datasets[0].label = selectedBlock === 'all' ? 'DW 7A (m³)' : `DW 7A (${selectedBlock}) (m³)`;
            dwChartTv.data.datasets[1].label = selectedBlock === 'all' ? 'DW 7B (m³)' : `DW 7B (${selectedBlock}) (m³)`;
            dwChartTv.update();
        }

        const nitrogenChartTv = window.nitrogenChartTv;
        if (nitrogenChartTv) {
nitrogenChartTv.data.labels = labelsOf(nitroIndexes);
            nitrogenChartTv.data.datasets[0].data = filteredNitrogen;
            nitrogenChartTv.update();
        }

        const chlorineChartTv = window.chlorineChartTv;
        if (chlorineChartTv) {
chlorineChartTv.data.labels = labelsOf(cloroIndexes);
chlorineChartTv.data.datasets = chlorineDatasets(cloroIndexes, true, selectedChlorineIndexes(getSelectedReportModules()));
chlorineChartTv.update();
}

renderFilteredTables(labels, indexes);
    renderDowntimeChart();
    renderSummaryForRange(indexes, selectedBlock);

        return filtered;
    }

    const today = new Date();
    const todayLabel = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
    const todayIndex = diasAgosto.findIndex((valor) => normalizeDateValue(valor) === normalizeDateValue(todayLabel));
    const initialIndex = todayIndex >= 0 ? todayIndex : diasAgosto.length - 1;
    document.getElementById('dailyNitro').innerText = nitrogenNivel[initialIndex].toFixed(1) + ' pol';
    document.getElementById('dailyDw7a').innerText = dw7A[initialIndex].toFixed(1) + ' m³';
    document.getElementById('dailyDw7b').innerText = dw7B[initialIndex].toFixed(1) + ' m³';
    const dailyDateBadge = document.getElementById('dailyDateBadge');
    if (dailyDateBadge) dailyDateBadge.innerText = diasAgosto[initialIndex] || todayLabel;

    const dwChart = new Chart(document.getElementById('dwChart').getContext('2d'), { type: 'bar', data: { labels: diasAgosto, datasets: [ { label: 'DW 7A (m³)', data: dw7A, backgroundColor: '#3498db' }, { label: 'DW 7B (m³)', data: dw7B, backgroundColor: '#27ae60' } ] },     options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 16 } }, scales: { y: { grace: '12%' } }, plugins: { legend: { display: false }, datalabels: { color: '#000', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(1) } } } });
    window.dwChart = dwChart;

    const nitrogenChart = new Chart(document.getElementById('nitrogenChart').getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Nitrogênio (pol)', data: nitrogenNivel, borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 16 } }, scales: { y: { grace: '12%' } }, plugins: { legend: { display: false }, datalabels: { color: '#9b59b6', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(1), anchor: 'end', align: 'top', offset: 5 } } } });
    window.nitrogenChart = nitrogenChart;

    const chlorineChart = new Chart(document.getElementById('chlorineChart').getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Teste de Cloro', data: cloroPpm, borderColor: '#34495e', fill: false, tension: 0.1 }, { label: 'Reteste', data: retestePpm, borderColor: '#f39c12', backgroundColor: '#f39c12', borderWidth: 2, pointRadius: 5, pointHoverRadius: 6, spanGaps: false, fill: false, tension: 0 }, { label: 'Limite inferior (1,00)', isLimit: true, data: diasAgosto.map(() => 1), borderColor: '#27ae60', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }, { label: 'Limite superior (2,00)', isLimit: true, data: diasAgosto.map(() => 2), borderColor: '#e74c3c', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24, right: 16 } },     scales: { y: { min: 0, suggestedMax: 3.5, ticks: { stepSize: 0.5, callback: (v) => Number(v).toFixed(1) }, title: { display: true, text: 'ppm' } }, x: { ticks: { maxRotation: 60, autoSkip: true } } }, plugins: { legend: { display: true }, datalabels: { display: (context) => !context.dataset.isLimit && context.dataset.data[context.dataIndex] !== null, color: '#34495e', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(2), anchor: 'end', align: 'top', offset: 5 } } } });
    window.chlorineChart = chlorineChart;

    const dispCanvas = document.getElementById('dispChart');
    if (dispCanvas) {
const dispChart = new Chart(dispCanvas.getContext('2d'), { type: 'bar', data: { labels: ['Vapor Ind 7A', 'Vapor Ind 7B', 'CW Processo', 'CW HVAC', 'Ar Comp', 'WFI', 'SFI'], datasets: [{ label: 'Disponibilidade Diária (%)', data: [100,100,100,100,100,100,100], backgroundColor: '#2ecc71', borderRadius: 4 }] }, options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, scales: { x: { max: 100 } }, plugins: { datalabels: { color: '#000', font: { weight: 'bold', size: 12 }, formatter: (value) => value + '%' } } } });
        window.dispChart = dispChart;
    }

    const dwChartTvCanvas = document.getElementById('dwChartTv');
    if (dwChartTvCanvas) {
        const dwChartTv = new Chart(dwChartTvCanvas.getContext('2d'), { type: 'bar', data: { labels: diasAgosto, datasets: [ { label: 'DW 7A (m³)', data: dw7A, backgroundColor: '#3498db', borderRadius: 5 }, { label: 'DW 7B (m³)', data: dw7B, backgroundColor: '#27ae60', borderRadius: 5 } ] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: false, ticks: { font: { size: 20 } }, grid: { color: 'rgba(0,0,0,0.08)' } }, x: { ticks: { font: { size: 20 } } } }, plugins: { legend: { labels: { font: { size: 20 } } }, datalabels: { color: '#000', font: { weight: 'bold', size: 18 }, formatter: (value) => value.toFixed(1) } } } });
        window.dwChartTv = dwChartTv;
    }

    const nitrogenChartTvCanvas = document.getElementById('nitrogenChartTv');
    if (nitrogenChartTvCanvas) {
        const nitrogenChartTv = new Chart(nitrogenChartTvCanvas.getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Nitrogênio (pol)', data: nitrogenNivel, borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', borderWidth: 3, fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font: { size: 20 } } }, y: { ticks: { font: { size: 20 } } } }, plugins: { datalabels: { color: '#9b59b6', font: { weight: 'bold', size: 18 }, formatter: (value) => value.toFixed(1), anchor: 'end', align: 'top', offset: 8 } } } });
        window.nitrogenChartTv = nitrogenChartTv;
    }

    const indispCanvas = document.getElementById('indispChart');
    if (indispCanvas) {
    const indispChart = new Chart(indispCanvas.getContext('2d'), { type: 'bar', data: { labels: ['CW Proc 7A', 'CW Proc 7B', 'CW HVAC 7A', 'CW HVAC 7B', 'WFI 7B', 'SFI 7A', 'SFI 7B'], datasets: [{ label: 'Tempo Indisponível (Horas)', data: [6.1, 24.6, 5.3, 5.3, 19.3, 6.7, 24.6], backgroundColor: '#e74c3c', borderRadius: 5, yAxisID: 'y' }, { label: 'Quantidade de Paradas', data: [1, 1, 1, 1, 1, 1, 1], backgroundColor: '#3498db', borderRadius: 5, yAxisID: 'yStops' }] }, options: { responsive: true, maintainAspectRatio: false, layout: { padding: { top: 24 } }, scales: { y: { beginAtZero: true, position: 'left', ticks: { font: { size: 10 } }, grid: { color: 'rgba(0,0,0,0.08)' } }, yStops: { beginAtZero: true, max: 5, position: 'right', grid: { drawOnChartArea: false }, ticks: { precision: 0, font: { size: 10 } } }, x: { ticks: { font: { size: 10 } } } }, plugins: { legend: { labels: { font: { size: 10 } } }, datalabels: { display: true, color: '#2c3e50', anchor: 'end', align: 'top', offset: 4, clamp: true, font: { weight: 'bold', size: 9 }, formatter: (value, context) => context.dataset.yAxisID === 'yStops' ? value : value.toFixed(1) + 'h' } } } });
window.indispChart = indispChart;
window.setIndispChartTvFonts = (isTv) => {
    const tickSize = isTv ? 12 : 10;
    const labelSize = isTv ? 11 : 9;
    indispChart.options.scales.y.ticks.font.size = tickSize;
    indispChart.options.scales.yStops.ticks.font.size = tickSize;
    indispChart.options.scales.x.ticks.font.size = tickSize;
    indispChart.options.plugins.legend.labels.font.size = tickSize;
    indispChart.options.plugins.datalabels.font.size = labelSize;
    indispChart.update();
};
    }

    const chlorineChartTvCanvas = document.getElementById('chlorineChartTv');
    if (chlorineChartTvCanvas) {
    const chlorineChartTv = new Chart(chlorineChartTvCanvas.getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Teste de Cloro', data: cloroPpm, borderColor: '#34495e', borderWidth: 2, fill: false, tension: 0.1, pointBackgroundColor: ctx => { const value = ctx.dataset.data[ctx.dataIndex]; return (value < 1 || value > 2) ? '#e74c3c' : '#3498db'; } }, { label: 'Reteste', data: retestePpm, borderColor: '#f39c12', backgroundColor: '#f39c12', borderWidth: 2, pointRadius: 6, pointHoverRadius: 7, spanGaps: false, fill: false, tension: 0 }, { label: 'Limite inferior (1,00)', isLimit: true, data: diasAgosto.map(() => 1), borderColor: '#27ae60', borderWidth: 2, borderDash: [8, 5], pointRadius: 0, fill: false }, { label: 'Limite superior (2,00)', isLimit: true, data: diasAgosto.map(() => 2), borderColor: '#e74c3c', borderWidth: 2, borderDash: [8, 5], pointRadius: 0, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font: { size: 12 }, autoSkip: false, minRotation: 45, maxRotation: 60 } }, y: { min: 0, suggestedMax: 3.5, ticks: { font: { size: 20 }, stepSize: 0.5, callback: (v) => Number(v).toFixed(1) } } }, plugins: { legend: { labels: { font: { size: 20 } } }, datalabels: { display: (context) => !context.dataset.isLimit && context.dataset.data[context.dataIndex] !== null, color: '#34495e', font: { weight: 'bold', size: 12 }, formatter: (value) => value.toFixed(2), anchor: 'end', align: 'top', offset: 8 } } } });
        window.chlorineChartTv = chlorineChartTv;
    }

    const dispTbody = document.getElementById('dispTableBody');
    if (dispTbody) {
        ['Vapor Ind', 'CW Processo', 'CW HVAC', 'Ar Comp', 'WFI', 'SFI'].forEach(ut => { dispTbody.innerHTML += `<tr><td><strong>13/08/2026</strong></td><td>7A/7B</td><td>${ut}</td><td><span style="color:#2ecc71; font-weight:bold;">100%</span></td></tr>`; });
    }

    const dwTbody = document.getElementById('dwTableBody');
    if (dwTbody) {
dwTbody.innerHTML = diasAgosto.map(dwRowHtml).join('');
    }

    const nitroTbody = document.getElementById('nitroTableBody');
    if (nitroTbody) {
        nitroTbody.innerHTML = nitroData.map(item => `<tr><td>${item.d}</td><td>${item.n}</td><td>${item.r}</td></tr>`).join('');
    }

    const logTbody = document.getElementById('logTableBody');
    if (logTbody) {
        logTbody.innerHTML = logData.map(item => `<tr><td><strong>${item.data}</strong></td><td><span style="color:#2980b9; font-weight:500">${item.utilidade}</span></td><td>${item.comentario}</td></tr>`).join('');
    }

    const cloroTbody = document.getElementById('cloroTableBody');
    if (cloroTbody) {
        cloroTbody.innerHTML = diasAgosto.map((dia, i) => { let color = (cloroPpm[i] < 1.0 || cloroPpm[i] > 2.0) ? 'color: #e74c3c; font-weight: bold;' : ''; return `<tr><td><strong>${dia}/2026</strong></td><td>1.00</td><td style="${color}">${cloroPpm[i].toFixed(2)}</td><td>2.00</td><td></td><td></td></tr>`; }).join('');
    }

    renderAvailabilityView();
    applyDateFilters();

    const applyFilterButton = document.querySelector('.btn-filter');
    if (applyFilterButton) {
        applyFilterButton.addEventListener('click', applyDateFilters);
    }

    const applyDataButton = document.getElementById('applyDataChanges');
    if (applyDataButton) {
        applyDataButton.addEventListener('click', applyBaseDataChanges);
    }

    const reloadCsvButton = document.getElementById('reloadCsvData');
    if (reloadCsvButton) {
        reloadCsvButton.addEventListener('click', () => {
            loadDataFromCsv();
        });
    }

initReportModuleFilter();
const generatePdfButton = document.getElementById('btnGeneratePdf');
    if (generatePdfButton) {
        generatePdfButton.addEventListener('click', () => {
const { start: startDate, end: endDate } = getEffectiveDateRange();
            const bloco = document.getElementById('blocoFilter')?.value || 'all';
const selectedModules = getSelectedReportModules();
const isAllModules = selectedModules.includes('all');
const moduleTitles = {
    all: 'Todos os módulos',
    availability: 'Disponibilidade Diária',
    dw7a: 'DW 7A',
    dw7b: 'DW 7B',
    nitrogenio: 'Nitrogênio',
    indisponibilidade: 'Indisponibilidade das Utilidades',
    cloro: 'Teste de Cloro'
};
const getModuleTitle = (moduleKey) => {
    const chlorineMatch = /^cloro:(\d+)$/.exec(moduleKey);
    if (chlorineMatch) return 'Cloro - ' + (getChlorineSeries()[Number(chlorineMatch[1])]?.name || moduleKey);
    const extra = extraData.columns.find((col) => 'extra:' + col.key === moduleKey);
    return extra ? extra.label : (moduleTitles[moduleKey] || moduleKey);
};
const reportModules = [...new Set(selectedModules.map((key) => (key.startsWith('cloro:') ? 'cloro' : key)))];
const chlorineSelected = selectedChlorineIndexes(selectedModules);
const moduleTitle = isAllModules ? moduleTitles.all : selectedModules.map(getModuleTitle).join(', ');
const extraReportHtml = (() => {
    const { columns, rows } = extraData;
    const inRange = filterDateRange(rows.map((row) => row.date), startDate, endDate, DEFAULT_YEAR).indexes.map((i) => rows[i]);
    return columns.map((col) => [
        '<h3 class="report-section-title">' + escapeHtml(col.label) + '</h3>',
        '<table class="report-table"><thead><tr><th>Data</th><th>' + escapeHtml(col.label) + '</th></tr></thead><tbody>',
        inRange.filter((row) => row.values[col.key] !== undefined).map((row) => '<tr><td>' + escapeHtml(row.date) + '</td><td>' + escapeHtml(row.values[col.key]) + '</td></tr>').join(''),
        '</tbody></table>'
    ].join(''));
})();

            const filteredLabels = filterDateRange(diasAgosto, startDate, endDate).labels;
            const filteredDw7A = filteredLabels.map((label) => {
                const idx = diasAgosto.indexOf(label);
                return Number.isFinite(dw7A[idx]) ? dw7A[idx] : 0;
            });
            const filteredDw7B = filteredLabels.map((label) => {
                const idx = diasAgosto.indexOf(label);
                return Number.isFinite(dw7B[idx]) ? dw7B[idx] : 0;
            });
            const filteredNitro = filteredLabels.map((label) => {
                const idx = diasAgosto.indexOf(label);
                return Number.isFinite(nitrogenNivel[idx]) ? nitrogenNivel[idx] : 0;
            });
            const filteredCloro = filteredLabels.map((label) => {
                const idx = diasAgosto.indexOf(label);
                return Number.isFinite(cloroPpm[idx]) ? cloroPpm[idx] : 0;
            });

const maxDw7A = Math.max(...filteredDw7A, 0);
const maxDw7B = Math.max(...filteredDw7B, 0);
const maxNitro = Math.max(...filteredNitro, 0);
const avgCloro = filteredCloro.length ? filteredCloro.reduce((sum, value) => sum + value, 0) / filteredCloro.length : 0;
const downtimeInRange = downtimeData
.filter((comment) => {
const itemDate = new Date(`${normalizeDateValue(comment.d)}T00:00:00`);
const start = new Date(`${startDate}T00:00:00`);
const end = new Date(`${endDate}T23:59:59`);
const matchesBlock = bloco === 'all' || comment.u.endsWith(bloco);
return matchesBlock && itemDate >= start && itemDate <= end;
})
.map((comment) => {
    const note = downtimeComments.find((item) =>
        normalizeDateValue(item.d) === normalizeDateValue(comment.d) &&
        normalizeCsvHeader(item.u) === normalizeCsvHeader(comment.u)
    );
    return {
        d: comment.d,
        u: comment.u,
        p: comment.p || '-',
        h: comment.h || '-',
        m: note?.m || comment.m || 'Sem detalhe'
    };
});
            const latestDowntime = [...downtimeInRange]
                .sort((first, second) => new Date(normalizeDateValue(second.d)) - new Date(normalizeDateValue(first.d)))[0];
            const latestRefill = [...nitroData]
                .filter((item) => {
                    const itemDate = new Date(normalizeDateValue(item.d));
                    const start = new Date(`${startDate}T00:00:00`);
                    const end = new Date(`${endDate}T23:59:59`);
                    return itemDate >= start && itemDate <= end;
                })
                .sort((first, second) => new Date(normalizeDateValue(second.d)) - new Date(normalizeDateValue(first.d)))[0];
            const availabilityValue = document.getElementById('avgAvailability')?.textContent || '--';
            const formatReportDate = (dateValue) => {
                const [year, month, day] = String(dateValue || '').split('-');
                return year && month && day ? `${day}/${month}` : 'N/D';
            };
            const reportYear = String(endDate || startDate || '').split('-')[0] || 'N/D';
            const reportPeriod = `${formatReportDate(startDate)} a ${formatReportDate(endDate)} de ${reportYear}`;
            const cloroOutOfRangeCount = (() => {
    let count = 0;
    chlorineSelected.forEach((k) => filteredLabels.forEach((label) => {
        const value = getChlorineSeries()[k].values[diasAgosto.indexOf(label)];
        if (value !== null && value !== undefined && (value < 1 || value > 2)) count += 1;
    }));
    return count;
})();
const avgChlorineSelected = (() => {
    const values = [];
    chlorineSelected.forEach((k) => filteredLabels.forEach((label) => {
        const value = getChlorineSeries()[k].values[diasAgosto.indexOf(label)];
        if (value !== null && value !== undefined && value > 0) values.push(value);
    }));
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
})();
            const filteredObs7A = filteredLabels.map((label) => obsDw7A[diasAgosto.indexOf(label)] || '');
            const filteredObs7B = filteredLabels.map((label) => obsDw7B[diasAgosto.indexOf(label)] || '');
            const dwSeries7A = [
                { label: 'DW 7A (m³)', values: filteredDw7A },
                { label: 'Observação DW 7A', values: filteredObs7A, text: true }
            ];
            const dwSeries7B = [
                { label: 'DW 7B (m³)', values: filteredDw7B },
                { label: 'Observação DW 7B', values: filteredObs7B, text: true }
            ];
            const buildDwTable = (title, series) => [
                '<h3 class="report-section-title">' + title + '</h3>',
                '<table class="report-table"><thead><tr><th>Data</th>' + series.map((s) => '<th>' + s.label + '</th>').join('') + '</tr></thead><tbody>',
                filteredLabels.map((label, filteredIndex) => {
                    return '<tr><td>' + label + '</td>' + series.map((s) => '<td>' + (s.text ? (escapeHtml(s.values[filteredIndex]) || '-') : Number(s.values[filteredIndex] || 0).toFixed(1)) + '</td>').join('') + '</tr>';
                }).join(''),
                '</tbody></table>'
            ].join('');

            const downtimeRowsHtml = downtimeInRange.length
                ? downtimeInRange.map((item) => {
                    return [
                    '<tr>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + item.d + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + item.u + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + item.p + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + item.h + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + item.m + '</td>',
                    '</tr>'
                    ].join('');
                }).join('')
                : '<tr><td colspan="5" style="border:1px solid #ddd; padding:8px;">Nenhuma parada no período</td></tr>';

            const rowsHtml = filteredLabels.map((label) => {
                const idx = diasAgosto.indexOf(label);
                return [
                    '<tr>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + label + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(dw7A[idx] || 0).toFixed(1) + '</td>',
'<td style="border:1px solid #ddd; padding:8px;">' + (escapeHtml(obsDw7A[idx]) || '-') + '</td>',
'<td style="border:1px solid #ddd; padding:8px;">' + Number(dw7B[idx] || 0).toFixed(1) + '</td>',
'<td style="border:1px solid #ddd; padding:8px;">' + (escapeHtml(obsDw7B[idx]) || '-') + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(nitrogenNivel[idx] || 0).toFixed(1) + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(cloroPpm[idx] || 0).toFixed(2) + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + (retestePpm[idx] === null || retestePpm[idx] === undefined ? '-' : Number(retestePpm[idx]).toFixed(2)) + '</td>',
                    '</tr>'
                ].join('');
            }).join('');

const chartImageSpecs = [
{ module: ['dw7a', 'dw7b'], chart: window.dwChart, title: 'Consumo de Água (DW 7A / DW 7B)' },
{ module: 'nitrogenio', chart: window.nitrogenChart, title: 'Nível de Nitrogênio' },
{ module: 'cloro', chart: window.chlorineChart, title: 'Monitoramento de Cloro', getImage: () => {
    const chart = window.chlorineChart;
    if (!chart) return '';
    const original = chart.data.datasets;
    chart.data.datasets = chlorineDatasets(chart.$indexes || [], false, chlorineSelected);
    chart.update('none');
    const image = chart.toBase64Image('image/png', 1);
    chart.data.datasets = original;
    chart.update('none');
    return image;
} },
{ module: 'indisponibilidade', chart: window.indispChart, title: 'Indisponibilidade das Utilidades (Horas)' },
...extraCharts.map((item) => ({ module: 'extra:' + item.key, chart: item.chart, title: item.chart.data.datasets[0].label }))
];
const chartsHtml = chartImageSpecs
.filter((spec) => (isAllModules || [].concat(spec.module).some((key) => reportModules.includes(key))) && spec.chart && typeof spec.chart.toBase64Image === 'function')
.map((spec) => ({ ...spec, image: spec.getImage ? spec.getImage() : spec.chart.toBase64Image('image/png', 1) }))
.filter((spec) => spec.image && spec.image.length > 100)
.map((spec) => {
    const image = spec.image;
    return [
        '<div class="report-chart-block">',
        '<h4>' + spec.title + '</h4>',
        '<img src="' + image + '" alt="' + spec.title + '">',
        '</div>'
    ].join('');
})
.join('');
const chartsSectionHtml = chartsHtml
? '<h3 class="report-section-title">Gráficos do Período</h3><div class="report-charts-grid">' + chartsHtml + '</div>'
: '';

const summaryItemsByModule = {
    dw7a: ['<div><span>Maior consumo DW 7A</span><strong>' + maxDw7A.toFixed(1) + ' m³</strong></div>'],
    dw7b: ['<div><span>Maior consumo DW 7B</span><strong>' + maxDw7B.toFixed(1) + ' m³</strong></div>'],
    nitrogenio: [
        '<div><span>Maior nível de nitrogênio</span><strong>' + maxNitro.toFixed(1) + ' pol</strong></div>',
        '<div><span>Último reabastecimento</span><strong>' + (latestRefill ? latestRefill.r + ' pol em ' + latestRefill.d : 'Nenhum no período') + '</strong></div>'
    ],
    cloro: [
        '<div><span>Média de cloro</span><strong>' + avgChlorineSelected.toFixed(2) + ' ppm</strong></div>',
        '<div><span>Testes fora do limite (1,00–2,00 ppm)</span><strong>' + cloroOutOfRangeCount + '</strong></div>'
    ],
    availability: [
        '<div><span>Utilidades disponíveis</span><strong>' + availabilityData.filter((item) => item.status === 'disponivel' && (bloco === 'all' || item.name.endsWith(bloco))).length + '/' + availabilityData.filter((item) => bloco === 'all' || item.name.endsWith(bloco)).length + '</strong></div>',
        '<div><span>Disponibilidade no período</span><strong>' + availabilityValue + '</strong></div>',
        '<div><span>Data de referência do status</span><strong>' + formatReportDate(endDate) + '</strong></div>'
    ],
    indisponibilidade: [
        '<div><span>Última parada</span><strong>' + (latestDowntime ? latestDowntime.u + ' - ' + latestDowntime.h + ' em ' + latestDowntime.d : 'Nenhuma no período') + '</strong></div>',
        '<div><span>Paradas registradas</span><strong>' + downtimeInRange.length + '</strong></div>',
        '<div><span>Horas indisponíveis</span><strong>' + downtimeInRange.reduce((total, item) => total + parseNumberValue(item.h), 0).toFixed(1) + ' h</strong></div>'
    ]
};
const allSummaryHtml = [
    '<div><span>Maior consumo DW 7A</span><strong>' + maxDw7A.toFixed(1) + ' m³</strong></div>',
    '<div><span>Maior consumo DW 7B</span><strong>' + maxDw7B.toFixed(1) + ' m³</strong></div>',
    '<div><span>Maior nitrogênio</span><strong>' + maxNitro.toFixed(1) + ' pol</strong></div>',
    '<div><span>Média de cloro</span><strong>' + avgCloro.toFixed(2) + ' ppm</strong></div>',
    '<div><span>Disponibilidade diária</span><strong>' + availabilityValue + '</strong></div>',
    '<div><span>Último reabastecimento</span><strong>' + (latestRefill ? latestRefill.r + ' pol em ' + latestRefill.d : 'Nenhum no período') + '</strong></div>',
    '<div><span>Última parada</span><strong>' + (latestDowntime ? latestDowntime.u + ' - ' + latestDowntime.h + ' em ' + latestDowntime.d : 'Nenhuma no período') + '</strong></div>',
    '<div><span>Paradas registradas</span><strong>' + downtimeInRange.length + '</strong></div>'
].join('');
const summaryHtml = '<h3 class="report-section-title">Resumo Operacional</h3><div class="report-summary-grid">' +
    (isAllModules ? allSummaryHtml : reportModules.map((key) => (summaryItemsByModule[key] || []).join('')).join('')) +
    '</div>';

const allDetailsHtml = [
    '<h3 class="report-section-title">Disponibilidade das Utilidades em ' + formatReportDate(endDate) + '</h3>',
    '<table class="report-table"><thead><tr><th>Utilidade</th><th>Status</th></tr></thead><tbody>',
    availabilityData.filter((item) => bloco === 'all' || item.name.endsWith(bloco)).map((item) =>
        '<tr><td>' + item.name + '</td><td>' + (item.status === 'disponivel' ? 'Disponível' : 'Indisponível') + '</td></tr>'
    ).join(''),
    '</tbody></table>',
    '<h3 class="report-section-title">Paradas e Ocorrências</h3>',
    '<table class="report-table">',
    '<thead><tr><th style="border:1px solid #ddd; padding:8px; text-align:left;">Data</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Utilidade</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Paradas</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Tempo indisponível</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Comentário</th></tr></thead>',
    '<tbody>' + downtimeRowsHtml + '</tbody>',
    '</table>',
    '<h3 class="report-section-title">Dados do Período</h3>',
    '<table class="report-table">',
    '<thead><tr><th style="border:1px solid #ddd; padding:8px; text-align:left;">Data</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">DW 7A</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Obs. DW 7A</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">DW 7B</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Obs. DW 7B</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Nitrogênio</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Cloro</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Reteste</th></tr></thead>',
    '<tbody>' + rowsHtml + '</tbody>',
    '</table>',
    extraReportHtml.join('')
].join('');
const moduleDetailsHtml = {
    availability: [
        '<h3 class="report-section-title">Disponibilidade das Utilidades em ' + formatReportDate(endDate) + '</h3>',
        '<table class="report-table"><thead><tr><th>Utilidade</th><th>Status</th></tr></thead><tbody>',
        availabilityData.filter((item) => bloco === 'all' || item.name.endsWith(bloco)).map((item) =>
            '<tr><td>' + item.name + '</td><td>' + (item.status === 'disponivel' ? 'Disponível' : 'Indisponível') + '</td></tr>'
        ).join(''),
        '</tbody></table>'
    ].join(''),
    dw7a: buildDwTable('Consumo DW 7A no Período', dwSeries7A),
    dw7b: buildDwTable('Consumo DW 7B no Período', dwSeries7B),
    nitrogenio: [
        '<h3 class="report-section-title">Nível e Reabastecimentos de Nitrogênio no Período</h3>',
        '<table class="report-table"><thead><tr><th>Data</th><th>Nível (pol)</th><th>Reabastecimento (pol)</th></tr></thead><tbody>',
        filteredLabels.map((label) => {
            const idx = diasAgosto.indexOf(label);
            const date = normalizeDateValue(label);
            const refill = nitroData.find((item) => normalizeDateValue(item.d) === date);
            return '<tr><td>' + label + '</td><td>' + Number(nitrogenNivel[idx] || 0).toFixed(1) + '</td><td>' + (refill ? refill.r : '-') + '</td></tr>';
        }).join(''),
        '</tbody></table>'
    ].join(''),
    cloro: [
        '<h3 class="report-section-title">Testes de Cloro e Limites de Controle no Período</h3>',
        '<table class="report-table"><thead><tr><th>Data</th><th>Teste</th><th>Limite inferior (ppm)</th><th>Teste (ppm)</th><th>Limite superior (ppm)</th><th>Reteste (ppm)</th><th>Resultado</th></tr></thead><tbody>',
        filteredLabels.map((label) => {
            const idx = diasAgosto.indexOf(label);
            return chlorineSelected.map((k) => {
                const serie = getChlorineSeries()[k];
                const value = serie.values[idx];
                const reteste = serie.reteste[idx];
                const hasValue = value !== null && value !== undefined;
                const hasReteste = reteste !== null && reteste !== undefined;
                if (!hasValue && !hasReteste) return '';
                const result = hasValue ? (value < 1 || value > 2 ? 'Fora do limite' : 'Dentro do limite') : '-';
                return '<tr><td>' + label + '</td><td>' + escapeHtml(serie.name) + '</td><td>1,00</td><td>' + (hasValue ? value.toFixed(2) : '-') + '</td><td>2,00</td><td>' + (hasReteste ? reteste.toFixed(2) : '-') + '</td><td>' + result + '</td></tr>';
            }).join('');
        }).join(''),
        '</tbody></table>'
    ].join(''),
    indisponibilidade: [
        '<h3 class="report-section-title">Paradas e Ocorrências</h3>',
        '<table class="report-table"><thead><tr><th>Data</th><th>Utilidade</th><th>Paradas</th><th>Tempo indisponível</th><th>Comentário</th></tr></thead><tbody>',
        downtimeRowsHtml,
        '</tbody></table>'
    ].join('')
};
extraData.columns.forEach((col, index) => {
    moduleDetailsHtml['extra:' + col.key] = extraReportHtml[index];
});
const detailsHtml = isAllModules ? allDetailsHtml : reportModules.map((key) => moduleDetailsHtml[key] || '').join('');

const reportContent = [
'<div id="reportPrintArea">',
'<header class="report-header"><img src="logo_hemo.jpeg" alt="Hemobrás"><div><span>HEMOBRÁS</span><h1>Relatório de Utilidades</h1><p>' + moduleTitle + '</p></div></header>',
'<div class="report-meta"><div><strong>Período</strong><span>' + reportPeriod + '</span></div><div><strong>Bloco</strong><span>' + (bloco === 'all' ? 'Todos os blocos' : 'Bloco ' + bloco) + '</span></div><div><strong>Módulo</strong><span>' + moduleTitle + '</span></div></div>',
summaryHtml,
chartsSectionHtml,
detailsHtml,
'</div>'
            ].join('');

            const existing = document.getElementById('reportPrintArea');
            if (existing) existing.remove();
document.body.insertAdjacentHTML('beforeend', reportContent);
window.print();
        });
    }

    populateBaseDataTable();

const dateStart = document.getElementById('dateStart');
const dateEnd = document.getElementById('dateEnd');
const blocoFilter = document.getElementById('blocoFilter');
if (dateStart) dateStart.addEventListener('change', applyDateFilters);
    if (dateEnd) dateEnd.addEventListener('change', applyDateFilters);
    if (blocoFilter) blocoFilter.addEventListener('change', applyDateFilters);

let csvLoading = false;
const refreshFromSource = async () => {
    if (csvLoading) return;
    csvLoading = true;
    try { await loadDataFromCsv(); } finally { csvLoading = false; }
};
refreshFromSource();
setInterval(refreshFromSource, AUTO_REFRESH_INTERVAL_MS);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshFromSource();
});
}

if (typeof module !== 'undefined') {
    module.exports = {
        filterDateRange,
buildDowntimeStateFromCsv,
normalizeDateValue,
        resolveBlockSeries,
        parseCsvText,
        parseNumberValue,
extractChlorineSeries,
        buildDataStateFromCsv,
        extractExtraColumns,
        extractColumnUnit,
        formatChartValueWithUnit,
        getDailyBoilerConsumption,
        getDailyColumnValues,
        getDailyChlorineValues,
    };
}
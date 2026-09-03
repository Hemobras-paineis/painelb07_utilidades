const DEFAULT_YEAR = 2026;
const AUTO_REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

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

function parseCsvText(csvText) {
    if (!csvText || !csvText.trim()) return [];

    const lines = csvText.trim().split(/\r?\n/).filter(line => line.trim());
    if (!lines.length) return [];

const headerCounts = new Map();
const headers = splitCsvLine(lines[0]).map((cell) => {
    const header = normalizeCsvHeader(cell);
    const count = (headerCounts.get(header) || 0) + 1;
    headerCounts.set(header, count);
    return count === 1 ? header : `${header}${count}`;
});
    return lines.slice(1).map((line) => {
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

    const sanitized = String(rawValue).trim().replace(/\s+/g, '').replace(/[A-Za-z%]/g, '');
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

    return { diasAgosto, dw7A, dw7B, nitrogenNivel, cloroPpm, retestePpm, nitroData };
}

function buildDowntimeStateFromCsv(csvText) {
    const lines = String(csvText || '').trim().split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return [];

    const headers = splitCsvLine(lines[0]).map(cell => normalizeCsvHeader(cell));
    const dateIndex = headers.findIndex((header, index) => header === 'data' && index > 0);
    const utilityIndex = headers.indexOf('utilidade');
    const stopsIndex = headers.indexOf('paradas');
    const hoursIndex = headers.findIndex(header => header.includes('tempoindisponivel'));
    const commentIndex = headers.findIndex(header => header.includes('comentario'));

    if ([dateIndex, utilityIndex, stopsIndex, hoursIndex, commentIndex].some(index => index < 0)) {
        return [];
    }

    return lines.slice(1).map((line) => {
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

const GOOGLE_SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/1SmjrouY2fg_kFRSYsu6kiptQpHJ2hbIIJR9zHWP1x9Q/export?format=csv&gid=0';
const DATA_SOURCE_URL = GOOGLE_SHEETS_CSV_URL;
const DATA_SOURCE_CANDIDATES = [DATA_SOURCE_URL];

const GOOGLE_SHEETS_PAGE2_CANDIDATES = [
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

    document.querySelectorAll('.sidebar-nav a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const targetId = e.currentTarget.getAttribute('data-target');
            if(targetId) {
                openView(targetId, e.currentTarget.innerText);
                setTimeout(() => window.dispatchEvent(new Event('resize')), 100);
            }
        });
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

function toggleTvMode() {
isTvModeActive = !isTvModeActive;
if (isTvModeActive) {
document.body.classList.add('tv-mode-active');
btnTvMode.innerHTML = '<i class="fas fa-stop"></i> Parar TV';

applyTvDateFilter();
try {
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
    }
} catch (e) {}
startTvCarousel();
if (window.setIndispChartTvFonts) window.setIndispChartTvFonts(true);
} else {
document.body.classList.remove('tv-mode-active');
btnTvMode.innerHTML = '<i class="fas fa-tv"></i> Iniciar Modo TV';
stopTvCarousel();
restorePreTvDateFilter();
if (window.setIndispChartTvFonts) window.setIndispChartTvFonts(false);
setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}
}

btnTvMode.addEventListener('click', toggleTvMode);

document.addEventListener('keydown', (event) => {
    if (event.key !== '*') return;
    if (event.repeat) return;
    const target = event.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    toggleTvMode();
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
        openView(tvViews[currentViewIndex].id, tvViews[currentViewIndex].title);
        animateTvProgress();
        setTimeout(() => window.dispatchEvent(new Event('resize')), 200);

        tvIntervalId = setInterval(() => {
            currentViewIndex = (currentViewIndex + 1) % tvViews.length;
            openView(tvViews[currentViewIndex].id, tvViews[currentViewIndex].title);
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
    let nitrogenNivel = [...baseDataState.nitrogenNivel];
    let cloroPpm = [...baseDataState.cloroPpm];
    let retestePpm = [...baseDataState.retestePpm];
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
                nitrogenNivel = [...parsed.nitrogenNivel];
                cloroPpm = [...parsed.cloroPpm];
                retestePpm = [...parsed.retestePpm];
                nitroData = [...parsed.nitroData];

const downtimeFromSource = buildDowntimeStateFromCsv(csvText);
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
                applyDateFilters();
                return true;
            } catch (error) {
                continue;
            }
        }

        diasAgosto = [...defaultData.diasAgosto];
        dw7A = [...defaultData.dw7A];
        dw7B = [...defaultData.dw7B];
        nitrogenNivel = [...defaultData.nitrogenNivel];
        cloroPpm = [...defaultData.cloroPpm];
    retestePpm = [...defaultData.retestePpm];
                syncAvailabilityForDate(document.getElementById('dateEnd')?.value);
                renderAvailabilityView();
        updateDataSourceStatus('Google Sheets indisponível; exibindo dados locais temporariamente');
        populateBaseDataTable();
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
        const summaryCloro = document.getElementById('dailyCloro');
        const dateBadge = document.getElementById('dailyDateBadge');

        if (!summaryTarget || !summaryDw7A || !summaryDw7B || !summaryCloro) {
            return;
        }

        const today = new Date();
        const todayLabel = `${String(today.getDate()).padStart(2, '0')}/${String(today.getMonth() + 1).padStart(2, '0')}/${today.getFullYear()}`;
        const todayIndex = diasAgosto.findIndex((valor) => normalizeDateValue(valor) === normalizeDateValue(todayLabel));

        if (!indexes.length) {
            summaryTarget.innerText = '--';
            summaryDw7A.innerText = '--';
            summaryDw7B.innerText = '--';
            summaryCloro.innerText = '--';
            if (dateBadge) dateBadge.innerText = todayLabel;
            return;
        }

        const referenceIndex = todayIndex >= 0 ? todayIndex : indexes[indexes.length - 1];
        const displayDate = diasAgosto[referenceIndex] || todayLabel;

        summaryTarget.innerText = nitrogenNivel[referenceIndex].toFixed(1) + ' pol';
        summaryDw7A.innerText = dw7A[referenceIndex].toFixed(1) + ' m³';
        summaryDw7B.innerText = dw7B[referenceIndex].toFixed(1) + ' m³';
        summaryCloro.innerText = cloroPpm[referenceIndex].toFixed(2) + ' ppm';

        if (dateBadge) dateBadge.innerText = displayDate;

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
    const startDate = document.getElementById('dateStart')?.value;
    const endDate = document.getElementById('dateEnd')?.value;
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
            dwTbody.innerHTML = labels.map((dia, i) => {
                const originalIndex = indexes[i];
                return `<tr><td><strong>${dia}/2026</strong></td><td>${dw7A[originalIndex].toFixed(1)}</td><td>${dw7B[originalIndex].toFixed(1)}</td></tr>`;
            }).join('');
        }

        const cloroTbody = document.getElementById('cloroTableBody');
        if (cloroTbody) {
            cloroTbody.innerHTML = labels.map((dia, i) => {
                const originalIndex = indexes[i];
                const color = (cloroPpm[originalIndex] < 1.0 || cloroPpm[originalIndex] > 2.0) ? 'color: #e74c3c; font-weight: bold;' : '';
                const reteste = retestePpm[originalIndex];
                const formattedDate = /\/\d{4}$/.test(String(dia)) ? dia : `${dia}/2026`;
                return `<tr><td><strong>${formattedDate}</strong></td><td>1.00</td><td style="${color}">${cloroPpm[originalIndex].toFixed(2)}</td><td>2.00</td><td>${reteste === null || reteste === undefined ? '-' : reteste.toFixed(2)}</td><td>${reteste === null || reteste === undefined ? '' : 'Reteste realizado'}</td></tr>`;
            }).join('');
        }

        const nitroTbody = document.getElementById('nitroTableBody');
        if (nitroTbody) {
            const selectedNitro = nitroData.filter((item) => {
                const date = new Date(normalizeDateValue(item.d).replace(/-/g, '/'));
                const startDate = new Date(`${document.getElementById('dateStart').value}T00:00:00`);
                const endDate = new Date(`${document.getElementById('dateEnd').value}T23:59:59`);
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

        const today = new Date();
        const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10);
        const currentDay = today.toISOString().slice(0, 10);

        if (!dateStart.value) {
            dateStart.value = currentMonthStart;
        }

        if (!dateEnd.value) {
            dateEnd.value = currentDay;
        }

        if (dateStart.value && dateEnd.value && dateStart.value > dateEnd.value) {
            const previousStart = dateStart.value;
            dateStart.value = dateEnd.value;
            dateEnd.value = previousStart;
        }

        const filtered = filterDateRange(diasAgosto, dateStart.value, dateEnd.value, DEFAULT_YEAR);
        const labels = filtered.labels;
        const indexes = filtered.indexes;
        const selectedBlock = blocoFilter ? blocoFilter.value : 'all';
syncAvailabilityForDate(dateEnd.value);
renderAvailabilityView();

        const blockDw7A = indexes.map((index) => dw7A[index]);
        const blockDw7B = indexes.map((index) => dw7B[index]);
        const blockNitrogen = indexes.map((index) => nitrogenNivel[index]);
        const blockCloro = indexes.map((index) => cloroPpm[index]);
    const blockReteste = indexes.map((index) => retestePpm[index]);

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
            dwChart.data.labels = labels;
            dwChart.data.datasets[0].data = filteredDw7A;
            dwChart.data.datasets[1].data = filteredDw7B;
            dwChart.data.datasets[0].label = selectedBlock === 'all' ? 'DW 7A (m³)' : `DW 7A (${selectedBlock}) (m³)`;
            dwChart.data.datasets[1].label = selectedBlock === 'all' ? 'DW 7B (m³)' : `DW 7B (${selectedBlock}) (m³)`;
            dwChart.update();
        }

        const nitrogenChart = window.nitrogenChart;
        if (nitrogenChart) {
            nitrogenChart.data.labels = labels;
            nitrogenChart.data.datasets[0].data = filteredNitrogen;
            nitrogenChart.update();
        }

        const chlorineChart = window.chlorineChart;
        if (chlorineChart) {
            chlorineChart.data.labels = labels;
            chlorineChart.data.datasets[0].data = filteredCloro;
            chlorineChart.data.datasets[1].data = filteredReteste;
            chlorineChart.data.datasets[2].data = labels.map(() => 1);
            chlorineChart.data.datasets[3].data = labels.map(() => 2);
            chlorineChart.update();
        }

        const dwChartTv = window.dwChartTv;
        if (dwChartTv) {
            dwChartTv.data.labels = labels;
            dwChartTv.data.datasets[0].data = filteredDw7A;
            dwChartTv.data.datasets[1].data = filteredDw7B;
            dwChartTv.data.datasets[0].label = selectedBlock === 'all' ? 'DW 7A (m³)' : `DW 7A (${selectedBlock}) (m³)`;
            dwChartTv.data.datasets[1].label = selectedBlock === 'all' ? 'DW 7B (m³)' : `DW 7B (${selectedBlock}) (m³)`;
            dwChartTv.update();
        }

        const nitrogenChartTv = window.nitrogenChartTv;
        if (nitrogenChartTv) {
            nitrogenChartTv.data.labels = labels;
            nitrogenChartTv.data.datasets[0].data = filteredNitrogen;
            nitrogenChartTv.update();
        }

        const chlorineChartTv = window.chlorineChartTv;
        if (chlorineChartTv) {
            chlorineChartTv.data.labels = labels;
            chlorineChartTv.data.datasets[0].data = filteredCloro;
            chlorineChartTv.data.datasets[1].data = filteredReteste;
            chlorineChartTv.data.datasets[2].data = labels.map(() => 1);
            chlorineChartTv.data.datasets[3].data = labels.map(() => 2);
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
    document.getElementById('dailyCloro').innerText = cloroPpm[initialIndex].toFixed(2) + ' ppm';
    const dailyDateBadge = document.getElementById('dailyDateBadge');
    if (dailyDateBadge) dailyDateBadge.innerText = diasAgosto[initialIndex] || todayLabel;

    const dwChart = new Chart(document.getElementById('dwChart').getContext('2d'), { type: 'bar', data: { labels: diasAgosto, datasets: [ { label: 'DW 7A (m³)', data: dw7A, backgroundColor: '#3498db' }, { label: 'DW 7B (m³)', data: dw7B, backgroundColor: '#27ae60' } ] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: '#000', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(1) } } } });
    window.dwChart = dwChart;

    const nitrogenChart = new Chart(document.getElementById('nitrogenChart').getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Nitrogênio (pol)', data: nitrogenNivel, borderColor: '#9b59b6', backgroundColor: 'rgba(155, 89, 182, 0.2)', fill: true, tension: 0.3 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, datalabels: { color: '#9b59b6', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(1), anchor: 'end', align: 'top', offset: 5 } } } });
    window.nitrogenChart = nitrogenChart;

    const chlorineChart = new Chart(document.getElementById('chlorineChart').getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Teste de Cloro', data: cloroPpm, borderColor: '#34495e', fill: false, tension: 0.1 }, { label: 'Reteste', data: retestePpm, borderColor: '#f39c12', backgroundColor: '#f39c12', borderWidth: 2, pointRadius: 5, pointHoverRadius: 6, spanGaps: false, fill: false, tension: 0 }, { label: 'Limite inferior (1,00)', data: diasAgosto.map(() => 1), borderColor: '#27ae60', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }, { label: 'Limite superior (2,00)', data: diasAgosto.map(() => 2), borderColor: '#e74c3c', borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { y: { suggestedMin: 0, suggestedMax: 3 } }, plugins: { legend: { display: true }, datalabels: { display: (context) => context.datasetIndex < 2 && context.dataset.data[context.dataIndex] !== null, color: '#34495e', font: { weight: 'bold', size: 10 }, formatter: (value) => value.toFixed(2), anchor: 'end', align: 'top', offset: 5 } } } });
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
    const chlorineChartTv = new Chart(chlorineChartTvCanvas.getContext('2d'), { type: 'line', data: { labels: diasAgosto, datasets: [{ label: 'Teste de Cloro', data: cloroPpm, borderColor: '#34495e', borderWidth: 2, fill: false, tension: 0.1, pointBackgroundColor: ctx => { const value = ctx.dataset.data[ctx.dataIndex]; return (value < 1 || value > 2) ? '#e74c3c' : '#3498db'; } }, { label: 'Reteste', data: retestePpm, borderColor: '#f39c12', backgroundColor: '#f39c12', borderWidth: 2, pointRadius: 6, pointHoverRadius: 7, spanGaps: false, fill: false, tension: 0 }, { label: 'Limite inferior (1,00)', data: diasAgosto.map(() => 1), borderColor: '#27ae60', borderWidth: 2, borderDash: [8, 5], pointRadius: 0, fill: false }, { label: 'Limite superior (2,00)', data: diasAgosto.map(() => 2), borderColor: '#e74c3c', borderWidth: 2, borderDash: [8, 5], pointRadius: 0, fill: false }] }, options: { responsive: true, maintainAspectRatio: false, scales: { x: { ticks: { font: { size: 20 } } }, y: { suggestedMin: 0, suggestedMax: 3, ticks: { font: { size: 20 } } } }, plugins: { legend: { labels: { font: { size: 20 } } }, datalabels: { display: (context) => context.datasetIndex < 2 && context.dataset.data[context.dataIndex] !== null, color: '#34495e', font: { weight: 'bold', size: 18 }, formatter: (value) => value.toFixed(2), anchor: 'end', align: 'top', offset: 8 } } } });
        window.chlorineChartTv = chlorineChartTv;
    }

    const dispTbody = document.getElementById('dispTableBody');
    if (dispTbody) {
        ['Vapor Ind', 'CW Processo', 'CW HVAC', 'Ar Comp', 'WFI', 'SFI'].forEach(ut => { dispTbody.innerHTML += `<tr><td><strong>13/08/2026</strong></td><td>7A/7B</td><td>${ut}</td><td><span style="color:#2ecc71; font-weight:bold;">100%</span></td></tr>`; });
    }

    const dwTbody = document.getElementById('dwTableBody');
    if (dwTbody) {
        dwTbody.innerHTML = diasAgosto.map((dia, i) => `<tr><td><strong>${dia}/2026</strong></td><td>${dw7A[i].toFixed(1)}</td><td>${dw7B[i].toFixed(1)}</td></tr>`).join('');
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

    const generatePdfButton = document.getElementById('btnGeneratePdf');
    if (generatePdfButton) {
        generatePdfButton.addEventListener('click', () => {
            const startDate = document.getElementById('dateStart')?.value || '';
            const endDate = document.getElementById('dateEnd')?.value || '';
            const bloco = document.getElementById('blocoFilter')?.value || 'all';

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

            const maxDw = Math.max(...filteredDw7A, 0);
            const maxNitro = Math.max(...filteredNitro, 0);
            const avgCloro = filteredCloro.length ? filteredCloro.reduce((sum, value) => sum + value, 0) / filteredCloro.length : 0;
            const downtimeInRange = downtimeComments
                .filter((comment) => {
                const itemDate = new Date(`${normalizeDateValue(comment.d)}T00:00:00`);
                const start = new Date(`${startDate}T00:00:00`);
                const end = new Date(`${endDate}T23:59:59`);
                const matchesBlock = bloco === 'all' || comment.u.endsWith(bloco);
                return matchesBlock && itemDate >= start && itemDate <= end;
                })
                .map((comment) => {
                    const stop = downtimeData.find((item) => normalizeCsvHeader(item.u) === normalizeCsvHeader(comment.u));
                    return {
                        d: comment.d,
                        u: comment.u,
                        p: stop?.p || '-',
                        h: stop?.h || '-',
                        m: comment.m
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
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(dw7B[idx] || 0).toFixed(1) + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(nitrogenNivel[idx] || 0).toFixed(1) + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + Number(cloroPpm[idx] || 0).toFixed(2) + '</td>',
                    '<td style="border:1px solid #ddd; padding:8px;">' + (retestePpm[idx] === null || retestePpm[idx] === undefined ? '-' : Number(retestePpm[idx]).toFixed(2)) + '</td>',
                    '</tr>'
                ].join('');
            }).join('');

const chartImageSpecs = [
{ chart: window.dwChart, title: 'Consumo de Água (DW 7A / DW 7B)' },
{ chart: window.nitrogenChart, title: 'Nível de Nitrogênio' },
{ chart: window.chlorineChart, title: 'Monitoramento de Cloro' },
{ chart: window.indispChart, title: 'Indisponibilidade das Utilidades (Horas)' }
];
const chartsHtml = chartImageSpecs
.filter((spec) => spec.chart && typeof spec.chart.toBase64Image === 'function')
.map((spec) => ({ ...spec, image: spec.chart.toBase64Image('image/png', 1) }))
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

const reportContent = [
'<div id="reportPrintArea">',
                '<header class="report-header"><img src="logo_hemo.jpeg" alt="Hemobrás"><div><span>HEMOBRÁS</span><h1>Relatório de Utilidades</h1><p>Gestão de Utilidades</p></div></header>',
                '<div class="report-meta"><div><strong>Período</strong><span>' + reportPeriod + '</span></div><div><strong>Bloco</strong><span>' + (bloco === 'all' ? 'Todos os blocos' : 'Bloco ' + bloco) + '</span></div></div>',
                '<h3 class="report-section-title">Resumo Operacional</h3>',
                '<div class="report-summary-grid">',
                '<div><span>Maior consumo DW</span><strong>' + maxDw.toFixed(1) + ' m³</strong></div>',
                '<div><span>Maior nitrogênio</span><strong>' + maxNitro.toFixed(1) + ' pol</strong></div>',
                '<div><span>Média de cloro</span><strong>' + avgCloro.toFixed(2) + ' ppm</strong></div>',
                '<div><span>Disponibilidade diária</span><strong>' + availabilityValue + '</strong></div>',
                '<div><span>Último reabastecimento</span><strong>' + (latestRefill ? latestRefill.r + ' pol em ' + latestRefill.d : 'Nenhum no período') + '</strong></div>',
                '<div><span>Última parada</span><strong>' + (latestDowntime ? latestDowntime.u + ' - ' + latestDowntime.h + ' em ' + latestDowntime.d : 'Nenhuma no período') + '</strong></div>',
                '<div><span>Paradas registradas</span><strong>' + downtimeInRange.length + '</strong></div>',
                '</div>',
                chartsSectionHtml,
                '<h3 class="report-section-title">Paradas e Ocorrências</h3>',
                '<table class="report-table">',
                '<thead><tr><th style="border:1px solid #ddd; padding:8px; text-align:left;">Data</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Utilidade</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Paradas</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Tempo indisponível</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Comentário</th></tr></thead>',
                '<tbody>' + downtimeRowsHtml + '</tbody>',
                '</table>',
                '<h3 class="report-section-title">Dados do Período</h3>',
                '<table class="report-table">',
                '<thead><tr><th style="border:1px solid #ddd; padding:8px; text-align:left;">Data</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">DW 7A</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">DW 7B</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Nitrogênio</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Cloro</th><th style="border:1px solid #ddd; padding:8px; text-align:left;">Reteste</th></tr></thead>',
                '<tbody>' + rowsHtml + '</tbody>',
                '</table>',
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

    loadDataFromCsv();
setInterval(() => {
    loadDataFromCsv();
}, AUTO_REFRESH_INTERVAL_MS);
}

if (typeof module !== 'undefined') {
    module.exports = {
        filterDateRange,
        normalizeDateValue,
        resolveBlockSeries,
        parseCsvText,
        buildDataStateFromCsv,
    };
}
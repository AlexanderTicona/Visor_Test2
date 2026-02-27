// js/state.js — Global State & Configuration

const appState = {
    proyectos: [],          // [ {id, nombre, archivo, visible, data: {planta, perfil, secciones}} ]
    proyectoActivoId: null, // ID of the currently active project for sections and profile
    secciones: [],
    planta: null,
    perfil: null,
    currentIdx: 0,
    limitesGlobales: {
        seccion: { minX: -100, maxX: 100, minY: 0, maxY: 100 },
        planta: { minE: 0, maxE: 1000, minN: 0, maxN: 1000 },
        perfil: { minK: 0, maxK: 1000, minZ: 0, maxZ: 100 }
    },
    encuadre: {
        seccion: { minX: -20, maxX: 20, minY: 0, maxY: 20 },
        planta: { minE: 0, maxE: 1000, minN: 0, maxN: 1000 },
        perfil: { minK: 0, maxK: 1000, minZ: 0, maxZ: 100 }
    },
    cameras: {
        seccion: { x: 0, y: 0, zoom: 1 },
        planta: { x: 0, y: 0, zoom: 1 },
        perfil: { x: 0, y: 0, zoom: 1 }
    },
    isDragging: false,
    isDraggingPlanta: false,
    isDraggingPerfil: false,
    lastMousePos: { x: 0, y: 0 },
    lastClick: null,
    lastMarker: null,
    transform: { minX: 0, minY: 0, scale: 1, mx: 0, my: 0 },
    measurement: {
        mode: 'none',    // 'none' | 'point' | 'distance' | 'slope'
        points: [],      // [{x, y}] clicked measurement points
        result: null      // { dx, dy, dist, slope, text }
    },
    snap: {
        enabled: true,
        point: null,      // {x, y} snapped vertex or null
        threshold: 15     // pixel distance for snap detection
    },
    gps: {
        active: false,    // Is geolocation tracking turned on?
        tracking: false,  // Is the camera following the user?
        lat: null,
        lon: null,
        accuracy: 0,
        e: null,          // UTM Easting
        n: null,          // UTM Northing
        watchId: null     // Geolocation watch ID
    },
    // Global Notes / Pins Storage
    notas: [],
    notaCounter: 1
};

const appConfig = {
    general: {
        theme: 'dark',
        textScale: 1.0
    },
    planta: {
        gridInterval: 200,
        gridIntervalMulti: 500,
        showGrid: true,
        ticksMajor: 1000,
        ticksMinor: 100,
        showLabels: true,
        showTicks: true
    },
    perfil: {
        gridK: 500, gridKMulti: 1000,
        gridZ: 20, gridZMulti: 50,
        exaj: 10, target: 'auto'
    },
    seccion: {
        gridX: 5,
        gridY: 5
    },
    layers: {
        planta: {},
        perfil: {},
        seccion: {}
    }
};

// Sync all views
let _syncTimeout = null;
function syncAllViews() {
    if (_syncTimeout) cancelAnimationFrame(_syncTimeout);
    _syncTimeout = requestAnimationFrame(() => {
        if (appState.planta && typeof dibujarPlanta === 'function') dibujarPlanta();
        if (appState.perfil && typeof dibujarPerfil === 'function') dibujarPerfil();

        if (!appState.secciones || !appState.secciones[appState.currentIdx]) return;

        const sec = appState.secciones[appState.currentIdx];
        const kmInput = document.getElementById('kmInput');
        if (kmInput && document.activeElement !== kmInput) {
            const m = sec.k || sec.km || 0;
            const km = Math.floor(m / 1000);
            const rest = (m % 1000).toFixed(2).padStart(6, '0');
            kmInput.value = `${km}+${rest}`;
        }

        // Update slider info
        updateSliderInfo();

        if (typeof dibujarSeccion === 'function') dibujarSeccion(sec);
    });
}

function updateSliderInfo() {
    if (!appState.secciones || appState.secciones.length === 0) return;
    const total = appState.secciones.length;
    const idx = appState.currentIdx;
    const first = appState.secciones[0];
    const last = appState.secciones[total - 1];

    const fmtPK = (val) => {
        const k = Math.floor(val / 1000);
        const m = Math.abs(val % 1000).toFixed(0).padStart(3, '0');
        return `${k}+${m}`;
    };

    const el1 = document.getElementById('sliderInfoLeft');
    const el2 = document.getElementById('sliderInfoCenter');
    const el3 = document.getElementById('sliderInfoRight');

    if (el1) el1.textContent = `PK ${fmtPK(first.k || first.km || 0)}`;
    if (el2) el2.textContent = `${idx + 1} / ${total} secciones`;
    if (el3) el3.textContent = `PK ${fmtPK(last.k || last.km || 0)}`;
}

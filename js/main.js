// js/main.js — Core Application Logic

// ═══════════ 1. TOUCH GESTURE BLOCKING ═══════════
document.addEventListener('touchstart', e => {
    // Allow native multi-touch zooming/scrolling if inside sidebar
    if (e.target.closest('#sidebar')) return;
    if (e.touches.length > 1) e.preventDefault();
}, { passive: false });

let lastTouchEnd = 0;
document.addEventListener('touchend', e => {
    if (e.target.closest('#sidebar')) return;
    const now = Date.now();
    if (now - lastTouchEnd <= 300) e.preventDefault();
    lastTouchEnd = now;
}, false);

// Toggle Mobile Sidebar
function toggleSidebar() {
    document.body.classList.toggle('sidebar-open');
}

// ═══════════ 2. LAYOUT MANAGEMENT ═══════════
function changeLayout(newLayout, btn) {
    const modal = document.getElementById('settingsModal');
    if (modal && modal.style.display !== 'none') toggleSettings();

    const dashboard = document.getElementById('main-dashboard');
    if (!dashboard) return;
    dashboard.className = newLayout;

    // Auto-close sidebar on mobile
    document.body.classList.remove('sidebar-open');

    // Update sidebar buttons
    document.querySelectorAll('.nav-btn[data-layout]').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');

    // Enable/Disable measurement tools based on layout
    const measureBtns = document.querySelectorAll('#btnMeasurePoint, #btnMeasureDist, #btnMeasureSlope, #btnSnap, #btnMeasurePin, #btnToolNotesList');
    if (newLayout === 'layout-seccion' || newLayout === 'layout-multi') {
        measureBtns.forEach(b => b.classList.remove('disabled-tool'));
    } else {
        measureBtns.forEach(b => b.classList.add('disabled-tool'));

        // If tools are disabled, turn off any active measurement mode forcefully
        if (appState.measurement && appState.measurement.mode !== 'none') {
            appState.measurement.mode = 'none';
            appState.measurement.points = [];
            const hud = document.getElementById('hud');
            if (hud) hud.style.display = 'none';

            // Remove active styling from measurement buttons
            measureBtns.forEach(b => b.classList.remove('active'));

            // But if Snap was specifically on, keep its visual state correct but its function will be ignored
            const snapBtn = document.getElementById('btnSnap');
            if (snapBtn && appState.snap && appState.snap.enabled) {
                snapBtn.classList.add('active');
            }
        }
    }

    // Permitir al navegador pintar el nuevo CSS (la transición de color/display)
    // antes de congelar el hilo principal recalculando los 3 canvas.
    requestAnimationFrame(() => {
        setTimeout(() => {
            resizeAll();
            if (appState.planta) resetView('planta');
            if (appState.secciones && appState.secciones.length > 0) resetView('seccion');
            if (appState.perfil) resetView('perfil');
            syncAllViews();
        }, 10); // 10ms es suficiente para que iOS "destrabe" la UI
    });
}

// ═══════════ 3. FILE READER & PROJECT MANAGEMENT ═══════════
document.getElementById('fileInput').addEventListener('change', function (e) {
    if (e.target.files.length) loadMultipleFiles(e.target.files);
    e.target.value = '';
});

const folderInput = document.getElementById('folderInput');
if (folderInput) {
    folderInput.addEventListener('change', function (e) {
        if (e.target.files.length) loadMultipleFiles(e.target.files);
        e.target.value = '';
    });
}

function toggleUploadMenu() {
    const menu = document.getElementById('uploadMenu');
    if (menu) {
        menu.style.display = menu.style.display === 'none' ? 'flex' : 'none';
        if (menu.style.display === 'flex') {
            const closeMenu = (e) => {
                if (!e.target.closest('.upload-dropdown')) {
                    menu.style.display = 'none';
                    document.removeEventListener('click', closeMenu);
                }
            };
            setTimeout(() => document.addEventListener('click', closeMenu), 10);
        }
    }
}

async function loadMultipleFiles(filesList) {
    const promises = [];
    for (let i = 0; i < filesList.length; i++) {
        const file = filesList[i];
        if (!file.name.toLowerCase().endsWith('.tiqal')) continue;

        const promise = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const raw = JSON.parse(e.target.result);
                    const id = 'proy_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
                    resolve({ id, nombre: file.name.replace('.TiQAL', ''), visible: true, data: raw });
                } catch (err) {
                    console.error("Error parsing " + file.name, err);
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsText(file);
        });
        promises.push(promise);
    }

    if (promises.length === 0) {
        showNotification('No se encontraron archivos .TiQAL', 'warning');
        return;
    }

    // Bloquear UI temporalmente si lo deseamos aquí
    const results = await Promise.all(promises);
    const validProyectos = results.filter(p => p !== null);

    if (validProyectos.length === 0) {
        showNotification('❌ Archivos sin datos válidos', 'error');
        return;
    }

    // Add to state
    validProyectos.forEach(p => appState.proyectos.push(p));

    // Select first one if no active project
    if (!appState.proyectoActivoId && appState.proyectos.length > 0) {
        cambiarProyectoActivo(appState.proyectos[0].id);
    } else {
        recalcularLimitesPlanta(); // Refrescar los limites gloables de planta
        renderizarListaProyectos();
        syncAllViews();
    }

    hideWelcome();
    showNotification(`✅ ${validProyectos.length} proyecto(s) cargado(s)`);
}

function cambiarProyectoActivo(id) {
    appState.proyectoActivoId = id;
    const proy = appState.proyectos.find(p => p.id === id);
    if (!proy) return;

    const raw = proy.data;
    appState.planta = raw; // For backwards compatibility
    appState.perfil = raw.perfiles || null;
    appState.secciones = raw.secciones || [];
    appState.currentIdx = 0;

    appConfig.layers = { planta: {}, perfil: {}, seccion: {} };

    // ── CONFIGURAR CAPAS Y LÍMITES PARA ESTE PROYECTO ──
    appConfig.layers.planta['Eje'] = { color: '#ff3d00', width: 2, visible: true, type: 'line' };

    if (appState.perfil) {
        let minK = Infinity, maxK = -Infinity, minZ = Infinity, maxZ = -Infinity;
        appState.perfil.forEach((p, idx) => {
            let defColor = '#ffffff'; let defWidth = 1.5;
            const nombre = p.nombre || `Perfil ${idx + 1}`;
            if (nombre.includes('TN') || nombre.includes('Surface')) { defColor = '#8b6914'; defWidth = 1.5; }
            else if (nombre.includes('Rasante') || nombre.includes('FG') || nombre.includes('Layout')) { defColor = '#ff3d00'; defWidth = 2.5; }
            else { const palette = ['#ffd600', '#e040fb', '#00e5ff', '#ff6d00', '#76ff03', '#448aff']; defColor = palette[idx % palette.length]; }

            appConfig.layers.perfil[nombre] = { color: defColor, width: defWidth, visible: true, id: idx };

            if (p.data) p.data.forEach(pt => {
                if (pt[0] < minK) minK = pt[0]; if (pt[0] > maxK) maxK = pt[0];
                if (pt[1] < minZ) minZ = pt[1]; if (pt[1] > maxZ) maxZ = pt[1];
            });
        });
        if (minK !== Infinity) {
            const altoZ = maxZ - minZ;
            appState.limitesGlobales.perfil = { minK, maxK, minZ: minZ - (altoZ * 0.2), maxZ: maxZ + (altoZ * 0.2) };
            appState.encuadre.perfil = { minK, maxK, minZ, maxZ };
        }
    }

    if (appState.secciones.length > 0) {
        if (raw.info && raw.info.CapasTerreno) {
            raw.info.CapasTerreno.forEach((nombre, idx) => {
                appConfig.layers.seccion[`Sup: ${nombre}`] = { color: '#8b6914', width: 2, visible: true, type: 't', idx };
            });
        } else {
            appConfig.layers.seccion['Terreno'] = { color: '#8b6914', width: 2, visible: true, type: 't', idx: 0 };
        }
        appConfig.layers.seccion['Corredor'] = { color: '#ff3d00', width: 1.5, visible: true, type: 'c' };

        let gMinY = Infinity, gMaxY = -Infinity;
        const pasoScan = appState.secciones.length > 500 ? 10 : 1;
        for (let k = 0; k < appState.secciones.length; k += pasoScan) {
            const sec = appState.secciones[k];
            const escanear = (listas) => {
                if (!listas) return;
                listas.forEach(obj => {
                    const arr = Array.isArray(obj) ? obj : (obj.p || []);
                    for (let i = 1; i < arr.length; i += 2) {
                        const y = arr[i];
                        if (y > -1000 && y < 8000) { if (y < gMinY) gMinY = y; if (y > gMaxY) gMaxY = y; }
                    }
                });
            };
            escanear(sec.t); escanear(sec.c);
        }
        if (gMinY === Infinity) { gMinY = 0; gMaxY = 20; }
        const alto = gMaxY - gMinY;
        appState.limitesGlobales.seccion = { minX: -50, maxX: 50, minY: gMinY - (alto * 0.1), maxY: gMaxY + (alto * 0.1) };
        appState.encuadre.seccion = { minX: -20, maxX: 20, minY: gMinY, maxY: gMaxY };

        const slider = document.getElementById('stationSlider');
        if (slider) { slider.max = appState.secciones.length - 1; slider.value = 0; }
    }

    recalcularLimitesPlanta();

    buildDynamicSettings();
    renderizarListaProyectos();

    resizeAll();
    resetView('planta');
    resetView('perfil');
    resetView('seccion');
    syncAllViews();
}

function recalcularLimitesPlanta() {
    let minE = Infinity, maxE = -Infinity, minN = Infinity, maxN = -Infinity;

    appState.proyectos.forEach(proy => {
        if (!proy.visible) return;
        const plantaArr = proy.data.planta_trazo || proy.data.planta;
        if (!plantaArr) return;
        plantaArr.forEach(pt => {
            const x = pt.length >= 3 ? pt[1] : pt[0];
            const y = pt.length >= 3 ? pt[2] : pt[1];
            if (x < minE) minE = x; if (x > maxE) maxE = x;
            if (y < minN) minN = y; if (y > maxN) maxN = y;
        });
    });

    if (minE !== Infinity) {
        appState.limitesGlobales.planta = { minE: minE - 500, maxE: maxE + 500, minN: minN - 500, maxN: maxN + 500 };
        appState.encuadre.planta = { minE, maxE, minN, maxN };
    }
}

// ═══════════ SIDE PANELS ═══════════
function toggleNotesPanel() {
    const pn = document.getElementById('notesPanel');
    const pp = document.getElementById('proyectosPanel');
    if (!pn) return;

    // Si abrimos notas, cerramos proyectos
    if (!pn.classList.contains('open') && pp && pp.classList.contains('open')) {
        pp.classList.remove('open');
        document.getElementById('btnToolProyectos').classList.remove('active');
    }

    pn.classList.toggle('open');
    const b = document.getElementById('btnToolNotesList');
    if (pn.classList.contains('open')) { b.classList.add('active'); if (typeof renderNotesList === 'function') renderNotesList(); }
    else { b.classList.remove('active'); }
}

function toggleProyectosPanel() {
    const pp = document.getElementById('proyectosPanel');
    const pn = document.getElementById('notesPanel');
    if (!pp) return;

    // Si abrimos proyectos, cerramos notas
    if (!pp.classList.contains('open') && pn && pn.classList.contains('open')) {
        pn.classList.remove('open');
        document.getElementById('btnToolNotesList').classList.remove('active');
    }

    pp.classList.toggle('open');
    const b = document.getElementById('btnToolProyectos');
    if (pp.classList.contains('open')) {
        b.classList.add('active');
        renderizarListaProyectos();
    } else {
        b.classList.remove('active');
    }
}

function renderizarListaProyectos() {
    const container = document.getElementById('proyectosListContainer');
    const emptyState = document.getElementById('proyectosEmptyState');
    if (!container || !emptyState) return;

    if (appState.proyectos.length === 0) {
        emptyState.style.display = 'block';
        container.innerHTML = '';
        return;
    }

    emptyState.style.display = 'none';
    container.innerHTML = '';

    appState.proyectos.forEach(proy => {
        const isActive = proy.id === appState.proyectoActivoId;

        const card = document.createElement('div');
        card.className = 'proyecto-card ' + (isActive ? 'active' : '');

        card.innerHTML = `
            <div class="proyecto-info" onclick="cambiarProyectoActivo('${proy.id}')">
                <span class="proyecto-name" title="${proy.nombre}">${proy.nombre}</span>
                <span class="proyecto-meta">${proy.data.secciones ? proy.data.secciones.length + ' secciones' : 'Sólo planta'}</span>
            </div>
            <div class="proyecto-actions">
                <button class="btn-proy-action ${proy.visible ? 'active-eye' : ''}" onclick="toggleVisibilidadProyecto('${proy.id}', event)" title="Mostrar/Ocultar en Planta">
                    ${proy.visible ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>' : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>'}
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function toggleVisibilidadProyecto(id, event) {
    if (event) event.stopPropagation();
    const proy = appState.proyectos.find(p => p.id === id);
    if (!proy) return;
    proy.visible = !proy.visible;
    renderizarListaProyectos();
    recalcularLimitesPlanta();
    syncAllViews();
}

function volverAlInicio() {
    if (appState.proyectos && appState.proyectos.length > 0) {
        if (!confirm('¿Deseas cerrar todos los proyectos y volver al inicio?')) return;
    }

    // Limpiar estado
    appState.proyectos = [];
    appState.proyectoActivoId = null;
    appState.notas = [];
    appState.planta = null;
    appState.perfil = null;
    appState.secciones = [];
    appConfig.layers = { planta: {}, perfil: {}, seccion: {} };

    // Cerrar paneles
    const pp = document.getElementById('proyectosPanel');
    if (pp) pp.classList.remove('open');
    const pn = document.getElementById('notesPanel');
    if (pn) pn.classList.remove('open');

    const btnP = document.getElementById('btnToolProyectos');
    if (btnP) btnP.classList.remove('active');
    const btnN = document.getElementById('btnToolNotesList');
    if (btnN) btnN.classList.remove('active');

    // Deseleccionar herramientas de medición
    if (appState.measurement) appState.measurement.mode = 'none';
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';

    // Limpiar Slider y Text
    const kmInput = document.getElementById('kmInput');
    if (kmInput) kmInput.value = '';

    ['sliderInfoLeft', 'sliderInfoCenter', 'sliderInfoRight'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    });

    // Limpiar TODOS los canvas
    ['canvasPlanta', 'canvasPerfil', 'visorCanvas', 'canvasPlantaGPS'].forEach(id => {
        const c = document.getElementById(id);
        if (c) {
            const ctx = c.getContext('2d');
            ctx.clearRect(0, 0, c.width, c.height);
        }
    });

    // Mostrar welcome overlay
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) {
        overlay.style.display = 'flex';
        // Delay slighty to allow 'flex' display to apply before triggering fade-in
        setTimeout(() => overlay.classList.remove('hidden'), 50);
    }

    document.body.classList.remove('sidebar-open'); // asegurar que sidebar está cerrado en movil
}

// ═══════════ 4. INTERACTION (MOUSE + TOUCH) ═══════════
const canvasSec = document.getElementById('visorCanvas');
const canvasPlanta = document.getElementById('canvasPlanta');
const canvasPerfil = document.getElementById('canvasPerfil');

let isPanning = false;
let distInicial = null;

function getPos(e) {
    return (e.touches && e.touches.length > 0)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
        : { x: e.clientX, y: e.clientY };
}

function handleStart(e, tipo) {
    // In measurement mode, block left-click pan on section canvas
    if (tipo === 'seccion' && appState.measurement.mode !== 'none' && e.button === 0) {
        return; // Left click reserved for measurement
    }

    const pos = getPos(e);
    appState.lastMousePos = pos;
    isPanning = true;

    if (tipo === 'seccion') { appState.isDragging = true; updateHUD(e); }
    if (tipo === 'planta') { if (appState.planta) appState.isDraggingPlanta = true; }
    if (tipo === 'perfil') { if (appState.perfil) appState.isDraggingPerfil = true; }
}

[{ c: canvasSec, t: 'seccion' }, { c: canvasPlanta, t: 'planta' }, { c: canvasPerfil, t: 'perfil' }].forEach(item => {
    item.c.addEventListener('mousedown', e => handleStart(e, item.t));
    item.c.addEventListener('touchstart', e => {
        if (e.touches.length === 1) handleStart(e, item.t);
        else if (e.touches.length === 2) {
            distInicial = Math.hypot(
                e.touches[0].pageX - e.touches[1].pageX,
                e.touches[0].pageY - e.touches[1].pageY
            );
        }
    }, { passive: false });
});

window.addEventListener('mousemove', handleMove);
window.addEventListener('touchmove', e => {
    if (e.touches.length === 1 && isPanning) {
        if (e.target.tagName === 'CANVAS') e.preventDefault();
        handleMove(e);
    } else if (e.touches.length === 2 && distInicial) {
        e.preventDefault();
        handlePinchZoom(e);
    }
}, { passive: false });

function handleMove(e) {
    if (!isPanning) return;
    const pos = getPos(e);
    const deltaX = (pos.x - appState.lastMousePos.x) * window.devicePixelRatio;
    const deltaY = (pos.y - appState.lastMousePos.y) * window.devicePixelRatio;

    if (appState.isDragging) { appState.cameras.seccion.x += deltaX; appState.cameras.seccion.y += deltaY; }
    if (appState.isDraggingPlanta) {
        appState.cameras.planta.x += deltaX;
        appState.cameras.planta.y += deltaY;
        // Si el usuario mueve el mapa manualmente, frenamos el "tracking" automático
        if (appState.gps && appState.gps.active && appState.gps.tracking) {
            appState.gps.tracking = false;
            const btnG = document.getElementById('btnToggleGPS');
            if (btnG) btnG.classList.remove('active'); // Mantenemos encendido (sigue dibujando) pero sin active status fuerte
        }
    }
    if (appState.isDraggingPerfil) { appState.cameras.perfil.x += deltaX; appState.cameras.perfil.y += deltaY; }

    appState.lastMousePos = pos;
    syncAllViews();
}

function handlePinchZoom(e) {
    let cam = null;
    const targetId = e.target.id;
    if (targetId === 'visorCanvas') cam = appState.cameras.seccion;
    else if (targetId === 'canvasPlanta') cam = appState.cameras.planta;
    else if (targetId === 'canvasPerfil') cam = appState.cameras.perfil;
    if (!cam) return;

    const distActual = Math.hypot(
        e.touches[0].pageX - e.touches[1].pageX,
        e.touches[0].pageY - e.touches[1].pageY
    );
    const delta = distActual / distInicial;
    const oldZoom = cam.zoom;
    cam.zoom = Math.min(Math.max(cam.zoom * delta, 0.01), 100);

    const midX = (e.touches[0].pageX + e.touches[1].pageX) / 2;
    const midY = (e.touches[0].pageY + e.touches[1].pageY) / 2;
    const rect = e.target.getBoundingClientRect();
    const ax = (midX - rect.left) * window.devicePixelRatio;
    const ay = (midY - rect.top) * window.devicePixelRatio;

    cam.x -= (ax - cam.x) * (cam.zoom / oldZoom - 1);
    cam.y -= (ay - cam.y) * (cam.zoom / oldZoom - 1);

    distInicial = distActual;
    syncAllViews();
}

const stopAll = () => {
    isPanning = false;
    distInicial = null;
    appState.isDragging = false;
    appState.isDraggingPlanta = false;
    appState.isDraggingPerfil = false;
};
window.addEventListener('mouseup', stopAll);
window.addEventListener('touchend', stopAll);

// Wheel Zoom
function aplicarZoom(cam, e, canvasElement) {
    const rect = canvasElement.getBoundingClientRect();
    const mouseX = (e.clientX - rect.left) * window.devicePixelRatio;
    const mouseY = (e.clientY - rect.top) * window.devicePixelRatio;
    const worldX = (mouseX - cam.x) / cam.zoom;
    const worldY = (mouseY - cam.y) / cam.zoom;
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    cam.zoom = Math.min(Math.max(cam.zoom * zoomFactor, 0.001), 100);
    cam.x = mouseX - (worldX * cam.zoom);
    cam.y = mouseY - (worldY * cam.zoom);
    syncAllViews();
}

canvasSec.addEventListener('wheel', e => { e.preventDefault(); aplicarZoom(appState.cameras.seccion, e, canvasSec); }, { passive: false });
canvasPlanta.addEventListener('wheel', e => { e.preventDefault(); aplicarZoom(appState.cameras.planta, e, canvasPlanta); }, { passive: false });
canvasPerfil.addEventListener('wheel', e => { e.preventDefault(); aplicarZoom(appState.cameras.perfil, e, canvasPerfil); }, { passive: false });

// HUD
function updateHUD(e) {
    if (!appState.secciones || !appState.transform) return;
    // Only show HUD when a measurement tool is active
    if (appState.measurement.mode === 'none') return;

    const pos = getPos(e);
    const cam = appState.cameras.seccion;
    const rect = canvasSec.getBoundingClientRect();

    const vx = ((pos.x - rect.left) * window.devicePixelRatio - cam.x) / cam.zoom;
    const vy = ((pos.y - rect.top) * window.devicePixelRatio - cam.y) / cam.zoom;

    const rx = ((vx - appState.transform.mx) / appState.transform.scale) + appState.transform.minX;
    const ry = ((canvasSec.height - vy - appState.transform.my) / appState.transform.scale) + appState.transform.minY;

    appState.lastMarker = { x: rx, y: ry };

    const hud = document.getElementById('hud');
    if (hud) {
        hud.style.display = 'flex';
        // If in point mode with a placed point, freeze HUD to clicked coordinates
        if (appState.measurement.mode === 'point' && appState.measurement.points.length >= 1) {
            const pt = appState.measurement.points[0];
            document.getElementById('hudX').textContent = pt.x.toFixed(2);
            document.getElementById('hudY').textContent = pt.y.toFixed(2);
        } else {
            document.getElementById('hudX').textContent = rx.toFixed(2);
            document.getElementById('hudY').textContent = ry.toFixed(2);
        }
    }
    syncAllViews();
}

// ═══════════ 5. SLIDER & SEARCH ═══════════
document.getElementById('stationSlider').addEventListener('input', (e) => {
    appState.currentIdx = parseInt(e.target.value);
    syncAllViews();
});

const kmInput = document.getElementById('kmInput');
kmInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { buscarProgresiva(kmInput.value); kmInput.blur(); }
});

function buscarProgresiva(texto) {
    if (!appState.secciones) return;
    let valorBuscado = parseFloat(texto.replace('+', ''));
    if (isNaN(valorBuscado)) { syncAllViews(); return; }
    let mejorIndice = 0, minimaDiferencia = Infinity;
    appState.secciones.forEach((seccion, index) => {
        const kActual = seccion.k || seccion.km || 0;
        const diferencia = Math.abs(kActual - valorBuscado);
        if (diferencia < minimaDiferencia) { minimaDiferencia = diferencia; mejorIndice = index; }
    });
    appState.currentIdx = mejorIndice;
    document.getElementById('stationSlider').value = mejorIndice;
    syncAllViews();
}

// ═══════════ 6. RESIZE ═══════════
function resizeAll() {
    // Auto-adjust text scaling for mobile devices
    if (window.innerWidth <= 800) {
        appConfig.general.textScale = 1.6; // Boost readability on small screens
    } else {
        appConfig.general.textScale = 1.0; // Default for desktop
    }

    ['visorCanvas', 'canvasPlanta', 'canvasPlantaGPS', 'canvasPerfil'].forEach(id => {
        const c = document.getElementById(id);
        if (c && c.parentNode) {
            const parent = c.parentNode;
            if (parent.clientWidth > 0) {
                c.width = parent.clientWidth * window.devicePixelRatio;
                c.height = parent.clientHeight * window.devicePixelRatio;
            }
        }
    });
    syncAllViews();
    if (typeof dibujarGPS === 'function') dibujarGPS();
}

function resetView(tipo) {
    if (appState.cameras[tipo]) {
        appState.cameras[tipo] = { x: 0, y: 0, zoom: 1 };
        syncAllViews();
    }
}

const observerPlanta = new ResizeObserver(entries => {
    for (const entry of entries) {
        if (entry.contentRect.width > 10) { resizeAll(); syncAllViews(); }
    }
});
if (document.getElementById('panel-planta')) observerPlanta.observe(document.getElementById('panel-planta'));

window.onload = resizeAll;
window.onresize = resizeAll;

// ═══════════ 7. SETTINGS ═══════════
function openTab(tabId, btn) {
    document.querySelectorAll('.tab-panel').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.settings-nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
    if (btn) btn.classList.add('active');
}

function buildDynamicSettings() {
    // Planta layers
    const divPlanta = document.getElementById('layers-planta-container');
    divPlanta.innerHTML = '';
    Object.keys(appConfig.layers.planta).forEach(key => {
        divPlanta.appendChild(createLayerControl('planta', key));
    });

    // Perfil layers
    const divPerfil = document.getElementById('layers-perfil-container');
    const selTarget = document.getElementById('cfgTargetPerfil');
    divPerfil.innerHTML = '';
    selTarget.innerHTML = '<option value="auto">Automático (Primer Elemento)</option>';
    Object.keys(appConfig.layers.perfil).forEach(key => {
        divPerfil.appendChild(createLayerControl('perfil', key));
        const opt = document.createElement('option');
        opt.value = key;
        opt.innerText = key;
        selTarget.appendChild(opt);
    });

    // Seccion layers
    const divSeccion = document.getElementById('layers-seccion-container');
    divSeccion.innerHTML = '';
    Object.keys(appConfig.layers.seccion).forEach(key => {
        divSeccion.appendChild(createLayerControl('seccion', key));
    });
}

function createLayerControl(viewType, layerName) {
    const layer = appConfig.layers[viewType][layerName];
    const row = document.createElement('div');
    row.className = 'setting-row';
    row.style.borderTop = '1px solid var(--border)';
    row.style.paddingTop = '8px';

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = layer.visible;
    check.onchange = (e) => { layer.visible = e.target.checked; syncAllViews(); };

    const span = document.createElement('span');
    span.innerText = layerName;
    span.style.flexGrow = 1;
    span.style.marginLeft = '10px';
    span.style.fontSize = '12px';

    const color = document.createElement('input');
    color.type = 'color';
    color.value = layer.color;
    color.style.cssText = 'border:none; width:28px; height:28px; background:none; cursor:pointer; border-radius:4px;';
    color.onchange = (e) => { layer.color = e.target.value; syncAllViews(); };

    const width = document.createElement('input');
    width.type = 'number';
    width.value = layer.width;
    width.step = 0.5;
    width.min = 0.1;
    width.style.width = '50px';
    width.className = 'input-num';
    width.onchange = (e) => { layer.width = parseFloat(e.target.value); syncAllViews(); };

    row.appendChild(check);
    row.appendChild(span);
    row.appendChild(color);
    row.appendChild(width);

    return row;
}

function toggleSettings() {
    const m = document.getElementById('settingsModal');
    if (!m) return;
    const isHidden = m.style.display === 'none';
    m.style.display = isHidden ? 'flex' : 'none';

    const btn = document.querySelector('.btn-settings-trigger');
    if (btn) isHidden ? btn.classList.add('active') : btn.classList.remove('active');

    if (isHidden) cargarValoresAjustes();
}

function cargarValoresAjustes() {
    document.getElementById('chkTheme').checked = (appConfig.general.theme === 'light');
    document.getElementById('cfgTextScale').value = appConfig.general.textScale;
    document.getElementById('cfgGridPlanta').value = appConfig.planta.gridInterval;
    document.getElementById('cfgGridPlantaMulti').value = appConfig.planta.gridIntervalMulti;
    document.getElementById('chkShowGridPlanta').checked = appConfig.planta.showGrid;
    document.getElementById('cfgPlantaMajor').value = appConfig.planta.ticksMajor || 1000;
    document.getElementById('cfgPlantaMinor').value = appConfig.planta.ticksMinor || 100;
    document.getElementById('chkPlantaLabels').checked = appConfig.planta.showLabels !== false;
    document.getElementById('chkPlantaTicks').checked = appConfig.planta.showTicks !== false;
    document.getElementById('chkShowMap').checked = appConfig.planta.showMap;
    const mapTypeEl = document.getElementById('cfgMapType');
    if (mapTypeEl) mapTypeEl.value = appConfig.planta.mapType || 's';
    const mapOpacityEl = document.getElementById('cfgMapOpacity');
    if (mapOpacityEl) {
        mapOpacityEl.value = Math.round((appConfig.planta.mapOpacity ?? 0.8) * 100);
        document.getElementById('mapOpacityVal').innerText = mapOpacityEl.value + '%';
    }
    document.getElementById('cfgGridPerfilK').value = appConfig.perfil.gridK;
    document.getElementById('cfgGridPerfilKMulti').value = appConfig.perfil.gridKMulti || 1000;
    document.getElementById('cfgGridPerfilZ').value = appConfig.perfil.gridZ;
    document.getElementById('cfgGridPerfilZMulti').value = appConfig.perfil.gridZMulti || 50;
    document.getElementById('cfgExajPerfil').value = appConfig.perfil.exaj;
    document.getElementById('cfgTargetPerfil').value = appConfig.perfil.target;
    document.getElementById('cfgGridSeccionX').value = appConfig.seccion?.gridX || 5;
    document.getElementById('cfgGridSeccionY').value = appConfig.seccion?.gridY || 5;
}

function applySettingsAndClose() {
    appConfig.general.textScale = parseFloat(document.getElementById('cfgTextScale').value) || 1.0;

    if (!appConfig.planta) appConfig.planta = {};
    appConfig.planta.gridInterval = parseFloat(document.getElementById('cfgGridPlanta').value) || 200;
    appConfig.planta.gridIntervalMulti = parseFloat(document.getElementById('cfgGridPlantaMulti').value) || 500;
    appConfig.planta.showGrid = document.getElementById('chkShowGridPlanta').checked;
    appConfig.planta.ticksMajor = parseFloat(document.getElementById('cfgPlantaMajor').value) || 1000;
    appConfig.planta.ticksMinor = parseFloat(document.getElementById('cfgPlantaMinor').value) || 100;
    appConfig.planta.showLabels = document.getElementById('chkPlantaLabels').checked;
    appConfig.planta.showTicks = document.getElementById('chkPlantaTicks').checked;
    appConfig.planta.showMap = document.getElementById('chkShowMap').checked;

    const prevType = appConfig.planta.mapType;
    appConfig.planta.mapType = document.getElementById('cfgMapType').value || 's';
    if (prevType !== appConfig.planta.mapType) window.mapTileCache = {}; // invalidate cache if changed

    appConfig.planta.mapOpacity = parseInt(document.getElementById('cfgMapOpacity').value) / 100;

    if (!appConfig.perfil) appConfig.perfil = {};
    appConfig.perfil.gridK = parseFloat(document.getElementById('cfgGridPerfilK').value) || 100;
    appConfig.perfil.gridKMulti = parseFloat(document.getElementById('cfgGridPerfilKMulti').value) || 1000;
    appConfig.perfil.gridZ = parseFloat(document.getElementById('cfgGridPerfilZ').value) || 5;
    appConfig.perfil.gridZMulti = parseFloat(document.getElementById('cfgGridPerfilZMulti').value) || 50;
    appConfig.perfil.exaj = parseFloat(document.getElementById('cfgExajPerfil').value) || 10;
    appConfig.perfil.target = document.getElementById('cfgTargetPerfil').value;

    if (!appConfig.seccion) appConfig.seccion = {};
    appConfig.seccion.gridX = parseFloat(document.getElementById('cfgGridSeccionX').value) || 5;
    appConfig.seccion.gridY = parseFloat(document.getElementById('cfgGridSeccionY').value) || 5;

    syncAllViews();
    toggleSettings();
}

function toggleTheme(checkbox) {
    appConfig.general.theme = checkbox.checked ? 'light' : 'dark';
    applyTheme();
}

function applyTheme() {
    if (appConfig.general.theme === 'light') document.body.classList.add('light-mode');
    else document.body.classList.remove('light-mode');
    syncAllViews();
}

// ═══════════ SATELLITE MAP LOGIC ═══════════

// ═══════════ GPS TRACKING LOGIC ═══════════

function toggleGPS() {
    const btn = document.getElementById('btnToggleGPS');

    // Si ya está activo pero el seguimiento se frenó manuamente, lo re-enganchamos
    if (appState.gps.active && !appState.gps.tracking) {
        appState.gps.tracking = true;
        if (btn) { btn.classList.add('active'); btn.classList.remove('searching'); }
        centrarCamaraEnGPS();
        return;
    }

    // Toggle Off
    if (appState.gps.active) {
        appState.gps.active = false;
        appState.gps.tracking = false;
        if (appState.gps.watchId !== null) {
            navigator.geolocation.clearWatch(appState.gps.watchId);
            appState.gps.watchId = null;
        }
        if (btn) { btn.classList.remove('active'); btn.classList.remove('searching'); }
        appState.gps.e = null; appState.gps.n = null;
        syncAllViews();
        if (typeof dibujarGPS === 'function') dibujarGPS();
        showNotification('📍 GPS desactivado');
        return;
    }

    // Toggle On (Request permission)
    if (!navigator.geolocation) {
        showNotification('⚠️ Geolocalización no soportada en este navegador', 'error');
        return;
    }

    // Primero validamos zona UTM (la misma del mapa)
    if (!appConfig.planta.utmZone) {
        const zone = prompt("Para ubicar tu posición en el diseño, ingresa la Zona UTM de tu proyecto (Ej: '18S', '17S', '19S'):", "18S");
        if (zone && zone.trim() !== "") {
            appConfig.planta.utmZone = zone.trim().toUpperCase();
        } else {
            return; // Cancelado
        }
    }

    appState.gps.active = true;
    appState.gps.tracking = true; // Empieza siguiendo
    if (btn) btn.classList.add('searching'); // Animación de bucando

    appState.gps.watchId = navigator.geolocation.watchPosition(
        (position) => {
            appState.gps.lat = position.coords.latitude;
            appState.gps.lon = position.coords.longitude;
            appState.gps.accuracy = position.coords.accuracy;

            // Convert to UTM using existing appConfig.planta.utmZone setup for map
            const zoneStr = appConfig.planta.utmZone.toUpperCase();
            const hemi = zoneStr.includes('S') ? '+south' : '';
            const zoneNum = zoneStr.replace(/[^0-9]/g, '');
            proj4.defs('USER_UTM_GPS', `+proj=utm +zone=${zoneNum} ${hemi} +datum=WGS84 +units=m +no_defs`);

            try {
                const utmCoords = proj4('WGS84', 'USER_UTM_GPS', [appState.gps.lon, appState.gps.lat]);
                appState.gps.e = utmCoords[0];
                appState.gps.n = utmCoords[1];

                if (btn) {
                    btn.classList.remove('searching');
                    if (appState.gps.tracking) btn.classList.add('active');
                }

                if (appState.gps.tracking) {
                    centrarCamaraEnGPS();
                } else {
                    if (typeof dibujarGPS === 'function') dibujarGPS(); // Repinta solo la capa transparente
                }
            } catch (e) { console.error("GPS conversion error", e); }
        },
        (error) => {
            console.error(error);
            showNotification('❌ Error de GPS: ' + error.message, 'error');
            toggleGPS(); // auto-off
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 5000 }
    );
}

function centrarCamaraEnGPS() {
    if (!appState.gps.e || !appState.gps.n || !appState.cameras.planta) return;
    const canvas = document.getElementById('canvasPlanta');
    if (!canvas) return;

    // Calculate new camera position so GPS (e, n) is at center of canvas
    // Logic: toX(e) without camera should equal W/2
    // We modify camera (cam.x, cam.y) directly using the inverse function of toX and toY
    const cam = appState.cameras.planta;
    const W = canvas.width;
    const H = canvas.height;

    const { minE, maxE, minN, maxN } = appState.encuadre.planta;
    const centroE = (minE + maxE) / 2;
    const centroN = (minN + maxN) / 2;
    const scale = Math.min(W / ((maxE - minE) * 1.2), H / ((maxN - minN) * 1.2));

    // Deseamos que la coordenada "GPS" caiga en el pixel W/2, H/2
    // Formula interna de toX en dibujo es: screenX = ( (W/2) + (mundoE - centroE) * scale ) * cam.zoom + cam.x
    // Para que caiga en W/2:
    // W/2 = (W/2 + (gpsE - centroE)*scale)*cam.zoom + cam.x 
    // cam.x = W/2 - (W/2 + (gpsE - centroE)*scale)*cam.zoom

    const baseX = (W / 2) + (appState.gps.e - centroE) * scale;
    const baseY = (H / 2) - (appState.gps.n - centroN) * scale;

    cam.x = (W / 2) - (baseX * cam.zoom);
    cam.y = (H / 2) - (baseY * cam.zoom);

    syncAllViews();
    if (typeof dibujarGPS === 'function') dibujarGPS();
}

function toggleMapQuick() {
    const chk = document.getElementById('chkShowMap');
    if (chk) {
        chk.checked = !chk.checked;
        toggleMap(chk);
    }
}

function changeMapTypeAndSync() {
    if (appConfig.planta) {
        appConfig.planta.mapType = document.getElementById('cfgMapType').value || 's';
        window.mapTileCache = {}; // Limpiamos para que vuelva a cargar
        if (appConfig.planta.showMap) syncAllViews();
    }
}

function changeMapOpacityAndSync() {
    if (appConfig.planta) {
        appConfig.planta.mapOpacity = parseInt(document.getElementById('cfgMapOpacity').value) / 100;
        if (appConfig.planta.showMap) syncAllViews();
    }
}

function toggleMap(checkbox) {
    const btnQuick = document.getElementById('btnToggleMapQuick');
    if (!checkbox.checked) {
        appConfig.planta.showMap = false;
        if (btnQuick) btnQuick.classList.remove('active');
        if (appState.planta) resetView('planta');
        return;
    }

    if (!appConfig.planta.utmZone) {
        const zone = prompt("Para dibujar el mapa base, por favor ingresa la Zona UTM de tu proyecto (Ej: '18S', '17S', '19S'):", "18S");
        if (zone && zone.trim() !== "") {
            appConfig.planta.utmZone = zone.trim().toUpperCase();
            appConfig.planta.showMap = true;
            if (btnQuick) btnQuick.classList.add('active');
            if (appState.planta) resetView('planta');
        } else {
            // Cancelled
            checkbox.checked = false;
            appConfig.planta.showMap = false;
            if (btnQuick) btnQuick.classList.remove('active');
        }
    } else {
        appConfig.planta.showMap = true;
        if (btnQuick) btnQuick.classList.add('active');
        if (appState.planta) resetView('planta');
    }
}

window.addEventListener('DOMContentLoaded', () => { applyTheme(); });

// ═══════════ 8. CAPTURE ═══════════
function capturaInteligente() {
    document.body.classList.remove('sidebar-open');
    const dashboard = document.getElementById('main-dashboard');
    const layout = dashboard.className;

    if (layout === 'layout-multi') {
        capturarMultiVista();
    } else {
        let activeCanvas = '', activeName = '', activeTitle = '';
        if (layout.includes('planta')) { activeCanvas = 'canvasPlanta'; activeName = 'Planta'; activeTitle = 'Vista Planta'; }
        else if (layout.includes('perfil')) { activeCanvas = 'canvasPerfil'; activeName = 'Perfil'; activeTitle = 'Vista Perfil Longitudinal'; }
        else { activeCanvas = 'visorCanvas'; activeName = 'Seccion'; activeTitle = 'Vista Sección Transversal'; }
        guardarImagenConEncabezado(activeCanvas, activeName, activeTitle);
    }
}

function drawProfessionalHeaderAndFooter(ctx, width, height, tituloVista) {
    const isLight = document.body.classList.contains('light-mode');

    // Theme colors matching UI
    const bgApp = isLight ? '#f5f6fa' : '#0a0a14';
    const bgHeader = isLight ? '#ebedf5' : '#121220';
    const borderCol = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
    const textMain = isLight ? '#1a1a2e' : '#f0f0f5';
    const textMuted = isLight ? '#666680' : '#8888a0';
    const accent = isLight ? '#0066ff' : '#00e5ff';
    const accentDim = isLight ? 'rgba(0,102,255,0.1)' : 'rgba(0,229,255,0.15)';

    // Fill entire background
    ctx.fillStyle = bgApp;
    ctx.fillRect(0, 0, width, height);

    // Ranges
    const H_HEADER = 64;
    const H_FOOTER = 44;
    const Y_FOOTER = height - H_FOOTER;

    // Draw Header
    ctx.fillStyle = bgHeader;
    ctx.fillRect(0, 0, width, H_HEADER);
    ctx.fillStyle = borderCol;
    ctx.fillRect(0, H_HEADER - 1, width, 1);

    // Draw Footer
    ctx.fillStyle = bgHeader;
    ctx.fillRect(0, Y_FOOTER, width, H_FOOTER);
    ctx.fillStyle = borderCol;
    ctx.fillRect(0, Y_FOOTER, width, 1);

    // --- Header Element: Logo ---
    ctx.save();
    ctx.translate(24, 21); // Logo position
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    // SVG Path equivalent
    const pathIcon = new Path2D("M5 7h1a2 2 0 0 0 2-2a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1a2 2 0 0 0 2 2h1a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2");
    ctx.stroke(pathIcon);
    const circleIcon = new Path2D();
    circleIcon.arc(12, 13, 3, 0, Math.PI * 2);
    ctx.stroke(circleIcon);
    ctx.restore();

    // Logo Text
    ctx.font = 'bold 20px "Inter", sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = textMain;
    ctx.fillText("Visor", 64, H_HEADER / 2);
    const visorW = ctx.measureText("Visor").width;
    ctx.fillStyle = accent;
    ctx.fillText("TIQAL", 64 + visorW, H_HEADER / 2);

    // --- Header Element: Center PK Pill ---
    let pkText = getCurrentPKText().replace('PK: ', ''); // "14+820"
    if (pkText === '--+---') pkText = '0+000';
    const pkWidth = 160;
    const pkHeight = 34;
    const pkX = (width - pkWidth) / 2;
    const pkY = (H_HEADER - pkHeight) / 2;

    // PK Pill bg
    ctx.fillStyle = bgApp;
    ctx.beginPath();
    ctx.roundRect(pkX, pkY, pkWidth, pkHeight, 6);
    ctx.fill();
    ctx.strokeStyle = accentDim;
    ctx.lineWidth = 1;
    ctx.stroke();

    // PK Pill label bg
    ctx.fillStyle = accentDim;
    ctx.beginPath();
    ctx.roundRect(pkX, pkY, 44, pkHeight, [6, 0, 0, 6]);
    ctx.fill();

    ctx.font = 'bold 12px "Inter", sans-serif';
    ctx.fillStyle = accent;
    ctx.textAlign = 'center';
    ctx.fillText("PK", pkX + 22, H_HEADER / 2);

    ctx.font = 'bold 16px "JetBrains Mono", monospace';
    ctx.fillText(pkText, pkX + 44 + (pkWidth - 44) / 2, H_HEADER / 2 + 1);

    // --- Header Element: Title ---
    ctx.font = 'bold 16px "Inter", sans-serif';
    ctx.fillStyle = textMuted;
    ctx.textAlign = 'right';
    ctx.fillText(tituloVista.toUpperCase(), width - 30, H_HEADER / 2);

    // --- Footer Element: Texts ---
    ctx.font = '13px "Inter", sans-serif';
    ctx.fillStyle = textMuted;
    ctx.textAlign = 'left';
    ctx.fillText("Generado por VisorTIQAL", 24, Y_FOOTER + H_FOOTER / 2);

    const dateStr = new Date().toLocaleString();
    ctx.textAlign = 'right';
    ctx.fillText(dateStr, width - 24, Y_FOOTER + H_FOOTER / 2);
}

function guardarImagenConEncabezado(idCanvas, nombreBase, tituloVista) {
    const canvas = document.getElementById(idCanvas);
    if (!canvas) return;

    // Fixed output target dimensions
    const width = 1920;
    const height = 1080;
    const H_HEADER = 64;
    const H_FOOTER = 44;

    const masterCanvas = document.createElement('canvas');
    masterCanvas.width = width;
    masterCanvas.height = height;
    const ctx = masterCanvas.getContext('2d');

    drawProfessionalHeaderAndFooter(ctx, width, height, tituloVista);

    // Calculate canvas scaling inside available safe content area preserving aspect ratio
    const contW = width;
    const contH = height - H_HEADER - H_FOOTER;
    const scale = Math.min(contW / canvas.width, contH / canvas.height);
    const drawW = canvas.width * scale;
    const drawH = canvas.height * scale;
    const dx = (contW - drawW) / 2;
    const dy = H_HEADER + (contH - drawH) / 2;

    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, dx, dy, drawW, drawH);

    descargarCanvas(masterCanvas, nombreBase);
}

function capturarMultiVista() {
    const dashboard = document.getElementById('main-dashboard');
    const rectDash = dashboard.getBoundingClientRect();

    // Fixed output target dimensions
    const width = 1920;
    const height = 1080;
    const H_HEADER = 64;
    const H_FOOTER = 44;

    const masterCanvas = document.createElement('canvas');
    masterCanvas.width = width;
    masterCanvas.height = height;
    const ctx = masterCanvas.getContext('2d');

    drawProfessionalHeaderAndFooter(ctx, width, height, "Vista Multipantalla");

    // Scale entire dashboard mapping to fit safe rect
    const contW = width;
    const contH = height - H_HEADER - H_FOOTER;
    const scale = Math.min(contW / rectDash.width, contH / rectDash.height);
    const dashW = rectDash.width * scale;
    const dashH = rectDash.height * scale;
    const offsetX = (contW - dashW) / 2;
    const offsetY = H_HEADER + (contH - dashH) / 2;

    const isLight = document.body.classList.contains('light-mode');

    [{ id: 'canvasPlanta' }, { id: 'canvasPerfil' }, { id: 'visorCanvas' }].forEach(item => {
        const c = document.getElementById(item.id);
        if (c) {
            const rectC = c.getBoundingClientRect();
            // Position relative to dashboard
            const x = offsetX + (rectC.left - rectDash.left) * scale;
            const y = offsetY + (rectC.top - rectDash.top) * scale;
            const w = rectC.width * scale;
            const h = rectC.height * scale;

            ctx.drawImage(c, 0, 0, c.width, c.height, x, y, w, h);

            // Draw grid borders matching the UI grids
            ctx.strokeStyle = isLight ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 3;
            ctx.strokeRect(x, y, w, h);
        }
    });

    descargarCanvas(masterCanvas, 'Dashboard_Multi');
}

// ═══════════ UTILITIES ═══════════
function getCurrentPKText() {
    if (!appState.secciones || appState.secciones.length === 0) return 'PK: --+---';
    const sec = appState.secciones[appState.currentIdx];
    const val = sec.k || sec.km || 0;
    const k = Math.floor(val / 1000);
    const m = Math.abs(val % 1000).toFixed(0).padStart(3, '0');
    return `PK: ${k}+${m}`;
}

function descargarCanvas(canvas, nombreBase) {
    try {
        let pkStr = 'General';
        if (appState.secciones && appState.secciones.length > 0) {
            pkStr = Math.floor(appState.secciones[appState.currentIdx].k).toString();
        }
        const now = new Date();
        const fechaHora = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
        const nombreArchivo = `Ti_${nombreBase}_PK${pkStr}_${fechaHora}.png`;

        const link = document.createElement('a');
        link.download = nombreArchivo;
        link.href = canvas.toDataURL('image/png');
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('Error al exportar:', err);
        showNotification('Error al generar imagen', 'error');
    }
}

function hideWelcome() {
    const overlay = document.getElementById('welcomeOverlay');
    if (overlay) {
        overlay.classList.add('hidden');
        setTimeout(() => overlay.style.display = 'none', 600);
    }
}

// Toast notifications
function showNotification(msg, type = 'success') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.textContent = msg;

    const bgColor = type === 'error' ? 'rgba(244,67,54,0.9)'
        : type === 'warning' ? 'rgba(255,152,0,0.9)'
            : 'rgba(0,229,255,0.9)';

    toast.style.cssText = `
        position: fixed;
        bottom: 100px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: ${bgColor};
        color: #000;
        padding: 10px 24px;
        border-radius: 8px;
        font-family: 'Inter', sans-serif;
        font-size: 13px;
        font-weight: 600;
        z-index: 10000;
        opacity: 0;
        transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1);
        pointer-events: none;
        backdrop-filter: blur(8px);
    `;

    document.body.appendChild(toast);
    requestAnimationFrame(() => {
        toast.style.opacity = '1';
        toast.style.transform = 'translateX(-50%) translateY(0)';
    });
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(-50%) translateY(20px)';
        setTimeout(() => toast.remove(), 300);
    }, 2500);
}

// ═══════════ DRAG & DROP ═══════════
document.addEventListener('dragover', e => {
    e.preventDefault();
    document.body.classList.add('drag-over');
});

document.addEventListener('dragleave', e => {
    if (e.relatedTarget === null) document.body.classList.remove('drag-over');
});

document.addEventListener('drop', e => {
    e.preventDefault();
    document.body.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) loadFile(file);
});

// ═══════════ KEYBOARD SHORTCUTS ═══════════
document.addEventListener('keydown', e => {
    if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT' || document.activeElement.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        if (appState.secciones && appState.currentIdx < appState.secciones.length - 1) {
            appState.currentIdx++;
            document.getElementById('stationSlider').value = appState.currentIdx;
            syncAllViews();
        }
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (appState.secciones && appState.currentIdx > 0) {
            appState.currentIdx--;
            document.getElementById('stationSlider').value = appState.currentIdx;
            syncAllViews();
        }
    }
    if (e.key === 'Home') {
        e.preventDefault();
        if (appState.secciones) {
            appState.currentIdx = 0;
            document.getElementById('stationSlider').value = 0;
            syncAllViews();
        }
    }
    if (e.key === 'End') {
        e.preventDefault();
        if (appState.secciones) {
            appState.currentIdx = appState.secciones.length - 1;
            document.getElementById('stationSlider').value = appState.currentIdx;
            syncAllViews();
        }
    }

    // View shortcuts
    if (e.key === '1') changeLayout('layout-seccion', document.querySelector('[data-layout="layout-seccion"]'));
    if (e.key === '2') changeLayout('layout-planta', document.querySelector('[data-layout="layout-planta"]'));
    if (e.key === '3') changeLayout('layout-perfil', document.querySelector('[data-layout="layout-perfil"]'));
    if (e.key === '4') changeLayout('layout-multi', document.querySelector('[data-layout="layout-multi"]'));

    // ESC cancels measurement
    if (e.key === 'Escape') {
        cancelMeasurement();
    }
});

// ═══════════ MEASUREMENT TOOLS ═══════════
function setMeasureTool(mode) {
    const dashboard = document.getElementById('main-dashboard');
    if (dashboard && dashboard.className !== 'layout-seccion' && dashboard.className !== 'layout-multi') {
        return; // Tools disabled outside section view
    }

    document.body.classList.remove('sidebar-open');
    const prevMode = appState.measurement.mode;

    // Toggle off if clicking same tool
    if (prevMode === mode) {
        cancelMeasurement();
        return;
    }

    // Set new mode
    appState.measurement.mode = mode;
    appState.measurement.points = [];
    appState.measurement.result = null;

    // Update button states
    ['btnMeasurePoint', 'btnMeasureDist', 'btnMeasureSlope', 'btnMeasurePin'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });

    const btnMap = { 'point': 'btnMeasurePoint', 'distance': 'btnMeasureDist', 'slope': 'btnMeasureSlope', 'pin': 'btnMeasurePin' };
    if (btnMap[mode]) document.getElementById(btnMap[mode])?.classList.add('active');

    // Show mode indicator in HUD
    const hudMode = document.getElementById('hudMode');
    const hudModeText = document.getElementById('hudModeText');
    if (hudMode && hudModeText) {
        hudMode.style.display = 'block';
        const modeNames = { 'point': '⊕ PUNTO', 'distance': '📏 DISTANCIA', 'slope': '📐 PENDIENTE', 'pin': '📍 NOTA (PIN)' };
        hudModeText.textContent = modeNames[mode] || '';
    }

    // Hide measurement rows when switching
    hideMeasurementHUD();

    // Change cursor
    const secCanvas = document.getElementById('visorCanvas');
    if (secCanvas) secCanvas.style.cursor = 'crosshair';

    syncAllViews();
}

function cancelMeasurement() {
    appState.measurement.mode = 'none';
    appState.measurement.points = [];
    appState.measurement.result = null;

    ['btnMeasurePoint', 'btnMeasureDist', 'btnMeasureSlope', 'btnMeasurePin'].forEach(id => {
        document.getElementById(id)?.classList.remove('active');
    });

    const hudMode = document.getElementById('hudMode');
    if (hudMode) hudMode.style.display = 'none';

    hideMeasurementHUD();

    const secCanvas = document.getElementById('visorCanvas');
    if (secCanvas) secCanvas.style.cursor = '';

    syncAllViews();
}

function hideMeasurementHUD() {
    ['hudMeasSep', 'hudMeasP1X', 'hudMeasP1Z', 'hudMeasP1P2Sep', 'hudMeasP2X', 'hudMeasP2Z', 'hudMeasP2DeltaSep',
        'hudMeasDx', 'hudMeasDy', 'hudMeasDist', 'hudMeasSlope', 'hudMeasTalud'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    // Restore base X/Z rows
    const baseZ = document.getElementById('hudBaseZ');
    const baseX = document.getElementById('hudBaseX');
    if (baseZ) baseZ.style.display = 'flex';
    if (baseX) baseX.style.display = 'flex';
}

function showMeasurementHUD(dx, dy, dist, slope, p1, p2) {
    const mode = appState.measurement.mode;

    // Hide base X/Z rows in distance/slope (they follow the mouse)
    if (mode === 'distance' || mode === 'slope') {
        const baseZ = document.getElementById('hudBaseZ');
        const baseX = document.getElementById('hudBaseX');
        if (baseZ) baseZ.style.display = 'none';
        if (baseX) baseX.style.display = 'none';
    }

    // Show P1/P2 coordinates for distance and slope
    if (mode === 'distance' || mode === 'slope') {
        if (p1) {
            document.getElementById('hudMeasP1X').style.display = 'flex';
            document.getElementById('hudMeasP1Z').style.display = 'flex';
            document.getElementById('hudP1X').textContent = p1.x.toFixed(3);
            document.getElementById('hudP1Z').textContent = p1.y.toFixed(3);
        }
        if (p2) {
            document.getElementById('hudMeasP1P2Sep').style.display = 'block';
            document.getElementById('hudMeasP2X').style.display = 'flex';
            document.getElementById('hudMeasP2Z').style.display = 'flex';
            document.getElementById('hudP2X').textContent = p2.x.toFixed(3);
            document.getElementById('hudP2Z').textContent = p2.y.toFixed(3);
            document.getElementById('hudMeasP2DeltaSep').style.display = 'block';
        }

        document.getElementById('hudMeasSep').style.display = 'block';
        document.getElementById('hudMeasDx').style.display = 'flex';
        document.getElementById('hudMeasDy').style.display = 'flex';
        document.getElementById('hudDx').textContent = dx.toFixed(3);
        document.getElementById('hudDy').textContent = dy.toFixed(3);
    }

    // Show D only in distance mode
    if (mode === 'distance') {
        document.getElementById('hudMeasDist').style.display = 'flex';
        document.getElementById('hudDist').textContent = dist.toFixed(3);
    }

    // Show slope and talud only in slope mode
    if (mode === 'slope') {
        document.getElementById('hudMeasSlope').style.display = 'flex';
        document.getElementById('hudSlope').textContent = isFinite(slope) ? slope.toFixed(2) : '∞';

        // Calculate and show Talud (X:1 format)
        document.getElementById('hudMeasTalud').style.display = 'flex';
        let taludStr = '∞';
        if (Math.abs(dy) > 0.0001) {
            const taludX = Math.abs(dx / dy);
            taludStr = `${taludX.toFixed(2)}:1`;
        } else if (Math.abs(dx) > 0.0001) {
            taludStr = '∞:1';
        } else {
            taludStr = '0:1';
        }
        document.getElementById('hudTalud').textContent = taludStr;
    }
}

function toggleSnap() {
    const dashboard = document.getElementById('main-dashboard');
    if (dashboard && dashboard.className !== 'layout-seccion' && dashboard.className !== 'layout-multi') {
        return; // Tools disabled outside section view
    }

    appState.snap.enabled = !appState.snap.enabled;
    const btn = document.getElementById('btnSnap');
    if (btn) {
        if (appState.snap.enabled) btn.classList.add('active');
        else btn.classList.remove('active');
    }
    syncAllViews();
}

// ═══════════ SNAP ENGINE ═══════════
function findSnapPoint(worldX, worldY) {
    if (!appState.snap.enabled) return null;
    if (!appState.secciones || !appState.secciones[appState.currentIdx]) return null;

    const sec = appState.secciones[appState.currentIdx];
    const cam = appState.cameras.seccion;
    const t = appState.transform;
    const canvas = document.getElementById('visorCanvas');
    if (!canvas) return null;

    const toScreenX = (v) => ((t.mx + (v - t.minX) * t.scale) * cam.zoom) + cam.x;
    const toScreenY = (v) => ((canvas.height - (t.my + (v - t.minY) * t.scale)) * cam.zoom) + cam.y;

    const screenMX = toScreenX(worldX);
    const screenMY = toScreenY(worldY);

    let bestDist = appState.snap.threshold * window.devicePixelRatio;
    let bestPt = null;

    // Scan all geometry vertices
    const scanForSnap = (listas) => {
        if (!listas) return;
        listas.forEach(obj => {
            const arr = Array.isArray(obj) ? obj : (obj.p || []);
            for (let i = 0; i < arr.length; i += 2) {
                const vx = arr[i], vy = arr[i + 1];
                const sx = toScreenX(vx);
                const sy = toScreenY(vy);
                const d = Math.hypot(sx - screenMX, sy - screenMY);
                if (d < bestDist) {
                    bestDist = d;
                    bestPt = { x: vx, y: vy };
                }
            }
        });
    };

    scanForSnap(sec.t);
    scanForSnap(sec.c);

    return bestPt;
}

// ═══════════ ENHANCED MOUSE HANDLING FOR MEASUREMENT ═══════════
// Extend mousemove to update snap + HUD in measurement mode
canvasSec.addEventListener('mousemove', function (e) {
    if (!appState.secciones || !appState.transform) return;
    if (appState.measurement.mode === 'none') return;

    const pos = getPos(e);
    const cam = appState.cameras.seccion;
    const rect = canvasSec.getBoundingClientRect();

    const vx = ((pos.x - rect.left) * window.devicePixelRatio - cam.x) / cam.zoom;
    const vy = ((pos.y - rect.top) * window.devicePixelRatio - cam.y) / cam.zoom;

    const rx = ((vx - appState.transform.mx) / appState.transform.scale) + appState.transform.minX;
    const ry = ((canvasSec.height - vy - appState.transform.my) / appState.transform.scale) + appState.transform.minY;

    // Try snap
    const snap = findSnapPoint(rx, ry);
    const finalX = snap ? snap.x : rx;
    const finalY = snap ? snap.y : ry;

    appState.snap.point = snap;
    appState.lastMarker = { x: finalX, y: finalY };

    // Update HUD coordinates
    const hud = document.getElementById('hud');
    if (hud) {
        hud.style.display = 'flex';
        // In point mode with a placed point, freeze HUD to the clicked coordinates
        if (appState.measurement.mode === 'point' && appState.measurement.points.length >= 1) {
            const pt = appState.measurement.points[0];
            document.getElementById('hudX').textContent = pt.x.toFixed(2);
            document.getElementById('hudY').textContent = pt.y.toFixed(2);
        } else if (appState.measurement.mode === 'point') {
            document.getElementById('hudX').textContent = finalX.toFixed(2);
            document.getElementById('hudY').textContent = finalY.toFixed(2);
        }
        // For distance/slope: base X/Z are hidden, no update needed
    }

    // If we have P1 and mouse is moving, show live measurement
    if (appState.measurement.points.length === 1 && appState.measurement.mode !== 'point') {
        const p1 = appState.measurement.points[0];
        const p2 = { x: finalX, y: finalY };
        const dx = finalX - p1.x;
        const dy = finalY - p1.y;
        const dist = Math.hypot(dx, dy);
        const slope = dx !== 0 ? (dy / Math.abs(dx)) * 100 : Infinity;
        showMeasurementHUD(dx, dy, dist, slope, p1, p2);
        appState.measurement.result = { p1, p2, dx, dy, dist, slope };
    }

    syncAllViews();
});

function handleMeasurementTap(e) {
    if (appState.measurement.mode === 'none') return;

    const isTouch = e.type === 'touchstart';
    if (!isTouch && appState.isDragging &&
        (Math.abs(e.clientX - appState.lastMousePos.x) > 2 ||
            Math.abs(e.clientY - appState.lastMousePos.y) > 2)) {
        return;
    }

    const pos = getPos(e);
    const cam = appState.cameras.seccion;
    const rect = canvasSec.getBoundingClientRect();

    const vx = ((pos.x - rect.left) * window.devicePixelRatio - cam.x) / cam.zoom;
    const vy = ((pos.y - rect.top) * window.devicePixelRatio - cam.y) / cam.zoom;

    const rx = ((vx - appState.transform.mx) / appState.transform.scale) + appState.transform.minX;
    const ry = ((canvasSec.height - vy - appState.transform.my) / appState.transform.scale) + appState.transform.minY;

    // Use snap if available
    const snap = findSnapPoint(rx, ry);
    const clickX = snap ? snap.x : rx;
    const clickY = snap ? snap.y : ry;

    // ════════════ CHECK PIN HIT-TEST (READ NOTE) ════════════
    const sec = appState.secciones[appState.currentIdx];
    if (sec && sec.pins && sec.pins.length > 0) {
        const scaleFactor = appState.transform.scale * cam.zoom;
        for (let p of sec.pins) {
            const dx = (rx - p.x) * scaleFactor;
            const dy = (ry - p.y) * scaleFactor;
            if ((dx * dx + dy * dy) <= 225) { // 15px radius squared
                const viewModal = document.getElementById('pinViewModal');

                // Buscar global ID si no lo tiene directamente pegado (compatibilidad)
                let gId = p.globalId;
                if (gId === undefined && appState.notas) {
                    const matchedGlobalNote = appState.notas.find(n => n.idx === appState.currentIdx && n.text === p.text);
                    if (matchedGlobalNote) gId = matchedGlobalNote.id;
                }

                const pinHud = document.getElementById('pinHud');
                if (pinHud) {
                    window._currentViewingPinDetails = {
                        globalId: gId,
                        idx: appState.currentIdx,
                        text: p.text
                    };

                    const sec = appState.secciones[appState.currentIdx];
                    const pkRaw = sec.km !== undefined ? sec.km : (sec.k !== undefined ? sec.k : 'N/A');
                    const pkNum = parseFloat(pkRaw);
                    const pkText = !isNaN(pkNum) ? `${Math.floor(pkNum / 1000)}+${(pkNum % 1000).toFixed(0).padStart(3, '0')}` : pkRaw;

                    document.getElementById('pinHudTitle').innerHTML = `<span class="note-icon">📍</span> Nota PK ${pkText}`;
                    document.getElementById('pinHudText').textContent = p.text;

                    // Asegurar que cerramos el otro menu transparente por las dudas
                    const viewModal = document.getElementById('pinViewModal');
                    if (viewModal) viewModal.style.display = 'none';

                    pinHud.style.display = 'flex';
                    if (appState.measurement.mode === 'pin') cancelMeasurement(); // Stop dropping pins accidentally
                }
                return; // Stop processing the click
            }
        }
    }

    if (appState.measurement.mode === 'none') return;

    if (appState.measurement.mode === 'point') {
        // Point mode: show coordinates and immediately freeze HUD
        appState.measurement.points = [{ x: clickX, y: clickY }];
        const hud = document.getElementById('hud');
        if (hud) {
            hud.style.display = 'flex';
            document.getElementById('hudX').textContent = clickX.toFixed(2);
            document.getElementById('hudY').textContent = clickY.toFixed(2);
        }
        showNotification(`📍 X: ${clickX.toFixed(3)}  Z: ${clickY.toFixed(3)}`);
    } else if (appState.measurement.mode === 'pin') {
        // Pin Mode: Open Custom HTML Modal
        window._pendingPin = { x: clickX, y: clickY };
        const modal = document.getElementById('pinEditHud');
        const txtArea = document.getElementById('txtPinNote');
        if (modal && txtArea) {
            txtArea.value = '';
            modal.style.display = 'flex';
            setTimeout(() => txtArea.focus(), 50); // Focus for easy typing
        }
    } else {
        // Distance / Slope mode: two-point measurement
        if (appState.measurement.points.length === 0) {
            // First point
            appState.measurement.points.push({ x: clickX, y: clickY });
            showNotification('📍 P1 fijado — Click/Tap en P2');
        } else if (appState.measurement.points.length === 1) {
            // Second point — compute result
            const p1 = appState.measurement.points[0];
            const p2 = { x: clickX, y: clickY };
            const dx = clickX - p1.x;
            const dy = clickY - p1.y;
            const dist = Math.hypot(dx, dy);
            const slope = dx !== 0 ? (dy / Math.abs(dx)) * 100 : Infinity;

            appState.measurement.points.push(p2);
            appState.measurement.result = { p1, p2, dx, dy, dist, slope };

            showMeasurementHUD(dx, dy, dist, slope, p1, p2);

            if (appState.measurement.mode === 'distance') {
                showNotification(`📏 D = ${dist.toFixed(3)} m`);
            } else {
                showNotification(`📐 Pendiente = ${isFinite(slope) ? slope.toFixed(2) : '∞'} %`);
            }
        } else {
            // Reset and start new measurement
            appState.measurement.points = [{ x: clickX, y: clickY }];
            appState.measurement.result = null;
            hideMeasurementHUD();
            showNotification('📍 P1 fijado — Click/Tap en P2');
        }
    }

    syncAllViews();
}

// Click and Touch handlers for measurement
canvasSec.addEventListener('click', handleMeasurementTap);
canvasSec.addEventListener('touchstart', (e) => {
    if (e.touches.length === 1 && appState.measurement.mode !== 'none') {
        setTimeout(() => {
            if (!isPanning && !distInicial) {
                handleMeasurementTap(e);
            }
        }, 50); // slight delay to avoid conflicts with pinch to zoom
    }
}, { passive: true });

// Pan prevention for measurement mode is handled directly in handleStart()

// ═══════════ PIN NOTE UI FLOW ═══════════
function closePinModal() {
    const modal = document.getElementById('pinEditHud');
    if (modal) modal.style.display = 'none';
    window._pendingPin = null;
    window._editingPinDetails = null;
    cancelMeasurement();
}

function iniciarEdicionNota() {
    const viewModal = document.getElementById('pinViewModal');
    if (viewModal) viewModal.style.display = 'none';

    const pinHud = document.getElementById('pinHud');
    if (pinHud) pinHud.style.display = 'none';

    if (window._currentViewingPinDetails) {
        window._editingPinDetails = window._currentViewingPinDetails;

        const modal = document.getElementById('pinEditHud');
        const txtArea = document.getElementById('txtPinNote');
        if (modal && txtArea) {
            txtArea.value = window._currentViewingPinDetails.text;
            modal.style.display = 'flex';
            setTimeout(() => txtArea.focus(), 50);
        }
    }
}

function savePinNote() {
    const txtArea = document.getElementById('txtPinNote');
    const noteText = txtArea ? txtArea.value.trim() : '';
    if (!noteText) { closePinModal(); return; }

    if (window._editingPinDetails) {
        // EN MODO EDICIÓN
        const gNote = appState.notas.find(n => n.id === window._editingPinDetails.globalId);
        if (gNote) gNote.text = noteText;

        const sec = appState.secciones[window._editingPinDetails.idx];
        if (sec && sec.pins) {
            const lNote = sec.pins.find(p => p.globalId === window._editingPinDetails.globalId);
            if (lNote) lNote.text = noteText;
        }

        if (typeof renderNotesList === 'function') renderNotesList();
        showNotification(`✏️ Nota guardada exitosamente`);
    } else if (window._pendingPin) {
        // EN MODO CREACIÓN
        const sec = appState.secciones[appState.currentIdx];
        if (!sec.pins) sec.pins = [];

        const localId = sec.pins.length + 1;
        const globalId = appState.notaCounter++;

        sec.pins.push({
            id: localId,
            globalId: globalId,
            x: window._pendingPin.x,
            y: window._pendingPin.y,
            text: noteText
        });

        const pkLabel = sec.km !== undefined ? sec.km : (sec.k !== undefined ? sec.k : 'N/A');
        appState.notas.push({
            id: globalId,
            localId: localId,
            idx: appState.currentIdx,
            pk: pkLabel,
            text: noteText,
            date: new Date().toLocaleString()
        });

        if (typeof renderNotesList === 'function') renderNotesList();
        showNotification(`📍 Nota #${localId} agregada al listado`);
    }

    closePinModal();
    syncAllViews(); // Force canvas redraw to show the newly edited/created pin
}

// ═══════════ NOTES LIST DRAWER ═══════════
function toggleNotesPanel() {
    const panel = document.getElementById('notesPanel');
    const btn = document.getElementById('btnToolNotesList');
    if (panel) {
        panel.classList.toggle('open');
        const isOpen = panel.classList.contains('open');
        if (isOpen) {
            renderNotesList();
            document.body.classList.remove('sidebar-open'); // Close main sidebar on mobile if open
        }
        if (btn) btn.classList.toggle('active', isOpen);
    }
}

function renderNotesList() {
    const listContainer = document.getElementById('notesListContainer');
    const emptyState = document.getElementById('notesEmptyState');
    if (!listContainer || !emptyState) return;

    listContainer.innerHTML = '';

    if (!appState.notas || appState.notas.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

    // Reverse to show newest on top
    const notasToDisplay = [...appState.notas].reverse();

    notasToDisplay.forEach(nota => {
        const pkNum = parseFloat(nota.pk);
        const pkText = !isNaN(pkNum) ?
            `${Math.floor(pkNum / 1000)}+${(pkNum % 1000).toFixed(0).padStart(3, '0')}` :
            nota.pk;

        const card = document.createElement('div');
        card.className = 'note-card';
        card.onclick = () => irANota(nota.idx, nota.id);

        card.innerHTML = `
            <div class="note-card-header">
                <span class="note-card-pk">PK ${pkText}</span>
                <span class="note-card-date">${nota.date.split(',')[0]}</span>
            </div>
            <div class="note-card-text">${nota.text}</div>
        `;
        listContainer.appendChild(card);
    });
}

function irANota(targetIdx, notaGlobalId) {
    if (targetIdx >= 0 && targetIdx < appState.secciones.length) {
        appState.currentIdx = targetIdx;
        const slider = document.getElementById('stationSlider');
        if (slider) slider.value = targetIdx;
        syncAllViews();

        const panel = document.getElementById('notesPanel');
        if (panel && panel.classList.contains('open')) {
            toggleNotesPanel(); // Close drawer
        }

        // Open HUD immediately to view the note
        const globalNote = appState.notas.find(n => n.id === notaGlobalId);
        if (globalNote) {
            window._currentViewingPinDetails = {
                globalId: globalNote.id,
                idx: globalNote.idx,
                text: globalNote.text
            };
            const pinHud = document.getElementById('pinHud');
            if (pinHud) {
                const pkNum = parseFloat(globalNote.pk);
                const pkText = !isNaN(pkNum) ? `${Math.floor(pkNum / 1000)}+${(pkNum % 1000).toFixed(0).padStart(3, '0')}` : globalNote.pk;
                document.getElementById('pinHudTitle').innerHTML = `<span class="note-icon">📍</span> Nota PK ${pkText}`;
                document.getElementById('pinHudText').textContent = globalNote.text;

                // Ensure legacy modal is closed
                const viewModal = document.getElementById('pinViewModal');
                if (viewModal) viewModal.style.display = 'none';

                pinHud.style.display = 'flex';
            }
        }
    }
}

function closePinHud() {
    const pinHud = document.getElementById('pinHud');
    if (pinHud) pinHud.style.display = 'none';
}

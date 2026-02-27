// js/planta.js — Plan View Renderer

function dibujarPlanta() {
    const canvas = document.getElementById('canvasPlanta');
    if (!canvas || !appState.planta) return;
    const ctx = canvas.getContext('2d');

    const isLight = appConfig.general.theme === 'light';
    const isMobileDevice = window.innerWidth <= 1024;
    const baseScale = isMobileDevice ? 1.5 : (12 / 13);
    const escalaTxt = (appConfig.general.textScale || 1.0) * baseScale;

    const colors = {
        grid: isLight ? '#e2e4ea' : 'rgba(255,255,255,0.08)',
        text: isLight ? '#666' : '#999',
        point: isLight ? '#e91e63' : '#ffeb3b',
        txtPK: isLight ? '#1a1a2e' : '#f0f0f5'
    };

    const verEtiquetas = appConfig.planta.showLabels !== false;
    const intMajor = appConfig.planta.ticksMajor || 1000;
    const intMinor = appConfig.planta.ticksMinor || 100;

    const rect = canvas.parentNode.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    const W = canvas.width, H = canvas.height;
    if (W === 0 || H === 0) return;

    ctx.clearRect(0, 0, W, H);

    // Data
    if (!appState.proyectos || appState.proyectos.length === 0) return;

    // Scales
    const { minE, maxE, minN, maxN } = appState.encuadre.planta;
    const centroE = (minE + maxE) / 2;
    const centroN = (minN + maxN) / 2;
    const scale = Math.min(W / ((maxE - minE) * 1.2), H / ((maxN - minN) * 1.2));
    if (!Number.isFinite(scale) || scale <= 0) return;

    const toX = (e) => (W / 2) + (e - centroE) * scale;
    const toY = (n) => (H / 2) - (n - centroN) * scale;

    const cam = appState.cameras.planta;

    // ════════════ PHASE 1: WORLD SPACE ════════════
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    // Grid
    const dashboard = document.getElementById('main-dashboard');
    const esModoMini = dashboard && dashboard.classList.contains('layout-multi');
    let gSize = esModoMini ? (appConfig.planta.gridIntervalMulti || 500) : (appConfig.planta.gridInterval || 200);
    if (gSize <= 0) gSize = 100;

    const viewLeft = -cam.x / cam.zoom;
    const viewTop = -cam.y / cam.zoom;
    const viewRight = (W - cam.x) / cam.zoom;
    const viewBottom = (H - cam.y) / cam.zoom;

    const startE_aprox = centroE + (viewLeft - W / 2) / scale;
    const endE_aprox = centroE + (viewRight - W / 2) / scale;
    const startN_aprox = centroN - (viewBottom - H / 2) / scale;
    const endN_aprox = centroN - (viewTop - H / 2) / scale;

    const startE = Math.floor(startE_aprox / gSize) * gSize - gSize;
    const endE = Math.ceil(endE_aprox / gSize) * gSize + gSize;
    const startN = Math.floor(startN_aprox / gSize) * gSize - gSize;
    const endN = Math.ceil(endN_aprox / gSize) * gSize + gSize;

    // ════════════ SATELLITE MAP RENDERER ════════════
    if (appConfig.planta.showMap && appConfig.planta.utmZone && typeof proj4 !== 'undefined') {
        const zoneStr = appConfig.planta.utmZone.toUpperCase();
        const hemi = zoneStr.includes('S') ? '+south' : '';
        const zoneNum = zoneStr.replace(/[^0-9]/g, '');

        // Define UTM projection dynamically based on user input
        proj4.defs('USER_UTM', `+proj=utm +zone=${zoneNum} ${hemi} +datum=WGS84 +units=m +no_defs`);

        // Helper: Convert Lat/Lon to Tile X/Y at given zoom level
        const lonToTileX = (lon, z) => Math.floor((lon + 180) / 360 * Math.pow(2, z));
        const latToTileY = (lat, z) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, z));

        // Render Tile Cache
        if (!window.mapTileCache) window.mapTileCache = {};

        // 1. Calculate the geographic bounding box of the current view
        try {
            const botLeftLatLon = proj4('USER_UTM', 'WGS84', [startE_aprox, startN_aprox]);
            const topRightLatLon = proj4('USER_UTM', 'WGS84', [endE_aprox, endN_aprox]);

            // 2. Determine an appropriate zoom level based on pixel scale
            const centerLat = (botLeftLatLon[1] + topRightLatLon[1]) / 2;
            const metersPerCanvasPx = 1 / scale;
            const tileResAtZoom0 = (40075016.686 / 256) * Math.cos(centerLat * Math.PI / 180);

            // We want tile resolution to closely match real canvas physical resolution
            let mapZoom = Math.round(Math.log2(tileResAtZoom0 / metersPerCanvasPx));

            // Limit zoom to available Google Maps ranges
            if (mapZoom < 5) mapZoom = 5;
            if (mapZoom > 21) mapZoom = 21;

            // 3. Find tile boundaries
            const minX = Math.min(lonToTileX(botLeftLatLon[0], mapZoom), lonToTileX(topRightLatLon[0], mapZoom));
            const maxX = Math.max(lonToTileX(botLeftLatLon[0], mapZoom), lonToTileX(topRightLatLon[0], mapZoom));
            const minY = Math.min(latToTileY(botLeftLatLon[1], mapZoom), latToTileY(topRightLatLon[1], mapZoom));
            const maxY = Math.max(latToTileY(botLeftLatLon[1], mapZoom), latToTileY(topRightLatLon[1], mapZoom));

            // Helper: Convert Tile X/Y back to Lat/Lon for drawing boundaries
            const tileXToLon = (x, z) => x / Math.pow(2, z) * 360 - 180;
            const tileYToLat = (y, z) => {
                const n = Math.PI - 2 * Math.PI * y / Math.pow(2, z);
                return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
            };

            // 4. Load and draw tiles
            ctx.globalAlpha = appConfig.planta.mapOpacity ?? 0.8;

            for (let x = minX; x <= maxX; x++) {
                for (let y = minY; y <= maxY; y++) {
                    const mType = appConfig.planta.mapType || 's';
                    const url = `https://mt1.google.com/vt/lyrs=${mType}&x=${x}&y=${y}&z=${mapZoom}`;

                    // Tile bounds in Lat/Lon
                    const tlLatLon = [tileXToLon(x, mapZoom), tileYToLat(y, mapZoom)];
                    const brLatLon = [tileXToLon(x + 1, mapZoom), tileYToLat(y + 1, mapZoom)];

                    // Tile bounds back to UTM (projected coordinates)
                    const tlUTM = proj4('WGS84', 'USER_UTM', tlLatLon);
                    const brUTM = proj4('WGS84', 'USER_UTM', brLatLon);

                    // Tile bounds in Canvas coordinates
                    const drawX = toX(tlUTM[0]);
                    const drawY = toY(tlUTM[1]); // Note: In UTM, North is up. Canvas, Y is down.
                    const drawW = toX(brUTM[0]) - drawX;
                    const drawH = toY(brUTM[1]) - drawY;

                    // Cache check
                    if (!window.mapTileCache[url]) {
                        // Create and load image
                        const img = new Image();
                        img.crossOrigin = "Anonymous";
                        img.src = url;
                        // Initial placeholder box while loading
                        ctx.fillStyle = 'rgba(20, 20, 30, 0.5)';
                        ctx.fillRect(drawX, drawY, drawW, drawH);

                        img.onload = () => {
                            window.mapTileCache[url] = img;
                            // Request a redraw once tile loads
                            requestAnimationFrame(syncAllViews);
                        };
                        // Mark as loading to avoid duplicate requests
                        window.mapTileCache[url] = "loading";
                    } else if (window.mapTileCache[url] !== "loading") {
                        // Draw cached image
                        ctx.drawImage(window.mapTileCache[url], drawX, drawY, drawW, drawH);
                    }
                }
            }
            ctx.globalAlpha = 1.0;
        } catch (e) {
            console.error("Proj4 Error computing map tiles:", e);
        }
    }

    // ════════════ GRID LAYER ════════════
    if (appConfig.planta.showGrid !== false) {
        ctx.lineWidth = 0.5 / cam.zoom;
        // Adjust grid color based on map type (light maps need darker grid, dark maps need lighter grid)
        const isDarkMap = appConfig.planta.showMap && (!appConfig.planta.mapType || appConfig.planta.mapType === 's' || appConfig.planta.mapType === 'y');
        ctx.strokeStyle = isDarkMap ? 'rgba(255, 255, 255, 0.4)' : colors.grid;
        for (let e = startE; e <= endE; e += gSize) {
            const x = toX(e);
            ctx.beginPath(); ctx.moveTo(x, -50000); ctx.lineTo(x, 50000); ctx.stroke();
        }
        for (let n = startN; n <= endN; n += gSize) {
            const y = toY(n);
            ctx.beginPath(); ctx.moveTo(-50000, y); ctx.lineTo(50000, y); ctx.stroke();
        }
    }

    // ════════════ ALIGNMENTS (Ejes) ════════════
    appState.proyectos.forEach(proy => {
        if (!proy.visible) return;
        const isActive = proy.id === appState.proyectoActivoId;
        const raw = proy.data;
        const trazo = raw.planta_trazo || raw.geometria || raw.planta || [];
        if (!trazo || trazo.length === 0) return;

        const colorEje = isActive ? (appConfig.layers?.planta?.['Eje']?.color || (isLight ? '#0066ff' : '#00e5ff')) : (isLight ? '#a0aabf' : '#333344');
        const widthEje = isActive ? (appConfig.layers?.planta?.['Eje']?.width || 2.5) : 1.5;

        ctx.beginPath();
        ctx.strokeStyle = colorEje;
        ctx.lineWidth = widthEje / cam.zoom;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        const esArray3 = Array.isArray(trazo[0]) && trazo[0].length === 3;
        const esArray2 = Array.isArray(trazo[0]) && trazo[0].length === 2;

        trazo.forEach((pt, i) => {
            let x, y;
            if (esArray3) { x = pt[1]; y = pt[2]; }
            else if (esArray2) { x = pt[0]; y = pt[1]; }
            else { x = pt.x || pt.e; y = pt.y || pt.n; }
            if (i === 0) ctx.moveTo(toX(x), toY(y));
            else ctx.lineTo(toX(x), toY(y));
        });
        ctx.stroke();

        // Ticks - Only draw if active
        if (isActive && esArray3) {
            ctx.fillStyle = isLight ? '#000' : '#fff';
            ctx.font = `${(10 * escalaTxt) / cam.zoom}px "Inter", sans-serif`;
            const sizeMajor = 8 / cam.zoom;
            const sizeMinor = 4 / cam.zoom;
            const verTicks = appConfig.planta.showTicks !== false;

            for (let i = 0; i < trazo.length - 1; i++) {
                const p1 = trazo[i], p2 = trazo[i + 1];
                const k1 = p1[0], k2 = p2[0];
                if (k2 <= k1) continue;

                const nextMajor = Math.ceil(k1 / intMajor) * intMajor;
                if (nextMajor <= k2) {
                    drawTick(ctx, p1, p2, nextMajor, sizeMajor, true, verEtiquetas, verTicks, toX, toY, cam, isLight);
                }
                let kScan = Math.ceil(k1 / intMinor) * intMinor;
                while (kScan <= k2) {
                    if (kScan % intMajor !== 0) {
                        drawTick(ctx, p1, p2, kScan, sizeMinor, false, false, verTicks, toX, toY, cam, isLight);
                    }
                    kScan += intMinor;
                }
            }
        }
    });

    // Current station point
    if (appState.secciones && appState.secciones.length > 0) {
        const secActual = appState.secciones[appState.currentIdx];
        const mActual = secActual.k || secActual.km || 0;
        let pRef = null;

        const trazo = appState.planta?.planta_trazo || appState.planta?.geometria || appState.planta?.planta || [];
        const hitos = appState.planta?.planta_hitos || [];
        const esArray3 = trazo.length > 0 && Array.isArray(trazo[0]) && trazo[0].length === 3;

        if (esArray3) {
            pRef = trazo.reduce((prev, curr) => (Math.abs(curr[0] - mActual) < Math.abs(prev[0] - mActual) ? curr : prev));
            if (pRef && Math.abs(pRef[0] - mActual) < 50) pRef = { x: pRef[1], y: pRef[2] };
            else pRef = null;
        }
        if (!pRef && hitos.length > 0) {
            const hito = hitos.find(h => Math.abs(h.k - mActual) < 2);
            if (hito) pRef = { x: hito.x, y: hito.y };
        }

        if (pRef) {
            // Glow
            const gradient = ctx.createRadialGradient(toX(pRef.x), toY(pRef.y), 0, toX(pRef.x), toY(pRef.y), 15 / cam.zoom);
            gradient.addColorStop(0, 'rgba(233, 30, 99, 0.4)');
            gradient.addColorStop(1, 'rgba(233, 30, 99, 0)');
            ctx.fillStyle = gradient;
            ctx.beginPath(); ctx.arc(toX(pRef.x), toY(pRef.y), 15 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            // Point
            ctx.fillStyle = colors.point;
            ctx.beginPath(); ctx.arc(toX(pRef.x), toY(pRef.y), 8 / cam.zoom, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = isLight ? '#fff' : '#000';
            ctx.lineWidth = 2.0 / cam.zoom;
            ctx.stroke();

            // Label
            ctx.fillStyle = colors.txtPK;
            ctx.font = `bold ${(15 * escalaTxt) / cam.zoom}px "Inter", sans-serif`;
            ctx.textAlign = 'left';
            const kE = Math.floor(mActual / 1000);
            const kM = Math.abs(mActual % 1000).toFixed(0).padStart(3, '0');
            ctx.fillText(`PK ${kE}+${kM}`, toX(pRef.x) + 10 / cam.zoom, toY(pRef.y) - 2 / cam.zoom);
        }
    }

    ctx.restore();

    // ════════════ PHASE 2: SCREEN-SPACE HUD ════════════
    if (appConfig.planta.showGrid !== false) {
        const gapX = 14, gapTop = 14, gapBottom = 16;
        ctx.font = `${13 * escalaTxt}px "JetBrains Mono", monospace`;
        ctx.fillStyle = colors.text;

        const worldToScreenX = (eVal) => (toX(eVal) * cam.zoom) + cam.x;
        const worldToScreenY = (nVal) => (toY(nVal) * cam.zoom) + cam.y;

        for (let e = startE; e <= endE; e += gSize) {
            const sx = worldToScreenX(e);
            if (sx > -20 && sx < W + 20) {
                ctx.textAlign = 'center';
                ctx.textBaseline = 'bottom';
                ctx.fillText(e.toFixed(0), sx, H - gapBottom);
                ctx.textBaseline = 'top';
                ctx.fillText(e.toFixed(0), sx, gapTop);
            }
        }

        for (let n = startN; n <= endN; n += gSize) {
            const sy = worldToScreenY(n);
            if (sy > -20 && sy < H + 20) {
                ctx.textBaseline = 'middle';
                ctx.textAlign = 'left';
                ctx.fillText(n.toFixed(0), gapX, sy);
                ctx.textAlign = 'right';
                ctx.fillText(n.toFixed(0), W - gapX, sy);
            }
        }
    }
}

// Tick drawing helper
function drawTick(ctx, p1, p2, targetK, size, isMajor, showLabel, showLine, toX, toY, cam, isLight) {
    const k1 = p1[0], x1 = p1[1], y1 = p1[2];
    const k2 = p2[0], x2 = p2[1], y2 = p2[2];
    const fraction = (targetK - k1) / (k2 - k1);
    const x = x1 + (x2 - x1) * fraction;
    const y = y1 + (y2 - y1) * fraction;

    const sx = toX(x), sy = toY(y);
    const sx1 = toX(x1), sy1 = toY(y1);
    const sx2 = toX(x2), sy2 = toY(y2);

    const dx = sx2 - sx1;
    const dy = sy2 - sy1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len === 0) return;

    const px = -dy / len;
    const py = dx / len;

    if (showLine) {
        ctx.beginPath();
        ctx.strokeStyle = isLight ? '#888' : '#555';
        ctx.lineWidth = 0.8 / cam.zoom;
        ctx.moveTo(sx + px * size, sy + py * size);
        ctx.lineTo(sx - px * size, sy - py * size);
        ctx.stroke();
    }

    if (isMajor && showLabel) {
        const kEntero = Math.floor(targetK / 1000);
        const kMetros = Math.abs(targetK % 1000).toFixed(0).padStart(3, '0');
        const textoPK = `${kEntero}+${kMetros}`;

        ctx.fillStyle = isLight ? '#333' : '#ccc';
        ctx.save();
        ctx.translate(sx + px * (size + 5 / cam.zoom), sy + py * (size + 5 / cam.zoom));
        let angle = Math.atan2(dy, dx) - Math.PI / 2;
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) angle += Math.PI;
        ctx.rotate(angle);
        ctx.textAlign = 'center';
        ctx.fillText(textoPK, 0, 0);
        ctx.restore();
    }
}

// ════════════ INDEPENDENT GPS LAYER ════════════
// Renders only the GPS dot on the transparent overlay canvas to prevent full scene redraws
function dibujarGPS() {
    const canvas = document.getElementById('canvasPlantaGPS');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    // Clear entire overlay canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!appState.gps || !appState.gps.active || appState.gps.e === null || appState.gps.n === null) {
        return; // Nothing to draw if gps is off or hasn't locked
    }

    const isLight = document.body.classList.contains('light-mode');
    const cam = appState.cameras.planta || { x: 0, y: 0, zoom: 1 };

    // Limits and center (same logic as main canvas to perfectly align)
    let minE = 0, maxE = 1000, minN = 0, maxN = 1000;
    if (appState.encuadre && appState.encuadre.planta) {
        ({ minE, maxE, minN, maxN } = appState.encuadre.planta);
    }
    const centroE = (minE + maxE) / 2;
    const centroN = (minN + maxN) / 2;

    // Dynamic scale to fit canvas
    const W = canvas.width;
    const H = canvas.height;
    const padding = 1.2;
    const scale = Math.min(W / ((maxE - minE) * padding), H / ((maxN - minN) * padding));

    const toX = (e) => ((W / 2) + (e - centroE) * scale) * cam.zoom + cam.x;
    const toY = (n) => ((H / 2) - (n - centroN) * scale) * cam.zoom + cam.y;

    const gpsX = toX(appState.gps.e);
    const gpsY = toY(appState.gps.n);

    // Apply zoom scaling to the dot so it stays relative (but impose a minimum size so it's always visible)
    const baseZoom = Math.max(0.5, cam.zoom);

    // Fixed Halo Glow 
    ctx.fillStyle = isLight ? 'rgba(0, 102, 255, 0.25)' : 'rgba(0, 229, 255, 0.25)';
    ctx.beginPath();
    ctx.arc(gpsX, gpsY, 20 * baseZoom, 0, Math.PI * 2); // Subtle glow
    ctx.fill();

    // White border for center dot
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(gpsX, gpsY, 6 * baseZoom, 0, Math.PI * 2);
    ctx.fill();

    // Blue dot center
    ctx.fillStyle = isLight ? '#0066ff' : '#00e5ff';
    ctx.beginPath();
    ctx.arc(gpsX, gpsY, 4 * baseZoom, 0, Math.PI * 2);
    ctx.fill();

    // subtle shadow for depth
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
}

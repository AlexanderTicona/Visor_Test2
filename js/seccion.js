// js/seccion.js — Cross-Section View Renderer

function dibujarSeccion(seccion) {
    const canvas = document.getElementById('visorCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const isLight = appConfig.general.theme === 'light';
    const isMobileDevice = window.innerWidth <= 1024;
    const baseScale = isMobileDevice ? 1.5 : (12 / 13);
    const escalaTxt = (appConfig.general.textScale || 1.0) * baseScale;

    // Color palette
    const colors = {
        grid: isLight ? '#e2e4ea' : 'rgba(255,255,255,0.08)',
        gridAxis: isLight ? 'rgba(0,102,255,0.4)' : 'rgba(0,229,255,0.3)',
        text: isLight ? '#666' : '#999',
        textAxis: isLight ? '#0066ff' : '#00e5ff',
        cursor: isLight ? '#0066ff' : '#00e5ff',
        cursorRing: isLight ? 'rgba(0,102,255,0.2)' : 'rgba(0,229,255,0.15)'
    };

    const W = canvas.width, H = canvas.height;
    if (W === 0 || H === 0) return;

    ctx.clearRect(0, 0, W, H);
    if (!seccion) return;

    // 1. Calculate bounds
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const escanear = (listas) => {
        if (!listas) return;
        listas.forEach(obj => {
            const arr = Array.isArray(obj) ? obj : (obj.p || []);
            for (let i = 0; i < arr.length; i += 2) {
                const x = arr[i], y = arr[i + 1];
                if (x < minX) minX = x; if (x > maxX) maxX = x;
                if (y < minY) minY = y; if (y > maxY) maxY = y;
            }
        });
    };
    escanear(seccion.t);
    escanear(seccion.c);

    if (minY > maxY) { minY = 0; maxY = 10; minX = -10; maxX = 10; }

    const rangeX = (maxX - minX) * 1.1;
    const rangeY = (maxY - minY) * 1.3;
    const scale = Math.min(W / rangeX, H / rangeY);
    if (!Number.isFinite(scale) || scale <= 0) return;
    const marginX = (W - (maxX - minX) * scale) / 2;
    const marginY = (H - (maxY - minY) * scale) / 2;

    appState.transform = { minX, minY, scale, mx: marginX, my: marginY };

    const toX = (v) => marginX + (v - minX) * scale;
    const toY = (v) => H - (marginY + (v - minY) * scale);

    const cam = appState.cameras.seccion;

    // ════════════ PHASE 1: WORLD SPACE ════════════
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    // Grid
    let gX = appConfig.seccion.gridX || 5; if (gX <= 0) gX = 5;
    let gY = appConfig.seccion.gridY || 5; if (gY <= 0) gY = 5;

    const centroX = (minX + maxX) / 2;
    const centroY = (minY + maxY) / 2;
    const sX = Math.floor((centroX - (W / scale) / cam.zoom) / gX) * gX;
    const eX = sX + (W * 2 / scale) / cam.zoom;
    const sY = Math.floor((centroY - (H / scale) / cam.zoom) / gY) * gY;
    const eY = sY + (H * 2 / scale) / cam.zoom;

    // Vertical grid lines
    for (let x = sX; x <= eX; x += gX) {
        const sx = toX(x);
        const esEje = Math.abs(x) < 0.01;
        ctx.strokeStyle = esEje ? colors.gridAxis : colors.grid;
        ctx.lineWidth = (esEje ? 1.5 : 0.5) / cam.zoom;
        ctx.beginPath(); ctx.moveTo(sx, -50000); ctx.lineTo(sx, 50000); ctx.stroke();
    }

    // Horizontal grid lines
    for (let y = sY; y <= eY; y += gY) {
        const sy = toY(y);
        ctx.strokeStyle = colors.grid;
        ctx.lineWidth = 0.5 / cam.zoom;
        ctx.beginPath(); ctx.moveTo(-50000, sy); ctx.lineTo(50000, sy); ctx.stroke();
    }

    // Draw layers
    if (appConfig.layers && appConfig.layers.seccion) {
        Object.values(appConfig.layers.seccion).forEach(layer => {
            if (!layer.visible) return;
            ctx.strokeStyle = layer.color;
            ctx.lineWidth = layer.width / cam.zoom;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            if (layer.type === 't' && seccion.t && seccion.t[layer.idx]) {
                const d = seccion.t[layer.idx];
                dibujarPolyFlat(ctx, Array.isArray(d) ? d : d.p, toX, toY);
            } else if (layer.type === 'c' && seccion.c) {
                seccion.c.forEach(obj => dibujarPolyFlat(ctx, Array.isArray(obj) ? obj : obj.p, toX, toY));
            }
        });
    } else {
        if (seccion.t) { ctx.strokeStyle = '#8b4513'; ctx.lineWidth = 2 / cam.zoom; seccion.t.forEach(o => dibujarPolyFlat(ctx, Array.isArray(o) ? o : o.p, toX, toY)); }
        if (seccion.c) { ctx.strokeStyle = '#0066ff'; ctx.lineWidth = 1.5 / cam.zoom; seccion.c.forEach(o => dibujarPolyFlat(ctx, Array.isArray(o) ? o : o.p, toX, toY)); }
    }

    // Crosshair / Snap cursor
    if (appState.lastMarker) {
        const px = toX(appState.lastMarker.x);
        const py = toY(appState.lastMarker.y);

        if (appState.snap.point && appState.snap.enabled) {
            // ═══ SNAP CURSOR: AutoCAD-style square vertex marker ═══
            const sz = 7 / cam.zoom;

            // Outer glow
            ctx.fillStyle = 'rgba(0,255,100,0.15)';
            ctx.beginPath(); ctx.arc(px, py, 12 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            // Square marker
            ctx.strokeStyle = '#00ff64';
            ctx.lineWidth = 2 / cam.zoom;
            ctx.strokeRect(px - sz, py - sz, sz * 2, sz * 2);

            // Center dot
            ctx.fillStyle = '#00ff64';
            ctx.beginPath(); ctx.arc(px, py, 2 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            // Crosshairs extending from square
            ctx.strokeStyle = '#00ff64';
            ctx.lineWidth = 1 / cam.zoom;
            ctx.globalAlpha = 0.5;
            const ext = 18 / cam.zoom;
            ctx.beginPath();
            ctx.moveTo(px - ext, py); ctx.lineTo(px - sz, py);
            ctx.moveTo(px + sz, py); ctx.lineTo(px + ext, py);
            ctx.moveTo(px, py - ext); ctx.lineTo(px, py - sz);
            ctx.moveTo(px, py + sz); ctx.lineTo(px, py + ext);
            ctx.stroke();
            ctx.globalAlpha = 1;
        } else {
            // ═══ FREE CURSOR: Dot + crosshair ═══
            ctx.fillStyle = colors.cursorRing;
            ctx.beginPath(); ctx.arc(px, py, 8 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            ctx.fillStyle = colors.cursor;
            ctx.beginPath(); ctx.arc(px, py, 3 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            ctx.strokeStyle = colors.cursor;
            ctx.lineWidth = 1 / cam.zoom;
            ctx.globalAlpha = 0.6;
            const s = 12 / cam.zoom;
            ctx.beginPath();
            ctx.moveTo(px - s, py); ctx.lineTo(px + s, py);
            ctx.moveTo(px, py - s); ctx.lineTo(px, py + s);
            ctx.stroke();
            ctx.globalAlpha = 1;
        }
    }

    // ═══ MEASUREMENT VISUALIZATION ═══
    const meas = appState.measurement;

    // Theme-aware colors for better contrast in light mode
    const colorCyan = isLight ? '#0055cc' : '#00e5ff';
    const colorYellow = isLight ? '#d97706' : '#ffd700';
    const colorYellowAlpha = isLight ? 'rgba(217, 119, 6, 0.4)' : 'rgba(255,215,0,0.3)';

    // Draw fixed P1 marker
    if (meas.points.length >= 1) {
        const p1x = toX(meas.points[0].x);
        const p1y = toY(meas.points[0].y);

        // P1 marker - filled circle with ring
        ctx.fillStyle = isLight ? 'rgba(217, 119, 6, 0.2)' : 'rgba(255,215,0,0.2)';
        ctx.beginPath(); ctx.arc(p1x, p1y, 10 / cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = colorYellow;
        ctx.beginPath(); ctx.arc(p1x, p1y, 4 / cam.zoom, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = colorYellow;
        ctx.lineWidth = 1.5 / cam.zoom;
        ctx.beginPath(); ctx.arc(p1x, p1y, 7 / cam.zoom, 0, Math.PI * 2); ctx.stroke();

        // Point mode: show coordinate label near the point
        if (meas.mode === 'point') {
            const fontSize = 12 / cam.zoom;
            ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;
            ctx.fillStyle = colorCyan;
            ctx.textAlign = 'left';
            ctx.textBaseline = 'top';
            const label = `X: ${meas.points[0].x.toFixed(3)}  Z: ${meas.points[0].y.toFixed(3)}`;
            ctx.fillText(label, p1x + 14 / cam.zoom, p1y + 14 / cam.zoom);
        }
    }

    // Draw measurement line and result (ONLY for distance/slope)
    if (meas.mode !== 'point' && meas.result && meas.result.p1 && meas.result.p2) {
        const p1x = toX(meas.result.p1.x);
        const p1y = toY(meas.result.p1.y);
        const p2x = toX(meas.result.p2.x);
        const p2y = toY(meas.result.p2.y);

        // Dashed measurement line
        ctx.strokeStyle = colorYellow;
        ctx.lineWidth = 1.5 / cam.zoom;
        ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dimension helpers (horizontal + vertical dashed lines)
        ctx.strokeStyle = colorYellowAlpha;
        ctx.lineWidth = 0.8 / cam.zoom;
        ctx.setLineDash([3 / cam.zoom, 3 / cam.zoom]);
        ctx.beginPath();
        ctx.moveTo(p1x, p1y);
        ctx.lineTo(p2x, p1y);
        ctx.lineTo(p2x, p2y);
        ctx.stroke();
        ctx.setLineDash([]);

        // On-canvas labels
        const fontSize = 13 / cam.zoom;
        ctx.font = `bold ${fontSize}px "JetBrains Mono", monospace`;

        // Mid-point and angle of the measurement line
        const midX = (p1x + p2x) / 2;
        const midY = (p1y + p2y) / 2;
        let angle = Math.atan2(p2y - p1y, p2x - p1x);

        // Keep text upright
        if (angle > Math.PI / 2 || angle < -Math.PI / 2) {
            angle += Math.PI;
        }

        ctx.save();
        ctx.translate(midX, midY);
        ctx.rotate(angle);

        let labelText = '';
        if (meas.mode === 'distance') {
            labelText = `D=${meas.result.dist.toFixed(2)}m`;
        } else if (meas.mode === 'slope') {
            const slopeVal = isFinite(meas.result.slope) ? meas.result.slope.toFixed(2) : '∞';
            labelText = `${slopeVal}%`;
        } // ΔX and ΔZ are intentionally omitted from canvas, showing only in HUD

        if (labelText) {
            // Draw background pill for text
            const textMetrics = ctx.measureText(labelText);
            const padX = 6 / cam.zoom;
            const padY = 4 / cam.zoom;
            const bgWidth = textMetrics.width + padX * 2;
            const bgHeight = fontSize + padY * 2;

            ctx.fillStyle = isLight ? 'rgba(255, 255, 255, 0.85)' : 'rgba(10, 10, 20, 0.85)';
            ctx.fillRect(-bgWidth / 2, -bgHeight / 2, bgWidth, bgHeight);

            // Draw text
            ctx.fillStyle = isLight ? '#1a1a2e' : '#ffffff'; // High contrast text
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(labelText, 0, 0);
        }

        ctx.restore();

        // P2 marker
        if (meas.points.length >= 2) {
            ctx.fillStyle = isLight ? 'rgba(0, 85, 204, 0.2)' : 'rgba(0,229,255,0.2)';
            ctx.beginPath(); ctx.arc(p2x, p2y, 10 / cam.zoom, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = colorCyan;
            ctx.beginPath(); ctx.arc(p2x, p2y, 4 / cam.zoom, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#00e5ff';
            ctx.lineWidth = 1.5 / cam.zoom;
            ctx.beginPath(); ctx.arc(p2x, p2y, 7 / cam.zoom, 0, Math.PI * 2); ctx.stroke();
        }
    }

    // ════════════ DRAW SAVED PINS ════════════
    if (seccion.pins && seccion.pins.length > 0) {
        seccion.pins.forEach(pin => {
            const px = toX(pin.x);
            const py = toY(pin.y);

            // Pin shadow/outer ring
            ctx.fillStyle = 'rgba(255, 152, 0, 0.3)';
            ctx.beginPath(); ctx.arc(px, py, 14 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            // Pin circle
            ctx.fillStyle = '#ff9800'; // Orange Warning Color
            ctx.beginPath(); ctx.arc(px, py, 9 / cam.zoom, 0, Math.PI * 2); ctx.fill();

            // Pin Border
            ctx.strokeStyle = isLight ? '#ffffff' : '#1a1a2e';
            ctx.lineWidth = 1.5 / cam.zoom;
            ctx.beginPath(); ctx.arc(px, py, 9 / cam.zoom, 0, Math.PI * 2); ctx.stroke();

            // Pin Number (Text)
            const fontSize = 11 / cam.zoom;
            ctx.font = `bold ${fontSize}px "Inter", sans-serif`;
            ctx.fillStyle = isLight ? '#ffffff' : '#1a1a2e';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(pin.id, px, py + (1 / cam.zoom)); // small offset for visual centering
        });
    }

    ctx.restore();

    // ════════════ PHASE 2: SCREEN-SPACE HUD ════════════
    const gapX = 14, gapY = 16;
    ctx.font = `${13 * escalaTxt}px "JetBrains Mono", monospace`;

    const worldToScreenX = (valX) => (toX(valX) * cam.zoom) + cam.x;
    const worldToScreenY = (valY) => (toY(valY) * cam.zoom) + cam.y;

    // Vertical labels (X offsets)
    for (let x = sX; x <= eX; x += gX) {
        const screenX = worldToScreenX(x);
        if (screenX > -20 && screenX < W + 20) {
            const esEje = Math.abs(x) < 0.01;
            ctx.fillStyle = esEje ? colors.textAxis : colors.text;
            ctx.textAlign = 'center';

            ctx.textBaseline = 'bottom';
            ctx.fillText(x.toFixed(1), screenX, H - gapY);

            ctx.textBaseline = 'top';
            ctx.fillText(x.toFixed(1), screenX, gapY);
        }
    }

    // Horizontal labels (Elevations)
    for (let y = sY; y <= eY; y += gY) {
        const screenY = worldToScreenY(y);
        if (screenY > -20 && screenY < H + 20) {
            ctx.fillStyle = colors.text;
            ctx.textBaseline = 'middle';

            ctx.textAlign = 'left';
            ctx.fillText(y.toFixed(1), gapX, screenY);

            ctx.textAlign = 'right';
            ctx.fillText(y.toFixed(1), W - gapX, screenY);
        }
    }
}

function dibujarPolyFlat(ctx, arr, toX, toY) {
    if (!arr || arr.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(toX(arr[0]), toY(arr[1]));
    for (let i = 2; i < arr.length; i += 2) {
        ctx.lineTo(toX(arr[i]), toY(arr[i + 1]));
    }
    ctx.stroke();
}

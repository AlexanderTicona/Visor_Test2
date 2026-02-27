// js/perfil.js — Profile View Renderer

function dibujarPerfil() {
    const canvas = document.getElementById('canvasPerfil');
    if (!canvas || !appState.perfil) return;
    const ctx = canvas.getContext('2d');

    const isLight = appConfig.general.theme === 'light';
    const isMobileDevice = window.innerWidth <= 1024;
    const baseScale = isMobileDevice ? 1.5 : (12 / 13);
    const escalaTxt = (appConfig.general.textScale || 1.0) * baseScale;

    const colors = {
        grid: isLight ? '#e2e4ea' : 'rgba(255,255,255,0.08)',
        text: isLight ? '#666' : '#999',
        txtPto: isLight ? '#1a1a2e' : '#f0f0f5'
    };

    const W = canvas.width, H = canvas.height;
    if (W === 0 || H === 0) return;

    ctx.clearRect(0, 0, W, H);

    const fmtPK = (val) => {
        const k = Math.floor(val / 1000);
        const m = Math.abs(val % 1000).toFixed(0).padStart(3, '0');
        return `${k}+${m}`;
    };

    // Data & scales
    const { minK, maxK, minZ, maxZ } = appState.encuadre.perfil;
    const centroK = (minK + maxK) / 2;
    const centroZ = (minZ + maxZ) / 2;
    const exajVertical = appConfig.perfil.exaj || 10;

    const rangeK = maxK - minK;
    const rangeZ = (maxZ - minZ) * exajVertical;
    const scale = Math.min(W / (rangeK * 1.1), H / (rangeZ * 1.1));
    if (!Number.isFinite(scale) || scale <= 0) return;

    const toX = (k) => (W / 2) + (k - centroK) * scale;
    const toY = (z) => (H / 2) - (z - centroZ) * exajVertical * scale;

    const cam = appState.cameras.perfil;

    const dashboard = document.getElementById('main-dashboard');
    const esModoMini = dashboard && dashboard.classList.contains('layout-multi');

    let gStepK = esModoMini ? (appConfig.perfil.gridKMulti || 1000) : (appConfig.perfil.gridK || 100);
    let gStepZ = esModoMini ? (appConfig.perfil.gridZMulti || 50) : (appConfig.perfil.gridZ || 5);
    if (gStepK <= 0) gStepK = 100;
    if (gStepZ <= 0) gStepZ = 5;

    const lineasExtra = 5;
    const gapK = gStepK * lineasExtra;
    const gapZ = gStepZ * lineasExtra;

    const startK = Math.floor((minK - gapK) / gStepK) * gStepK;
    const endK = maxK + gapK;
    const startZ = Math.floor((minZ - gapZ) / gStepZ) * gStepZ;
    const endZ = maxZ + gapZ;

    // ════════════ PHASE 1: WORLD SPACE ════════════
    ctx.save();
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.zoom, cam.zoom);

    // Grid
    ctx.lineWidth = 0.5 / cam.zoom;
    ctx.strokeStyle = colors.grid;

    for (let k = startK; k <= endK; k += gStepK) {
        const sx = toX(k);
        ctx.beginPath(); ctx.moveTo(sx, -50000); ctx.lineTo(sx, 50000); ctx.stroke();
    }
    for (let z = startZ; z <= endZ; z += gStepZ) {
        const sy = toY(z);
        ctx.beginPath(); ctx.moveTo(-50000, sy); ctx.lineTo(50000, sy); ctx.stroke();
    }

    // Profile lines (layer manager)
    appState.perfil.forEach((p, idx) => {
        const nombre = p.nombre || `Perfil ${idx + 1}`;
        const style = appConfig.layers?.perfil?.[nombre]
            || { visible: true, color: '#fff', width: 2 };

        if (!style.visible) return;

        ctx.beginPath();
        ctx.strokeStyle = style.color;
        ctx.lineWidth = style.width / cam.zoom;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';

        if (p.data) {
            p.data.forEach((pt, i) => {
                if (i === 0) ctx.moveTo(toX(pt[0]), toY(pt[1]));
                else ctx.lineTo(toX(pt[0]), toY(pt[1]));
            });
        }
        ctx.stroke();
    });

    // Tracking point
    if (appState.secciones && appState.secciones.length > 0) {
        const pkActual = appState.secciones[appState.currentIdx].k;
        const xPos = toX(pkActual);

        // Guide line
        ctx.setLineDash([6 / cam.zoom, 4 / cam.zoom]);
        ctx.strokeStyle = 'rgba(233, 30, 99, 0.4)';
        ctx.lineWidth = 1 / cam.zoom;
        ctx.beginPath(); ctx.moveTo(xPos, -5000); ctx.lineTo(xPos, 5000); ctx.stroke();
        ctx.setLineDash([]);

        const targetName = appConfig.perfil.target || 'auto';
        let foundAuto = false;

        appState.perfil.forEach((p, idx) => {
            const nombre = p.nombre || `Perfil ${idx + 1}`;
            if (targetName !== 'auto' && nombre !== targetName) return;
            if (targetName === 'auto' && foundAuto) return;

            const style = appConfig.layers?.perfil?.[nombre];
            if (style && !style.visible) return;

            if (p.data) {
                const pt = p.data.find(d => Math.abs(d[0] - pkActual) < 2);
                if (pt) {
                    // Glow
                    const gradient = ctx.createRadialGradient(toX(pt[0]), toY(pt[1]), 0, toX(pt[0]), toY(pt[1]), 15 / cam.zoom);
                    gradient.addColorStop(0, 'rgba(233, 30, 99, 0.4)');
                    gradient.addColorStop(1, 'rgba(233, 30, 99, 0)');
                    ctx.fillStyle = gradient;
                    ctx.beginPath(); ctx.arc(toX(pt[0]), toY(pt[1]), 15 / cam.zoom, 0, Math.PI * 2); ctx.fill();

                    // Point
                    ctx.fillStyle = isLight ? '#e91e63' : '#ffeb3b';
                    ctx.beginPath(); ctx.arc(toX(pt[0]), toY(pt[1]), 8 / cam.zoom, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = isLight ? '#fff' : '#000';
                    ctx.lineWidth = 2.0 / cam.zoom;
                    ctx.stroke();

                    // Elevation text
                    ctx.fillStyle = colors.txtPto;
                    ctx.font = `bold ${(15 * escalaTxt) / cam.zoom}px "Inter", sans-serif`;
                    ctx.textAlign = 'left';
                    ctx.fillText(`Z: ${pt[1].toFixed(2)}`, toX(pt[0]) + 8 / cam.zoom, toY(pt[1]) - 8 / cam.zoom);

                    if (targetName === 'auto') foundAuto = true;
                }
            }
        });
    }

    ctx.restore();

    // ════════════ PHASE 2: SCREEN-SPACE HUD ════════════
    const gapX = 14, gapTop = 14, gapBottom = 16;
    ctx.font = `${13 * escalaTxt}px "JetBrains Mono", monospace`;
    ctx.fillStyle = colors.text;

    const worldToScreenX = (k) => (toX(k) * cam.zoom) + cam.x;
    const worldToScreenY = (z) => (toY(z) * cam.zoom) + cam.y;

    for (let k = startK; k <= endK; k += gStepK) {
        const sx = worldToScreenX(k);
        if (sx > -50 && sx < W + 50) {
            const texto = fmtPK(k);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            ctx.fillText(texto, sx, H - gapBottom);
            ctx.textBaseline = 'top';
            ctx.fillText(texto, sx, gapTop);
        }
    }

    for (let z = startZ; z <= endZ; z += gStepZ) {
        const sy = worldToScreenY(z);
        if (sy > -20 && sy < H + 20) {
            ctx.textBaseline = 'middle';
            ctx.textAlign = 'left';
            ctx.fillText(z.toFixed(1), gapX, sy);
            ctx.textAlign = 'right';
            ctx.fillText(z.toFixed(1), W - gapX, sy);
        }
    }
}

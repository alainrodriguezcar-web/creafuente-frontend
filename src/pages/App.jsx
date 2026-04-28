import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import styles from './App.module.css';

const GROUPS = {
  upper:   { label: 'A – Z',      chars: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ') },
  lower:   { label: 'a – z',      chars: Array.from('abcdefghijklmnopqrstuvwxyz') },
  nums:    { label: '0 – 9',      chars: Array.from('0123456789') },
  special: { label: 'Símbolos',   chars: Array.from('.,;:!?-_()[]@#$%+=') },
  accents: { label: 'Tildes / ñ', chars: Array.from('ÁáÉéÍíÓóÚúÜüÑñ') },
};

const STEPS = ['Dibuja tus letras', 'Vista previa', 'Exportar'];

const BRUSH_MODES = [
  { id: 'normal',    label: 'Lápiz',      desc: 'Presión controla grosor uniformemente' },
  { id: 'lettering', label: 'Pluma',       desc: 'Presión + ángulo caligráfico' },
  { id: 'flat',      label: 'Pluma plana', desc: 'Ángulo fijo tipo caligrafía occidental' },
];

function lerp(a, b, t) { return a + (b - a) * t; }

// Escapa caracteres especiales XML para SVG seguro
function xmlEscape(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export default function App() {
  const navigate      = useNavigate();
  const canvasRef     = useRef(null);
  const lastWidthRef  = useRef(4);

  const [step, setStep]               = useState(0);
  const [mode, setMode]               = useState('draw');
  const [group, setGroup]             = useState('upper');
  const [currentChar, setCurrentChar] = useState('A');
  const [glyphs, setGlyphs]           = useState({});
  const [brushSize, setBrushSize]     = useState(6);
  const [sensitivity, setSensitivity] = useState(0.7); // 0.1 – 1.0
  const [brushMode, setBrushMode]     = useState('normal');
  const [strokes, setStrokes]         = useState([]);
  const [isDrawing, setIsDrawing]     = useState(false);
  const [previewText, setPreviewText] = useState('Hola, este es mi tipo de letra.');
  const [fontName, setFontName]       = useState('MiLetra');
  const [format, setFormat]           = useState('otf');
  const [loading, setLoading]         = useState(false);
  const [result, setResult]           = useState(null);
  const [error, setError]             = useState('');
  const [uploadMsg, setUploadMsg]     = useState('');
  const [showGuide, setShowGuide]     = useState(false);
  const [showInstall, setShowInstall] = useState(false);
  // Para preview de presión en tiempo real
  const [liveWidth, setLiveWidth]     = useState(6);

  const allCount  = Object.values(GROUPS).reduce((s, g) => s + g.chars.length, 0);
  const doneCount = Object.keys(glyphs).length;
  const pct       = Math.round((doneCount / allCount) * 100);

  // ── Captura posición + presión (Pointer API) ──────────────────
  const getPos = useCallback((e, canvas) => {
    const r = canvas.getBoundingClientRect();
    // e.pressure: 0–1 desde tableta gráfica, 0.5 con mouse, 0 cuando no toca
    const rawPressure = e.pressure ?? 0.5;
    // Cuando no hay tableta, el mouse siempre da 0.5 mientras presiona
    const pressure = rawPressure === 0 ? 0.5 : rawPressure;
    return {
      x: e.clientX - r.left,
      y: e.clientY - r.top,
      pressure,
      pointerType: e.pointerType ?? 'mouse',
    };
  }, []);

  // ── Calcular grosor según presión + sensibilidad ──────────────
  // La presión es el factor principal para todos los modos.
  // La sensibilidad amplifica el rango: baja=poco cambio, alta=mucho cambio.
  const calcWidth = useCallback((p1, p0, bMode, bSize, sens) => {
    const pressure = p1.pressure ?? 0.5;

    // Escalar presión: con sensibilidad alta, pequeñas variaciones tienen gran efecto
    // minW = grosor mínimo (cuando presión=0), maxW = grosor máximo (cuando presión=1)
    const minFactor = Math.max(0.05, 1 - sens);        // ej: sens=0.7 → min=0.3
    const maxFactor = Math.min(2.0,  1 + sens * 1.2);  // ej: sens=0.7 → max=1.84

    let targetWidth = bSize * lerp(minFactor, maxFactor, pressure);

    if (bMode === 'lettering' && p0) {
      // Pluma: la presión sigue mandando, pero el ángulo añade una modulación secundaria (30%)
      const dy = p1.y - p0.y;
      const angleBoost = dy > 0 ? 1.15 : 0.85; // leve ajuste por dirección
      targetWidth = targetWidth * (pressure * 0.7 + 0.3) * angleBoost;
    } else if (bMode === 'flat' && p0) {
      // Pluma plana: presión + ángulo horizontal
      const angle  = Math.atan2(p1.y - p0.y, p1.x - p0.x);
      const factor = Math.abs(Math.cos(angle - Math.PI / 4));
      targetWidth  = targetWidth * (0.3 + factor * 0.7);
    }

    return Math.max(0.5, targetWidth);
  }, []);

  // ── Dibujar segmento con interpolación suave ──────────────────
  const drawSegment = useCallback((ctx, p0, p1, bMode, bSize, sens) => {
    const target   = calcWidth(p1, p0, bMode, bSize, sens);
    const smoothed = lerp(lastWidthRef.current, target, 0.4);
    lastWidthRef.current = smoothed;

    ctx.beginPath();
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth   = smoothed;
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();

    return smoothed;
  }, [calcWidth]);

  const redraw = useCallback((strokeList) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    strokeList.forEach(s => {
      lastWidthRef.current = s.size;
      for (let i = 1; i < s.points.length; i++)
        drawSegment(ctx, s.points[i-1], s.points[i], s.mode, s.size, s.sens);
    });
  }, [drawSegment]);

  // Cargar glifo al cambiar carácter
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setStrokes([]);
    lastWidthRef.current = brushSize;
    if (glyphs[currentChar]) {
      const img = new Image();
      img.onload = () => canvas.getContext('2d').drawImage(img, 0, 0);
      img.src = glyphs[currentChar];
    }
  }, [currentChar]);

  // ── Teclado: Ctrl+Z, ← → ──────────────────────────────────────
  const saveAndNavRef = useRef(null);

  const saveCurrentGlyph = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return;
    setGlyphs(prev => ({ ...prev, [currentChar]: canvas.toDataURL() }));
  }, [currentChar, strokes]);

  const saveAndNav = useCallback((dir) => {
    saveCurrentGlyph();
    const chars = GROUPS[group].chars;
    const idx   = chars.indexOf(currentChar);
    const next  = idx + dir;
    if (next >= 0 && next < chars.length) setCurrentChar(chars[next]);
  }, [saveCurrentGlyph, group, currentChar]);

  useEffect(() => { saveAndNavRef.current = saveAndNav; }, [saveAndNav]);

  useEffect(() => {
    const handler = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); setStrokes(prev => { const u = prev.slice(0,-1); redraw(u); return u; }); }
      if (e.key === 'ArrowRight') { e.preventDefault(); saveAndNavRef.current?.(1); }
      if (e.key === 'ArrowLeft')  { e.preventDefault(); saveAndNavRef.current?.(-1); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [redraw]);

  // ── Eventos Pointer (tableta gráfica) ─────────────────────────
  const handlePointerDown = (e) => {
    canvasRef.current.setPointerCapture(e.pointerId);
    const p = getPos(e, canvasRef.current);
    lastWidthRef.current = brushSize;
    setIsDrawing(true);
    setLiveWidth(brushSize);
    setStrokes(prev => [...prev, { mode: brushMode, size: brushSize, sens: sensitivity, points: [p] }]);
  };

  const handlePointerMove = (e) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    const p      = getPos(e, canvas);
    setStrokes(prev => {
      const updated = [...prev];
      const last    = updated[updated.length - 1];
      const prevPt  = last.points[last.points.length - 1];
      const w = drawSegment(canvas.getContext('2d'), prevPt, p, brushMode, brushSize, sensitivity);
      setLiveWidth(+w.toFixed(1));
      updated[updated.length-1] = { ...last, points: [...last.points, p] };
      return updated;
    });
  };

  const handlePointerUp = () => setIsDrawing(false);

  const clearCanvas = () => {
    canvasRef.current.getContext('2d').clearRect(0, 0, 280, 280);
    setStrokes([]);
  };

  const undoStroke = () =>
    setStrokes(prev => { const u = prev.slice(0,-1); redraw(u); return u; });

  // ── Plantilla profesional ─────────────────────────────────────
  const downloadTemplate = () => {
    const GROUPS_DATA = [
      { label: 'MAYUSCULAS',        chars: Array.from('ABCDEFGHIJKLMNOPQRSTUVWXYZ') },
      { label: 'MINUSCULAS',        chars: Array.from('abcdefghijklmnopqrstuvwxyz') },
      { label: 'NUMEROS',           chars: Array.from('0123456789') },
      { label: 'SIMBOLOS',          chars: Array.from('.,;:!?-_()[]@#$%+=') },
      { label: 'TILDES Y ESPECIALES', chars: Array.from('AaEeIiOoUuNn').map((c,i) => {
          const acc = 'ÁáÉéÍíÓóÚúÑñ';
          return acc[i] ?? c;
        })
      },
    ];

    const COLS    = 9;
    const CW      = 68;  // ancho celda
    const CH      = 72;  // alto celda
    const ML      = 40;  // margen izquierdo
    const MT      = 100; // margen top (después del header)
    const GAP_COL = 6;
    const GAP_ROW = 4;
    const PAGE_W  = COLS * (CW + GAP_COL) - GAP_COL + ML * 2;

    // Calcular altura total
    let totalRows = 0;
    GROUPS_DATA.forEach(g => { totalRows += 1.2 + Math.ceil(g.chars.length / COLS); });
    const PAGE_H = MT + totalRows * (CH + GAP_ROW) + 60;

    let cells = '';
    let y = MT;

    GROUPS_DATA.forEach(({ label, chars }) => {
      // Etiqueta de grupo
      cells += `
  <text x="${ML}" y="${y + 2}"
    font-family="Helvetica Neue,Arial,sans-serif"
    font-size="8.5" font-weight="700" letter-spacing="2"
    fill="#8A8880">${xmlEscape(label)}</text>
  <line x1="${ML}" y1="${y + 6}" x2="${PAGE_W - ML}" y2="${y + 6}"
    stroke="#D8D6D0" stroke-width="0.5"/>`;
      y += 20;

      const rowCount = Math.ceil(chars.length / COLS);
      for (let r = 0; r < rowCount; r++) {
        for (let c = 0; c < COLS; c++) {
          const i  = r * COLS + c;
          if (i >= chars.length) break;
          const x  = ML + c * (CW + GAP_COL);
          const ch = xmlEscape(chars[i] === ' ' ? ' ' : chars[i]);

          // Fondo celda
          cells += `
  <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="5"
    fill="#FAFAF8" stroke="#E0DED8" stroke-width="0.6"/>`;

          // Línea ascendente (punteada, azul claro)
          cells += `
  <line x1="${x+6}" y1="${y+14}" x2="${x+CW-6}" y2="${y+14}"
    stroke="#C8DFFB" stroke-width="0.5" stroke-dasharray="3 3"/>`;

          // Zona de escritura (entre ascendente y baseline)
          cells += `
  <rect x="${x+1}" y="${y+14}" width="${CW-2}" height="${CH-28}" rx="0"
    fill="#F4F3F0" opacity="0.5"/>`;

          // Baseline (sólida, azul)
          cells += `
  <line x1="${x+6}" y1="${y+CH-14}" x2="${x+CW-6}" y2="${y+CH-14}"
    stroke="#3B82C4" stroke-width="0.8"/>`;

          // Línea descendente (punteada, gris)
          cells += `
  <line x1="${x+6}" y1="${y+CH-6}" x2="${x+CW-6}" y2="${y+CH-6}"
    stroke="#C8DFFB" stroke-width="0.4" stroke-dasharray="2 4"/>`;

          // Letra referencia (esquina superior izquierda, muy sutil)
          if (ch.trim()) {
            cells += `
  <text x="${x+5}" y="${y+12}"
    font-family="Helvetica Neue,Arial,sans-serif"
    font-size="8" fill="#C8C5BC">${ch}</text>`;
          }
        }
        y += CH + GAP_ROW;
      }
      y += 10; // espacio entre grupos
    });

    // Leyenda
    const LY = MT - 28;
    const legend = `
  <circle cx="${ML+6}"    cy="${LY}" r="4" fill="#C8DFFB"/>
  <text x="${ML+14}" y="${LY+4}" font-family="Helvetica Neue,Arial,sans-serif" font-size="8" fill="#8A8880">Ascendente (letras altas)</text>
  <rect x="${ML+130}" y="${LY-4}" width="16" height="8" rx="2" fill="#F4F3F0" stroke="#E0DED8" stroke-width="0.6"/>
  <text x="${ML+150}" y="${LY+4}" font-family="Helvetica Neue,Arial,sans-serif" font-size="8" fill="#8A8880">Zona de escritura</text>
  <line x1="${ML+240}" y1="${LY}" x2="${ML+256}" y2="${LY}" stroke="#3B82C4" stroke-width="1.5"/>
  <text x="${ML+260}" y="${LY+4}" font-family="Helvetica Neue,Arial,sans-serif" font-size="8" fill="#3B82C4">Baseline (apoya aqui)</text>`;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg"
  width="${PAGE_W}" height="${Math.ceil(PAGE_H)}"
  viewBox="0 0 ${PAGE_W} ${Math.ceil(PAGE_H)}">

  <!-- Fondo -->
  <rect width="${PAGE_W}" height="${Math.ceil(PAGE_H)}" fill="#FFFFFF"/>

  <!-- Header -->
  <rect x="0" y="0" width="${PAGE_W}" height="64" fill="#1A1A18"/>
  <text x="${ML}" y="38"
    font-family="Helvetica Neue,Arial,sans-serif"
    font-size="22" font-weight="700" letter-spacing="-0.5"
    fill="#FFFFFF">CreaFuente</text>
  <text x="${ML}" y="54"
    font-family="Helvetica Neue,Arial,sans-serif"
    font-size="9" fill="#888880" letter-spacing="1">
    PLANTILLA DE CARACTERES · Escribe sobre la baseline azul · Escanea a 300 DPI y sube a CreaFuente
  </text>

  <!-- Leyenda -->
  ${legend}

  <!-- Celdas -->
  ${cells}

  <!-- Footer -->
  <line x1="${ML}" y1="${Math.ceil(PAGE_H)-24}" x2="${PAGE_W-ML}" y2="${Math.ceil(PAGE_H)-24}"
    stroke="#E0DED8" stroke-width="0.4"/>
  <text x="${PAGE_W/2}" y="${Math.ceil(PAGE_H)-10}"
    font-family="Helvetica Neue,Arial,sans-serif"
    font-size="8" fill="#C8C5BC" text-anchor="middle">
    creafuente.app · Imprime en A4 horizontal · Una hoja por pagina
  </text>
</svg>`;

    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = 'CreaFuente_plantilla.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Exportar fuente ────────────────────────────────────────────
  const handleTemplateUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploadMsg('Procesando imagen...');
    try {
      const data = await api.uploadTemplate(file);
      setGlyphs(prev => ({ ...prev, ...data.glyphs }));
      setUploadMsg(`✓ Se extrajeron ${data.glyphCount} glifos.`);
    } catch {
      setUploadMsg('Error al procesar la imagen.');
    }
  };

  const handleExport = async () => {
    if (doneCount === 0) { setError('Dibuja al menos un glifo antes de exportar.'); return; }
    setLoading(true); setError(''); setResult(null);
    try { setResult(await api.generateFont(glyphs, fontName, format)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const goStep = (n) => { if (n === 1) saveCurrentGlyph(); setStep(n); setError(''); };

  // ── Vista previa del pincel ───────────────────────────────────
  const BrushPreview = () => {
    const s = Math.min(brushSize, 18);
    return (
      <div className={styles.brushPreview}>
        <svg width="200" height="44" viewBox="0 0 200 44">
          {/* Simula presión creciente luego decreciente */}
          {Array.from({ length: 18 }, (_, i) => {
            const t  = i / 17;
            const p  = t < 0.5 ? t * 2 : 2 - t * 2; // sube y baja
            const x0 = 10 + i * 10;
            const x1 = x0 + 10;
            let w;
            if (brushMode === 'lettering') {
              const angle = i % 2 === 0 ? 1.2 : 0.8;
              w = s * lerp(1 - sensitivity, 1 + sensitivity, p) * angle;
            } else if (brushMode === 'flat') {
              w = s * lerp(1 - sensitivity, 1 + sensitivity, p) * (0.4 + Math.abs(Math.cos(i * 0.4)) * 0.6);
            } else {
              w = s * lerp(1 - sensitivity * 0.8, 1 + sensitivity * 0.8, p);
            }
            w = Math.max(0.5, Math.min(w, 30));
            return <line key={i} x1={x0} y1={22} x2={x1} y2={22}
              stroke="#1a1a1a" strokeWidth={w} strokeLinecap="round"/>;
          })}
        </svg>
        <span style={{ fontSize:11, color:'var(--text-3)' }}>
          Simula presión variable — grosor real depende de tu lápiz
        </span>
      </div>
    );
  };

  // ─────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>

      {/* HEADER */}
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <span className={styles.logo}>CreaFuente</span>
          <nav className={styles.nav}>
            <button className={styles.navBtn} onClick={() => setShowInstall(true)}>📖 Cómo instalar</button>
            <button className={styles.navBtn} onClick={() => navigate('/gallery')}>Mis fuentes</button>
            <a className={styles.contactLink} href="mailto:alainarodriguez@mail.uniatlantico.edu.co">Contacto</a>
          </nav>
        </div>
      </header>

      <main className={styles.main}>
        <div className={styles.hero}>
          <h1>Tu letra, tu fuente</h1>
          <p>Dibuja tus caracteres y convírtelos en una tipografía digital real — instálala en cualquier computador o celular.</p>
        </div>

        {/* Tabs */}
        <div className={styles.steps}>
          {STEPS.map((label, i) => (
            <button key={i}
              className={`${styles.stepBtn} ${step===i ? styles.stepActive : ''}`}
              onClick={() => goStep(i)}>
              <span className={styles.stepNum}>Paso {i+1}</span>{label}
            </button>
          ))}
        </div>

        {/* ═══ PASO 0 ═══ */}
        {step === 0 && (
          <div className={styles.panel}>
            <div className={styles.modeTabs}>
              <button className={mode==='draw'   ? 'primary' : ''} onClick={() => setMode('draw')}>Dibujar en pantalla</button>
              <button className={mode==='upload' ? 'primary' : ''} onClick={() => setMode('upload')}>Subir plantilla escaneada</button>
            </div>

            {mode === 'draw' && (<>
              <button className={styles.guideBtn} onClick={() => setShowGuide(true)}>
                📐 ¿Cómo usar las líneas guía?
              </button>

              <div className={styles.groupTabs}>
                {Object.entries(GROUPS).map(([key, g]) => (
                  <button key={key}
                    className={`${styles.groupBtn} ${group===key ? styles.groupActive : ''}`}
                    onClick={() => { saveCurrentGlyph(); setGroup(key); setCurrentChar(g.chars[0]); }}>
                    {g.label}
                  </button>
                ))}
              </div>

              <div className={styles.charGrid}>
                {GROUPS[group].chars.map(ch => (
                  <button key={ch}
                    className={`${styles.charBtn} ${currentChar===ch ? styles.charActive : ''} ${glyphs[ch] ? styles.charDone : ''}`}
                    onClick={() => { saveCurrentGlyph(); setCurrentChar(ch); }}>
                    {ch===' ' ? '␣' : ch}
                  </button>
                ))}
              </div>

              <div className="card" style={{ marginBottom:'0.75rem' }}>
                <div className={styles.canvasHeader}>
                  <span className={styles.bigChar}>{currentChar===' ' ? '␣' : currentChar}</span>
                  <span style={{ fontSize:13, color:'var(--text-2)' }}>{doneCount} / {allCount} completados</span>
                </div>

                {/* Navegación justo encima del canvas */}
                <div className={styles.navBtnsTop}>
                  <button onClick={() => saveAndNav(-1)} title="Anterior (←)">← Anterior</button>
                  <button className="primary" onClick={saveCurrentGlyph}>Guardar glifo</button>
                  <button onClick={() => saveAndNav(1)}  title="Siguiente (→)">Siguiente →</button>
                </div>

                <div className={styles.canvasWrap}>
                  <svg className={styles.guideLines} viewBox="0 0 280 280">
                    <line x1="0" y1="56"  x2="280" y2="56"  stroke="#B5D4F4" strokeWidth="0.5" strokeDasharray="4 4"/>
                    <line x1="0" y1="190" x2="280" y2="190" stroke="#378ADD" strokeWidth="0.8"/>
                    <line x1="0" y1="234" x2="280" y2="234" stroke="#B5D4F4" strokeWidth="0.5" strokeDasharray="2 6"/>
                  </svg>
                  <canvas ref={canvasRef} width={280} height={280} className={styles.canvas}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                  />
                </div>

                <div className={styles.toolsRow}>
                  <button onClick={clearCanvas}>Borrar todo</button>
                  <button onClick={undoStroke}>↩ Deshacer <span style={{fontSize:11,opacity:0.6}}>(Ctrl+Z)</span></button>
                  {isDrawing && (
                    <span style={{fontSize:11,color:'var(--text-3)',marginLeft:'auto'}}>
                      grosor: <strong>{liveWidth}px</strong>
                    </span>
                  )}
                  {!isDrawing && (
                    <span style={{fontSize:11,color:'var(--text-3)',marginLeft:'auto'}}>← → para navegar</span>
                  )}
                </div>

                {/* ── Configuración del pincel ── */}
                <div className={styles.brushSection}>
                  <span className={styles.toolLabel}>Tipo de pincel</span>
                  <div className={styles.brushModes}>
                    {BRUSH_MODES.map(bm => (
                      <button key={bm.id}
                        className={`${styles.brushBtn} ${brushMode===bm.id ? styles.brushActive : ''}`}
                        onClick={() => setBrushMode(bm.id)}>
                        <span className={styles.brushLabel}>{bm.label}</span>
                        <span className={styles.brushDesc}>{bm.desc}</span>
                      </button>
                    ))}
                  </div>

                  <div className={styles.sizeRow}>
                    <span className={styles.toolLabel}>Grosor base: <strong>{brushSize}px</strong></span>
                    <input type="range" min={1} max={30} value={brushSize}
                      onChange={e => { setBrushSize(+e.target.value); lastWidthRef.current = +e.target.value; }}
                      style={{ flex:1 }}/>
                  </div>

                  <div className={styles.sizeRow}>
                    <span className={styles.toolLabel}>
                      Sensibilidad a presión: <strong>
                        {sensitivity < 0.35 ? 'Baja' : sensitivity < 0.65 ? 'Media' : sensitivity < 0.85 ? 'Alta' : 'Máxima'}
                      </strong>
                    </span>
                    <input type="range" min={0.1} max={1.0} step={0.05} value={sensitivity}
                      onChange={e => setSensitivity(+e.target.value)}
                      style={{ flex:1 }}/>
                  </div>

                  <BrushPreview/>

                  <div className={styles.pressureHint}>
                    {sensitivity < 0.35
                      ? '🖊 Baja: el grosor varía poco — ideal para trazos uniformes con mouse.'
                      : sensitivity < 0.65
                      ? '🖊 Media: variación moderada — buen balance para mouse y tableta.'
                      : sensitivity < 0.85
                      ? '✒️ Alta: la presión del lápiz tiene gran efecto — recomendado para tableta gráfica.'
                      : '✒️ Máxima: la más ligera presión cambia drásticamente el grosor — solo para tabletas profesionales.'}
                  </div>
                </div>
              </div>
            </>)}

            {mode === 'upload' && (
              <div>
                <div className="alert alert-info">
                  Descarga la plantilla, escribe un carácter en cada celda apoyando en la línea azul, escanéala a 300 DPI y súbela aquí.
                </div>
                <button style={{ width:'100%', marginBottom:'1rem' }} onClick={downloadTemplate}>
                  Descargar plantilla (SVG — abre en navegador e imprime)
                </button>
                <label className={styles.uploadZone}>
                  <input type="file" accept="image/*" onChange={handleTemplateUpload} hidden/>
                  <div className={styles.uploadIcon}>⬆</div>
                  <p><strong>Haz clic para subir</strong> o arrastra tu imagen aquí</p>
                  <p style={{ fontSize:12, color:'var(--text-3)', marginTop:4 }}>JPG, PNG o TIFF · máx. 20 MB</p>
                </label>
                {uploadMsg && (
                  <div className={`alert ${uploadMsg.includes('Error') ? 'alert-error' : 'alert-success'}`}>{uploadMsg}</div>
                )}
              </div>
            )}

            <div style={{ display:'flex', justifyContent:'flex-end', marginTop:'1.25rem' }}>
              <button className="primary" onClick={() => goStep(1)}>Continuar a vista previa →</button>
            </div>
          </div>
        )}

        {/* ═══ PASO 1 ═══ */}
        {step === 1 && (
          <div className={styles.panel}>
            <div className={styles.statsGrid}>
              {[['Glifos dibujados',doneCount],['Total',allCount],['Completado',`${pct}%`]].map(([l,v]) => (
                <div key={l} className={styles.statCard}>
                  <div className={styles.statVal}>{v}</div>
                  <div className={styles.statLabel}>{l}</div>
                </div>
              ))}
            </div>
            <div className={styles.progressBar}><div className={styles.progressFill} style={{ width:`${pct}%` }}/></div>
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p style={{ fontSize:12,fontWeight:500,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8 }}>Vista previa en tiempo real</p>
              <input type="text" value={previewText} onChange={e => setPreviewText(e.target.value)} style={{ marginBottom:'1rem' }}/>
              <div className={styles.previewRender}>
                {Array.from(previewText).map((ch,i) =>
                  glyphs[ch]
                    ? <img key={i} src={glyphs[ch]} alt={ch} style={{ height:44,width:'auto',verticalAlign:'baseline' }}/>
                    : <span key={i} style={{ fontSize:28,lineHeight:1.5 }}>{ch}</span>
                )}
              </div>
            </div>
            <div style={{ display:'flex', gap:8 }}>
              <button onClick={() => goStep(0)}>← Volver a dibujar</button>
              <button className="primary" style={{ flex:1 }} onClick={() => goStep(2)}>Continuar a exportar →</button>
            </div>
          </div>
        )}

        {/* ═══ PASO 2 ═══ */}
        {step === 2 && (
          <div className={styles.panel}>
            <div className="card" style={{ marginBottom:'1rem' }}>
              <p style={{ fontSize:12,fontWeight:500,color:'var(--text-3)',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:8 }}>Nombre de tu fuente</p>
              <input type="text" value={fontName} onChange={e => setFontName(e.target.value)}/>
            </div>
            <div className={styles.fmtGrid}>
              {['otf','ttf'].map(f => (
                <div key={f} className={`${styles.fmtCard} ${format===f ? styles.fmtActive : ''}`} onClick={() => setFormat(f)}>
                  <div className={styles.fmtLabel}>{f.toUpperCase()}</div>
                  <div className={styles.fmtDesc}>{f==='otf' ? 'OpenType · mejor calidad, recomendado' : 'TrueType · máxima compatibilidad'}</div>
                </div>
              ))}
            </div>
            <button className={styles.installHintBtn} onClick={() => setShowInstall(true)}>📖 ¿Cómo instalo y uso mi fuente?</button>
            {error && <div className="alert alert-error">{error}</div>}
            {result ? (
              <div>
                <div className="alert alert-success">¡Fuente "{result.name}" lista con {result.glyphCount} glifos!</div>
                <a href={api.downloadUrl(result.id)} download style={{ display:'block', marginBottom:8 }}>
                  <button className="primary" style={{ width:'100%' }}>Descargar {result.name}.{result.format}</button>
                </a>
                <button style={{ width:'100%' }} onClick={() => navigate('/gallery')}>Ver en mis fuentes</button>
              </div>
            ) : (
              <button className="primary" style={{ width:'100%' }} onClick={handleExport} disabled={loading}>
                {loading ? 'Generando fuente...' : 'Generar y descargar fuente'}
              </button>
            )}
          </div>
        )}
      </main>

      {/* FOOTER */}
      <footer className={styles.footer}>
        <span>CreaFuente · Hecho con ✍️</span>
        <a href="mailto:alainarodriguez@mail.uniatlantico.edu.co">Contactar al creador</a>
      </footer>

      {/* ═══ MODAL: Líneas guía ═══ */}
      {showGuide && (
        <div className={styles.overlay} onClick={() => setShowGuide(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Cómo usar las líneas guía</h2>
              <button onClick={() => setShowGuide(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              <svg width="100%" viewBox="0 0 280 160"
                style={{ border:'1px solid var(--border)', borderRadius:8, background:'#fff', marginBottom:16 }}>
                <line x1="0" y1="30"  x2="280" y2="30"  stroke="#B5D4F4" strokeWidth="1" strokeDasharray="4 4"/>
                <line x1="0" y1="110" x2="280" y2="110" stroke="#378ADD" strokeWidth="1.5"/>
                <line x1="0" y1="135" x2="280" y2="135" stroke="#B5D4F4" strokeWidth="1" strokeDasharray="2 6"/>
                <text x="6" y="26"  fontSize="9" fill="#378ADD" opacity="0.8">Ascendente (l b h d k)</text>
                <text x="6" y="107" fontSize="9" fill="#378ADD">Baseline — apoya aqui todas las letras</text>
                <text x="6" y="152" fontSize="9" fill="#B5D4F4">Descendente (g p y q)</text>
                <text x="160" y="110" fontSize="68" fill="#1a1a1a" fontFamily="Georgia,serif" dominantBaseline="auto">A</text>
              </svg>
              {[
                ['#B5D4F4','Línea azul claro (arriba) — Ascendente','Las letras altas como l, b, h, d, k llegan hasta aquí.'],
                ['#378ADD','Línea azul sólida — Baseline','La más importante: todas las letras apoyan su base aquí.'],
                ['rgba(181,212,244,0.5)','Línea azul claro (abajo) — Descendente','Letras con cola como g, p, y, q bajan hasta aquí.'],
              ].map(([color, title, desc]) => (
                <div key={title} className={styles.guideItem}>
                  <span className={styles.guideDot} style={{ background: color }}/>
                  <div><strong>{title}</strong><br/><span style={{fontSize:13,color:'var(--text-2)'}}>{desc}</span></div>
                </div>
              ))}
              <div className="alert alert-info" style={{ marginTop:16, marginBottom:0 }}>
                💡 Apoya siempre en la línea azul sólida para que tu fuente se vea uniforme.
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ MODAL: Instalación ═══ */}
      {showInstall && (
        <div className={styles.overlay} onClick={() => setShowInstall(false)}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHead}>
              <h2>Cómo instalar y usar tu fuente</h2>
              <button onClick={() => setShowInstall(false)}>✕</button>
            </div>
            <div className={styles.modalBody}>
              {[
                ['🖥️ Windows',['Descarga el .otf desde CreaFuente.','Búscalo en tu carpeta Descargas.','Doble clic sobre el archivo.','Clic en "Instalar" arriba de la ventana.','¡Listo! Aparece en todos tus programas.']],
                ['🍎 Mac',['Descarga el .otf.','Doble clic en el archivo.','Font Book se abre — clic en "Instalar fuente".']],
                ['📱 iPhone/iPad',['Descarga AnyFont desde App Store.','Descarga tu fuente en Safari.','Compartir → AnyFont → sigue los pasos.']],
                ['🤖 Android',['Descarga iFont desde Play Store.','Descarga tu fuente.','Abre iFont y sigue las instrucciones.']],
              ].map(([title, steps]) => (
                <div key={title} className={styles.installSection}>
                  <h3>{title}</h3>
                  <ol className={styles.installSteps}>
                    {steps.map((s,i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              ))}
              <div className={styles.installSection}>
                <h3>✏️ Programas compatibles</h3>
                <div className={styles.appGrid}>
                  {[['Word','Documentos'],['Illustrator','Diseño vectorial'],['Photoshop','Imagen'],['Canva','Diseño online'],['Procreate','iPad'],['PowerPoint','Presentaciones'],['InDesign','Maquetación'],['Figma','UI/UX']].map(([n,d]) => (
                    <div key={n} className={styles.appCard}><strong>{n}</strong><span>{d}</span></div>
                  ))}
                </div>
              </div>
              <div className="alert alert-info" style={{ marginBottom:0 }}>
                💡 Cierra y vuelve a abrir el programa después de instalar para que detecte tu fuente.
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

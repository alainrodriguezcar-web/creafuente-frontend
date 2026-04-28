import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import styles from './Gallery.module.css';

export default function Gallery() {
  const navigate = useNavigate();
  const [fonts, setFonts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await api.listFonts();
      setFonts(data);
    } catch (e) {
      setError('No se pudo cargar la galería. Verifica la conexión con el backend.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleDelete = async (id, name) => {
    if (!confirm(`¿Eliminar la fuente "${name}"? Esta acción no se puede deshacer.`)) return;
    setDeleting(id);
    try {
      await api.deleteFont(id);
      setFonts(prev => prev.filter(f => f.id !== id));
    } catch (e) {
      setError('No se pudo eliminar la fuente.');
    } finally {
      setDeleting(null);
    }
  };

  const formatDate = (iso) => new Date(iso).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerInner}>
          <button className={styles.back} onClick={() => navigate('/')}>← Volver al editor</button>
          <span className={styles.logo}>Mis fuentes</span>
        </div>
      </header>

      <main className={styles.main}>
        {loading && (
          <div className={styles.empty}>
            <div className={styles.spinner} />
            <p>Cargando tus fuentes...</p>
          </div>
        )}

        {!loading && error && (
          <div className="alert alert-error">{error}</div>
        )}

        {!loading && !error && fonts.length === 0 && (
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>Aa</div>
            <h2>Aún no has generado ninguna fuente</h2>
            <p>Dibuja tus caracteres en el editor y exporta tu primera tipografía.</p>
            <button className="primary" onClick={() => navigate('/')}>Ir al editor</button>
          </div>
        )}

        {!loading && fonts.length > 0 && (
          <>
            <p className={styles.count}>{fonts.length} fuente{fonts.length !== 1 ? 's' : ''} guardada{fonts.length !== 1 ? 's' : ''}</p>
            <div className={styles.grid}>
              {fonts.map(font => (
                <div key={font.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div className={styles.fontPreview}>{font.name[0]}</div>
                    <div className={styles.cardMeta}>
                      <div className={styles.fontName}>{font.name}</div>
                      <div className={styles.fontInfo}>
                        <span className="badge badge-blue">{font.format.toUpperCase()}</span>
                        <span className={styles.glyphCount}>{font.glyph_count} glifos</span>
                      </div>
                      <div className={styles.fontDate}>{formatDate(font.created_at)}</div>
                    </div>
                  </div>
                  <div className={styles.cardActions}>
                    <a href={api.downloadUrl(font.id)} download>
                      <button className="primary" style={{ width: '100%' }}>
                        Descargar .{font.format}
                      </button>
                    </a>
                    <button
                      className="danger"
                      onClick={() => handleDelete(font.id, font.name)}
                      disabled={deleting === font.id}
                    >
                      {deleting === font.id ? '...' : 'Eliminar'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

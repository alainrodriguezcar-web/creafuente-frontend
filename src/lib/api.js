const BASE = import.meta.env.VITE_API_URL || '';

async function apiFetch(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
  return data;
}

export const api = {
  generateFont: (glyphs, fontName, format) =>
    apiFetch('/api/fonts/generate', {
      method: 'POST',
      body: JSON.stringify({ glyphs, fontName, format }),
    }),

  listFonts: () => apiFetch('/api/fonts'),

  deleteFont: (id) => apiFetch(`/api/fonts/${id}`, { method: 'DELETE' }),

  downloadUrl: (id) => `${BASE}/api/fonts/${id}/download`,

  uploadTemplate: (file) => {
    const form = new FormData();
    form.append('image', file);
    return fetch(`${BASE}/api/upload/template`, { method: 'POST', body: form })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data.error);
        return data;
      });
  },
};

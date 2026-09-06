function parseSimpleYamlObject(text) {
    if (!text || !String(text).trim()) return {};
    const raw = String(text).trim();
    if (raw.startsWith('{')) {
        try {
            const obj = JSON.parse(raw);
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) return obj;
        } catch { /* fall through */ }
    }
    const out = {};
    for (const line of raw.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#')) continue;
        const i = t.indexOf(':');
        if (i <= 0) continue;
        const k = t.slice(0, i).trim();
        let v = t.slice(i + 1).trim();
        if (!k) continue;
        if (v === '' || v === '~' || v.toLowerCase() === 'null') out[k] = null;
        else if (v === 'true') out[k] = true;
        else if (v === 'false') out[k] = false;
        else if (!isNaN(Number(v)) && v !== '') out[k] = Number(v);
        else out[k] = v.replace(/^['"]|['"]$/g, '');
    }
    return out;
}

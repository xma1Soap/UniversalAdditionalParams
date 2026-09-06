function parseExcludeList(text) {
    if (!text || !String(text).trim()) return [];
    const raw = String(text).trim();
    if (raw.startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.map(String);
        } catch { /* fall through */ }
    }
    const out = [];
    for (const line of raw.split('\n')) {
        const t2 = line.trim().replace(/^-\s*/, '').replace(/^['"]|['"]$/g, '');
        if (!t2 || t2.startsWith('#')) continue;
        if (t2.includes(':')) continue;
        out.push(t2);
    }
    return [...new Set(out)];
}

function serializeExcludeList(keys) {
    return keys.map(k => `- ${k}`).join('\n');
}

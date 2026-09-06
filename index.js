// Universal Additional Parameters v1.2.0 - SillyTavern extension
// Shows the Additional Parameters button for every chat completion source
// and forwards custom_include_body / custom_exclude_body / custom_include_headers
// on every generation. Non-Custom sources need the server-side
// chat-completions.js patch (stock backend only honors them for Custom).
import { extension_settings, renderExtensionTemplateAsync } from '../../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { oai_settings, chat_completion_sources } from '../../../openai.js';

const EXT_ID = 'UniversalAdditionalParams';

const DEFAULT_SETTINGS = {
    globalEnabled: true,
    autoExcludeEnabled: true,
    autoRules: [
        {
            name: 'Gemini 3.7/3.8 Flash (no temp/top/penalties)',
            enabled: true,
            sources: ['makersuite', 'vertexai'],
            modelPatterns: ['gemini-3.7-flash', 'gemini-3.8-flash'],
            excludeKeys: ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty'],
        },
        {
            name: 'o1 / o3 reasoning (no temp/top/penalties)',
            enabled: true,
            sources: ['openai', 'azure_openai', 'custom'],
            modelPatterns: ['o1-', 'o1_', 'o3-', 'o3_'],
            excludeKeys: ['temperature', 'top_p', 'top_k', 'frequency_penalty', 'presence_penalty'],
        },
        {
            name: 'GPT-5 reasoning (no temp/top/penalties/logit_bias/stop)',
            enabled: true,
            sources: ['openai', 'azure_openai', 'custom'],
            modelPatterns: ['gpt-5'],
            excludeKeys: ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'logit_bias', 'stop'],
        },
    ],
};

function getSettings() {
    extension_settings[EXT_ID] = Object.assign(
        structuredClone(DEFAULT_SETTINGS),
        extension_settings[EXT_ID] || {},
    );
    return extension_settings[EXT_ID];
}

const settings = getSettings();

function stripDash(s) {
    s = String(s).trim();
    if (s.startsWith('-')) s = s.slice(1).trim();
    return s;
}

function stripQuotes(s) {
    s = String(s);
    if (s.length >= 2) {
        const f = s[0];
        const l = s[s.length - 1];
        if ((f === "'" && l === "'") || (f === '"' && l === '"')) return s.slice(1, -1);
    }
    return s;
}

function parseExcludeList(text) {
    if (!text || !String(text).trim()) return [];
    const raw = String(text).trim();
    if (raw.startsWith('[')) {
        try {
            const arr = JSON.parse(raw);
            if (Array.isArray(arr)) return arr.map(String);
        } catch (e) {
            void e;
        }
    }
    const out = [];
    const lines = raw.split('\n');
    for (const line of lines) {
        let t = stripQuotes(stripDash(line.trim()));
        t = t.trim();
        if (!t) continue;
        if (t[0] === '#') continue;
        if (t.indexOf(':') !== -1) continue;
        out.push(t);
    }
    const uniq = [];
    for (const k of out) {
        if (!uniq.includes(k)) uniq.push(k);
    }
    return uniq;
}

function serializeExcludeList(keys) {
    const arr = [];
    for (const k of keys) arr.push('- ' + k);
    return arr.join('\n');
}

function getCurrentModelId() {
    const src = oai_settings.chat_completion_source;
    if (src === chat_completion_sources.MAKERSUITE) return String(oai_settings.google_model || '');
    return String(oai_settings[src + '_model'] || '');
}

function getMatchedAutoKeys() {
    if (!settings.autoExcludeEnabled) return { keys: [], rules: [] };
    const src = String(oai_settings.chat_completion_source || '');
    const model = getCurrentModelId().toLowerCase();
    const keys = [];
    const matchedRules = [];
    for (const rule of settings.autoRules || []) {
        if (!rule || rule.enabled === false) continue;
        const sources = rule.sources || ['*'];
        if (!sources.includes('*') && !sources.includes(src)) continue;
        const patterns = rule.modelPatterns || [];
        let hit = patterns.length === 0;
        if (!hit) {
            for (const p of patterns) {
                if (p && model.includes(String(p).toLowerCase())) {
                    hit = true;
                    break;
                }
            }
        }
        if (!hit) continue;
        matchedRules.push(rule.name || 'unnamed rule');
        for (const k of rule.excludeKeys || []) {
            const sk = String(k);
            if (!keys.includes(sk)) keys.push(sk);
        }
    }
    return { keys: keys, rules: matchedRules };
}

function refreshAutoExcludeNote() {
    const matched = getMatchedAutoKeys();
    const keys = matched.keys;
    const rules = matched.rules;
    const noteEl = document.getElementById('uap_auto_note');
    if (noteEl) {
        if (!settings.globalEnabled) {
            noteEl.textContent = 'Plugin disabled. Additional params will not apply.';
        } else if (!settings.autoExcludeEnabled) {
            noteEl.textContent = 'Auto exclude disabled.';
        } else if (keys.length) {
            noteEl.textContent = 'Matched [' + rules.join('; ') + '] auto exclude: ' + keys.join(', ');
        } else {
            noteEl.textContent = 'No matched rule. Nothing auto excluded.';
        }
    }
    const badgeEl = document.getElementById('uap_status_badge');
    if (badgeEl) {
        const active = settings.globalEnabled;
        badgeEl.textContent = active ? 'on' : 'off';
        badgeEl.classList.toggle('uap_badge_off', !active);
    }
}

function forceShowButton() {
    const btn = document.getElementById('customize_additional_parameters');
    if (btn) {
        btn.style.display = '';
        btn.removeAttribute('data-source');
        btn.title = 'Universal Additional Parameters - works with all APIs';
    }
}

function applyAutoExclude(generate_data) {
    if (!settings.globalEnabled) {
        delete generate_data.custom_include_body;
        delete generate_data.custom_exclude_body;
        delete generate_data.custom_include_headers;
        return;
    }
    if (typeof generate_data.custom_include_body !== 'string') {
        generate_data.custom_include_body = String(oai_settings.custom_include_body || '');
    }
    if (typeof generate_data.custom_exclude_body !== 'string') {
        generate_data.custom_exclude_body = String(oai_settings.custom_exclude_body || '');
    }
    if (typeof generate_data.custom_include_headers !== 'string') {
        generate_data.custom_include_headers = String(oai_settings.custom_include_headers || '');
    }
    const matched = getMatchedAutoKeys();
    const keys = matched.keys;
    if (!keys.length) return;
    const existing = parseExcludeList(generate_data.custom_exclude_body);
    const merged = existing.slice();
    for (const k of keys) {
        if (!merged.includes(k)) merged.push(k);
    }
    generate_data.custom_exclude_body = serializeExcludeList(merged);
}

async function initSettingsPanel() {
    try {
        const html = await renderExtensionTemplateAsync('third-party/UniversalAdditionalParams', 'settings');
        const host = document.getElementById('extensions_settings2') || document.getElementById('extensions_settings');
        if (!host) return;
        const root = document.createElement('div');
        root.innerHTML = html;
        host.appendChild(root);
        const g = root.querySelector('#uap_global_enabled');
        const a = root.querySelector('#uap_auto_enabled');
        const rulesBox = root.querySelector('#uap_rules_json');
        const saveBtn = root.querySelector('#uap_rules_save');
        if (g) {
            g.checked = settings.globalEnabled !== false;
            g.addEventListener('change', () => {
                settings.globalEnabled = g.checked;
                saveSettingsDebounced();
                refreshAutoExcludeNote();
            });
        }
        if (a) {
            a.checked = settings.autoExcludeEnabled !== false;
            a.addEventListener('change', () => {
                settings.autoExcludeEnabled = a.checked;
                saveSettingsDebounced();
                refreshAutoExcludeNote();
            });
        }
        if (rulesBox) {
            rulesBox.value = JSON.stringify(settings.autoRules || [], null, 2);
        }
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                try {
                    const arr = JSON.parse(rulesBox.value);
                    if (!Array.isArray(arr)) throw new Error('rules must be an array');
                    settings.autoRules = arr;
                    saveSettingsDebounced();
                    refreshAutoExcludeNote();
                    toastr.success('rules saved');
                } catch (e) {
                    toastr.error('JSON error: ' + e.message);
                }
            });
        }
        const openBtn = root.querySelector('#uap_open_stock_editor');
        if (openBtn) {
            openBtn.addEventListener('click', () => {
                const b = document.getElementById('customize_additional_parameters');
                if (b) b.click();
            });
        }
        refreshAutoExcludeNote();
    } catch (e) {
        console.error('[UniversalAdditionalParams] settings panel failed:', e);
    }
}

jQuery(async () => {
    try {
        forceShowButton();
        const btn0 = document.getElementById('customize_additional_parameters');
        const parent = btn0 ? btn0.parentElement : null;
        if (parent) {
            new MutationObserver(() => forceShowButton()).observe(parent, { attributes: true, childList: true, subtree: true });
        }
        eventSource.on(event_types.CHATCOMPLETION_SOURCE_CHANGED, () => {
            forceShowButton();
            refreshAutoExcludeNote();
        });
        eventSource.on(event_types.CHATCOMPLETION_MODEL_CHANGED, () => refreshAutoExcludeNote());
        eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, () => {
            forceShowButton();
            refreshAutoExcludeNote();
        });
        eventSource.makeFirst(event_types.CHAT_COMPLETION_SETTINGS_READY, applyAutoExclude);
        await initSettingsPanel();
        eventSource.on(event_types.SETTINGS_LOADED_AFTER, () => {
            Object.assign(settings, getSettings());
            const g = document.getElementById('uap_global_enabled');
            const a = document.getElementById('uap_auto_enabled');
            const rulesBox = document.getElementById('uap_rules_json');
            if (g) g.checked = settings.globalEnabled !== false;
            if (a) a.checked = settings.autoExcludeEnabled !== false;
            if (rulesBox) rulesBox.value = JSON.stringify(settings.autoRules || [], null, 2);
            refreshAutoExcludeNote();
        });
        setTimeout(forceShowButton, 1500);
        setTimeout(forceShowButton, 4000);
        console.log('[UniversalAdditionalParams] loaded. globalEnabled =', settings.globalEnabled);
    } catch (e) {
        console.error('[UniversalAdditionalParams] init failed:', e);
    }
});

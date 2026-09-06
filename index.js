// Universal Additional Parameters — SillyTavern extension
//
// What it does:
// 1. Makes the "Additional Parameters" button visible for EVERY chat completion
//    source (stock SillyTavern only shows it for Custom / OpenAI-compatible).
// 2. Forwards the three YAML blobs (custom_include_body / custom_exclude_body /
//    custom_include_headers) to the backend on every generation, no matter the
//    source. A server-side patch in src/endpoints/backends/chat-completions.js
//    applies them to ALL providers (Claude/Gemini/Mistral/Cohere/DeepSeek/xAI/
//    AI-ML/ElectronHub/Azure/OpenAI/OpenRouter/.../Custom).
// 3. Optional "Global Enable" master switch + "Auto-exclude unsupported params"
//    per-model rules (e.g. gemini-3.7-flash / gemini-3.8-flash drop temperature,
//    top_p, top_k, frequency_penalty, presence_penalty).
//
// Backend requirement: the chat-completions.js patch (applyUniversalAdditionalParams)
// must be present. If the backend is stock, include-body still works for Custom
// only, and this extension will show a warning badge in its settings panel.

import { extension_settings, renderExtensionTemplateAsync } from '../../extensions.js';
import { saveSettingsDebounced, eventSource, event_types } from '../../../../script.js';
import { oai_settings, chat_completion_sources } from '../../openai.js';

const EXT_ID = 'UniversalAdditionalParams';

const DEFAULT_SETTINGS = {
    // Master switch
    globalEnabled: true,
    // Auto-exclude rules
    autoExcludeEnabled: true,
    autoRules: [
        {
            name: 'Gemini 3.7/3.8 Flash (no temp/top/penalties)',
            enabled: true,
            // matches chat_completion_source value; use '*' for all sources
            sources: ['makersuite', 'vertexai'],
            // substring (case-insensitive) matched against the resolved model id
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

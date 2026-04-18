/**
 * TunnelVision UI Controller
 * Handles tree editor rendering, drag-and-drop, settings panel, and all user interactions.
 */

import { saveSettingsDebounced } from '../../../../script.js';
import { getContext } from '../../../st-context.js';
import { world_names, loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { getAutoSummaryCount, resetAutoSummaryCount } from './auto-summary.js';
import { getActiveTunnelVisionBooks } from './tool-registry.js';
import {
    getTree,
    saveTree,
    deleteTree,
    isLorebookEnabled,
    setLorebookEnabled,
    createTreeNode,
    addEntryToNode,
    removeNode,
    removeEntryFromTree,
    getAllEntryUids,
    findNodeById,
    getSettings,
    getBookDescription,
    setBookDescription,
    getSelectedLorebook,
    setSelectedLorebook,
    isTrackerUid,
    isTrackerTitle,
    setTrackerUid,
    syncTrackerUidsForLorebook,
    getConnectionProfileId,
    setConnectionProfileId,
    listConnectionProfiles,
    getBookPermission,
    setBookPermission,
    getEffectiveTemplateForNode,
    hasEffectiveTemplate,
    parseTemplateSections,
    getSchemaStarterNames,
    getSchemaStarter,
    starterNodesToTreeNodes,
    saveSchemaTemplate,
    deleteSchemaTemplate,
    SCHEMA_STARTERS,
    SETTING_DEFAULTS,
    getEntryLinks,
    getBackLinks,
    addEntryLink,
    removeEntryLink,
} from './tree-store.js';
import { buildTreeFromMetadata, buildTreeWithLLM, generateSummariesForTree, ingestChatMessages } from './tree-builder.js';
import { registerTools, unregisterTools, getDefaultToolDescriptions, stripDynamicContent } from './tool-registry.js';
import { runDiagnostics } from './diagnostics.js';
import { applyRecurseLimit } from './index.js';
import { refreshHiddenToolCallMessages } from './activity-feed.js';
import { separateConditions, isEvaluableCondition, formatCondition, EVALUABLE_TYPES, CONDITION_LABELS, getKeywordProbability, setKeywordProbability } from './conditions.js';
import { callGenericPopup, POPUP_TYPE } from '../../../popup.js';
import { createEntry, forgetEntry } from './entry-manager.js';
import { sidecarGenerate, isSidecarConfigured } from './llm-sidecar.js';
import { getCheckpointInfo, clearCurrentChatCheckpoints, recordNotebook } from './checkpoint-manager.js';


let currentLorebook = null;

function selectCurrentLorebook(bookName) {
    currentLorebook = bookName || null;
    setSelectedLorebook(currentLorebook);
}

function syncSelectedLorebook() {
    if (currentLorebook && world_names?.includes(currentLorebook)) {
        return;
    }

    const preferredLorebook = getSelectedLorebook();
    if (preferredLorebook && world_names?.includes(preferredLorebook)) {
        currentLorebook = preferredLorebook;
        return;
    }

    currentLorebook = null;
}

// ─── Event Bindings ──────────────────────────────────────────────

export function bindUIEvents() {
    // Main collapsible header
    $('#tv_header_toggle').on('click', function () {
        $(this).toggleClass('expanded');
        $(this).closest('.tv-container').find('.tv-settings-body').slideToggle(200);
    });

    $('#tv_global_enabled').on('change', onGlobalToggle);
    $('#tv_conditional_triggers_master').on('change', function () {
        const settings = getSettings();
        settings.conditionalTriggersEnabled = $(this).prop('checked');
        $('#tv_conditional_triggers').prop('checked', settings.conditionalTriggersEnabled);
        saveSettingsDebounced();
    });
    $('#tv_lorebook_select').on('change', onLorebookSelect);
    $('#tv_lorebook_enabled').on('change', onLorebookToggle);
    $('#tv_book_description').on('input', onBookDescriptionChange);
    $('#tv_build_metadata').on('click', onBuildFromMetadata);
    $('#tv_build_llm').on('click', onBuildWithLLM);
    $('#tv_open_tree_editor').on('click', onOpenTreeEditor);
    $('#tv_import_file').on('change', onImportTree);
    $('#tv_bulk_export').on('click', onBulkExport);
    $('#tv_bulk_import_file').on('change', onBulkImport);
    $('#tv_bulk_import').on('click', () => $('#tv_bulk_import_file').trigger('click'));

    $('#tv_open_notebook').on('click', openNotebookEditor);
    $('#tv_run_diagnostics').on('click', onRunDiagnostics);

    // Lorebook filter
    $('#tv_lorebook_filter').on('input', onLorebookFilter);

    // Advanced Settings collapsible header
    $('#tv_advanced_header').on('click', function () {
        $(this).toggleClass('expanded');
        $(this).next('.tv-advanced-body').slideToggle(200);
    });

    // Auto-detect pattern
    $('#tv_auto_detect_pattern').on('input', function () {
        const settings = getSettings();
        settings.autoDetectPattern = $(this).val();
        saveSettingsDebounced();
    });

    // Per-tool toggles
    $(document).on('change', '.tv_tool_enabled', onToolToggle);

    // Per-tool confirmation toggles
    $('.tv_tool_confirm').on('change', onToolConfirmToggle);

    // Tool prompt overrides
    $('#tv_tool_prompt_overrides').on('input', '.tv-tool-prompt-textarea', onToolPromptChange);
    $('#tv_tool_prompt_overrides').on('click', '.tv-tool-prompt-reset', onToolPromptReset);

    // Search mode radio
    $('input[name="tv_search_mode"]').on('change', onSearchModeChange);

    // Collapsed tree depth
    $('#tv_collapsed_depth').on('change', onCollapsedDepthChange);

    // Selective retrieval
    $('#tv_selective_retrieval').on('change', onSelectiveRetrievalToggle);

    // Recurse limit
    $('#tv_recurse_limit').on('change', onRecurseLimitChange);

    // LLM build detail level
    $('#tv_llm_detail').on('change', onLlmDetailChange);

    // Tree granularity
    $('#tv_tree_granularity').on('change', onTreeGranularityChange);

    // LLM chunk size
    $('#tv_chunk_tokens').on('change', onChunkTokensChange);

    // Vector dedup toggle + threshold
    $('#tv_vector_dedup').on('change', onVectorDedupToggle);
    $('#tv_dedup_threshold').on('change', onDedupThresholdChange);

    // Chat ingest
    $('#tv_ingest_chat').on('click', onIngestChat);

    // Mandatory tool calls & prompt injection settings
    $('#tv_mandatory_tools').on('change', onMandatoryToolsToggle);
    $('#tv_mandatory_position').on('change', onPromptInjectionChange);
    $('#tv_mandatory_depth').on('change', onPromptInjectionChange);
    $('#tv_mandatory_role').on('change', onPromptInjectionChange);
    $('#tv_mandatory_prompt_text').on('change', onMandatoryPromptTextChange);
    $('#tv_mandatory_prompt_reset').on('click', onMandatoryPromptReset);
    $('#tv_notebook_position').on('change', onPromptInjectionChange);
    $('#tv_notebook_depth').on('change', onPromptInjectionChange);
    $('#tv_notebook_role').on('change', onPromptInjectionChange);
    $('#tv_stealth_mode').on('change', onStealthModeToggle);
    $('#tv_ephemeral_results').on('change', onEphemeralResultsToggle);
    $('.tv_ephemeral_tool').on('change', onEphemeralToolFilterChange);

    // Slash commands context setting
    $('#tv_command_context').on('change', onCommandContextChange);

    // Auto-summary settings
    $('#tv_auto_summary_enabled').on('change', onAutoSummaryToggle);
    $('#tv_auto_summary_interval').on('change', onAutoSummaryIntervalChange);
    $('#tv_auto_hide_summarized').on('change', onAutoHideSummarizedToggle);
    $('#tv_passthrough_constant').on('change', onPassthroughConstantToggle);
    $('#tv_allow_keyword_triggers').on('change', onAllowKeywordTriggersToggle);

    // Multi-book mode
    $('input[name="tv_multi_book_mode"]').on('change', onMultiBookModeChange);

    // Sidecar LLM (connection profile + sampler overrides)
    $('#tv_connection_profile').on('change', onConnectionProfileChange);
    $('#tv_sidecar_temperature').on('input', onSidecarTemperatureChange);
    $('#tv_sidecar_max_tokens').on('input', onSidecarMaxTokensChange);

    // Sidecar auto-retrieval
    $('#tv_sidecar_auto_retrieval').on('change', onSidecarAutoRetrievalToggle);
    $('#tv_sidecar_context_messages').on('input', onSidecarContextMessagesChange);
    $('#tv_sidecar_max_injection').on('input', onSidecarMaxInjectionChange);
    $('#tv_sidecar_follow_links').on('change', onSidecarFollowLinksToggle);
    $('#tv_sidecar_link_depth').on('input', onSidecarLinkDepthChange);
    $('#tv_conditional_triggers').on('change', function () {
        const settings = getSettings();
        settings.conditionalTriggersEnabled = $(this).prop('checked');
        $('#tv_conditional_triggers_master').prop('checked', settings.conditionalTriggersEnabled);
        saveSettingsDebounced();
    });

    // Sidecar post-gen writer
    $('#tv_sidecar_post_gen_writer').on('change', onSidecarPostGenWriterToggle);
    $('#tv_sidecar_writer_context').on('input', onSidecarWriterContextChange);
    $('#tv_sidecar_writer_max_ops').on('input', onSidecarWriterMaxOpsChange);

    // Compact tool prompts
    $('#tv_compact_tool_prompts').on('change', onCompactToolPromptsToggle);

    // Checkpoint desync protection
    $('#tv_enable_checkpoints').on('change', onEnableCheckpointsToggle);
    $('#tv_clear_checkpoints').on('click', onClearCheckpoints);

    // Per-lorebook permissions
    $('#tv_book_permission').on('change', onBookPermissionChange);

    // Backup & Restore collapsible header
    $('#tv_backup_header').on('click', function () {
        $(this).toggleClass('expanded');
        $(this).next('.tv-card-body').slideToggle(200);
    });

    // Diagnostics collapsible header
    $('#tv_diagnostics_header').on('click', function () {
        $(this).toggleClass('expanded');
        $(this).next('.tv-diagnostics-body').slideToggle(200);
    });

}

// ─── Refresh / Init ──────────────────────────────────────────────

export function refreshUI() {
    const settings = getSettings();
    const globalEnabled = settings.globalEnabled !== false;
    syncSelectedLorebook();

    $('#tv_global_enabled').prop('checked', globalEnabled);
    $('#tv_main_controls').toggle(globalEnabled);
    $('#tv_conditional_master_row').toggle(globalEnabled);
    $('#tv_conditional_triggers_master').prop('checked', settings.conditionalTriggersEnabled !== false);

    // Sync tool toggles from settings
    const disabledTools = settings.disabledTools || {};
    $('.tv_tool_enabled').each(function () {
        const toolName = $(this).data('tool');
        $(this).prop('checked', !disabledTools[toolName]);
    });

    // Sync tool confirmation toggles
    const confirmTools = settings.confirmTools || {};
    $('.tv_tool_confirm').each(function () {
        const toolName = $(this).data('tool');
        $(this).prop('checked', !!confirmTools[toolName]);
    });

    // Render tool prompt overrides
    renderToolPromptOverrides();

    // Sync search mode radio
    $(`input[name="tv_search_mode"][value="${settings.searchMode || 'traversal'}"]`).prop('checked', true);

    // Sync collapsed depth
    $('#tv_collapsed_depth').val(settings.collapsedDepth ?? 2);
    $('#tv_collapsed_depth_section').toggle((settings.searchMode || 'traversal') === 'collapsed');

    // Sync auto-detect pattern
    $('#tv_auto_detect_pattern').val(settings.autoDetectPattern || '');

    // Sync selective retrieval
    $('#tv_selective_retrieval').prop('checked', settings.selectiveRetrieval === true);

    // Sync recurse limit
    const recurseLimit = settings.recurseLimit ?? 5;
    $('#tv_recurse_limit').val(recurseLimit);
    $('#tv_recurse_warn').toggle(recurseLimit > 10);

    // Sync LLM detail level
    $('#tv_llm_detail').val(settings.llmBuildDetail || 'full');

    // Sync tree granularity
    $('#tv_tree_granularity').val(settings.treeGranularity ?? 0);

    // Sync LLM chunk size
    $('#tv_chunk_tokens').val(settings.llmChunkTokens ?? 30000);

    // Sync vector dedup
    const dedupEnabled = settings.enableVectorDedup === true;
    $('#tv_vector_dedup').prop('checked', dedupEnabled);
    $('#tv_dedup_threshold_row').toggle(dedupEnabled);
    $('#tv_dedup_threshold').val(settings.vectorDedupThreshold ?? 0.85);
    updateDedupStatus(dedupEnabled);

    // Sync mandatory tool calls & prompt injection
    $('#tv_mandatory_tools').prop('checked', settings.mandatoryTools === true);
    $('#tv_mandatory_prompt_options').toggle(settings.mandatoryTools === true);
    $('#tv_mandatory_position').val(settings.mandatoryPromptPosition || 'in_chat');
    $('#tv_mandatory_depth').val(settings.mandatoryPromptDepth ?? 1);
    $('#tv_mandatory_role').val(settings.mandatoryPromptRole || 'system');
    $('#tv_mandatory_prompt_text').val(settings.mandatoryPromptText || '');
    $('#tv_mandatory_depth_row').toggle((settings.mandatoryPromptPosition || 'in_chat') === 'in_chat');

    // Sync notebook injection settings
    $('#tv_notebook_position').val(settings.notebookPromptPosition || 'in_chat');
    $('#tv_notebook_depth').val(settings.notebookPromptDepth ?? 1);
    $('#tv_notebook_role').val(settings.notebookPromptRole || 'system');
    $('#tv_notebook_depth_row').toggle((settings.notebookPromptPosition || 'in_chat') === 'in_chat');

    $('#tv_stealth_mode').prop('checked', settings.stealthMode === true);
    $('#tv_ephemeral_results').prop('checked', settings.ephemeralResults === true);
    $('#tv_ephemeral_filter_options').toggle(settings.ephemeralResults === true);
    const filterList = settings.ephemeralToolFilter || [];
    $('.tv_ephemeral_tool').each(function () {
        $(this).prop('checked', filterList.includes($(this).val()));
    });

    // Sync slash command context setting
    $('#tv_command_context').val(settings.commandContextMessages ?? 50);

    // Sync auto-summary settings
    const autoEnabled = settings.autoSummaryEnabled === true;
    $('#tv_auto_summary_enabled').prop('checked', autoEnabled);
    $('#tv_auto_summary_options').toggle(autoEnabled);
    $('#tv_auto_summary_interval').val(settings.autoSummaryInterval ?? 20);
    $('#tv_auto_summary_count').text(getAutoSummaryCount());
    $('#tv_auto_hide_summarized').prop('checked', settings.autoHideSummarized !== false);
    $('#tv_passthrough_constant').prop('checked', settings.passthroughConstant !== false);
    $('#tv_allow_keyword_triggers').prop('checked', settings.allowKeywordTriggers === true);

    // Sync multi-book mode
    $(`input[name="tv_multi_book_mode"][value="${settings.multiBookMode || 'unified'}"]`).prop('checked', true);

    // Sync checkpoint desync protection settings
    $('#tv_enable_checkpoints').prop('checked', settings.enableCheckpoints !== false);
    updateCheckpointInfoDisplay();
    updateNotebookBadge();

    // Sync connection profile + sidecar sampler controls
    populateConnectionProfiles();

    populateLorebookDropdown();
    $('#tv_lorebook_controls').toggle(!!currentLorebook);

    if (currentLorebook) {
        loadLorebookUI(currentLorebook);
    }
}

function onLorebookFilter() {
    const query = $('#tv_lorebook_filter').val().toLowerCase().trim();
    $('#tv_lorebook_list .tv-lorebook-card').each(function () {
        const bookName = $(this).attr('data-book')?.toLowerCase() || '';
        $(this).toggle(!query || bookName.includes(query));
    });
}

function populateLorebookDropdown() {
    syncSelectedLorebook();
    const $list = $('#tv_lorebook_list');
    $list.empty();

    if (!world_names?.length) {
        $list.append('<div class="tv-help-text" style="text-align:center; padding: 12px;">No lorebooks found.</div>');
        return;
    }

    // Sort: TV-enabled first, then active in chat, then alphabetical
    const activeBooks = getActiveTunnelVisionBooks();
    const sorted = [...world_names].sort((a, b) => {
        const aTV = isLorebookEnabled(a) ? 1 : 0;
        const bTV = isLorebookEnabled(b) ? 1 : 0;
        if (aTV !== bTV) return bTV - aTV;
        const aActive = activeBooks.includes(a) ? 1 : 0;
        const bActive = activeBooks.includes(b) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return a.localeCompare(b);
    });

    for (const name of sorted) {
        const isActive = activeBooks.includes(name);
        const tvEnabled = isLorebookEnabled(name);
        const tree = getTree(name);
        const hasTree = !!tree?.root?.children?.length;

        const $card = $('<div class="tv-lorebook-card"></div>')
            .toggleClass('tv-lorebook-active', isActive)
            .toggleClass('tv-lorebook-selected', name === currentLorebook)
            .attr('data-book', name);

        const $info = $('<div class="tv-lorebook-card-info"></div>');
        const $name = $('<span class="tv-lorebook-card-name"></span>').text(name);
        $info.append($name);

        // Status badges
        const $badges = $('<div class="tv-lorebook-card-badges"></div>');
        if (!isActive) {
            $badges.append('<span class="tv-badge-inactive">inactive</span>');
        }
        if (tvEnabled) {
            $badges.append('<span class="tv-badge-tv-on"><i class="fa-solid fa-eye"></i> TV On</span>');
        }
        if (hasTree) {
            const count = (tree.root.children || []).length;
            $badges.append(`<span class="tv-badge-tree">${count} cat</span>`);
        }
        $info.append($badges);

        // Status indicator dot
        const dotClass = tvEnabled ? 'tv-dot-on' : (hasTree ? 'tv-dot-ready' : 'tv-dot-off');
        const $dot = $(`<span class="tv-lorebook-dot ${dotClass}"></span>`);

        $card.append($dot, $info);

        $card.on('click', () => {
            selectCurrentLorebook(name);
            $('.tv-lorebook-card').removeClass('tv-lorebook-selected');
            $card.addClass('tv-lorebook-selected');
            $('#tv_lorebook_controls').show();
            loadLorebookUI(name);
        });

        $list.append($card);
    }
}

// ─── Lorebook & Toggle Handlers ──────────────────────────────────

function onGlobalToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.globalEnabled = enabled;
    saveSettingsDebounced();
    $('#tv_main_controls').toggle(enabled);
    $('#tv_conditional_master_row').toggle(enabled);
    enabled ? registerTools() : unregisterTools();
}

function onLorebookSelect() {
    // Legacy handler for hidden select (kept for compatibility)
    const bookName = $(this).val();
    selectCurrentLorebook(bookName || null);
    $('#tv_lorebook_controls').toggle(!!bookName);
    if (bookName) loadLorebookUI(bookName);
}

async function loadLorebookUI(bookName) {
    const bookData = await loadWorldInfo(bookName);
    if (bookData?.entries) {
        await syncTrackerUidsForLorebook(bookName, bookData.entries);
    }
    $('#tv_lorebook_enabled').prop('checked', isLorebookEnabled(bookName));
    $('#tv_book_description').val(getBookDescription(bookName) || '');
    $('#tv_book_permission').val(getBookPermission(bookName));
    const tree = getTree(bookName);
    updateTreeStatus(bookName, tree);
    await renderTreeEditor(bookName, tree);
    await renderUnassignedEntries(bookName, tree, bookData);
    updateIngestUI();
}

function updateIngestUI() {
    const context = getContext();
    const hasChat = !!(context.chatId && context.chat?.length > 0);
    const hasBook = !!currentLorebook && isLorebookEnabled(currentLorebook);

    $('#tv_ingest_container').toggle(hasBook);

    if (hasChat) {
        const maxIdx = context.chat.length - 1;
        $('#tv_ingest_to').attr('max', maxIdx).val(maxIdx);
        $('#tv_ingest_from').attr('max', maxIdx);
        $('#tv_ingest_chat_info').text(`Chat has ${context.chat.length} messages (0-${maxIdx})`);
        $('#tv_ingest_chat').prop('disabled', false);
    } else {
        $('#tv_ingest_chat_info').text('No chat open. Open a chat to ingest messages.');
        $('#tv_ingest_chat').prop('disabled', true);
    }
}

function onLorebookToggle() {
    if (!currentLorebook) return;
    setLorebookEnabled(currentLorebook, $(this).prop('checked'));
    registerTools();
    populateLorebookDropdown(); // refresh badges
}

function onBookDescriptionChange() {
    if (!currentLorebook) return;
    const desc = $(this).val().trim();
    setBookDescription(currentLorebook, desc);
    saveSettingsDebounced();
}

function onToolToggle() {
    const toolName = $(this).data('tool');
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    const disabledTools = settings.disabledTools || {};
    if (enabled) {
        delete disabledTools[toolName];
    } else {
        disabledTools[toolName] = true;
    }
    settings.disabledTools = disabledTools;

    // Sync notebook injection setting with tool toggle
    if (toolName === 'TunnelVision_Notebook') {
        settings.notebookEnabled = enabled;
    }

    saveSettingsDebounced();
    registerTools();
}

// ─── Tool Confirmation Toggles ───────────────────────────────────

function onToolConfirmToggle() {
    const toolName = $(this).data('tool');
    const settings = getSettings();
    if (!settings.confirmTools) settings.confirmTools = {};
    settings.confirmTools[toolName] = $(this).prop('checked');
    saveSettingsDebounced();
    registerTools();
}

// ─── Tool Prompt Overrides ───────────────────────────────────────

function renderToolPromptOverrides() {
    const $container = $('#tv_tool_prompt_overrides');
    $container.empty();

    const settings = getSettings();
    const overrides = settings.toolPromptOverrides || {};
    const defaults = getDefaultToolDescriptions();

    for (const [toolName, defaultDesc] of Object.entries(defaults)) {
        const rawOverride = overrides[toolName] ? stripDynamicContent(overrides[toolName]) : null;
        const currentValue = rawOverride || defaultDesc;
        const isModified = !!rawOverride && rawOverride !== defaultDesc;
        const shortName = toolName.replace('TunnelVision_', '');

        const $block = $(`<div class="tv-tool-prompt-block ${isModified ? 'tv-tool-prompt-modified' : ''}"></div>`);
        const $header = $('<div class="tv-tool-prompt-header"></div>');
        $header.append(`<span class="tv-tool-prompt-label">${shortName}</span>`);
        $header.append(`<button class="tv-tool-prompt-reset" data-tool="${toolName}" title="Reset to default">Reset</button>`);
        $block.append($header);

        const $textarea = $(`<textarea class="tv-tool-prompt-textarea" data-tool="${toolName}" rows="4"></textarea>`);
        $textarea.val(currentValue);
        $block.append($textarea);

        $container.append($block);
    }
}

function onToolPromptChange() {
    const toolName = $(this).data('tool');
    const value = stripDynamicContent($(this).val());
    const settings = getSettings();
    if (!settings.toolPromptOverrides) settings.toolPromptOverrides = {};

    const defaults = getDefaultToolDescriptions();
    if (value === defaults[toolName]) {
        // Value matches default — remove override
        delete settings.toolPromptOverrides[toolName];
        $(this).closest('.tv-tool-prompt-block').removeClass('tv-tool-prompt-modified');
    } else {
        settings.toolPromptOverrides[toolName] = value;
        $(this).closest('.tv-tool-prompt-block').addClass('tv-tool-prompt-modified');
    }
    saveSettingsDebounced();
}

function onToolPromptReset() {
    const toolName = $(this).data('tool');
    const settings = getSettings();
    if (settings.toolPromptOverrides) {
        delete settings.toolPromptOverrides[toolName];
    }
    saveSettingsDebounced();

    const defaults = getDefaultToolDescriptions();
    const $block = $(this).closest('.tv-tool-prompt-block');
    $block.find('.tv-tool-prompt-textarea').val(defaults[toolName] || '');
    $block.removeClass('tv-tool-prompt-modified');
}

function onSearchModeChange() {
    const mode = $('input[name="tv_search_mode"]:checked').val();
    const settings = getSettings();
    settings.searchMode = mode;
    saveSettingsDebounced();
    $('#tv_collapsed_depth_section').toggle(mode === 'collapsed');
    // Re-register to rebuild tool description with new mode
    registerTools();
}

function onCollapsedDepthChange() {
    const raw = Number($('#tv_collapsed_depth').val());
    const clamped = Math.min(4, Math.max(1, Math.round(raw) || 2));
    $('#tv_collapsed_depth').val(clamped);
    const settings = getSettings();
    settings.collapsedDepth = clamped;
    saveSettingsDebounced();
    registerTools();
}

async function onSelectiveRetrievalToggle() {
    const settings = getSettings();
    settings.selectiveRetrieval = $(this).prop('checked');
    saveSettingsDebounced();
    await registerTools();
}

function onRecurseLimitChange() {
    const raw = Number($('#tv_recurse_limit').val());
    const clamped = Math.min(Math.max(Math.round(raw) || 5, 1), 50);
    $('#tv_recurse_limit').val(clamped);
    $('#tv_recurse_warn').toggle(clamped > 10);

    const settings = getSettings();
    settings.recurseLimit = clamped;
    saveSettingsDebounced();
    applyRecurseLimit(settings);
}

function onLlmDetailChange() {
    const settings = getSettings();
    settings.llmBuildDetail = $('#tv_llm_detail').val();
    saveSettingsDebounced();
}

function onTreeGranularityChange() {
    const settings = getSettings();
    settings.treeGranularity = Number($('#tv_tree_granularity').val()) || 0;
    saveSettingsDebounced();
}

function onChunkTokensChange() {
    const raw = Number($('#tv_chunk_tokens').val());
    const clamped = Math.min(Math.max(Math.round(raw / 1000) * 1000 || 30000, 5000), 500000);
    $('#tv_chunk_tokens').val(clamped);

    const settings = getSettings();
    settings.llmChunkTokens = clamped;
    saveSettingsDebounced();
}

function onVectorDedupToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.enableVectorDedup = enabled;
    saveSettingsDebounced();
    $('#tv_dedup_threshold_row').toggle(enabled);
    updateDedupStatus(enabled);
}

function onDedupThresholdChange() {
    const raw = Number($('#tv_dedup_threshold').val());
    const clamped = Math.min(Math.max(raw, 0.5), 0.99);
    $('#tv_dedup_threshold').val(clamped);

    const settings = getSettings();
    settings.vectorDedupThreshold = clamped;
    saveSettingsDebounced();
}

/**
 * Update the dedup status indicator.
 * @param {boolean} enabled
 */
function updateDedupStatus(enabled) {
    const $status = $('#tv_dedup_status');
    const $text = $('#tv_dedup_method_text');
    if (!enabled) {
        $status.hide();
        return;
    }
    $status.show();
    $text.text('Using trigram similarity — fast character n-gram matching that catches near-duplicates and morphological variants.');
}

// ─── Tree Building ───────────────────────────────────────────────

async function onBuildFromMetadata() {
    if (!currentLorebook) return;
    const $btn = $('#tv_build_metadata');
    try {
        $btn.prop('disabled', true).html('<span class="tv_loading"></span> Building...');
        const tree = await buildTreeFromMetadata(currentLorebook);
        toastr.success(`Built tree with ${(tree.root.children || []).length} categories`, 'TunnelVision');
        loadLorebookUI(currentLorebook);
        populateLorebookDropdown();
        registerTools();
    } catch (e) {
        toastr.error(e.message, 'TunnelVision');
        console.error('[TunnelVision]', e);
    } finally {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-sitemap"></i> From Metadata');
    }
}

async function onBuildWithLLM() {
    if (!currentLorebook) return;
    const $btn = $('#tv_build_llm');
    const $progress = $('#tv_build_progress');
    const $progressText = $('#tv_build_progress_text');
    const $progressFill = $('#tv_build_progress_fill');
    const $progressDetail = $('#tv_build_progress_detail');

    try {
        $btn.prop('disabled', true).html('<span class="tv_loading"></span> Building...');
        $('#tv_build_metadata').prop('disabled', true);
        $progress.slideDown(200);
        $progressFill.css('width', '0%');
        $progressDetail.text('');

        const tree = await buildTreeWithLLM(currentLorebook, {
            onProgress: (msg, pct) => {
                $progressText.text(msg);
                if (typeof pct === 'number') {
                    $progressFill.css('width', `${Math.min(pct, 100)}%`);
                }
            },
            onDetail: (msg) => $progressDetail.text(msg),
        });

        $progressFill.css('width', '100%');
        $progressText.text('Done!');
        toastr.success(`LLM built tree with ${(tree.root.children || []).length} categories`, 'TunnelVision');
        loadLorebookUI(currentLorebook);
        populateLorebookDropdown();
        registerTools();
    } catch (e) {
        toastr.error(e.message, 'TunnelVision');
        console.error('[TunnelVision]', e);
    } finally {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-brain"></i> With LLM');
        $('#tv_build_metadata').prop('disabled', false);
        setTimeout(() => $progress.slideUp(300), 2000);
    }
}

// ─── Chat Ingest ─────────────────────────────────────────────────

async function onIngestChat() {
    if (!currentLorebook) return;

    const context = getContext();
    if (!context.chatId || !context.chat?.length) {
        toastr.error('No chat is open. Open a chat first.', 'TunnelVision');
        return;
    }

    const from = parseInt($('#tv_ingest_from').val(), 10) || 0;
    const to = parseInt($('#tv_ingest_to').val(), 10) || 0;

    if (from > to) {
        toastr.warning('"From" must be less than or equal to "To".', 'TunnelVision');
        return;
    }

    const $btn = $('#tv_ingest_chat');
    const $progress = $('#tv_ingest_progress');
    const $progressText = $('#tv_ingest_progress_text');
    const $progressFill = $('#tv_ingest_progress_fill');
    const $progressDetail = $('#tv_ingest_progress_detail');

    try {
        $btn.prop('disabled', true).html('<span class="tv_loading"></span> Ingesting...');
        $progress.slideDown(200);
        $progressFill.css('width', '0%');
        $progressDetail.text('');

        const result = await ingestChatMessages(currentLorebook, {
            from,
            to,
            progress: (msg, pct) => {
                $progressText.text(msg);
                if (typeof pct === 'number') {
                    $progressFill.css('width', `${Math.min(pct, 100)}%`);
                }
            },
            detail: (msg) => $progressDetail.text(msg),
        });

        $progressFill.css('width', '100%');
        $progressText.text('Done!');
        toastr.success(`Created ${result.created} entries from chat (${result.errors} errors)`, 'TunnelVision');
        loadLorebookUI(currentLorebook);
        registerTools();
    } catch (e) {
        toastr.error(e.message, 'TunnelVision');
        console.error('[TunnelVision] Ingest error:', e);
    } finally {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-download"></i> Ingest Messages');
        setTimeout(() => $progress.slideUp(300), 2000);
    }
}

function onMandatoryToolsToggle() {
    const settings = getSettings();
    settings.mandatoryTools = $(this).prop('checked');
    saveSettingsDebounced();
    $('#tv_mandatory_prompt_options').toggle(settings.mandatoryTools);
}

function onPromptInjectionChange() {
    const settings = getSettings();
    const $el = $(this);
    const id = $el.attr('id') || '';

    if (id.startsWith('tv_mandatory_')) {
        const field = id.replace('tv_mandatory_', '');
        if (field === 'position') {
            settings.mandatoryPromptPosition = $el.val();
            $('#tv_mandatory_depth_row').toggle($el.val() === 'in_chat');
        } else if (field === 'depth') {
            settings.mandatoryPromptDepth = Math.max(1, Math.round(Number($el.val()) || 1));
            $el.val(settings.mandatoryPromptDepth);
        } else if (field === 'role') {
            settings.mandatoryPromptRole = $el.val();
        }
    } else if (id.startsWith('tv_notebook_')) {
        const field = id.replace('tv_notebook_', '');
        if (field === 'position') {
            settings.notebookPromptPosition = $el.val();
            $('#tv_notebook_depth_row').toggle($el.val() === 'in_chat');
        } else if (field === 'depth') {
            settings.notebookPromptDepth = Math.max(1, Math.round(Number($el.val()) || 1));
            $el.val(settings.notebookPromptDepth);
        } else if (field === 'role') {
            settings.notebookPromptRole = $el.val();
        }
    }

    saveSettingsDebounced();
}

function onMandatoryPromptTextChange() {
    const settings = getSettings();
    settings.mandatoryPromptText = $(this).val() || '';
    saveSettingsDebounced();
}

function onMandatoryPromptReset() {
    const settings = getSettings();
    settings.mandatoryPromptText = SETTING_DEFAULTS.mandatoryPromptText;
    $('#tv_mandatory_prompt_text').val(settings.mandatoryPromptText);
    saveSettingsDebounced();
}

function onStealthModeToggle() {
    const settings = getSettings();
    settings.stealthMode = $(this).prop('checked');
    saveSettingsDebounced();
    void refreshHiddenToolCallMessages({ syncFlags: true });
}

function onEphemeralResultsToggle() {
    const settings = getSettings();
    settings.ephemeralResults = $(this).prop('checked');
    $('#tv_ephemeral_filter_options').toggle(settings.ephemeralResults);
    saveSettingsDebounced();
}

function onEphemeralToolFilterChange() {
    const settings = getSettings();
    const selected = [];
    $('.tv_ephemeral_tool:checked').each(function () {
        selected.push($(this).val());
    });
    settings.ephemeralToolFilter = selected;
    saveSettingsDebounced();
}

// ─── Slash Commands Settings ─────────────────────────────────────

function onCommandContextChange() {
    const raw = Number($('#tv_command_context').val());
    const clamped = Math.min(Math.max(Math.round(raw) || 50, 5), 500);
    $('#tv_command_context').val(clamped);
    const settings = getSettings();
    settings.commandContextMessages = clamped;
    saveSettingsDebounced();
}

// ─── Auto-Summary Settings ──────────────────────────────────────

function onAutoSummaryToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.autoSummaryEnabled = enabled;
    saveSettingsDebounced();
    $('#tv_auto_summary_options').toggle(enabled);
}

function onAutoSummaryIntervalChange() {
    const raw = Number($('#tv_auto_summary_interval').val());
    const clamped = Math.min(Math.max(Math.round(raw) || 20, 5), 200);
    $('#tv_auto_summary_interval').val(clamped);
    const settings = getSettings();
    settings.autoSummaryInterval = clamped;
    saveSettingsDebounced();
}

function onAutoHideSummarizedToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.autoHideSummarized = enabled;
    saveSettingsDebounced();
}

function onPassthroughConstantToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.passthroughConstant = enabled;
    saveSettingsDebounced();
}

function onAllowKeywordTriggersToggle() {
    const enabled = $(this).prop('checked');
    const settings = getSettings();
    settings.allowKeywordTriggers = enabled;
    saveSettingsDebounced();
}

// ─── Multi-Book Mode ─────────────────────────────────────────────

function onMultiBookModeChange() {
    const mode = $('input[name="tv_multi_book_mode"]:checked').val();
    const settings = getSettings();
    settings.multiBookMode = mode;
    saveSettingsDebounced();
    registerTools();
}

// ─── Sidecar LLM (Connection Profile + Sampler Overrides) ───────

function onConnectionProfileChange() {
    setConnectionProfileId($(this).val() || null);
    // Show/hide sampler controls when a profile is selected
    $('#tv_sidecar_sampler_fields').toggle(!!$(this).val());
}

function onSidecarTemperatureChange() {
    const val = parseFloat($(this).val());
    const settings = getSettings();
    settings.sidecarTemperature = val;
    $('#tv_sidecar_temp_val').text(val.toFixed(2));
    saveSettingsDebounced();
}

function onSidecarMaxTokensChange() {
    const settings = getSettings();
    settings.sidecarMaxTokens = Number($(this).val()) || 2048;
    saveSettingsDebounced();
}

function onSidecarAutoRetrievalToggle() {
    const settings = getSettings();
    settings.sidecarAutoRetrieval = $(this).prop('checked');
    $('#tv_sidecar_retrieval_fields').toggle(settings.sidecarAutoRetrieval);
    saveSettingsDebounced();
}

function onSidecarContextMessagesChange() {
    const settings = getSettings();
    settings.sidecarContextMessages = Number($(this).val()) || 10;
    saveSettingsDebounced();
}

function onSidecarMaxInjectionChange() {
    const settings = getSettings();
    settings.sidecarMaxInjectionTokens = Number($(this).val()) || 4000;
    saveSettingsDebounced();
}

function onSidecarFollowLinksToggle() {
    const settings = getSettings();
    settings.sidecarFollowLinks = $(this).prop('checked');
    saveSettingsDebounced();
}

function onSidecarLinkDepthChange() {
    const settings = getSettings();
    settings.sidecarLinkDepth = Number($(this).val()) || 2;
    saveSettingsDebounced();
}

function onSidecarPostGenWriterToggle() {
    const settings = getSettings();
    settings.sidecarPostGenWriter = $(this).prop('checked');
    $('#tv_sidecar_writer_fields').toggle(settings.sidecarPostGenWriter);
    saveSettingsDebounced();
}

function onCompactToolPromptsToggle() {
    const settings = getSettings();
    settings.compactToolPrompts = $(this).prop('checked');
    saveSettingsDebounced();
    registerTools();
}

function onSidecarWriterContextChange() {
    const settings = getSettings();
    settings.sidecarWriterContextMessages = Number($(this).val()) || 15;
    saveSettingsDebounced();
}

function onSidecarWriterMaxOpsChange() {
    const settings = getSettings();
    settings.sidecarWriterMaxOps = Number($(this).val()) || 5;
    saveSettingsDebounced();
}

// ─── Per-Lorebook Permissions ────────────────────────────────────

function onBookPermissionChange() {
    if (!currentLorebook) return;
    setBookPermission(currentLorebook, $(this).val() || 'read_write');
    registerTools();
}

function populateConnectionProfiles() {
    const $select = $('#tv_connection_profile');
    const currentVal = getConnectionProfileId() || '';

    // Keep the first option (default)
    $select.find('option:not(:first)').remove();

    for (const profile of listConnectionProfiles().sort((a, b) => (a.name || '').localeCompare(b.name || ''))) {
        if (!profile?.id || !profile?.name) continue;
        $select.append($('<option></option>').val(profile.id).text(profile.name));
    }

    $select.val(currentVal);

    // Sync sampler controls
    const settings = getSettings();
    $('#tv_sidecar_temperature').val(settings.sidecarTemperature ?? 0.2);
    $('#tv_sidecar_temp_val').text((settings.sidecarTemperature ?? 0.2).toFixed(2));
    $('#tv_sidecar_max_tokens').val(settings.sidecarMaxTokens || 2048);
    $('#tv_sidecar_sampler_fields').toggle(!!currentVal);

    // Sync auto-retrieval controls
    const autoRetrieval = settings.sidecarAutoRetrieval === true;
    $('#tv_sidecar_auto_retrieval').prop('checked', autoRetrieval);
    $('#tv_sidecar_retrieval_fields').toggle(autoRetrieval);
    $('#tv_sidecar_context_messages').val(settings.sidecarContextMessages ?? 10);
    $('#tv_sidecar_max_injection').val(settings.sidecarMaxInjectionTokens ?? 4000);
    $('#tv_sidecar_follow_links').prop('checked', settings.sidecarFollowLinks !== false);
    $('#tv_sidecar_link_depth').val(settings.sidecarLinkDepth ?? 2);

    // Sync conditional triggers toggle
    $('#tv_conditional_triggers').prop('checked', settings.conditionalTriggersEnabled !== false);

    // Sync compact tool prompts
    $('#tv_compact_tool_prompts').prop('checked', settings.compactToolPrompts === true);

    // Sync post-gen writer controls
    const postGenWriter = settings.sidecarPostGenWriter === true;
    $('#tv_sidecar_post_gen_writer').prop('checked', postGenWriter);
    $('#tv_sidecar_writer_fields').toggle(postGenWriter);
    $('#tv_sidecar_writer_context').val(settings.sidecarWriterContextMessages ?? 15);
    $('#tv_sidecar_writer_max_ops').val(settings.sidecarWriterMaxOps ?? 5);
}

// ─── Tree Management ─────────────────────────────────────────────

/**
 * Open the tree editor for a specific lorebook. Exported for use by the activity feed.
 * Sets currentLorebook so internal state stays consistent.
 * @param {string} bookName
 */
export async function openTreeEditorForBook(bookName) {
    selectCurrentLorebook(bookName);
    await onOpenTreeEditor();
}

async function onOpenTreeEditor() {
    if (!currentLorebook) return;
    const tree = getTree(currentLorebook);
    if (!tree || !tree.root) {
        toastr.warning('Build a tree first before opening the editor.', 'TunnelVision');
        return;
    }

    const bookData = await loadWorldInfo(currentLorebook);
    if (bookData?.entries) {
        await syncTrackerUidsForLorebook(currentLorebook, bookData.entries);
    }
    const entryLookup = buildEntryLookup(bookData);
    const bookName = currentLorebook;

    // State: which node is selected in the tree
    let selectedNode = tree.root;

    // Build the popup content
    const $popup = $('<div class="tv-popup-editor"></div>');

    // Toolbar
    const $toolbar = $(`<div class="tv-popup-toolbar">
        <div class="tv-popup-toolbar-left">
            <span class="tv-popup-title"><i class="fa-solid fa-folder-tree"></i> ${escapeHtml(bookName)}</span>
        </div>
        <div class="tv-popup-toolbar-right">
            <button class="tv-popup-btn" id="tv_popup_add_cat" title="Add category"><i class="fa-solid fa-folder-plus"></i> Add Category</button>
            <button class="tv-popup-btn" id="tv_popup_load_schema" title="Load schema template"><i class="fa-solid fa-table-cells"></i> Load Schema</button>
            <button class="tv-popup-btn" id="tv_popup_save_schema" title="Save tree as template"><i class="fa-solid fa-bookmark"></i> Save as Template</button>
            <button class="tv-popup-btn" id="tv_popup_regen" title="Regenerate summaries"><i class="fa-solid fa-rotate"></i> Regen Summaries</button>
            <button class="tv-popup-btn" id="tv_popup_export" title="Export"><i class="fa-solid fa-file-export"></i></button>
            <button class="tv-popup-btn" id="tv_popup_import" title="Import"><i class="fa-solid fa-file-import"></i></button>
            <button class="tv-popup-btn tv-popup-btn-danger" id="tv_popup_delete" title="Delete tree"><i class="fa-solid fa-trash-can"></i></button>
        </div>
    </div>`);
    $popup.append($toolbar);

    // Search bar
    const $search = $(`<div class="tv-popup-search">
        <i class="fa-solid fa-magnifying-glass"></i>
        <input type="text" id="tv_popup_search" placeholder="Search categories and entries..." />
    </div>`);
    $popup.append($search);

    // Body: tree sidebar + main panel
    const $body = $('<div class="tv-popup-body"></div>');
    const $treeSidebar = $('<div class="tv-tree-sidebar"></div>');
    const $treeHeader = $('<div class="tv-tree-sidebar-header"><span>Tree</span></div>');
    const $treeScroll = $('<div class="tv-tree-sidebar-scroll"></div>');
    $treeSidebar.append($treeHeader, $treeScroll);

    const $mainPanel = $('<div class="tv-main-panel"></div>');

    $body.append($treeSidebar, $mainPanel);
    $popup.append($body);

    // --- Render functions ---

    function selectNode(node) {
        selectedNode = node;
        renderTreeNodes();
        renderMainPanel();
    }

    function isRootNode(node) {
        return !!node && node.id === tree.root.id;
    }

    function countActiveEntries(node) {
        return getAllEntryUids(node).filter(uid => !!entryLookup[uid] && !entryLookup[uid].disable).length;
    }

    function assignEntryToNode(uid, targetNode) {
        removeEntryFromTree(tree.root, uid);
        addEntryToNode(targetNode, uid);
        saveTree(bookName, tree);
    }

    function renderTreeNodes() {
        $treeScroll.empty();
        $treeScroll.append(buildTreeNode(tree.root, 0, { isRoot: true }));
        // Unassigned pseudo-node
        const unassigned = getUnassignedEntries(bookData, tree);
        if (unassigned.length > 0) {
            const $unRow = $('<div class="tv-tree-row tv-tree-row-unassigned"></div>');
            $unRow.append($('<span class="tv-tree-toggle"></span>'));
            $unRow.append($('<span class="tv-tree-dot" style="opacity:0.4"></span>'));
            $unRow.append($('<span class="tv-tree-label" style="color:var(--SmartThemeQuoteColor,#888)"></span>').text('Unassigned'));
            $unRow.append($(`<span class="tv-tree-count">${unassigned.length}</span>`));
            $unRow.on('click', () => {
                selectedNode = { id: '__unassigned__', label: 'Unassigned', entryUids: unassigned.map(e => e.uid), children: [] };
                renderTreeNodes();
                renderMainPanel();
            });
            if (selectedNode?.id === '__unassigned__') $unRow.addClass('active');
            $treeScroll.append($('<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--SmartThemeBorderColor,#444)"></div>').append($unRow));
        }
    }

    function buildTreeNode(node, depth, { isRoot = false } = {}) {
        const $wrapper = $('<div class="tv-tree-node"></div>');
        const hasChildren = (node.children || []).length > 0;
        const isActive = selectedNode?.id === node.id;
        const count = countActiveEntries(node);
        const label = isRoot ? 'Root' : (node.label || 'Unnamed');

        const $row = $(`<div class="tv-tree-row${isActive ? ' active' : ''}${isRoot ? ' tv-tree-row-root' : ''}"></div>`);
        const $toggle = $(`<span class="tv-tree-toggle">${hasChildren ? (node.collapsed ? '\u25B6' : '\u25BC') : ''}</span>`);
        const $dot = $('<span class="tv-tree-dot"></span>');
        const $label = $('<span class="tv-tree-label"></span>').text(label);
        const $count = $(`<span class="tv-tree-count">${count}</span>`);

        // Schema indicator — show a document icon if node has a template (own or inherited)
        if (!isRoot && hasEffectiveTemplate(tree.root, node.id)) {
            const $schemaIcon = $('<i class="fa-solid fa-file-lines tv-schema-indicator" title="Has template"></i>');
            $row.append($toggle, $dot, $label, $schemaIcon, $count);
        } else {
            $row.append($toggle, $dot, $label, $count);
        }

        // Click toggle to expand/collapse
        $toggle.on('click', (e) => {
            e.stopPropagation();
            node.collapsed = !node.collapsed;
            saveTree(bookName, tree);
            renderTreeNodes();
        });

        // Click row to select
        $row.on('click', () => selectNode(node));

        // Drop target: drag entries onto tree nodes
        $row.on('dragover', (e) => { e.preventDefault(); $row.addClass('tv-tree-drop-target'); });
        $row.on('dragleave', () => $row.removeClass('tv-tree-drop-target'));
        $row.on('drop', (e) => {
            e.preventDefault();
            $row.removeClass('tv-tree-drop-target');
            const raw = e.originalEvent.dataTransfer.getData('text/plain');
            if (!raw || !/^\d+$/.test(raw)) return;
            const uid = Number(raw);
            assignEntryToNode(uid, node);
            selectNode(node);
            renderUnassignedEntries(bookName, tree, bookData);
            registerTools();
        });

        $wrapper.append($row);

        // Children (recursive — no depth limit)
        if (hasChildren && !node.collapsed) {
            const $children = $('<div class="tv-tree-children"></div>');
            for (const child of node.children) {
                $children.append(buildTreeNode(child, depth + 1));
            }
            $wrapper.append($children);
        }

        return $wrapper;
    }

    function buildBreadcrumb(node) {
        if (node.id === '__unassigned__') {
            const $bc = $('<div class="tv-main-breadcrumb"></div>');
            const $rootCrumb = $('<span class="tv-bc-crumb"></span>').text('Root');
            $rootCrumb.on('click', () => selectNode(tree.root));
            $bc.append($rootCrumb);
            $bc.append($('<span class="tv-bc-sep">\u25B8</span>'));
            $bc.append($('<span class="tv-bc-current"></span>').text('Unassigned'));
            return $bc;
        }

        const path = [];
        const findPath = (current, target, trail) => {
            trail.push(current);
            if (current.id === target.id) return true;
            for (const child of (current.children || [])) {
                if (findPath(child, target, trail)) return true;
            }
            trail.pop();
            return false;
        };
        findPath(tree.root, node, path);

        const $bc = $('<div class="tv-main-breadcrumb"></div>');
        for (let i = 0; i < path.length; i++) {
            if (i > 0) $bc.append($('<span class="tv-bc-sep">\u25B8</span>'));
            const n = path[i];
            const label = n === tree.root ? 'Root' : (n.label || 'Unnamed');
            if (i < path.length - 1) {
                const $crumb = $('<span class="tv-bc-crumb"></span>').text(label);
                $crumb.on('click', () => selectNode(n));
                $bc.append($crumb);
            } else {
                $bc.append($('<span class="tv-bc-current"></span>').text(label));
            }
        }
        return $bc;
    }

    function renderMainPanel() {
        $mainPanel.empty();
        const node = selectedNode;
        if (!node) return;

        const isUnassigned = node.id === '__unassigned__';
        const isRoot = isRootNode(node);

        // Header
        const $header = $('<div class="tv-main-header"></div>');
        $header.append(buildBreadcrumb(node));

        const $titleRow = $('<div class="tv-main-title-row"></div>');
        if (!isUnassigned && !isRoot) {
            const $titleInput = $(`<input class="tv-main-title" type="text" />`).val(node.label || 'Unnamed');
            $titleInput.on('change', function () {
                node.label = $(this).val().trim() || 'Unnamed';
                saveTree(bookName, tree);
                renderTreeNodes();
                registerTools();
            });
            $titleRow.append($titleInput);

            const $actions = $('<div class="tv-main-title-actions"></div>');
            const $addSub = $('<button class="tv-popup-btn" title="Add sub-category"><i class="fa-solid fa-folder-plus"></i></button>');
            $addSub.on('click', () => {
                node.children = node.children || [];
                node.children.push(createTreeNode('New Sub-category'));
                node.collapsed = false;
                saveTree(bookName, tree);
                selectNode(node);
                registerTools();
            });
            const $regenSummary = $('<button class="tv-popup-btn" title="Regenerate summary for this node"><i class="fa-solid fa-arrows-rotate"></i></button>');
            $regenSummary.on('click', async (e) => {
                e.stopPropagation();
                const $icon = $regenSummary.find('i');
                try {
                    $regenSummary.prop('disabled', true);
                    $icon.addClass('fa-spin');
                    // Wrap in temp parent so the target node gets summarized (not skipped as root)
                    const tempWrapper = { children: [node], entryUids: [] };
                    await generateSummariesForTree(tempWrapper, bookName, true);
                    saveTree(bookName, tree);
                    renderTreeNodes();
                    renderMainPanel();
                    toastr.success(`Summary regenerated for "${node.label}".`, 'TunnelVision');
                } catch (err) {
                    toastr.error(err.message, 'TunnelVision');
                } finally {
                    $regenSummary.prop('disabled', false);
                    $icon.removeClass('fa-spin');
                }
            });
            const $delNode = $('<button class="tv-popup-btn tv-popup-btn-danger" title="Delete this node"><i class="fa-solid fa-trash-can"></i></button>');
            $delNode.on('click', () => {
                if (!confirm(`Delete "${node.label}" and unassign its entries?`)) return;
                removeNode(tree.root, node.id);
                saveTree(bookName, tree);
                selectedNode = tree.root;
                renderTreeNodes();
                renderMainPanel();
                renderUnassignedEntries(bookName, tree, bookData);
                registerTools();
            });
            $actions.append($addSub, $regenSummary, $delNode);
            $titleRow.append($actions);
        } else {
            $titleRow.append($('<div class="tv-main-title-static"></div>').text(isUnassigned ? 'Unassigned Entries' : 'Root'));
            if (isRoot) {
                const $actions = $('<div class="tv-main-title-actions"></div>');
                const $addSub = $('<button class="tv-popup-btn" title="Add category under root"><i class="fa-solid fa-folder-plus"></i></button>');
                $addSub.on('click', () => {
                    tree.root.children = tree.root.children || [];
                    tree.root.children.push(createTreeNode('New Category'));
                    tree.root.collapsed = false;
                    saveTree(bookName, tree);
                    selectNode(tree.root);
                    registerTools();
                });
                $actions.append($addSub);
                $titleRow.append($actions);
            }
        }
        $header.append($titleRow);
        $mainPanel.append($header);

        // Scrollable body
        const $body = $('<div class="tv-main-body"></div>');

        // Node summary
        if (node.summary && !isUnassigned && !isRoot) {
            $body.append($(`<div class="tv-node-summary">
                <div class="tv-node-summary-label">Node Summary</div>
                <div class="tv-node-summary-text"></div>
            </div>`).find('.tv-node-summary-text').text(node.summary).end());
        }

        // Template section (only for non-root, non-unassigned nodes)
        if (!isUnassigned && !isRoot) {
            const $templateSection = $('<div class="tv-template-section"></div>');

            // Editable template textarea
            const $templateLabel = $('<div class="tv-template-label">Entry Template</div>');
            const $templateHelp = $('<div class="tv-template-help">Define sections using markdown headings (e.g., #Appearance, #Personality). Child nodes inherit and add sections.</div>');
            const $templateTextarea = $('<textarea class="tv-template-textarea" rows="3" placeholder="# Appearance\n# Personality\n# Background"></textarea>');
            $templateTextarea.val(node.template || '');

            $templateTextarea.on('change', function () {
                node.template = $(this).val();
                saveTree(bookName, tree);
                renderTreeNodes(); // refresh schema indicators
                renderMainPanel(); // refresh effective template preview
                registerTools();
            });

            $templateSection.append($templateLabel, $templateHelp, $templateTextarea);

            // Effective template preview (read-only)
            const effectiveTemplate = getEffectiveTemplateForNode(tree.root, node.id);
            if (effectiveTemplate) {
                const sections = parseTemplateSections(effectiveTemplate);
                const $preview = $('<div class="tv-effective-template"></div>');
                const $previewLabel = $('<div class="tv-effective-template-label">Effective Template (inherited + own)</div>');
                const $previewTags = $('<div class="tv-effective-template-tags"></div>');
                for (const section of sections) {
                    $previewTags.append($(`<span class="tv-effective-template-tag"># ${escapeHtml(section)}</span>`));
                }
                $preview.append($previewLabel, $previewTags);
                $templateSection.append($preview);
            }

            $body.append($templateSection);
        }

        // Direct entries
        const entryUids = node.entryUids || [];
        const showNewEntry = !isUnassigned;

        if (entryUids.length > 0 || showNewEntry) {
            const sectionLabel = isRoot ? 'Root Entries' : isUnassigned ? 'Unassigned Entries' : 'Direct Entries';
            const $sectionHeader = $('<div class="tv-entry-section-title"></div>');
            $sectionHeader.append($(`<span>${sectionLabel} <span class="tv-entry-section-count">(${entryUids.length})</span></span>`));
            if (showNewEntry) {
                $sectionHeader.append($('<span style="flex:1"></span>'));
                const $newBtn = $('<button class="tv-popup-btn tv-popup-btn-sm" title="Create a new entry in this node"><i class="fa-solid fa-plus"></i> New Entry</button>');
                $newBtn.on('click', (e) => { e.stopPropagation(); openNewEntryDialog(node.id); });
                $sectionHeader.append($newBtn);
            }
            $body.append($sectionHeader);

            if (entryUids.length > 0) {
                const $list = $('<div class="tv-entry-list-rows"></div>');
                for (const uid of entryUids) {
                    $list.append(buildEntryRow(uid, entryLookup[uid], node, bookName, tree, isUnassigned));
                }
                $body.append($list);
            }
        }

        // Child nodes
        const children = node.children || [];
        if (children.length > 0) {
            $body.append($(`<div class="tv-entry-section-title">Sub-categories <span class="tv-entry-section-count">(${children.length})</span></div>`));
            const $cards = $('<div class="tv-child-cards"></div>');
            for (const child of children) {
                const childCount = countActiveEntries(child);
                const hasTemplate = hasEffectiveTemplate(tree.root, child.id);
                const $card = $(`<div class="tv-child-card${hasTemplate ? ' tv-child-card-schema' : ''}"></div>`);
                $card.append($('<span class="tv-tree-dot"></span>'));
                const $info = $('<div class="tv-child-card-info"></div>');
                const $nameRow = $('<div class="tv-child-card-name-row"></div>');
                $nameRow.append($('<span class="tv-child-card-name"></span>').text(child.label || 'Unnamed'));
                if (hasTemplate) {
                    $nameRow.append($('<i class="fa-solid fa-file-lines tv-child-card-schema-icon" title="Has template"></i>'));
                }
                $info.append($nameRow);
                if (child.summary) {
                    $info.append($('<div class="tv-child-card-summary"></div>').text(child.summary));
                }
                $card.append($info);
                $card.append($(`<span class="tv-child-card-count">${childCount}</span>`));
                $card.append($('<span class="tv-child-card-arrow">\u25B8</span>'));
                $card.on('click', () => {
                    child.collapsed = false;
                    saveTree(bookName, tree);
                    selectNode(child);
                });
                $cards.append($card);
            }
            $body.append($cards);
        }

        $mainPanel.append($body);
    }

    function buildEntryRow(uid, entry, node, bookName, tree, isUnassigned) {
        const label = entry ? (entry.comment || entry.key?.[0] || `#${uid}`) : `#${uid} (deleted)`;

        const $row = $(`<div class="tv-entry-row" draggable="true" data-uid="${uid}"></div>`);
        $row.append($('<span class="tv-entry-drag">\u22EE\u22EE</span>'));
        $row.append($('<span class="tv-entry-name"></span>').text(label));
        $row.append($(`<span class="tv-entry-uid">#${uid}</span>`));

        // Tracker toggle
        if (entry) {
            const tracked = isTrackerUid(bookName, uid);
            const $tracker = $(`<button class="tv-btn-icon tv-entry-tracker ${tracked ? 'is-on' : ''}" title="${tracked ? 'Tracked entry' : 'Track this entry'}"><i class="fa-solid ${tracked ? 'fa-location-crosshairs' : 'fa-location-dot'}"></i></button>`);
            $tracker.on('click', (e) => {
                e.stopPropagation();
                const nextTracked = !$tracker.hasClass('is-on');
                setTrackerUid(bookName, uid, nextTracked);
                $tracker.toggleClass('is-on', nextTracked);
                $tracker.attr('title', nextTracked ? 'Tracked entry' : 'Track this entry');
                $tracker.find('i').attr('class', `fa-solid ${nextTracked ? 'fa-location-crosshairs' : 'fa-location-dot'}`);
                registerTools();
            });
            $row.append($tracker);
        }

        // Enable/disable toggle
        if (entry) {
            const isDisabled = !!entry.disable;
            const $toggle = $(`<button class="tv-btn-icon tv-entry-toggle ${isDisabled ? 'is-off' : ''}" title="${isDisabled ? 'Enable entry' : 'Disable entry'}"><i class="fa-solid ${isDisabled ? 'fa-eye-slash' : 'fa-eye'}"></i></button>`);
            $toggle.on('click', async (e) => {
                e.stopPropagation();
                const wasTracked = isTrackerUid(bookName, uid);
                entry.disable = !entry.disable;
                await saveWorldInfo(bookName, bookData, true);
                if (entry.disable) {
                    setTrackerUid(bookName, uid, false);
                } else if (wasTracked || isTrackerTitle(entry.comment)) {
                    setTrackerUid(bookName, uid, true);
                }
                $toggle.toggleClass('is-off', !!entry.disable);
                $toggle.attr('title', entry.disable ? 'Enable entry' : 'Disable entry');
                $toggle.find('i').attr('class', `fa-solid ${entry.disable ? 'fa-eye-slash' : 'fa-eye'}`);
                $row.toggleClass('is-disabled', !!entry.disable);
                renderTreeNodes();
                renderMainPanel();
                await renderUnassignedEntries(bookName, tree, bookData);
                registerTools();
            });
            $row.append($toggle);
            if (isDisabled) $row.addClass('is-disabled');
        }

        if (!isUnassigned) {
            const $remove = $('<button class="tv-btn-icon tv-btn-danger-icon tv-entry-remove" title="Remove from node"><i class="fa-solid fa-xmark"></i></button>');
            $remove.on('click', async (e) => {
                e.stopPropagation();
                node.entryUids = (node.entryUids || []).filter(u => u !== uid);
                saveTree(bookName, tree);
                renderMainPanel();
                renderTreeNodes();
                await renderUnassignedEntries(bookName, tree, bookData);
                registerTools();
            });
            $row.append($remove);
        }

        // Drag
        $row.on('dragstart', (e) => {
            e.originalEvent.dataTransfer.setData('text/plain', String(uid));
            $row.addClass('dragging');
        });
        $row.on('dragend', () => $row.removeClass('dragging'));

        // Click to inline-expand entry detail
        if (entry) {
            $row.on('click', function () {
                const $existing = $row.next('.tv-entry-expand');
                if ($existing.length) {
                    $existing.slideUp(150, () => $existing.remove());
                    $row.removeClass('expanded');
                    return;
                }
                // Close any other expanded entries
                $row.closest('.tv-entry-list-rows').find('.tv-entry-expand').slideUp(150, function () { $(this).remove(); });
                $row.closest('.tv-entry-list-rows').find('.tv-entry-row').removeClass('expanded');

                $row.addClass('expanded');
                const $expand = $('<div class="tv-entry-expand" style="display:none"></div>');

                // Node summary context
                if (node.summary && !isUnassigned && !isRootNode(node)) {
                    $expand.append($(`<div class="tv-expand-node-box">
                        <div class="tv-expand-node-label">Parent node: ${escapeHtml(node.label || 'Unnamed')}</div>
                        <div class="tv-expand-node-text"></div>
                    </div>`).find('.tv-expand-node-text').text(node.summary).end());
                }

                // Keys (filter out condition tags — shown separately below)
                const allKeys = entry.key || [];
                const regularKeys = allKeys.filter(k => !isEvaluableCondition(k));
                if (regularKeys.length > 0) {
                    const $keys = $('<div class="tv-expand-keys"></div>');
                    $keys.append($('<span class="tv-expand-label">Keys</span>'));
                    const $tags = $('<div class="tv-expand-key-tags"></div>');
                    for (const k of regularKeys) {
                        $tags.append($('<span class="tv-expand-key-tag"></span>').text(k));
                    }
                    $keys.append($tags);
                    $expand.append($keys);
                }

                // Conditions editor — parsed from key[] and keysecondary[]
                {
                    const primaryParsed = separateConditions(entry.key || []);
                    const secondaryParsed = separateConditions(entry.keysecondary || []);
                    const hasPrimary = primaryParsed.conditions.length > 0;
                    const hasSecondary = secondaryParsed.conditions.length > 0;

                    const $condSection = $('<div class="tv-expand-conditions"></div>');
                    $condSection.append($('<span class="tv-expand-label">Conditions</span>'));

                    // Render existing condition tags
                    const $condTags = $('<div class="tv-condition-tags"></div>');

                    const renderCondTag = (cond, group) => {
                        const typeLabel = (CONDITION_LABELS[cond.type] || cond.type).toUpperCase();
                        const condStr = formatCondition(cond);
                        const negatedClass = cond.negated ? ' is-negated' : '';
                        const negTitle = cond.negated ? 'Negated — click to un-negate' : 'Not negated — click to negate';
                        const prob = getKeywordProbability(entry, condStr);
                        const probClass = prob < 100 ? ' tv-condition-prob-reduced' : '';
                        const $tag = $(`<span class="tv-condition-tag${negatedClass}" data-group="${group}" title="${group} condition">
                            <button class="tv-condition-neg-toggle tv-btn-icon" title="${negTitle}"><i class="fa-solid ${cond.negated ? 'fa-ban' : 'fa-check'}"></i></button>
                            <span class="tv-condition-type">${typeLabel}</span>:<span class="tv-condition-value">${escapeHtml(cond.value)}</span>
                            <span class="tv-condition-prob${probClass}" title="Click to change probability (0-100)">${prob}%</span>
                            <i class="fa-solid fa-xmark tv-condition-remove" title="Remove condition"></i>
                        </span>`);
                        $tag.find('.tv-condition-prob').on('click', (e) => {
                            e.stopPropagation();
                            const current = getKeywordProbability(entry, condStr);
                            const input = prompt(`Probability for ${condStr} (0-100):`, String(current));
                            if (input === null) return;
                            const val = parseInt(input, 10);
                            if (isNaN(val) || val < 0 || val > 100) return;
                            setKeywordProbability(entry, condStr, val);
                            saveWorldInfo(bookName, bookData, true);
                            $tag.find('.tv-condition-prob').text(`${val}%`).toggleClass('tv-condition-prob-reduced', val < 100);
                            toastr.info(`Set ${condStr} probability to ${val}%`, 'TunnelVision');
                        });
                        $tag.find('.tv-condition-neg-toggle').on('click', (e) => {
                            e.stopPropagation();
                            const oldStr = formatCondition(cond);
                            const targetArr = group === 'primary' ? entry.key : entry.keysecondary;
                            const idx = targetArr.indexOf(oldStr);
                            if (idx < 0) return;
                            // Migrate probability to new condition string
                            const oldProb = getKeywordProbability(entry, oldStr);
                            cond.negated = !cond.negated;
                            const newStr = formatCondition(cond);
                            targetArr[idx] = newStr;
                            if (oldProb < 100) {
                                setKeywordProbability(entry, newStr, oldProb);
                            }
                            if (entry.tvKeywordProbability?.[oldStr] !== undefined) {
                                delete entry.tvKeywordProbability[oldStr];
                            }
                            saveWorldInfo(bookName, bookData, true);
                            $tag.toggleClass('is-negated', !!cond.negated);
                            const $icon = $tag.find('.tv-condition-neg-toggle i');
                            $icon.attr('class', `fa-solid ${cond.negated ? 'fa-ban' : 'fa-check'}`);
                            $tag.find('.tv-condition-neg-toggle').attr('title', cond.negated ? 'Negated — click to un-negate' : 'Not negated — click to negate');
                            toastr.info(`${newStr} (${group})`, 'TunnelVision');
                        });
                        $tag.find('.tv-condition-remove').on('click', (e) => {
                            e.stopPropagation();
                            const targetArr = group === 'primary' ? entry.key : entry.keysecondary;
                            const idx = targetArr.indexOf(condStr);
                            if (idx >= 0) {
                                targetArr.splice(idx, 1);
                                // Clean up probability data
                                if (entry.tvKeywordProbability?.[condStr] !== undefined) {
                                    delete entry.tvKeywordProbability[condStr];
                                }
                                saveWorldInfo(bookName, bookData, true);
                                $tag.fadeOut(150, () => $tag.remove());
                                toastr.info(`Removed ${condStr}`, 'TunnelVision');
                            }
                        });
                        return $tag;
                    };

                    for (const c of primaryParsed.conditions) $condTags.append(renderCondTag(c, 'primary'));
                    for (const c of secondaryParsed.conditions) $condTags.append(renderCondTag(c, 'secondary'));

                    if (!hasPrimary && !hasSecondary) {
                        $condTags.append($('<span class="tv-condition-empty">No conditions set</span>'));
                    }
                    $condSection.append($condTags);

                    // Add condition controls
                    const typeOptions = [...EVALUABLE_TYPES].map(t => `<option value="${t}">${CONDITION_LABELS[t] || t}</option>`).join('');
                    const $addRow = $(`<div class="tv-condition-add-row">
                        <select class="tv-condition-type-select"><${typeOptions}</select>
                        <input type="text" class="tv-condition-value-input" placeholder="value (e.g. tense, forest)" />
                        <select class="tv-condition-group-select">
                            <option value="primary">Primary</option>
                            <option value="secondary">Secondary</option>
                        </select>
                        <button class="tv-popup-btn tv-popup-btn-sm tv-condition-add-btn" title="Add condition"><i class="fa-solid fa-plus"></i></button>
                    </div>`);

                    $addRow.find('.tv-condition-add-btn').on('click', (e) => {
                        e.stopPropagation();
                        const type = $addRow.find('.tv-condition-type-select').val();
                        const value = $addRow.find('.tv-condition-value-input').val().trim();
                        const group = $addRow.find('.tv-condition-group-select').val();
                        if (!value) {
                            toastr.warning('Enter a condition value.', 'TunnelVision');
                            return;
                        }
                        const condStr = `[${type}:${value}]`;
                        const targetArr = group === 'primary' ? (entry.key || (entry.key = [])) : (entry.keysecondary || (entry.keysecondary = []));
                        if (targetArr.includes(condStr)) {
                            toastr.warning('Condition already exists.', 'TunnelVision');
                            return;
                        }
                        targetArr.push(condStr);
                        saveWorldInfo(bookName, bookData, true);
                        // Add tag visually
                        $condTags.find('.tv-condition-empty').remove();
                        $condTags.append(renderCondTag({ type, value, negated: false }, group));
                        $addRow.find('.tv-condition-value-input').val('');
                        toastr.success(`Added ${condStr} (${group})`, 'TunnelVision');
                    });

                    // Allow Enter key to add
                    $addRow.find('.tv-condition-value-input').on('keydown', (e) => {
                        if (e.key === 'Enter') {
                            e.stopPropagation();
                            $addRow.find('.tv-condition-add-btn').trigger('click');
                        }
                    });

                    $condSection.append($addRow);
                    $expand.append($condSection);
                }

                // Links editor
                {
                    const $linksSection = $('<div class="tv-expand-links"></div>');
                    $linksSection.append($('<span class="tv-expand-label">Links</span>'));

                    // Outgoing links (this entry links to others)
                    const $outgoingLinks = $('<div class="tv-links-subsection"></div>');
                    $outgoingLinks.append($('<div class="tv-links-subtitle">Links to:</div>'));

                    const $outgoingTags = $('<div class="tv-links-tags"></div>');
                    const outgoingLinks = getEntryLinks(bookName, uid);

                    const renderOutgoingLink = (link) => {
                        const linkedEntry = bookData.entries[Object.keys(bookData.entries).find(k => bookData.entries[k].uid === link.uid)];
                        const linkedTitle = linkedEntry ? (linkedEntry.comment || `Entry #${link.uid}`) : `Entry #${link.uid}`;
                        const $tag = $(`<span class="tv-link-tag tv-link-outgoing" title="UID: ${link.uid}">
                            <span class="tv-link-title">${escapeHtml(linkedTitle)}</span>
                            <span class="tv-link-relation">→ ${escapeHtml(link.relation)}</span>
                            <i class="fa-solid fa-xmark tv-link-remove" title="Remove link"></i>
                        </span>`);

                        $tag.find('.tv-link-remove').on('click', (e) => {
                            e.stopPropagation();
                            if (confirm(`Remove link to "${linkedTitle}"?`)) {
                                removeEntryLink(bookName, uid, link.uid);
                                $tag.fadeOut(150, () => {
                                    $tag.remove();
                                    if ($outgoingTags.children().length === 0) {
                                        $outgoingTags.append('<span class="tv-links-empty">No outgoing links</span>');
                                    }
                                });
                                toastr.info('Link removed.', 'TunnelVision');
                            }
                        });

                        return $tag;
                    };

                    if (outgoingLinks.length > 0) {
                        for (const link of outgoingLinks) {
                            $outgoingTags.append(renderOutgoingLink(link));
                        }
                    } else {
                        $outgoingTags.append('<span class="tv-links-empty">No outgoing links</span>');
                    }
                    $outgoingLinks.append($outgoingTags);

                    // Add link form
                    const $addLinkRow = $(`<div class="tv-link-add-row">
                        <input type="number" class="tv-link-uid-input" placeholder="Entry UID" min="1" />
                        <input type="text" class="tv-link-relation-input" placeholder="Relation (e.g. lives_in)" />
                        <button class="tv-popup-btn tv-popup-btn-sm tv-link-add-btn" title="Add link"><i class="fa-solid fa-plus"></i></button>
                    </div>`);

                    $addLinkRow.find('.tv-link-add-btn').on('click', (e) => {
                        e.stopPropagation();
                        const linkUid = parseInt($addLinkRow.find('.tv-link-uid-input').val(), 10);
                        const relation = $addLinkRow.find('.tv-link-relation-input').val().trim();

                        if (isNaN(linkUid) || linkUid <= 0) {
                            toastr.warning('Enter a valid entry UID.', 'TunnelVision');
                            return;
                        }
                        if (!relation) {
                            toastr.warning('Enter a relationship type.', 'TunnelVision');
                            return;
                        }

                        // Check if link already exists
                        if (outgoingLinks.some(l => l.uid === linkUid && l.relation === relation)) {
                            toastr.warning('This link already exists.', 'TunnelVision');
                            return;
                        }

                        // Check if target entry exists
                        const targetExists = Object.values(bookData.entries).some(e => e.uid === linkUid);
                        if (!targetExists) {
                            toastr.warning(`Entry UID ${linkUid} not found in this lorebook.`, 'TunnelVision');
                            return;
                        }

                        addEntryLink(bookName, uid, linkUid, relation);
                        $outgoingTags.find('.tv-links-empty').remove();
                        $outgoingTags.append(renderOutgoingLink({ uid: linkUid, relation }));
                        $addLinkRow.find('.tv-link-uid-input').val('');
                        $addLinkRow.find('.tv-link-relation-input').val('');
                        toastr.success('Link added.', 'TunnelVision');
                    });

                    $outgoingLinks.append($addLinkRow);
                    $linksSection.append($outgoingLinks);

                    // Back-links (others link to this entry)
                    const $backLinks = $('<div class="tv-links-subsection"></div>');
                    $backLinks.append($('<div class="tv-links-subtitle">Linked from:</div>'));

                    const $backTags = $('<div class="tv-links-tags"></div>');
                    const backLinks = getBackLinks(bookName, uid);

                    if (backLinks.length > 0) {
                        for (const link of backLinks) {
                            const fromEntry = bookData.entries[Object.keys(bookData.entries).find(k => bookData.entries[k].uid === link.uid)];
                            const fromTitle = fromEntry ? (fromEntry.comment || `Entry #${link.uid}`) : `Entry #${link.uid}`;
                            $backTags.append($(`<span class="tv-link-tag tv-link-incoming" title="UID: ${link.uid}">
                                <span class="tv-link-title">${escapeHtml(fromTitle)}</span>
                                <span class="tv-link-relation">← ${escapeHtml(link.relation)}</span>
                            </span>`));
                        }
                    } else {
                        $backTags.append('<span class="tv-links-empty">No back-links</span>');
                    }
                    $backLinks.append($backTags);
                    $linksSection.append($backLinks);

                    $expand.append($linksSection);
                }

                // Content
                if (entry.content) {
                    $expand.append($('<div class="tv-expand-label">Content</div>'));
                    $expand.append($('<div class="tv-expand-content"></div>').text(entry.content));
                }

                // Edit button row
                const $editRow = $('<div class="tv-expand-edit-row"></div>');
                const $editBtn = $('<button class="tv-popup-btn tv-popup-btn-sm" title="Edit entry content"><i class="fa-solid fa-pen-to-square"></i> Edit</button>');
                $editBtn.on('click', (e) => {
                    e.stopPropagation();
                    // Toggle edit mode
                    const $contentEl = $expand.find('.tv-expand-content');
                    if ($contentEl.is('textarea')) {
                        // Save mode
                        entry.content = $contentEl.val();
                        saveWorldInfo(bookName, bookData, true);
                        const $newContent = $('<div class="tv-expand-content"></div>').text(entry.content);
                        $contentEl.replaceWith($newContent);
                        $editBtn.html('<i class="fa-solid fa-pen-to-square"></i> Edit');
                        toastr.success('Entry updated.', 'TunnelVision');
                    } else {
                        // Edit mode
                        const $textarea = $('<textarea class="tv-expand-content tv-expand-content-edit"></textarea>').val(entry.content || '');
                        if ($contentEl.length) {
                            $contentEl.replaceWith($textarea);
                        } else {
                            $expand.find('.tv-expand-label').last().after($textarea);
                        }
                        $textarea.focus();
                        $editBtn.html('<i class="fa-solid fa-floppy-disk"></i> Save');
                    }
                });
                $editRow.append($editBtn);
                $expand.append($editRow);

                // Delete Permanently button
                const $deleteRow = $('<div class="tv-expand-delete-row"></div>');
                const $deleteBtn = $('<button class="tv-popup-btn tv-popup-btn-sm tv-popup-btn-danger" title="Permanently delete this entry from the lorebook"><i class="fa-solid fa-trash-can"></i> Delete Permanently</button>');
                $deleteBtn.on('click', async (e) => {
                    e.stopPropagation();
                    const entryLabel = entry.comment || entry.key?.[0] || `#${uid}`;
                    if (!confirm(`Permanently delete "${entryLabel}"?\n\nThis removes it from the lorebook entirely and cannot be undone.`)) return;
                    try {
                        $deleteBtn.prop('disabled', true).html('<i class="fa-solid fa-spinner fa-spin"></i> Deleting...');
                        await forgetEntry(bookName, uid, true);
                        delete entryLookup[uid];
                        const entryKey = Object.keys(bookData.entries).find(k => bookData.entries[k].uid === uid);
                        if (entryKey) delete bookData.entries[entryKey];
                        renderTreeNodes();
                        renderMainPanel();
                        await renderUnassignedEntries(bookName, tree, bookData);
                        registerTools();
                        toastr.success(`Deleted "${entryLabel}".`, 'TunnelVision');
                    } catch (err) {
                        $deleteBtn.prop('disabled', false).html('<i class="fa-solid fa-trash-can"></i> Delete Permanently');
                        toastr.error(err.message, 'TunnelVision');
                    }
                });
                $deleteRow.append($deleteBtn);
                $expand.append($deleteRow);

                $row.after($expand);
                $expand.slideDown(150);
            });
        }

        return $row;
    }

    async function openNewEntryDialog(defaultNodeId) {
        // Build node selector options by walking the tree depth-first
        const nodeOptions = [];
        function collectNodes(node, depth) {
            const indent = '\u00A0\u00A0'.repeat(depth);
            nodeOptions.push({ id: node.id, label: indent + (depth === 0 ? 'Root' : (node.label || 'Unnamed')) });
            for (const child of (node.children || [])) {
                collectNodes(child, depth + 1);
            }
        }
        collectNodes(tree.root, 0);

        const $form = $('<div class="tv-new-entry-form"></div>');

        const $titleField = $('<div class="tv-new-entry-field"></div>');
        $titleField.append($('<label class="tv-label">Title <span class="tv-new-entry-required">*</span></label>'));
        $titleField.append($('<input type="text" class="tv-new-entry-title" placeholder="Entry title" />'));
        $form.append($titleField);

        const $contentField = $('<div class="tv-new-entry-field"></div>');
        $contentField.append($('<label class="tv-label">Content <span class="tv-new-entry-required">*</span></label>'));
        $contentField.append($('<textarea class="tv-textarea tv-new-entry-content" rows="6" placeholder="Entry content..."></textarea>'));
        $form.append($contentField);

        const $keysField = $('<div class="tv-new-entry-field"></div>');
        $keysField.append($('<label class="tv-label">Keywords <span class="tv-new-entry-hint">(optional, comma-separated)</span></label>'));
        $keysField.append($('<input type="text" class="tv-new-entry-keys" placeholder="keyword1, keyword2" />'));
        $form.append($keysField);

        const $nodeField = $('<div class="tv-new-entry-field"></div>');
        $nodeField.append($('<label class="tv-label">Category</label>'));
        const $nodeSelect = $('<select class="tv-new-entry-node"></select>');
        for (const n of nodeOptions) {
            const $opt = $('<option></option>').val(n.id).text(n.label);
            if (n.id === defaultNodeId) $opt.prop('selected', true);
            $nodeSelect.append($opt);
        }
        // Schema indicator and auto-scaffold
        const $schemaHint = $('<div class="tv-new-entry-schema-hint" style="display:none"></div>');
        function updateSchemaHint(nodeId) {
            const template = getEffectiveTemplateForNode(tree.root, nodeId);
            $schemaHint.empty();
            if (!template) { $schemaHint.hide(); return; }
            const sections = parseTemplateSections(template);
            $schemaHint.show();
            $schemaHint.append($('<span class="tv-new-entry-schema-label"><i class="fa-solid fa-file-lines"></i> Template: </span>'));
            const $tags = $('<span class="tv-effective-template-tags" style="display:inline-flex;flex-wrap:wrap;"></span>');
            for (const s of sections) {
                $tags.append($(`<span class="tv-effective-template-tag"># ${escapeHtml(s)}</span>`));
            }
            $schemaHint.append($tags);
        }
        function applySchemaScaffold(nodeId) {
            const template = getEffectiveTemplateForNode(tree.root, nodeId);
            if (!template) return;
            const $contentEl = $form.find('.tv-new-entry-content');
            if ($contentEl.val().trim()) return; // don't overwrite user-entered content
            const sections = parseTemplateSections(template);
            $contentEl.val(sections.map(s => `# ${s}\n\n`).join('\n'));
        }
        $nodeSelect.on('change', function () {
            const nodeId = $(this).val();
            updateSchemaHint(nodeId);
            applySchemaScaffold(nodeId);
        });
        $nodeField.append($nodeSelect, $schemaHint);
        $form.append($nodeField);

        // Initialize schema state for the default node
        updateSchemaHint(defaultNodeId);
        applySchemaScaffold(defaultNodeId);

        const result = await callGenericPopup($form, POPUP_TYPE.CONFIRM, '', {
            okButton: 'Create Entry',
            cancelButton: 'Cancel',
            allowVerticalScrolling: true,
        });

        if (result !== 1) return;

        const title = $form.find('.tv-new-entry-title').val().trim();
        const content = $form.find('.tv-new-entry-content').val().trim();
        const keysRaw = $form.find('.tv-new-entry-keys').val().trim();
        const nodeId = $form.find('.tv-new-entry-node').val();
        const keys = keysRaw ? keysRaw.split(',').map(k => k.trim()).filter(Boolean) : [];

        if (!title) { toastr.warning('Title is required.', 'TunnelVision'); return; }
        if (!content) { toastr.warning('Content is required.', 'TunnelVision'); return; }

        try {
            const created = await createEntry(bookName, { comment: title, content, keys, nodeId });
            // Sync stale closed-over bookData and entryLookup
            const freshBookData = await loadWorldInfo(bookName);
            Object.assign(bookData.entries, freshBookData.entries);
            Object.assign(entryLookup, buildEntryLookup(freshBookData));
            renderTreeNodes();
            renderMainPanel();
            await renderUnassignedEntries(bookName, tree, bookData);
            registerTools();
            toastr.success(`Created "${created.comment}" in ${created.nodeLabel}.`, 'TunnelVision');
        } catch (err) {
            toastr.error(err.message, 'TunnelVision');
        }
    }

    // --- Initial render ---
    renderTreeNodes();
    renderMainPanel();

    // Wire toolbar buttons BEFORE showing popup (callGenericPopup awaits until close)
    $popup.find('#tv_popup_add_cat').on('click', () => {
        tree.root.children = tree.root.children || [];
        tree.root.children.push(createTreeNode('New Category'));
        tree.root.collapsed = false;
        saveTree(bookName, tree);
        renderTreeNodes();
        renderMainPanel();
        registerTools();
    });

    // Load Schema Template
    $popup.find('#tv_popup_load_schema').on('click', () => {
        const names = getSchemaStarterNames();
        if (names.length === 0) {
            toastr.info('No schema templates available.', 'TunnelVision');
            return;
        }

        // Build a popup listing available schema starters
        const $picker = $('<div class="tv-schema-picker"></div>');
        $picker.append('<div class="tv-schema-picker-title">Choose a schema template to load:</div>');

        const builtIn = Object.keys(SCHEMA_STARTERS);
        const settings = getSettings();
        const savedNames = Object.keys(settings.savedSchemaTemplates || {});

        if (builtIn.length > 0) {
            $picker.append('<div class="tv-schema-picker-group">Built-in Templates</div>');
            for (const name of builtIn) {
                const $btn = $(`<button class="tv-schema-picker-btn">${escapeHtml(name)}</button>`);
                $btn.on('click', async () => {
                    const starter = getSchemaStarter(name);
                    if (!starter?.nodes) return;
                    const replace = confirm(`Load "${name}" schema? This will REPLACE the current tree.`);
                    if (!replace) return;
                    tree.root.children = starterNodesToTreeNodes(starter.nodes);
                    tree.root.collapsed = false;
                    saveTree(bookName, tree);
                    renderTreeNodes();
                    renderMainPanel();
                    registerTools();
                    toastr.success(`Loaded "${name}" schema template.`, 'TunnelVision');
                    $('.popup.active .popup-button-close, .popup:last-child [data-i18n="Close"]').trigger('click');
                });
                $picker.append($btn);
            }
        }

        if (savedNames.length > 0) {
            $picker.append('<div class="tv-schema-picker-group">Your Templates</div>');
            for (const name of savedNames) {
                const $row = $('<div class="tv-schema-picker-row"></div>');
                const $btn = $(`<button class="tv-schema-picker-btn">${escapeHtml(name)}</button>`);
                $btn.on('click', async () => {
                    const starter = getSchemaStarter(name);
                    if (!starter?.nodes) return;
                    const replace = confirm(`Load "${name}" schema? This will REPLACE the current tree.`);
                    if (!replace) return;
                    tree.root.children = starterNodesToTreeNodes(starter.nodes);
                    tree.root.collapsed = false;
                    saveTree(bookName, tree);
                    renderTreeNodes();
                    renderMainPanel();
                    registerTools();
                    toastr.success(`Loaded "${name}" schema template.`, 'TunnelVision');
                    $('.popup.active .popup-button-close, .popup:last-child [data-i18n="Close"]').trigger('click');
                });
                const $del = $('<button class="tv-schema-picker-del" title="Delete template"><i class="fa-solid fa-xmark"></i></button>');
                $del.on('click', (e) => {
                    e.stopPropagation();
                    if (!confirm(`Delete your saved template "${name}"?`)) return;
                    deleteSchemaTemplate(name);
                    $row.fadeOut(150, () => $row.remove());
                    toastr.info(`Deleted template "${name}".`, 'TunnelVision');
                });
                $row.append($btn, $del);
                $picker.append($row);
            }
        }

        callGenericPopup($picker, POPUP_TYPE.TEXT, '', { allowVerticalScrolling: true });
    });

    // Save as Template
    $popup.find('#tv_popup_save_schema').on('click', () => {
        if (!(tree.root.children || []).length) {
            toastr.warning('Tree is empty. Add categories first.', 'TunnelVision');
            return;
        }
        const name = prompt('Save current tree structure as a template.\nName:');
        if (!name?.trim()) return;
        saveSchemaTemplate(name.trim(), tree.root);
        toastr.success(`Saved template "${name.trim()}".`, 'TunnelVision');
    });

    $popup.find('#tv_popup_regen').on('click', async () => {
        const $btn = $popup.find('#tv_popup_regen');
        try {
            $btn.prop('disabled', true).find('i').addClass('fa-spin');
            await generateSummariesForTree(tree.root, bookName);
            saveTree(bookName, tree);
            renderTreeNodes();
            renderMainPanel();
            registerTools();
            toastr.success('Summaries regenerated.', 'TunnelVision');
        } catch (e) {
            toastr.error(e.message, 'TunnelVision');
        } finally {
            $btn.prop('disabled', false).find('i').removeClass('fa-spin');
        }
    });

    $popup.find('#tv_popup_export').on('click', () => onExportTree());
    $popup.find('#tv_popup_import').on('click', () => $('#tv_import_file').trigger('click'));
    $popup.find('#tv_popup_delete').on('click', () => {
        if (!confirm(`Delete the entire tree for "${bookName}"?`)) return;
        deleteTree(bookName);
        toastr.info('Tree deleted.', 'TunnelVision');
        loadLorebookUI(bookName);
        populateLorebookDropdown();
        registerTools();
        $('.popup.active .popup-button-close, .popup:last-child [data-i18n="Close"]').trigger('click');
    });

    // Search filter
    $popup.find('#tv_popup_search').on('input', function () {
        const q = $(this).val().toLowerCase().trim();
        $treeScroll.find('.tv-tree-row').each(function () {
            if ($(this).hasClass('tv-tree-row-root')) {
                $(this).closest('.tv-tree-node').show();
                return;
            }
            const label = $(this).find('.tv-tree-label').text().toLowerCase();
            $(this).closest('.tv-tree-node').toggle(!q || label.includes(q));
        });
        $mainPanel.find('.tv-entry-row').each(function () {
            const name = $(this).find('.tv-entry-name').text().toLowerCase();
            $(this).toggle(!q || name.includes(q));
        });
    });

    // Show popup (blocks until user closes it)
    await callGenericPopup($popup, POPUP_TYPE.DISPLAY, '', {
        large: true,
        wide: true,
        allowVerticalScrolling: true,
        allowHorizontalScrolling: false,
    });

    // When popup closes, refresh sidebar UI
    loadLorebookUI(bookName);
    populateLorebookDropdown();
}

// ─── Tree Editor Helpers ─────────────────────────────────────────

function getUnassignedEntries(bookData, tree) {
    if (!bookData?.entries || !tree?.root) return [];
    const indexedUids = new Set(getAllEntryUids(tree.root));
    const unassigned = [];
    for (const key of Object.keys(bookData.entries)) {
        const entry = bookData.entries[key];
        if (entry.disable) continue;
        if (!indexedUids.has(entry.uid)) unassigned.push(entry);
    }
    return unassigned;
}

// ─── Import Sanitization ─────────────────────────────────────────

/**
 * Recursively sanitize an imported tree node.
 * Ensures all fields are the expected types, strips unexpected properties,
 * and prevents prototype pollution via __proto__ / constructor keys.
 * @param {Object} node
 */
function sanitizeImportedNode(node) {
    if (!node || typeof node !== 'object') return;

    // Enforce expected field types
    if (typeof node.id !== 'string' || !node.id) node.id = `tv_import_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    if (typeof node.label !== 'string') node.label = 'Unnamed';
    if (typeof node.summary !== 'string') node.summary = '';
    if (typeof node.template !== 'string') node.template = '';
    if (!Array.isArray(node.entryUids)) node.entryUids = [];
    if (!Array.isArray(node.children)) node.children = [];

    // Sanitize entryUids — must be numbers
    node.entryUids = node.entryUids.filter(uid => typeof uid === 'number' && Number.isFinite(uid));

    // Strip any unexpected/dangerous keys (prototype pollution vectors)
    const allowed = new Set(['id', 'label', 'summary', 'entryUids', 'children', 'collapsed', 'isArc', 'template']);
    for (const key of Object.keys(node)) {
        if (!allowed.has(key)) delete node[key];
    }

    // Recurse children
    for (const child of node.children) {
        sanitizeImportedNode(child);
    }
}

// ─── Export / Import ─────────────────────────────────────────────

function onExportTree() {
    if (!currentLorebook) return;
    const tree = getTree(currentLorebook);
    if (!tree) {
        toastr.warning('No tree to export.', 'TunnelVision');
        return;
    }
    const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tunnelvision_${currentLorebook.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.info('Tree exported.', 'TunnelVision');
}

function onImportTree(e) {
    if (!currentLorebook) return;
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const tree = JSON.parse(ev.target.result);
            if (!tree.root || !Array.isArray(tree.root.children)) {
                throw new Error('Invalid tree structure.');
            }
            // Sanitize imported tree to prevent injection of unexpected properties
            sanitizeImportedNode(tree.root);
            tree.lorebookName = currentLorebook;
            tree.lastBuilt = Date.now();
            // Strip any unexpected top-level keys
            const cleanTree = {
                lorebookName: tree.lorebookName,
                root: tree.root,
                version: Number(tree.version) || 1,
                lastBuilt: tree.lastBuilt,
            };
            saveTree(currentLorebook, cleanTree);
            toastr.success('Tree imported.', 'TunnelVision');
            loadLorebookUI(currentLorebook);
            registerTools();
        } catch (err) {
            toastr.error(`Import failed: ${err.message}`, 'TunnelVision');
        }
    };
    reader.readAsText(file);
    // Reset file input so same file can be re-imported
    $(e.target).val('');
}

function onBulkExport() {
    const settings = getSettings();
    const trees = settings.trees || {};
    const enabledLorebooks = settings.enabledLorebooks || {};
    const bookDescriptions = settings.bookDescriptions || {};
    const bookPermissions = settings.bookPermissions || {};

    // Build a snapshot of all trees + per-book settings
    const backup = {
        _tunnelvision_backup: true,
        version: 1,
        exportedAt: new Date().toISOString(),
        trees: JSON.parse(JSON.stringify(trees)),
        enabledLorebooks: JSON.parse(JSON.stringify(enabledLorebooks)),
        bookDescriptions: JSON.parse(JSON.stringify(bookDescriptions)),
        bookPermissions: JSON.parse(JSON.stringify(bookPermissions)),
    };

    const treeCount = Object.keys(trees).length;
    if (treeCount === 0) {
        toastr.warning('No trees to export.', 'TunnelVision');
        return;
    }

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tunnelvision_backup_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toastr.success(`Exported ${treeCount} tree(s) + settings.`, 'TunnelVision');
}

function onBulkImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
        try {
            const backup = JSON.parse(ev.target.result);
            if (!backup._tunnelvision_backup || !backup.trees) {
                throw new Error('Not a valid TunnelVision backup file.');
            }

            const settings = getSettings();
            const treeCount = Object.keys(backup.trees).length;

            // Confirm overwrite
            if (!confirm(`This will import ${treeCount} tree(s) and their settings. Existing trees with the same names will be overwritten. Continue?`)) {
                return;
            }

            // Import trees
            for (const [bookName, tree] of Object.entries(backup.trees)) {
                if (!tree?.root || !Array.isArray(tree.root.children)) {
                    console.warn(`[TunnelVision] Skipping invalid tree: ${bookName}`);
                    continue;
                }
                sanitizeImportedNode(tree.root);
                tree.lorebookName = bookName;
                saveTree(bookName, {
                    lorebookName: tree.lorebookName,
                    root: tree.root,
                    version: Number(tree.version) || 1,
                    lastBuilt: tree.lastBuilt || Date.now(),
                });
            }

            // Import per-book settings
            if (backup.enabledLorebooks) {
                for (const [bookName, enabled] of Object.entries(backup.enabledLorebooks)) {
                    setLorebookEnabled(bookName, enabled);
                }
            }
            if (backup.bookDescriptions) {
                for (const [bookName, desc] of Object.entries(backup.bookDescriptions)) {
                    setBookDescription(bookName, desc);
                }
            }
            if (backup.bookPermissions) {
                for (const [bookName, perm] of Object.entries(backup.bookPermissions)) {
                    setBookPermission(bookName, perm);
                }
            }

            toastr.success(`Imported ${treeCount} tree(s) + settings.`, 'TunnelVision');
            populateLorebookDropdown();
            registerTools();
        } catch (err) {
            toastr.error(`Bulk import failed: ${err.message}`, 'TunnelVision');
        }
    };
    reader.readAsText(file);
    $(e.target).val('');
}

// ─── Tree Status ─────────────────────────────────────────────────

function updateTreeStatus(bookName, tree) {
    const $info = $('#tv_tree_info');
    if (!tree) {
        $info.text('No tree built yet.');
        return;
    }
    const totalEntries = getAllEntryUids(tree.root).length;
    const categories = (tree.root.children || []).length;
    const date = new Date(tree.lastBuilt).toLocaleString();
    $info.text(`${categories} categories, ${totalEntries} indexed entries. Last built: ${date}`);
}

// ─── Tree Editor Rendering ───────────────────────────────────────

async function renderTreeEditor(bookName, tree) {
    const $container = $('#tv_tree_editor_container');

    if (!tree || !tree.root || ((tree.root.children || []).length === 0 && (tree.root.entryUids || []).length === 0)) {
        $container.hide();
        return;
    }

    $container.show();
    const totalEntries = getAllEntryUids(tree.root).length;
    const $count = $('#tv_tree_entry_count');
    if (totalEntries > 0) {
        $count.text(totalEntries).show();
    } else {
        $count.hide();
    }

    // Mini-kanban overview in sidebar
    const $overview = $('#tv_mini_kanban_overview');
    $overview.empty();
    const categories = [];
    if ((tree.root.entryUids || []).length > 0) {
        categories.push({
            label: 'Root',
            summary: 'Entries stored directly on the root node.',
            entryUids: tree.root.entryUids,
            children: [],
        });
    }
    categories.push(...(tree.root.children || []));
    const colors = ['#e84393', '#f0946c', '#6c5ce7', '#00b894', '#fdcb6e'];
    for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        const count = getAllEntryUids(cat).length;
        const color = colors[i % colors.length];
        const $row = $(`<div class="tv-mini-cat">
            <div class="tv-mini-cat-stripe" style="background:${color}"></div>
            <div class="tv-mini-cat-info">
                <div class="tv-mini-cat-name"></div>
                <div class="tv-mini-cat-summary"></div>
            </div>
            <div class="tv-mini-cat-count">${count}</div>
        </div>`);
        $row.find('.tv-mini-cat-name').text(cat.label || 'Unnamed');
        $row.find('.tv-mini-cat-summary').text(cat.summary || '');
        $overview.append($row);
    }
}

// ─── Unassigned Entries ──────────────────────────────────────────

async function renderUnassignedEntries(bookName, tree, bookData = null) {
    const $container = $('#tv_unassigned_container');
    const $count = $('#tv_unassigned_count');
    const $list = $('#tv_unassigned_list');

    if (!tree || !tree.root) {
        $list.empty();
        $container.hide();
        return;
    }

    const resolvedBookData = bookData || await loadWorldInfo(bookName);
    if (!resolvedBookData || !resolvedBookData.entries) {
        $list.empty();
        $container.hide();
        return;
    }

    const unassigned = getUnassignedEntries(resolvedBookData, tree);
    $count.text(unassigned.length);
    $list.empty();

    for (const entry of unassigned) {
        const label = entry.comment || entry.key?.[0] || `#${entry.uid}`;
        const $chip = $('<button type="button" class="tv-unassigned-chip"></button>');
        $chip.append($('<span class="tv-unassigned-chip-label"></span>').text(label));
        $chip.append($(`<span class="tv-unassigned-chip-uid">#${entry.uid}</span>`));
        $chip.append($('<span class="tv-unassigned-chip-action"><i class="fa-solid fa-arrow-turn-down"></i> Root</span>'));
        $chip.on('click', async () => {
            addEntryToNode(tree.root, entry.uid);
            saveTree(bookName, tree);
            toastr.success(`Assigned "${label}" to Root.`, 'TunnelVision');
            await loadLorebookUI(bookName);
            populateLorebookDropdown();
            registerTools();
        });
        $list.append($chip);
    }

    if (unassigned.length === 0) {
        $container.hide();
    } else {
        $container.show();
    }
}

// ─── Diagnostics ─────────────────────────────────────────────────

async function onRunDiagnostics() {
    const $btn = $('#tv_run_diagnostics');
    const $output = $('#tv_diagnostics_output');

    $btn.prop('disabled', true).html('<span class="tv_loading"></span> Running...');
    $output.empty().show();

    try {
        const results = await runDiagnostics();
        for (const result of results) {
            const icon = result.status === 'pass' ? 'fa-check' : result.status === 'warn' ? 'fa-triangle-exclamation' : 'fa-xmark';
            const cssClass = `tv_diag_${result.status}`;
            const $item = $(`<div class="tv_diag_item ${cssClass}"><i class="fa-solid ${icon}"></i> ${escapeHtml(result.message)}</div>`);
            if (result.fix && typeof result.fix === 'function') {
                const $fixBtn = $(`<button class="tv-btn tv-btn-secondary" style="margin-left:8px;padding:2px 8px;font-size:0.85em;">${escapeHtml(result.fixLabel || 'Fix')}</button>`);
                $fixBtn.on('click', () => {
                    const msg = result.fix();
                    $fixBtn.replaceWith(`<span style="margin-left:8px;color:var(--tv-accent,#4fc3f7);">✓ ${escapeHtml(msg)}</span>`);
                });
                $item.append($fixBtn);
            }
            $output.append($item);
        }
    } catch (e) {
        $output.append(`<div class="tv_diag_item tv_diag_fail"><i class="fa-solid fa-xmark"></i> Diagnostics error: ${escapeHtml(e.message)}</div>`);
    } finally {
        $btn.prop('disabled', false).html('<i class="fa-solid fa-stethoscope"></i> Run Diagnostics');
    }
}

// ─── Utilities ───────────────────────────────────────────────────

function buildEntryLookup(bookData) {
    const lookup = {};
    if (!bookData || !bookData.entries) return lookup;
    for (const key of Object.keys(bookData.entries)) {
        const entry = bookData.entries[key];
        lookup[entry.uid] = entry;
    }
    return lookup;
}

function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ─── Checkpoint Desync Protection ────────────────────────────────

function onEnableCheckpointsToggle() {
    const settings = getSettings();
    settings.enableCheckpoints = $(this).prop('checked');
    saveSettingsDebounced();
}

function onClearCheckpoints() {
    const context = getContext();
    const chatId = context.getCurrentChatId?.() ?? context.chatId ?? null;
    if (!chatId) {
        toastr.warning('No active chat — nothing to clear.', 'TunnelVision');
        return;
    }
    clearCurrentChatCheckpoints(chatId);
    updateCheckpointInfoDisplay();
    toastr.success('Checkpoints cleared.', 'TunnelVision');
}

function updateCheckpointInfoDisplay() {
    const context = getContext();
    const chatId = context.getCurrentChatId?.() ?? context.chatId ?? null;
    const $info = $('#tv_checkpoint_count');

    if (!chatId) {
        $info.text('No active chat.');
        return;
    }

    const info = getCheckpointInfo(chatId);
    if (info.count === 0) {
        $info.text('No checkpoints saved yet.');
    } else {
        $info.text(`${info.count} checkpoint${info.count !== 1 ? 's' : ''} saved (~${info.estimatedKb} KB). ${info.hadChangesCount} with lorebook changes.`);
    }
}

// ─── Notebook Editor ─────────────────────────────────────────────

export function updateNotebookBadge() {
    const context = getContext();
    const notes = context.chatMetadata?.['tunnelvision_notebook'] || [];
    const $badge = $('#tv_notebook_note_count');
    if (notes.length > 0) {
        $badge.text(notes.length).show();
    } else {
        $badge.hide();
    }
}

async function openNotebookEditor() {
    const context = getContext();
    if (!context.chatMetadata) {
        toastr.warning('No chat is open.', 'TunnelVision');
        return;
    }

    const NOTEBOOK_KEY = 'tunnelvision_notebook';

    function getNotebook() {
        if (!context.chatMetadata[NOTEBOOK_KEY]) {
            context.chatMetadata[NOTEBOOK_KEY] = [];
        }
        return context.chatMetadata[NOTEBOOK_KEY];
    }

    function saveNotebook() {
        context.saveMetadataDebounced();
        updateNotebookBadge();
    }

    const $popup = $('<div class="tv-notebook-editor"></div>');
    const $inner = $('<div class="tv-notebook-editor-inner"></div>');
    $inner.append('<div class="tv-help-text tv-notebook-description">The AI\'s private scratchpad for this chat. Read, edit, or remove notes. New notes the AI writes will appear here automatically.</div>');

    const $list = $('<div class="tv-notebook-list"></div>');
    $inner.append($list);

    const $addSection = $('<div class="tv-notebook-add-section"></div>');
    $addSection.append('<div class="tv-adv-section-title">Add Note</div>');
    const $titleInput = $('<input class="text_pole tv-notebook-new-title" type="text" placeholder="Title..." />');
    const $contentInput = $('<textarea class="tv-textarea tv-notebook-new-content" rows="3" placeholder="Content..."></textarea>');
    const $btnRow = $('<div class="tv-notebook-btn-row"></div>');
    const $addBtn = $('<button class="tv-btn tv-btn-primary"><i class="fa-solid fa-plus"></i> Add Note</button>');
    const $clearBtn = $('<button class="tv-btn tv-btn-sm tv-btn-secondary" title="Clear all notes"><i class="fa-solid fa-trash-can"></i> Clear All</button>');
    $btnRow.append($addBtn, $clearBtn);
    $addSection.append($titleInput, $contentInput, $btnRow);
    $inner.append($addSection);
    $popup.append($inner);

    function renderNotes() {
        $list.empty();
        const notebook = getNotebook();
        if (notebook.length === 0) {
            $list.append('<div class="tv-notebook-empty">No notes yet. The AI writes notes here during conversation.</div>');
            return;
        }
        for (const note of notebook) {
            const $note = $('<div class="tv-notebook-note"></div>').attr('data-id', note.id);
            const $header = $('<div class="tv-notebook-note-header"></div>');
            const $noteTitle = $('<input class="tv-notebook-note-title text_pole" type="text" placeholder="Title" />').val(note.title);
            const $deleteBtn = $('<button class="tv-notebook-note-delete tv-btn tv-btn-sm" title="Delete note"><i class="fa-solid fa-trash-can"></i></button>');
            const $noteContent = $('<textarea class="tv-notebook-note-content tv-textarea" rows="3" placeholder="Content"></textarea>').val(note.content);
            $header.append($noteTitle, $deleteBtn);
            $note.append($header, $noteContent);
            $list.append($note);
        }

        $list.find('.tv-notebook-note-title').on('change', function () {
            const noteId = $(this).closest('.tv-notebook-note').data('id');
            const notebook = getNotebook();
            const note = notebook.find(n => n.id === noteId);
            if (!note) return;
            const newTitle = $(this).val().trim();
            if (!newTitle) { $(this).val(note.title); return; }
            recordNotebook(notebook);
            note.title = newTitle;
            saveNotebook();
        });

        $list.find('.tv-notebook-note-content').on('change', function () {
            const noteId = $(this).closest('.tv-notebook-note').data('id');
            const notebook = getNotebook();
            const note = notebook.find(n => n.id === noteId);
            if (!note) return;
            recordNotebook(notebook);
            note.content = $(this).val();
            saveNotebook();
        });

        $list.find('.tv-notebook-note-delete').on('click', function () {
            const noteId = $(this).closest('.tv-notebook-note').data('id');
            const notebook = getNotebook();
            const idx = notebook.findIndex(n => n.id === noteId);
            if (idx === -1) return;
            recordNotebook(notebook);
            notebook.splice(idx, 1);
            saveNotebook();
            renderNotes();
        });
    }

    renderNotes();

    $addBtn.on('click', () => {
        const title = $titleInput.val().trim();
        const content = $contentInput.val().trim();
        if (!title || !content) {
            toastr.warning('Both title and content are required.', 'TunnelVision');
            return;
        }
        const notebook = getNotebook();
        if (notebook.length >= 50) {
            toastr.warning('Notebook is full (50 notes). Remove some notes first.', 'TunnelVision');
            return;
        }
        recordNotebook(notebook);
        notebook.push({
            id: `note_${Date.now().toString(36)}`,
            title,
            content,
            created: Date.now(),
        });
        saveNotebook();
        $titleInput.val('');
        $contentInput.val('');
        renderNotes();
    });

    $clearBtn.on('click', async () => {
        const notebook = getNotebook();
        if (notebook.length === 0) return;
        const confirmed = await callGenericPopup('Clear all notes from the AI notebook? This cannot be undone.', POPUP_TYPE.CONFIRM);
        if (!confirmed) return;
        recordNotebook(notebook);
        notebook.length = 0;
        saveNotebook();
        renderNotes();
    });

    await callGenericPopup($popup, POPUP_TYPE.DISPLAY, '', {
        allowVerticalScrolling: true,
    });
}

// ─── WI Lorebook Button Injector ─────────────────────────────────────────────

let _wiTVBtnInjecting = false;

/** Find the tree node whose entryUids contains the given UID. */
function findNodeByUid(node, uid) {
    if (!node) return null;
    if ((node.entryUids || []).includes(uid)) return node;
    for (const child of (node.children || [])) {
        const found = findNodeByUid(child, uid);
        if (found) return found;
    }
    return null;
}

/**
 * Poll the ST lorebook editor at 500ms and inject a TV eye-icon button into
 * each entry's header row. Only active while a TV-managed lorebook is open.
 * Follows the same pattern as initWIConditionInjector in index.js.
 */
export function initWITVButtonInjector() {
    setInterval(() => {
        if (_wiTVBtnInjecting) return;
        const settings = getSettings();
        if (settings.globalEnabled === false) return;

        const list = document.getElementById('world_popup_entries_list');
        if (!list || !list.offsetParent) return;

        const sel = document.getElementById('world_editor_select');
        if (!sel) return;
        const bookName = sel.options[sel.selectedIndex]?.textContent?.trim();
        if (!bookName) return;

        const tree = getTree(bookName);
        if (!tree || !tree.root) {
            // Not a TV-managed lorebook — remove any previously injected buttons
            list.querySelectorAll('.tv-wi-btn').forEach(btn => btn.remove());
            return;
        }

        _wiTVBtnInjecting = true;
        try {
            const entries = list.querySelectorAll('.world_entry[uid]');
            for (const entryEl of entries) {
                const uid = Number(entryEl.getAttribute('uid'));
                if (isNaN(uid)) continue;

                const containingNode = findNodeByUid(tree.root, uid);
                const existingBtn = entryEl.querySelector('.tv-wi-btn');

                if (existingBtn) {
                    // Refresh state in case the tree changed since last tick
                    if (containingNode) {
                        existingBtn.classList.add('tv-wi-btn-registered');
                        existingBtn.title = `In TunnelVision: ${containingNode.label}`;
                    } else {
                        existingBtn.classList.remove('tv-wi-btn-registered');
                        existingBtn.title = 'Add to TunnelVision';
                    }
                    continue;
                }

                // Inject a new button into the entry's header
                const header = entryEl.querySelector('.inline-drawer-header');
                if (!header) continue;

                const btn = document.createElement('i');
                btn.className = 'menu_button tv-wi-btn fa-solid fa-eye';
                if (containingNode) {
                    btn.classList.add('tv-wi-btn-registered');
                    btn.title = `In TunnelVision: ${containingNode.label}`;
                } else {
                    btn.title = 'Add to TunnelVision';
                }

                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentSel = document.getElementById('world_editor_select');
                    const currentBook = currentSel?.options[currentSel?.selectedIndex]?.textContent?.trim();
                    if (currentBook) openWINodePicker(uid, currentBook);
                });

                header.appendChild(btn);
            }
        } finally {
            _wiTVBtnInjecting = false;
        }
    }, 500);
}

/**
 * Show a node picker popup so the user can assign (or move) a lorebook entry
 * to a TunnelVision tree node. When the target node has a schema template, the
 * LLM reformats the entry's content to fit the schema before saving. If no
 * schema is defined, the entry is registered as-is.
 */
async function openWINodePicker(uid, bookName) {
    const tree = getTree(bookName);
    if (!tree || !tree.root) return;

    const containingNode = findNodeByUid(tree.root, uid);

    const $popup = $('<div class="tv-node-picker"></div>');
    const $desc = $('<div class="tv-help-text tv-node-picker-desc"></div>');
    $desc.text(containingNode
        ? `Currently in "${containingNode.label}". Click a node to move it.`
        : 'Click a node to import this entry into TunnelVision:');
    $popup.append($desc);

    const $status = $('<div class="tv-node-picker-status" style="display:none;"></div>');
    $popup.append($status);

    const $list = $('<div class="tv-node-picker-list"></div>');

    function buildRows(node, depth = 0) {
        const isCurrentNode = containingNode && node.id === containingNode.id;

        const $row = $('<button class="tv-node-picker-row" type="button"></button>');
        $row.css('padding-left', `${8 + depth * 14}px`);

        const $icon = $(`<i class="fa-solid ${isCurrentNode ? 'fa-folder-open' : 'fa-folder'} tv-node-picker-icon"></i>`);
        const $label = $('<span></span>').text(node.label);

        // Show schema badge if this node has a template
        const schema = getEffectiveTemplateForNode(tree.root, node.id);
        if (schema) {
            const $badge = $('<span class="tv-node-picker-schema-badge" title="Has schema — LLM will reformat entry">schema</span>');
            $row.append($icon, $label, $badge);
        } else {
            $row.append($icon, $label);
        }

        if (isCurrentNode) {
            $row.addClass('tv-node-picker-current');
        }

        $row.on('click', async () => {
            if ($row.hasClass('tv-node-picker-loading')) return;

            const freshTree = getTree(bookName);
            if (!freshTree) return;
            const targetNode = findNodeById(freshTree.root, node.id);
            if (!targetNode) return;

            const freshSchema = getEffectiveTemplateForNode(freshTree.root, node.id);

            if (freshSchema) {
                // Schema present — use the LLM to reformat the entry content
                if (!isSidecarConfigured()) {
                    toastr.warning(
                        'No LLM connection profile selected. Choose one in TunnelVision settings to enable schema-based import.',
                        'TunnelVision',
                    );
                    return;
                }

                // Lock UI during generation
                $list.find('.tv-node-picker-row').prop('disabled', true);
                $row.addClass('tv-node-picker-loading');
                $row.find('.tv-node-picker-icon').removeClass('fa-folder fa-folder-open').addClass('fa-spinner fa-spin');
                $status.text('Reformatting entry to match schema…').show();

                try {
                    const bookData = await loadWorldInfo(bookName);
                    if (!bookData?.entries) throw new Error('Could not load lorebook data.');

                    // Find the entry by UID
                    let entry = null;
                    for (const key of Object.keys(bookData.entries)) {
                        if (bookData.entries[key].uid === uid) { entry = bookData.entries[key]; break; }
                    }
                    if (!entry) throw new Error(`Entry UID ${uid} not found in lorebook.`);

                    const entryTitle = entry.comment || `Entry #${uid}`;
                    const entryContent = entry.content || '';

                    const reformatted = await sidecarGenerate({
                        systemPrompt: 'You are reformatting a lorebook entry to fit a structured schema. Output ONLY the reformatted content using the schema sections as headings. Do not add explanation, preamble, or JSON. Preserve all factual information from the original — do not invent new details.',
                        prompt: `Reformat the lorebook entry below to match the schema template. Use each schema heading as a section and distribute the original content into the appropriate sections.\n\nEntry title: ${entryTitle}\n\nOriginal content:\n${entryContent}\n\nSchema template:\n${freshSchema}\n\nReturn only the reformatted content.`,
                    });

                    // Save reformatted content back to the lorebook entry
                    entry.content = reformatted.trim();
                    await saveWorldInfo(bookName, bookData, true);

                    // Register in tree
                    removeEntryFromTree(freshTree.root, uid);
                    addEntryToNode(targetNode, uid);
                    saveTree(bookName, freshTree);

                    toastr.success(`Imported "${entryTitle}" into "${node.label}" with schema applied.`, 'TunnelVision');
                } catch (err) {
                    toastr.error(`Import failed: ${err.message}`, 'TunnelVision');
                    console.error('[TunnelVision] Schema import error:', err);
                } finally {
                    $list.find('.tv-node-picker-row').prop('disabled', false);
                    $row.removeClass('tv-node-picker-loading');
                    $row.find('.fa-spinner').removeClass('fa-spinner fa-spin').addClass(isCurrentNode ? 'fa-folder-open' : 'fa-folder');
                    $status.hide();
                }
            } else {
                // No schema — register as-is without any LLM call
                removeEntryFromTree(freshTree.root, uid);
                addEntryToNode(targetNode, uid);
                saveTree(bookName, freshTree);
                const action = containingNode ? `Moved to "${node.label}"` : `Added to "${node.label}"`;
                toastr.success(`${action} in TunnelVision.`, 'TunnelVision');
            }
        });

        $list.append($row);
        for (const child of node.children || []) {
            buildRows(child, depth + 1);
        }
    }

    buildRows(tree.root);
    $popup.append($list);

    await callGenericPopup($popup, POPUP_TYPE.DISPLAY, '', { allowVerticalScrolling: true });
}

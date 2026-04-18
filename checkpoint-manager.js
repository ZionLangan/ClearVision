/**
 * TunnelVision Checkpoint Manager
 * Delta-based snapshot/restore system for chat branch desync protection.
 *
 * Records only what each generation changed (created, modified, deleted entries)
 * so that reverting a message deletion or regeneration undoes only that generation's
 * lorebook writes — leaving entries from other chats or out-of-band edits untouched.
 *
 * Storage: extension_settings.tunnelvision.checkpoints[chatId] = Array<Delta>
 * Cap: 25 deltas per chat by default. Trees are full-cloned (small); entries are delta-only.
 */

import { getSettings, getTree, saveTree } from './tree-store.js';
import { loadWorldInfo, saveWorldInfo } from '../../../world-info.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { getContext } from '../../../st-context.js';
import { setCheckpointListener } from './entry-manager.js';

// Metadata keys (must match the values in notebook.js and summarize.js)
const NOTEBOOK_METADATA_KEY = 'tunnelvision_notebook';
const WATERMARK_METADATA_KEY = 'tunnelvision_summary_watermark';

/**
 * Active delta buffer. Non-null only during an active recording session.
 * @type {Object|null}
 */
let _delta = null;

// ─── Public API ───────────────────────────────────────────────────

/**
 * Begin recording lorebook mutations for this generation.
 * Takes cheap snapshots of trees/links/trackers for active books.
 * Registers the change listener on entry-manager.
 *
 * @param {string} chatId
 * @param {number} messageIndex - chat.length at snapshot time (= future AI msg index)
 * @param {string[]} activeBookNames
 */
export function startRecording(chatId, messageIndex, activeBookNames) {
    const settings = getSettings();
    if (settings.enableCheckpoints === false) return;
    if (!chatId) return;

    _delta = {
        messageIndex,
        timestamp: Date.now(),
        hadChanges: false,
        createdUids: {},
        modifiedEntries: {},
        deletedEntries: {},
        treesBefore: {},
        linksBefore: {},
        trackersBefore: {},
        notebookBefore: null,
        watermarkBefore: null,
        // Internal tracking (not persisted)
        _chatId: chatId,
        _notebookRecorded: false,
        _watermarkRecorded: false,
    };

    // Snapshot trees, links, and trackers for each active book (cheap operations)
    for (const bookName of activeBookNames) {
        const tree = getTree(bookName);
        if (tree) {
            _delta.treesBefore[bookName] = JSON.parse(JSON.stringify(tree));
        }

        const links = settings.entryLinks?.[bookName];
        _delta.linksBefore[bookName] = links ? JSON.parse(JSON.stringify(links)) : {};

        const trackers = settings.trackerUids?.[bookName];
        _delta.trackersBefore[bookName] = Array.isArray(trackers) ? [...trackers] : [];
    }

    // Register change listener with entry-manager
    setCheckpointListener(_changeHandler);

    console.debug(`[TunnelVision] Checkpoint recording started: chatId="${chatId}", messageIndex=${messageIndex}, books=[${activeBookNames.join(', ')}]`);
}

/**
 * Record that entry-manager created a new entry.
 * Called by the listener in entry-manager.js after creation.
 * @param {string} bookName
 * @param {number} uid
 */
export function recordCreated(bookName, uid) {
    if (!_delta) return;
    if (!_delta.createdUids[bookName]) _delta.createdUids[bookName] = [];
    _delta.createdUids[bookName].push(uid);
    _delta.hadChanges = true;
}

/**
 * Record that entry-manager modified an entry (before mutation).
 * @param {string} bookName
 * @param {number} uid
 * @param {{ content, comment, key, keysecondary, disable }} before
 */
export function recordModified(bookName, uid, before) {
    if (!_delta) return;
    if (!_delta.modifiedEntries[bookName]) _delta.modifiedEntries[bookName] = [];
    // Only save the first before-state (if the same UID is modified twice in one generation)
    if (!_delta.modifiedEntries[bookName].some(e => e.uid === uid)) {
        _delta.modifiedEntries[bookName].push({ uid, before });
    }
    _delta.hadChanges = true;
}

/**
 * Record that entry-manager deleted an entry (before deletion).
 * For soft deletes (disable=true), stored in modifiedEntries (just disable change).
 * For hard deletes, stored in deletedEntries (full entry needed for re-insertion).
 * @param {string} bookName
 * @param {number} uid
 * @param {Object} entryBefore - Full entry object snapshot before mutation
 * @param {string|null} nodeId - Tree node the entry lived in
 * @param {boolean} hardDelete
 */
export function recordDeleted(bookName, uid, entryBefore, nodeId, hardDelete) {
    if (!_delta) return;

    if (hardDelete) {
        if (!_delta.deletedEntries[bookName]) _delta.deletedEntries[bookName] = [];
        if (!_delta.deletedEntries[bookName].some(e => e.uid === uid)) {
            _delta.deletedEntries[bookName].push({
                uid,
                data: JSON.parse(JSON.stringify(entryBefore)),
                nodeId,
            });
        }
    } else {
        // Soft-delete: just the disable field change; treat like a modification
        if (!_delta.modifiedEntries[bookName]) _delta.modifiedEntries[bookName] = [];
        if (!_delta.modifiedEntries[bookName].some(e => e.uid === uid)) {
            _delta.modifiedEntries[bookName].push({
                uid,
                before: {
                    content: entryBefore.content,
                    comment: entryBefore.comment,
                    key: [...(entryBefore.key || [])],
                    keysecondary: [...(entryBefore.keysecondary || [])],
                    disable: entryBefore.disable, // was false before disable=true was set
                },
            });
        }
    }
    _delta.hadChanges = true;
}

/**
 * Record the notebook state before modification.
 * Only saves the first before-state per generation.
 * @param {Array} notebookBefore - The notebook array before any changes
 */
export function recordNotebook(notebookBefore) {
    if (!_delta || _delta._notebookRecorded) return;
    _delta.notebookBefore = JSON.parse(JSON.stringify(notebookBefore));
    _delta._notebookRecorded = true;
    _delta.hadChanges = true;
}

/**
 * Record the summary watermark before modification.
 * Only saves the first before-state per generation.
 * @param {number|null} watermarkBefore
 */
export function recordWatermark(watermarkBefore) {
    if (!_delta || _delta._watermarkRecorded) return;
    _delta.watermarkBefore = watermarkBefore;
    _delta._watermarkRecorded = true;
    _delta.hadChanges = true;
}

/**
 * Finalize and store the current delta.
 * Called after MESSAGE_RECEIVED or GENERATION_ENDED.
 * Idempotent: no-op if no recording is in progress.
 */
export function sealCheckpoint() {
    if (!_delta) return;

    const settings = getSettings();
    const chatId = _delta._chatId;
    const messageIndex = _delta.messageIndex;

    // Build the storable delta (strip internal tracking fields)
    const storable = {
        messageIndex: _delta.messageIndex,
        timestamp: _delta.timestamp,
        hadChanges: _delta.hadChanges,
        createdUids: _delta.createdUids,
        modifiedEntries: _delta.modifiedEntries,
        deletedEntries: _delta.deletedEntries,
        treesBefore: _delta.treesBefore,
        linksBefore: _delta.linksBefore,
        trackersBefore: _delta.trackersBefore,
        notebookBefore: _delta.notebookBefore,
        watermarkBefore: _delta.watermarkBefore,
    };

    // Clear in-progress state immediately (before any async work)
    _delta = null;
    setCheckpointListener(null);

    // Store in settings
    if (!settings.checkpoints) settings.checkpoints = {};
    if (!settings.checkpoints[chatId]) settings.checkpoints[chatId] = [];

    settings.checkpoints[chatId].push(storable);

    // Enforce cap (oldest dropped when exceeded)
    const maxCheckpoints = settings.maxCheckpoints ?? 25;
    while (settings.checkpoints[chatId].length > maxCheckpoints) {
        settings.checkpoints[chatId].shift();
    }

    saveSettingsDebounced();

    console.debug(`[TunnelVision] Checkpoint sealed: chatId="${chatId}", messageIndex=${messageIndex}, hadChanges=${storable.hadChanges}`);
}

/**
 * Check whether a checkpoint exists for a specific message index.
 * @param {string} chatId
 * @param {number} messageIndex
 * @returns {boolean}
 */
export function hasCheckpoint(chatId, messageIndex) {
    const settings = getSettings();
    const checkpoints = settings.checkpoints?.[chatId];
    if (!checkpoints) return false;
    return checkpoints.some(cp => cp.messageIndex === messageIndex);
}

/**
 * Prune checkpoints whose messageIndex >= newChatLength (those messages were deleted),
 * then restore from the most recent remaining checkpoint if it hadChanges.
 *
 * @param {string} chatId
 * @returns {Promise<boolean>} True if a restoration was performed
 */
export async function restoreForMessageDeleted(chatId) {
    const settings = getSettings();
    if (settings.enableCheckpoints === false) return false;
    if (!chatId) return false;

    const checkpoints = settings.checkpoints?.[chatId];
    if (!checkpoints || checkpoints.length === 0) return false;

    // Use current chat length (deletion has already happened when this is called)
    const context = getContext();
    const newChatLength = context.chat?.length ?? 0;

    // Prune checkpoints for messages that were deleted
    const before = checkpoints.length;
    settings.checkpoints[chatId] = checkpoints.filter(cp => cp.messageIndex < newChatLength);
    const prunedCount = before - settings.checkpoints[chatId].length;

    if (prunedCount > 0) {
        console.log(`[TunnelVision] Pruned ${prunedCount} checkpoint(s) for chatId="${chatId}" (newLength=${newChatLength})`);
    }

    const remaining = settings.checkpoints[chatId];
    if (remaining.length === 0) {
        saveSettingsDebounced();
        return false;
    }

    // Restore from the most recent remaining checkpoint
    const mostRecent = remaining[remaining.length - 1];
    if (!mostRecent.hadChanges) {
        saveSettingsDebounced();
        return false;
    }

    await restoreFromDelta(mostRecent);
    saveSettingsDebounced();
    return true;
}

/**
 * Undo the previous generation at messageIndex so a fresh generation can replace it.
 * Called at generation start when a checkpoint already exists at this index (user is regenerating).
 * Does NOT remove the delta — it will be replaced by sealCheckpoint after the new generation.
 *
 * @param {string} chatId
 * @param {number} messageIndex
 * @returns {Promise<boolean>} True if restoration was performed
 */
export async function restoreForRegeneration(chatId, messageIndex) {
    const settings = getSettings();
    if (settings.enableCheckpoints === false) return false;
    if (!chatId) return false;

    const checkpoints = settings.checkpoints?.[chatId];
    if (!checkpoints || checkpoints.length === 0) return false;

    const delta = checkpoints.find(cp => cp.messageIndex === messageIndex);
    if (!delta || !delta.hadChanges) return false;

    console.log(`[TunnelVision] Restoring checkpoint for regeneration: chatId="${chatId}", messageIndex=${messageIndex}`);
    await restoreFromDelta(delta);
    // Remove the old delta so sealCheckpoint can push a fresh one for this message index
    settings.checkpoints[chatId] = checkpoints.filter(cp => cp.messageIndex !== messageIndex);
    saveSettingsDebounced();
    return true;
}

/**
 * Discard all checkpoints for a chat. Called when leaving a chat (CHAT_CHANGED).
 * @param {string} chatId
 */
export function pruneCurrentChatCheckpoints(chatId) {
    if (!chatId) return;
    const settings = getSettings();
    if (settings.checkpoints?.[chatId]) {
        delete settings.checkpoints[chatId];
        saveSettingsDebounced();
        console.log(`[TunnelVision] Pruned all checkpoints for departed chatId="${chatId}"`);
    }
}

/**
 * Clear all checkpoints for a chat (user-triggered).
 * @param {string} chatId
 */
export function clearCurrentChatCheckpoints(chatId) {
    if (!chatId) return;
    const settings = getSettings();
    if (!settings.checkpoints) settings.checkpoints = {};
    settings.checkpoints[chatId] = [];
    saveSettingsDebounced();
}

/**
 * Get diagnostic info about checkpoints for a chat.
 * @param {string} chatId
 * @returns {{ count: number, newestIndex: number|null, estimatedKb: number, hadChangesCount: number }}
 */
export function getCheckpointInfo(chatId) {
    const settings = getSettings();
    const checkpoints = settings.checkpoints?.[chatId] || [];

    if (checkpoints.length === 0) {
        return { count: 0, newestIndex: null, estimatedKb: 0, hadChangesCount: 0 };
    }

    const hadChangesCount = checkpoints.filter(cp => cp.hadChanges).length;
    const newestIndex = checkpoints[checkpoints.length - 1]?.messageIndex ?? null;
    const totalBytes = JSON.stringify(checkpoints).length;
    const estimatedKb = Math.round(totalBytes / 1024 * 10) / 10;

    return { count: checkpoints.length, newestIndex, estimatedKb, hadChangesCount };
}

// ─── Internal ─────────────────────────────────────────────────────

/**
 * Change listener registered with entry-manager.
 * Routes events into the appropriate record* functions.
 */
function _changeHandler(event, bookName, ...args) {
    if (!_delta) return;

    switch (event) {
        case 'created':
            recordCreated(bookName, args[0]);
            break;
        case 'modified':
            recordModified(bookName, args[0], args[1]);
            break;
        case 'deleted':
            recordDeleted(bookName, args[0], args[1], args[2], args[3]);
            break;
        default:
            break;
    }
}

/**
 * Find an entry by UID in a lorebook entries map.
 * @param {Object} entries
 * @param {number} uid
 * @returns {Object|null}
 */
function findEntryByUid(entries, uid) {
    for (const key of Object.keys(entries)) {
        if (entries[key].uid === uid) return entries[key];
    }
    return null;
}

/**
 * Apply a delta in reverse — undo all lorebook changes recorded in this delta.
 * @param {Object} delta
 */
async function restoreFromDelta(delta) {
    const settings = getSettings();
    console.log(`[TunnelVision] Restoring from delta: messageIndex=${delta.messageIndex}`);

    // Collect all book names affected by this delta
    const affectedBooks = new Set([
        ...Object.keys(delta.createdUids || {}),
        ...Object.keys(delta.modifiedEntries || {}),
        ...Object.keys(delta.deletedEntries || {}),
        ...Object.keys(delta.treesBefore || {}),
        ...Object.keys(delta.linksBefore || {}),
        ...Object.keys(delta.trackersBefore || {}),
    ]);

    for (const bookName of affectedBooks) {
        try {
            let bookData = null;
            let bookDirty = false;

            const ensureBook = async () => {
                if (!bookData) bookData = await loadWorldInfo(bookName);
                return bookData;
            };

            // 1. Delete entries that were created during this generation
            const createdUids = delta.createdUids?.[bookName] || [];
            if (createdUids.length > 0) {
                const bd = await ensureBook();
                if (bd?.entries) {
                    for (const uid of createdUids) {
                        for (const key of Object.keys(bd.entries)) {
                            if (bd.entries[key].uid === uid) {
                                delete bd.entries[key];
                                console.log(`[TunnelVision] Restore: deleted created entry UID ${uid} from "${bookName}"`);
                                break;
                            }
                        }
                    }
                    bookDirty = true;
                }
            }

            // 2. Revert entries that were modified during this generation
            const modifiedEntries = delta.modifiedEntries?.[bookName] || [];
            if (modifiedEntries.length > 0) {
                const bd = await ensureBook();
                if (bd?.entries) {
                    for (const { uid, before } of modifiedEntries) {
                        const entry = findEntryByUid(bd.entries, uid);
                        if (!entry) {
                            console.warn(`[TunnelVision] Restore: entry UID ${uid} not found in "${bookName}" (may have been deleted manually — skipping)`);
                            continue;
                        }
                        Object.assign(entry, before);
                        console.log(`[TunnelVision] Restore: reverted entry UID ${uid} in "${bookName}"`);
                    }
                    bookDirty = true;
                }
            }

            // 3. Re-insert entries that were hard-deleted during this generation
            const deletedEntries = delta.deletedEntries?.[bookName] || [];
            if (deletedEntries.length > 0) {
                const bd = await ensureBook();
                if (bd?.entries) {
                    for (const { uid, data } of deletedEntries) {
                        // Only re-insert if not already present (user may have manually re-created)
                        if (!findEntryByUid(bd.entries, uid)) {
                            // Insert under UID as key — ST uses uid field for lookup, not key
                            bd.entries[String(uid)] = JSON.parse(JSON.stringify(data));
                            console.log(`[TunnelVision] Restore: re-inserted deleted entry UID ${uid} into "${bookName}"`);
                        }
                    }
                    bookDirty = true;
                }
            }

            // Save lorebook if any entries were changed
            if (bookDirty && bookData) {
                await saveWorldInfo(bookName, bookData, true);
            }

            // 4. Restore tree to pre-generation state
            if (delta.treesBefore?.[bookName]) {
                saveTree(bookName, JSON.parse(JSON.stringify(delta.treesBefore[bookName])));
                console.log(`[TunnelVision] Restore: tree for "${bookName}"`);
            }

            // 5. Restore entry links
            if (delta.linksBefore?.[bookName] !== undefined) {
                if (!settings.entryLinks) settings.entryLinks = {};
                settings.entryLinks[bookName] = JSON.parse(JSON.stringify(delta.linksBefore[bookName]));
            }

            // 6. Restore tracker UIDs
            if (delta.trackersBefore?.[bookName] !== undefined) {
                if (!settings.trackerUids) settings.trackerUids = {};
                const trackers = delta.trackersBefore[bookName];
                if (trackers.length > 0) {
                    settings.trackerUids[bookName] = [...trackers];
                } else {
                    delete settings.trackerUids[bookName];
                }
            }
        } catch (err) {
            console.error(`[TunnelVision] Restore error for book "${bookName}":`, err);
        }
    }

    // 7. Restore notebook
    if (delta.notebookBefore !== null) {
        try {
            const context = getContext();
            if (context.chatMetadata) {
                context.chatMetadata[NOTEBOOK_METADATA_KEY] = JSON.parse(JSON.stringify(delta.notebookBefore));
                context.saveMetadataDebounced?.();
                console.log('[TunnelVision] Restore: notebook');
            }
        } catch (err) {
            console.error('[TunnelVision] Restore: failed to restore notebook:', err);
        }
    }

    // 8. Restore summary watermark
    if (delta.watermarkBefore !== null) {
        try {
            const context = getContext();
            if (context.chatMetadata) {
                context.chatMetadata[WATERMARK_METADATA_KEY] = delta.watermarkBefore;
                context.saveMetadataDebounced?.();
                console.log('[TunnelVision] Restore: summary watermark');
            }
        } catch (err) {
            console.error('[TunnelVision] Restore: failed to restore watermark:', err);
        }
    }

    console.log('[TunnelVision] Delta restoration complete');
}

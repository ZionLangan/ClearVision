/**
 * TunnelVision Tree Store
 * Manages the hierarchical tree index over lorebook entries.
 * Each tree node represents a category/topic containing references to WI entry UIDs.
 */

import { extension_settings } from '../../../extensions.js';
import { saveSettingsDebounced } from '../../../../script.js';
import { loadWorldInfo } from '../../../world-info.js';

const EXTENSION_NAME = 'tunnelvision';
const TRACKER_TITLE_PREFIX = /^\[tracker[^\]]*\]/i;

/**
 * @typedef {Object} TreeNode
 * @property {string} id - Unique node ID
 * @property {string} label - Display name / topic description
 * @property {string} summary - Brief summary of what entries under this node cover
 * @property {number[]} entryUids - WI entry UIDs directly under this node
 * @property {TreeNode[]} children - Sub-categories
 * @property {boolean} collapsed - UI state for tree editor
 * @property {string} template - Markdown template for entries under this node (sections accumulate via inheritance)
 */

/**
 * @typedef {Object} TreeIndex
 * @property {string} lorebookName - Name of the lorebook this tree indexes
 * @property {TreeNode} root - Root node of the tree
 * @property {number} version - Schema version for future migrations
 * @property {number} lastBuilt - Timestamp of last tree build
 */

export function generateNodeId() {
    // Use crypto.getRandomValues for better collision resistance across rapid calls
    const arr = new Uint8Array(6);
    crypto.getRandomValues(arr);
    const rand = Array.from(arr, b => b.toString(36).padStart(2, '0')).join('').substring(0, 8);
    return `tv_${Date.now()}_${rand}`;
}

export function createTreeNode(label = 'New Category', summary = '') {
    return {
        id: generateNodeId(),
        label,
        summary,
        entryUids: [],
        children: [],
        collapsed: false,
        template: '',
    };
}

export function createEmptyTree(lorebookName) {
    return {
        lorebookName,
        root: createTreeNode('Root', `Top-level index for ${lorebookName}`),
        version: 2,
        lastBuilt: Date.now(),
    };
}

/**
 * Get the tree index for a specific lorebook.
 * @param {string} lorebookName
 * @returns {TreeIndex|null}
 */
export function getTree(lorebookName) {
    ensureSettings();
    return extension_settings[EXTENSION_NAME].trees[lorebookName] || null;
}

/**
 * Save a tree index for a lorebook.
 * @param {string} lorebookName
 * @param {TreeIndex} tree
 */
export function saveTree(lorebookName, tree) {
    ensureSettings();
    normalizeTree(tree, lorebookName);
    tree.lorebookName = lorebookName;
    extension_settings[EXTENSION_NAME].trees[lorebookName] = tree;
    saveSettingsDebounced();
}

/**
 * Delete the tree index for a lorebook.
 * @param {string} lorebookName
 */
export function deleteTree(lorebookName) {
    ensureSettings();
    delete extension_settings[EXTENSION_NAME].trees[lorebookName];
    saveSettingsDebounced();
}

/**
 * Check if a lorebook has TunnelVision enabled.
 * @param {string} lorebookName
 * @returns {boolean}
 */
export function isLorebookEnabled(lorebookName) {
    ensureSettings();
    return extension_settings[EXTENSION_NAME].enabledLorebooks[lorebookName] === true;
}

/**
 * Toggle TunnelVision for a lorebook.
 * @param {string} lorebookName
 * @param {boolean} enabled
 */
export function setLorebookEnabled(lorebookName, enabled) {
    ensureSettings();
    extension_settings[EXTENSION_NAME].enabledLorebooks[lorebookName] = enabled;
    saveSettingsDebounced();
}

/**
 * Get the user-set description for a lorebook, or empty string.
 * @param {string} lorebookName
 * @returns {string}
 */
export function getBookDescription(lorebookName) {
    ensureSettings();
    return extension_settings[EXTENSION_NAME].bookDescriptions[lorebookName] || '';
}

/**
 * Set a user description for a lorebook.
 * @param {string} lorebookName
 * @param {string} description
 */
export function setBookDescription(lorebookName, description) {
    ensureSettings();
    extension_settings[EXTENSION_NAME].bookDescriptions[lorebookName] = description;
    saveSettingsDebounced();
}

/**
 * Find a node by ID in the tree (depth-first).
 * @param {TreeNode} node
 * @param {string} nodeId
 * @returns {TreeNode|null}
 */
export function findNodeById(node, nodeId) {
    if (!node) return null;
    if (node.id === nodeId) return node;
    for (const child of (node.children || [])) {
        const found = findNodeById(child, nodeId);
        if (found) return found;
    }
    return null;
}

/**
 * Find the parent of a node by ID.
 * @param {TreeNode} root
 * @param {string} nodeId
 * @returns {TreeNode|null}
 */
export function findParentNode(root, nodeId) {
    if (!root) return null;
    for (const child of (root.children || [])) {
        if (child.id === nodeId) return root;
        const found = findParentNode(child, nodeId);
        if (found) return found;
    }
    return null;
}

/**
 * Find the path from root to a target node (inclusive).
 * Returns an array of TreeNodes or null if not found.
 * @param {TreeNode} node
 * @param {string} nodeId
 * @returns {TreeNode[]|null}
 */
function findNodePath(node, nodeId) {
    if (!node) return null;
    if (node.id === nodeId) return [node];
    for (const child of (node.children || [])) {
        const path = findNodePath(child, nodeId);
        if (path) return [node, ...path];
    }
    return null;
}

/**
 * Parse a template string into an ordered array of section names.
 * Sections are markdown headings: lines starting with # (or ## etc.).
 * @param {string} template
 * @returns {string[]} Section names in order (lowercased, trimmed)
 */
export function parseTemplateSections(template) {
    if (!template || typeof template !== 'string') return [];
    const sections = [];
    for (const line of template.split('\n')) {
        const match = line.match(/^#{1,6}\s+(.+)/);
        if (match) {
            sections.push(match[1].trim());
        }
    }
    return sections;
}

/**
 * Get the effective (accumulated) template for a node by walking the path
 * from root to the target node and combining all template sections.
 * Child templates add new sections to the parent's sections.
 * If a child re-defines a section that exists in a parent, the child's position wins.
 * @param {TreeIndex} tree
 * @param {string} nodeId
 * @returns {string} The effective template (empty string if no templates defined)
 */
export function getEffectiveTemplate(tree, nodeId) {
    if (!tree || !tree.root || !nodeId) return '';
    return getEffectiveTemplateForNode(tree.root, nodeId);
}

/**
 * Get the effective template for a node within a tree rooted at `root`.
 * Walks the path from root to the target, accumulating template sections.
 * @param {TreeNode} root
 * @param {string} nodeId
 * @returns {string}
 */
export function getEffectiveTemplateForNode(root, nodeId) {
    if (!root || !nodeId) return '';
    const path = findNodePath(root, nodeId);
    if (!path) return '';

    // Accumulate sections preserving order; later occurrences override earlier ones
    const seen = new Map(); // sectionName -> index in ordered list
    const ordered = [];     // final ordered section names

    for (const node of path) {
        const sections = parseTemplateSections(node.template);
        for (const section of sections) {
            const key = section.toLowerCase();
            if (seen.has(key)) {
                // Child re-defines a parent section: keep the child's position
                // (the parent's earlier position is already in the list — leave it,
                //  the child's later occurrence is the one that matters for content)
                // We don't duplicate; just update the label in case casing differs.
                const idx = seen.get(key);
                ordered[idx] = section;
            } else {
                seen.set(key, ordered.length);
                ordered.push(section);
            }
        }
    }

    if (ordered.length === 0) return '';
    return ordered.map(s => `# ${s}`).join('\n');
}

/**
 * Check whether a node (or any of its ancestors) has a template defined.
 * @param {TreeNode} root
 * @param {string} nodeId
 * @returns {boolean}
 */
export function hasEffectiveTemplate(root, nodeId) {
    if (!root || !nodeId) return false;
    const path = findNodePath(root, nodeId);
    if (!path) return false;
    return path.some(node => node.template && node.template.trim().length > 0);
}

/**
 * Remove a node from the tree. Entries are moved to parent.
 * @param {TreeNode} root
 * @param {string} nodeId
 * @returns {boolean} Whether the node was removed
 */
export function removeNode(root, nodeId) {
    const parent = findParentNode(root, nodeId);
    if (!parent) return false;

    const idx = parent.children.findIndex(c => c.id === nodeId);
    if (idx === -1) return false;

    const removed = parent.children[idx];
    // Move orphaned entries up to parent
    if (!parent.entryUids) parent.entryUids = [];
    parent.entryUids.push(...(removed.entryUids || []));
    // Move orphaned children up to parent
    parent.children.splice(idx, 1, ...(removed.children || []));

    return true;
}

/**
 * Add an entry UID to a specific node.
 * @param {TreeNode} node
 * @param {number} uid
 */
export function addEntryToNode(node, uid) {
    if (!node) return;
    if (!node.entryUids) node.entryUids = [];
    if (!node.entryUids.includes(uid)) {
        node.entryUids.push(uid);
    }
}

/**
 * Remove an entry UID from any node in the tree.
 * @param {TreeNode} root
 * @param {number} uid
 */
export function removeEntryFromTree(root, uid) {
    if (!root) return;
    root.entryUids = (root.entryUids || []).filter(u => u !== uid);
    for (const child of (root.children || [])) {
        removeEntryFromTree(child, uid);
    }
}

/**
 * Collect all entry UIDs in the tree (all nodes).
 * @param {TreeNode} node
 * @returns {number[]}
 */
export function getAllEntryUids(node) {
    if (!node) return [];
    const uids = [...(node.entryUids || [])];
    for (const child of (node.children || [])) {
        uids.push(...getAllEntryUids(child));
    }
    return uids;
}

/**
 * Build a text representation of the tree for the LLM tool description.
 * This is what the model sees when deciding which branch to search.
 * Schema nodes (with templates) show their section names even when empty,
 * so the LLM knows what types are available for new entries.
 * @param {TreeNode} node
 * @param {number} depth
 * @returns {string}
 */
export function buildTreeDescription(node, depth = 0) {
    if (!node) return '';
    const indent = '  '.repeat(depth);
    const entryCount = (node.entryUids || []).length;
    const ownSections = parseTemplateSections(node.template);

    let desc = `${indent}- [${node.id}] ${node.label || 'Unnamed'}`;
    if (node.summary) desc += `: ${node.summary}`;
    if (ownSections.length > 0) {
        desc += ` [schema: ${ownSections.join(', ')}]`;
    }
    if (entryCount > 0) {
        desc += ` (${entryCount} ${entryCount === 1 ? 'entry' : 'entries'})`;
    }
    desc += '\n';

    for (const child of (node.children || [])) {
        desc += buildTreeDescription(child, depth + 1);
    }
    return desc;
}

/**
 * Get entries for a set of node IDs (the model's selection).
 * @param {TreeNode} root
 * @param {string[]} nodeIds
 * @returns {number[]} Array of entry UIDs
 */
export function getEntriesForNodes(root, nodeIds) {
    const uids = [];
    for (const nodeId of nodeIds) {
        const node = findNodeById(root, nodeId);
        if (node) {
            uids.push(...getAllEntryUids(node));
        }
    }
    return [...new Set(uids)];
}

/** Default settings values. Adding a new setting = add one line here. */
export const SETTING_DEFAULTS = {
    globalEnabled: true,
    trees: {},
    enabledLorebooks: {},
    selectedLorebook: null,
    bookDescriptions: {},
    connectionProfile: null,
    sidecarTemperature: 0.2,
    sidecarMaxTokens: 8192,
    disabledTools: {},
    searchMode: 'traversal',
    collapsedDepth: 2,
    recurseLimit: 5,
    enableVectorDedup: false,
    vectorDedupThreshold: 0.85,
    llmBuildDetail: 'lite',
    treeGranularity: 0,
    llmChunkTokens: 30000,
    commandContextMessages: 50,
    autoSummaryEnabled: false,
    autoSummaryInterval: 20,
    multiBookMode: 'unified',
    trackerUids: {},
    mandatoryTools: false,
    mandatoryPromptPosition: 'in_chat',
    mandatoryPromptDepth: 1,
    mandatoryPromptRole: 'system',
    mandatoryPromptText: '[IMPORTANT INSTRUCTION: You MUST use at least one TunnelVision tool call this turn. Before responding to the user, search the lorebook for relevant context using TunnelVision_Search. If important new information emerged in the conversation, also use TunnelVision_Remember to save it. Do NOT skip tool calls — they are mandatory every generation.]',
    notebookEnabled: true,
    notebookPromptPosition: 'in_chat',
    notebookPromptDepth: 1,
    notebookPromptRole: 'system',
    selectiveRetrieval: true,
    ephemeralResults: true,
    ephemeralToolFilter: ['TunnelVision_Search', 'TunnelVision_Summarize', 'TunnelVision_MergeSplit'],
    stealthMode: false,
    autoHideSummarized: true,
    passthroughConstant: true,
    allowKeywordTriggers: false,
    autoDetectPattern: '',
    confirmTools: {},
    toolPromptOverrides: {},
    // Sidecar auto-retrieval (pre-gen)
    sidecarAutoRetrieval: false,
    sidecarContextMessages: 10,
    sidecarMaxInjectionTokens: 4000,
    sidecarFollowLinks: true,
    sidecarLinkDepth: 2,
    // LLM-evaluable conditional triggers (evaluated during sidecar retrieval)
    conditionalTriggersEnabled: true,
    // Sidecar post-gen writer
    sidecarPostGenWriter: false,
    sidecarWriterContextMessages: 15,
    sidecarWriterMaxOps: 5,
    // Per-lorebook permissions: { bookName: 'read_write' | 'read_only' | 'write_only' }
    bookPermissions: {},
    // Compact tool prompts: register one guide tool + one-liner descriptions to save tokens
    compactToolPrompts: true,
    // User-saved schema templates: { templateName: { nodes: [...] } }
    savedSchemaTemplates: {},
    // Entry links for cross-referencing: { lorebookName: { uid: [{ uid, relation }] } }
    entryLinks: {},
};

// ─── Schema Starter Templates ────────────────────────────────────
// Built-in templates users can load to bootstrap a schema tree.
// Each node has label, template (own sections only), and children.
// Inheritance is handled at runtime — children inherit parent sections.

/** @typedef {Object} SchemaStarterNode
 *  @property {string} label
 *  @property {string} template - Own template sections (not inherited)
 *  @property {SchemaStarterNode[]} [children]
 */

export const SCHEMA_STARTERS = {
    'Fantasy RPG': {
        nodes: [
            {
                label: 'Characters',
                template: '# Appearance\n# Personality',
                children: [
                    { label: 'NPCs', template: '', children: [] },
                    { label: 'Companions', template: '# Background\n# Speech Patterns\n# Relationship to {{user}}', children: [] },
                    { label: 'Antagonists', template: '# Motivation\n# Methods\n# Weakness', children: [] },
                ],
            },
            {
                label: 'Locations',
                template: '# Description\n# Atmosphere',
                children: [
                    { label: 'Settlements', template: '# Government\n# Notable Locations\n# Culture', children: [] },
                    { label: 'Wilderness', template: '# Terrain\n# Hazards\n# Flora and Fauna', children: [] },
                    { label: 'Dungeons', template: '# Layout\n# Encounters\n# Loot', children: [] },
                ],
            },
            {
                label: 'Items',
                template: '# Description\n# Properties\n# History',
                children: [
                    { label: 'Weapons', template: '# Damage Type\n# Special Abilities', children: [] },
                    { label: 'Armor', template: '# Defense\n# Restrictions', children: [] },
                    { label: 'Artifacts', template: '# Origin\n# Powers\n# Curse', children: [] },
                ],
            },
            {
                label: 'Events',
                template: '# What Happened\n# Participants\n# Consequences',
                children: [],
            },
            {
                label: 'World Lore',
                template: '# Overview\n# History\n# Rules',
                children: [],
            },
        ],
    },
    'Sci-Fi': {
        nodes: [
            {
                label: 'Characters',
                template: '# Appearance\n# Personality\n# Role',
                children: [
                    { label: 'Crew Members', template: '# Specialization\n# Backstory\n# Relationships', children: [] },
                    { label: 'Antagonists', template: '# Motivation\n# Resources\n# Weakness', children: [] },
                ],
            },
            {
                label: 'Planets',
                template: '# Atmosphere\n# Gravity\n# Population\n# Government',
                children: [],
            },
            {
                label: 'Starships',
                template: '# Class\n# Crew Capacity\n# Capabilities\n# Armament',
                children: [],
            },
            {
                label: 'Factions',
                template: '# Ideology\n# Structure\n# Territory\n# Key Members',
                children: [],
            },
            {
                label: 'Technology',
                template: '# Function\n# Limitations\n# Availability',
                children: [],
            },
            {
                label: 'Events',
                template: '# What Happened\n# Participants\n# Consequences\n# Timeline',
                children: [],
            },
        ],
    },
    'General': {
        nodes: [
            {
                label: 'People',
                template: '# Description\n# Personality\n# Background',
                children: [
                    { label: 'Main Characters', template: '# Motivation\n# Relationships\n# Arc', children: [] },
                    { label: 'Supporting Cast', template: '# Role in Story\n# Connection to Protagonist', children: [] },
                ],
            },
            {
                label: 'Places',
                template: '# Description\n# Atmosphere',
                children: [
                    { label: 'Buildings', template: '# Layout\n# Notable Features\n# History', children: [] },
                    { label: 'Regions', template: '# Geography\n# Climate\n# Inhabitants', children: [] },
                ],
            },
            {
                label: 'Things',
                template: '# Description\n# Significance',
                children: [],
            },
            {
                label: 'Events',
                template: '# Summary\n# People Involved\n# Outcome',
                children: [],
            },
        ],
    },
};

/**
 * Get all available schema starter template names (built-in + user-saved).
 * @returns {string[]}
 */
export function getSchemaStarterNames() {
    const builtIn = Object.keys(SCHEMA_STARTERS);
    const settings = getSettings();
    const saved = Object.keys(settings.savedSchemaTemplates || {});
    return [...builtIn, ...saved];
}

/**
 * Get a schema starter template by name (built-in or user-saved).
 * @param {string} name
 * @returns {{ nodes: SchemaStarterNode[] } | null}
 */
export function getSchemaStarter(name) {
    if (SCHEMA_STARTERS[name]) return SCHEMA_STARTERS[name];
    const settings = getSettings();
    return settings.savedSchemaTemplates?.[name] || null;
}

/**
 * Convert a schema starter node tree into live TreeNodes (with IDs).
 * Does NOT assign entryUids — schema nodes start empty.
 * @param {SchemaStarterNode[]} starterNodes
 * @returns {TreeNode[]}
 */
export function starterNodesToTreeNodes(starterNodes) {
    if (!Array.isArray(starterNodes)) return [];
    return starterNodes.map(sn => ({
        id: generateNodeId(),
        label: sn.label || 'Unnamed',
        summary: '',
        template: sn.template || '',
        entryUids: [],
        children: starterNodesToTreeNodes(sn.children || []),
        collapsed: false,
    }));
}

/**
 * Save the current tree's structure (nodes + templates, no entries) as a user template.
 * @param {string} name
 * @param {TreeNode} rootNode
 */
export function saveSchemaTemplate(name, rootNode) {
    if (!name || !rootNode) return;
    const settings = getSettings();

    function stripEntries(node) {
        return {
            label: node.label || 'Unnamed',
            template: node.template || '',
            children: (node.children || []).map(stripEntries),
        };
    }

    if (!settings.savedSchemaTemplates) {
        settings.savedSchemaTemplates = {};
    }
    settings.savedSchemaTemplates[name] = { nodes: (rootNode.children || []).map(stripEntries) };
    saveSettingsDebounced();
}

/**
 * Delete a user-saved schema template by name.
 * @param {string} name
 */
export function deleteSchemaTemplate(name) {
    const settings = getSettings();
    if (settings.savedSchemaTemplates?.[name]) {
        delete settings.savedSchemaTemplates[name];
        saveSettingsDebounced();
    }
}

function ensureSettings() {
    if (!extension_settings[EXTENSION_NAME]) {
        extension_settings[EXTENSION_NAME] = {};
    }
    const s = extension_settings[EXTENSION_NAME];
    let didMutate = false;
    for (const [key, defaultVal] of Object.entries(SETTING_DEFAULTS)) {
        if (s[key] === undefined || s[key] === null) {
            s[key] = (typeof defaultVal === 'object' && defaultVal !== null)
                ? JSON.parse(JSON.stringify(defaultVal))
                : defaultVal;
            didMutate = true;
        }
    }
    // Migration: old 'keys' detail level was renamed to 'lite'
    if (s.llmBuildDetail === 'keys') {
        s.llmBuildDetail = 'lite';
        didMutate = true;
    }

    if (normalizeTrackerSettings(s)) {
        didMutate = true;
    }

    if (normalizeConnectionProfileSetting(s)) {
        didMutate = true;
    }

    for (const [bookName, tree] of Object.entries(s.trees || {})) {
        if (normalizeTree(tree, bookName)) {
            didMutate = true;
        }
    }

    // Don't save here — filling in defaults during init can race with ST's
    // settings load and overwrite user settings. Let ST save naturally when
    // the user actually changes something.
}

export function getSettings() {
    ensureSettings();
    return extension_settings[EXTENSION_NAME];
}

function normalizeTree(tree, lorebookName) {
    if (!tree || typeof tree !== 'object') return false;

    let mutated = false;
    if (typeof tree.lorebookName !== 'string' || !tree.lorebookName) {
        tree.lorebookName = lorebookName;
        mutated = true;
    }

    if (!tree.root || typeof tree.root !== 'object') {
        tree.root = createTreeNode('Root', `Top-level index for ${tree.lorebookName}`);
        mutated = true;
    }

    if (typeof tree.version !== 'number' || !Number.isFinite(tree.version)) {
        tree.version = 1;
        mutated = true;
    }

    // Migration: v1 → v2 adds template field to all nodes.
    // normalizeTreeNode (called below) will add the missing field.
    // We just bump the version here.
    if (tree.version < 2) {
        tree.version = 2;
        mutated = true;
    }

    if (typeof tree.lastBuilt !== 'number' || !Number.isFinite(tree.lastBuilt)) {
        tree.lastBuilt = Date.now();
        mutated = true;
    }

    if (normalizeTreeNode(tree.root)) {
        mutated = true;
    }

    return mutated;
}

function normalizeTreeNode(node) {
    if (!node || typeof node !== 'object') return false;

    let mutated = false;
    if (typeof node.id !== 'string' || !node.id) {
        node.id = generateNodeId();
        mutated = true;
    }
    if (typeof node.label !== 'string') {
        node.label = 'Unnamed';
        mutated = true;
    }
    if (typeof node.summary !== 'string') {
        node.summary = '';
        mutated = true;
    }
    if (!Array.isArray(node.entryUids)) {
        node.entryUids = [];
        mutated = true;
    }
    if (!Array.isArray(node.children)) {
        node.children = [];
        mutated = true;
    }
    if (typeof node.collapsed !== 'boolean') {
        node.collapsed = Boolean(node._collapsed);
        mutated = true;
    }
    if ('_collapsed' in node) {
        delete node._collapsed;
        mutated = true;
    }
    if (typeof node.template !== 'string') {
        node.template = '';
        mutated = true;
    }

    for (const child of node.children) {
        if (normalizeTreeNode(child)) {
            mutated = true;
        }
    }

    return mutated;
}

function normalizeTrackerSettings(settings) {
    const trackerUids = settings.trackerUids;
    if (!trackerUids || typeof trackerUids !== 'object' || Array.isArray(trackerUids)) {
        settings.trackerUids = {};
        return true;
    }

    let mutated = false;
    for (const [bookName, rawUids] of Object.entries(trackerUids)) {
        const next = Array.isArray(rawUids)
            ? [...new Set(rawUids.map(uid => Number(uid)).filter(uid => Number.isFinite(uid)))]
            : [];

        if (next.length === 0) {
            if (Array.isArray(rawUids) && rawUids.length === 0) continue;
            delete trackerUids[bookName];
            mutated = true;
            continue;
        }

        next.sort((a, b) => a - b);
        if (!Array.isArray(rawUids) || rawUids.length !== next.length || rawUids.some((uid, index) => uid !== next[index])) {
            trackerUids[bookName] = next;
            mutated = true;
        }
    }

    return mutated;
}

function normalizeConnectionProfileSetting(settings) {
    const current = settings.connectionProfile;
    if (!current || typeof current !== 'string') return false;

    const profiles = getConnectionProfiles();
    if (profiles.some(profile => profile.id === current)) {
        return false;
    }

    const legacyMatch = profiles.find(profile => profile.name === current);
    if (legacyMatch) {
        settings.connectionProfile = legacyMatch.id;
        return true;
    }

    return false;
}

function getConnectionProfiles() {
    const profiles = extension_settings?.connectionManager?.profiles;
    return Array.isArray(profiles) ? profiles : [];
}

function resolveEntriesMap(entriesOrBookData) {
    if (!entriesOrBookData || typeof entriesOrBookData !== 'object') return null;
    if (entriesOrBookData.entries && typeof entriesOrBookData.entries === 'object') {
        return entriesOrBookData.entries;
    }
    return entriesOrBookData;
}

function getTrackerSet(bookName) {
    ensureSettings();
    const trackerUids = extension_settings[EXTENSION_NAME].trackerUids;
    return new Set(Array.isArray(trackerUids[bookName]) ? trackerUids[bookName] : []);
}

function storeTrackerSet(bookName, trackerSet) {
    const settings = getSettings();
    const next = [...trackerSet].sort((a, b) => a - b);
    if (next.length > 0) {
        settings.trackerUids[bookName] = next;
    } else {
        delete settings.trackerUids[bookName];
    }
}

export function getSelectedLorebook() {
    const settings = getSettings();
    return settings.selectedLorebook || null;
}

export function setSelectedLorebook(lorebookName) {
    const settings = getSettings();
    settings.selectedLorebook = lorebookName || null;
    saveSettingsDebounced();
}

export function getConnectionProfileId() {
    const settings = getSettings();
    return settings.connectionProfile || null;
}

export function setConnectionProfileId(profileId) {
    const settings = getSettings();
    settings.connectionProfile = profileId || null;
    saveSettingsDebounced();
}

export function findConnectionProfile(profileRef = null) {
    const ref = profileRef ?? getConnectionProfileId();
    if (!ref) return null;

    const profiles = getConnectionProfiles();
    return profiles.find(profile => profile.id === ref || profile.name === ref) || null;
}

export function getConnectionProfileName(profileRef = null) {
    return findConnectionProfile(profileRef)?.name || null;
}

export function listConnectionProfiles() {
    return [...getConnectionProfiles()];
}

// ─── Per-Lorebook Permissions ────────────────────────────────────

/**
 * Get the permission level for a lorebook.
 * @param {string} bookName
 * @returns {'read_write'|'read_only'|'write_only'}
 */
export function getBookPermission(bookName) {
    ensureSettings();
    return extension_settings[EXTENSION_NAME].bookPermissions[bookName] || 'read_write';
}

/**
 * Set the permission level for a lorebook.
 * @param {string} bookName
 * @param {'read_write'|'read_only'|'write_only'} permission
 */
export function setBookPermission(bookName, permission) {
    ensureSettings();
    if (permission === 'read_write') {
        // Default — remove from map to keep it clean
        delete extension_settings[EXTENSION_NAME].bookPermissions[bookName];
    } else {
        extension_settings[EXTENSION_NAME].bookPermissions[bookName] = permission;
    }
    saveSettingsDebounced();
}

/**
 * Check if a lorebook allows read (Search) operations.
 * @param {string} bookName
 * @returns {boolean}
 */
export function canReadBook(bookName) {
    const perm = getBookPermission(bookName);
    return perm === 'read_write' || perm === 'read_only';
}

/**
 * Check if a lorebook allows write (Remember/Update/Forget) operations.
 * @param {string} bookName
 * @returns {boolean}
 */
export function canWriteBook(bookName) {
    const perm = getBookPermission(bookName);
    return perm === 'read_write' || perm === 'write_only';
}

export function isTrackerTitle(title) {
    return TRACKER_TITLE_PREFIX.test(String(title || '').trim());
}

export function getTrackerUids(bookName) {
    return [...getTrackerSet(bookName)];
}

export function isTrackerUid(bookName, uid) {
    return getTrackerSet(bookName).has(Number(uid));
}

export function setTrackerUid(bookName, uid, tracked, { save = true } = {}) {
    const trackerSet = getTrackerSet(bookName);
    const numericUid = Number(uid);
    if (!Number.isFinite(numericUid)) return false;

    const hadUid = trackerSet.has(numericUid);
    if (tracked) {
        trackerSet.add(numericUid);
    } else {
        trackerSet.delete(numericUid);
    }

    if (hadUid === trackerSet.has(numericUid)) {
        return false;
    }

    storeTrackerSet(bookName, trackerSet);
    if (save) {
        saveSettingsDebounced();
    }
    return true;
}

export async function syncTrackerUidsForLorebook(bookName, entriesOrBookData = null, { save = true } = {}) {
    const entries = entriesOrBookData ? resolveEntriesMap(entriesOrBookData) : resolveEntriesMap(await loadWorldInfo(bookName));
    const trackerSet = getTrackerSet(bookName);
    const next = new Set();

    if (entries) {
        for (const key of Object.keys(entries)) {
            const entry = entries[key];
            if (!entry || entry.disable) continue;

            const shouldTrack = trackerSet.has(entry.uid) || isTrackerTitle(entry.comment);
            if (shouldTrack) {
                next.add(entry.uid);
            }
        }
    }

    const current = [...trackerSet].sort((a, b) => a - b);
    const normalized = [...next].sort((a, b) => a - b);
    const changed = current.length !== normalized.length || current.some((uid, index) => uid !== normalized[index]);

    if (!changed) {
        return normalized;
    }

    storeTrackerSet(bookName, next);
    if (save) {
        saveSettingsDebounced();
    }

    return normalized;
}

// ─── Entry Links (Cross-References) ────────────────────────────────────

/**
 * Get all links from an entry in a lorebook.
 * @param {string} bookName
 * @param {number} uid
 * @returns {Array<{uid: number, relation: string}>}
 */
export function getEntryLinks(bookName, uid) {
    ensureSettings();
    const links = extension_settings[EXTENSION_NAME].entryLinks[bookName];
    if (!links || !links[uid]) return [];
    return [...links[uid]];
}

/**
 * Set the links for an entry in a lorebook.
 * @param {string} bookName
 * @param {number} uid
 * @param {Array<{uid: number, relation: string}>} links
 */
export function setEntryLinks(bookName, uid, links) {
    ensureSettings();
    if (!extension_settings[EXTENSION_NAME].entryLinks[bookName]) {
        extension_settings[EXTENSION_NAME].entryLinks[bookName] = {};
    }
    extension_settings[EXTENSION_NAME].entryLinks[bookName][uid] = links;
    saveSettingsDebounced();
}

/**
 * Add a single link from one entry to another.
 * @param {string} bookName
 * @param {number} fromUid - The entry that is linking
 * @param {number} toUid - The entry being linked to
 * @param {string} relation - The type of relationship (e.g., "lives_in", "knows")
 */
export function addEntryLink(bookName, fromUid, toUid, relation = 'related') {
    ensureSettings();
    if (!extension_settings[EXTENSION_NAME].entryLinks[bookName]) {
        extension_settings[EXTENSION_NAME].entryLinks[bookName] = {};
    }
    const links = extension_settings[EXTENSION_NAME].entryLinks[bookName];
    if (!links[fromUid]) {
        links[fromUid] = [];
    }

    // Check if link already exists
    const existing = links[fromUid].find(l => l.uid === toUid);
    if (existing) {
        existing.relation = relation;
    } else {
        links[fromUid].push({ uid: toUid, relation });
    }

    // Auto-create back-link for bidirectional navigation
    if (!links[toUid]) {
        links[toUid] = [];
    }
    const backExisting = links[toUid].find(l => l.uid === fromUid);
    const backRelation = getInverseRelation(relation);
    if (backExisting) {
        backExisting.relation = backRelation;
    } else {
        links[toUid].push({ uid: fromUid, relation: backRelation });
    }

    saveSettingsDebounced();
}

/**
 * Remove a link from an entry.
 * @param {string} bookName
 * @param {number} fromUid
 * @param {number} toUid
 */
export function removeEntryLink(bookName, fromUid, toUid) {
    ensureSettings();
    const links = extension_settings[EXTENSION_NAME].entryLinks[bookName];
    if (!links) return;

    // Remove forward link
    if (links[fromUid]) {
        links[fromUid] = links[fromUid].filter(l => l.uid !== toUid);
        if (links[fromUid].length === 0) {
            delete links[fromUid];
        }
    }

    // Remove back-link
    if (links[toUid]) {
        links[toUid] = links[toUid].filter(l => l.uid !== fromUid);
        if (links[toUid].length === 0) {
            delete links[toUid];
        }
    }

    saveSettingsDebounced();
}

/**
 * Get all entries that link TO a given UID (reverse lookup).
 * @param {string} bookName
 * @param {number} uid
 * @returns {Array<{uid: number, relation: string}>} Entries that link to this UID
 */
export function getBackLinks(bookName, uid) {
    ensureSettings();
    const links = extension_settings[EXTENSION_NAME].entryLinks[bookName];
    if (!links) return [];

    const backLinks = [];
    for (const [fromUid, linkList] of Object.entries(links)) {
        for (const link of linkList) {
            if (link.uid === uid) {
                backLinks.push({ uid: Number(fromUid), relation: link.relation });
            }
        }
    }
    return backLinks;
}

/**
 * Remove all links referencing a UID (used when an entry is deleted).
 * @param {string} bookName
 * @param {number} uid
 */
export function removeAllLinksToEntry(bookName, uid) {
    ensureSettings();
    const links = extension_settings[EXTENSION_NAME].entryLinks[bookName];
    if (!links) return;

    // Remove this UID from all link arrays
    for (const fromUid in links) {
        if (links[fromUid]) {
            links[fromUid] = links[fromUid].filter(l => l.uid !== uid);
            if (links[fromUid].length === 0) {
                delete links[fromUid];
            }
        }
    }

    // Delete this UID's own links
    if (links[uid]) {
        delete links[uid];
    }

    saveSettingsDebounced();
}

/**
 * Ensure the entryLinks structure is initialized.
 * Called by ensureSettings().
 */
export function ensureLinkSettings() {
    if (!extension_settings[EXTENSION_NAME].entryLinks) {
        extension_settings[EXTENSION_NAME].entryLinks = {};
    }
}

/**
 * Get the inverse relation for bidirectional links.
 * @param {string} relation
 * @returns {string}
 */
function getInverseRelation(relation) {
    const inverseMap = {
        'lives_in': 'resident_of',
        'works_at': 'employer_of',
        'knows': 'known_by',
        'friend_of': 'friend_of',
        'enemy_of': 'enemy_of',
        'parent_of': 'child_of',
        'child_of': 'parent_of',
        'spouse_of': 'spouse_of',
        'sibling_of': 'sibling_of',
        'mentor_of': 'student_of',
        'student_of': 'mentor_of',
        'rival_of': 'rival_of',
        'ally_of': 'ally_of',
        'owns': 'owned_by',
        'member_of': 'has_member',
        'located_in': 'contains',
        'neighbor_of': 'neighbor_of',
    };
    return inverseMap[relation] || 'related_to';
}

export const BUILT_IN_FIELD_IDS = new Set([
  'issuetype', 'status', 'priority', 'labels', 'environment',
  'versions', 'fixVersions', 'parent', 'assignee', 'reporter',
  'summary', 'description', 'attachment', 'comment', 'timetracking',
  'project', 'id'
]);

export function normalizeInstanceUrl(instanceUrl) {
  let normalized = String(instanceUrl || '').trim();
  if (!normalized) {
    return '';
  }
  if (normalized.indexOf('://') === -1) {
    normalized = 'https://' + normalized;
  }
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return '';
    }
    parsed.hash = '';
    parsed.search = '';
    if (!parsed.pathname) {
      parsed.pathname = '/';
    }
    if (!parsed.pathname.endsWith('/')) {
      parsed.pathname += '/';
    }
    return parsed.toString();
  } catch (error) {
    return '';
  }
}

export function normalizeInstanceUrls(instanceUrls) {
  const values = Array.isArray(instanceUrls) ? instanceUrls : [instanceUrls];
  const normalized = values
    .flatMap(value => String(value || '').split(/\r?\n|\r/).map(entry => {
      // Preserve comma-separated entries (URL,PREFIX1,PREFIX2) for parseInstanceUrlsWithPrefixes
      // Only normalize the URL part if it exists
      const parts = entry.trim().split(',');
      if (!parts[0]) return '';
      const normalizedUrl = normalizeInstanceUrl(parts[0].trim());
      if (!normalizedUrl) return '';
      // Return full entry with prefixes intact if present
      return parts.length > 1
        ? `${normalizedUrl},${parts.slice(1).join(',')}`
        : normalizedUrl;
    }))
    .filter(Boolean);
  return normalized.filter((value, index) => normalized.indexOf(value) === index);
}

export function getConfiguredInstanceUrls(config = {}) {
  const configured = normalizeInstanceUrls(config.instanceUrls)
    .map(resolveInstanceUrl)
    .filter(Boolean);

  return configured.length ? [...new Set(configured)] : normalizeInstanceUrls(config.instanceUrl)
    .map(resolveInstanceUrl)
    .filter(Boolean);
}

export function selectInstanceUrl(instanceUrls, pageUrl = '') {
  const candidates = normalizeInstanceUrls(instanceUrls)
    .map(resolveInstanceUrl)
    .filter(Boolean);
  if (!candidates.length) {
    return '';
  }
  try {
    const page = new URL(pageUrl);
    const matchingCandidates = candidates.filter(candidate => {
      const instance = new URL(candidate);
      return page.origin === instance.origin &&
        (instance.pathname === '/' || page.pathname === instance.pathname || page.pathname.startsWith(instance.pathname));
    });
    if (matchingCandidates.length) {
      return matchingCandidates.sort((left, right) => {
        return new URL(right).pathname.length - new URL(left).pathname.length;
      })[0];
    }
  } catch (error) {
    // Fall back to the first configured instance for non-URL pages.
  }
  return candidates[0];
}

const ROOT_LEVEL_JIRA_SEGMENTS = new Set([
  'browse',
  'issues',
  'login',
  'logout',
  'plugins',
  'projects',
  'rest',
  'secure',
  'servicedesk',
]);

const CONTEXT_LEVEL_JIRA_SEGMENTS = new Set([
  ...ROOT_LEVEL_JIRA_SEGMENTS,
  'software',
]);

function isAtlassianCloudHost(hostname) {
  return String(hostname || '').toLowerCase().endsWith('.atlassian.net');
}

export function resolveInstanceUrl(instanceUrl) {
  const rawEntry = String(instanceUrl || '').trim();
  if (!rawEntry) {
    return '';
  }

  const urlPart = rawEntry.split(',')[0].trim();
  const normalized = normalizeInstanceUrl(urlPart);
  if (!normalized) {
    return '';
  }

  try {
    const parsed = new URL(normalized);
    const segments = String(parsed.pathname || '')
      .split('/')
      .filter(Boolean);
    const loweredSegments = segments.map(segment => String(segment || '').toLowerCase());

    if (!segments.length || isAtlassianCloudHost(parsed.hostname)) {
      parsed.pathname = '/';
      return parsed.toString();
    }

    if (segments.length === 1) {
      parsed.pathname = ROOT_LEVEL_JIRA_SEGMENTS.has(loweredSegments[0])
        ? '/'
        : `/${segments[0]}/`;
      return parsed.toString();
    }

    if (ROOT_LEVEL_JIRA_SEGMENTS.has(loweredSegments[0])) {
      parsed.pathname = '/';
      return parsed.toString();
    }

    if (CONTEXT_LEVEL_JIRA_SEGMENTS.has(loweredSegments[1])) {
      parsed.pathname = `/${segments[0]}/`;
      return parsed.toString();
    }

    return '';
  } catch (error) {
    return '';
  }
}

/**
 * Parse instance URLs with optional issue key prefixes.
 * Format: url,PREFIX1,PREFIX2\nurl,PREFIX3
 * Returns: Map of prefix -> normalized URL, and array of normalized URLs (for fallback)
 * @param {string} rawInput - Raw textarea input
 * @returns {{prefixMap: Map, instanceUrls: string[]}}
 */
export function parseInstanceUrlsWithPrefixes(rawInput) {
  const prefixMap = new Map();
  const instanceUrls = [];

  const rawLines = Array.isArray(rawInput)
    ? rawInput.flatMap(value => String(value || '').split(/\r?\n|\r/))
    : String(rawInput || '').split(/\r?\n|\r/);

  rawLines.filter(line => String(line || '').trim()).forEach(line => {
    const parts = String(line || '').split(',').map(part => part.trim()).filter(Boolean);
    if (!parts.length) {
      return;
    }

    const urlPart = parts[0];
    const normalized = normalizeInstanceUrl(urlPart);

    if (!normalized) {
      return;
    }

    instanceUrls.push(normalized);

    if (parts.length === 1) {
      return;
    }

    parts.slice(1).forEach(prefix => {
      const key = String(prefix || '').toUpperCase().trim();
      if (key) {
        prefixMap.set(key, normalized);
      }
    });
  });

  return {
    prefixMap,
    instanceUrls: [...new Set(instanceUrls)]
  };
}

/**
 * Extract issue key prefix from a full key like "CS-123" -> "CS"
 * @param {string} issueKey - Full issue key
 * @returns {string} Uppercase prefix
 */
export function extractIssuePrefixFromKey(issueKey) {
  const match = String(issueKey || '').match(/^([A-Z]+)/);
  return match ? match[1].toUpperCase() : '';
}

/**
 * Find the instance URL for an issue key using prefix mapping.
 * No fallback: only exact prefix matches are allowed.
 * @param {Map} prefixMap - Map of prefix -> instanceUrl
 * @param {string[]} instanceUrls - Unused; kept for signature compatibility
 * @param {string} issueKey - Issue key to look up
 * @returns {string|null} Instance URL or null if not found
 */
export function findInstanceUrlByIssueKey(prefixMap, instanceUrls, issueKey) {
  const prefix = extractIssuePrefixFromKey(issueKey);

  if (prefix && prefixMap.has(prefix)) {
    return prefixMap.get(prefix);
  }

  return null;
}

/**
 * Resolve instance URLs while preserving comma-separated prefixes.
 * Handles entries like "https://example.com/,PREFIX1,PREFIX2"
 * @param {string[]} instanceUrlsWithPrefixes - Array from normalizeInstanceUrls
 * @returns {string[]} Resolved URLs with prefixes intact
 */
export function resolveInstanceUrlsWithPrefixes(instanceUrlsWithPrefixes) {
  return (instanceUrlsWithPrefixes || []).map(entry => {
    // Split on comma to separate URL from prefixes
    const parts = entry.split(',');
    if (!parts[0]) {
      return entry;
    }
    
    // Resolve only the URL part
    const resolvedUrl = resolveInstanceUrl(parts[0].trim());
    if (!resolvedUrl) {
      return '';
    }
    
    // Reconstruct with prefixes if present
    if (parts.length > 1) {
      return `${resolvedUrl},${parts.slice(1).join(',')}`;
    }
    
    return resolvedUrl;
  }).filter(Boolean);
}

export function getCustomFieldLayoutKey(field) {
  const fieldId = typeof field === 'string'
    ? String(field || '').trim()
    : String(field?.fieldId || '').trim();
  if (fieldId) {
    return `custom_${fieldId}`;
  }
  const uid = typeof field === 'string' ? '' : String(field?._uid || '').trim();
  return uid ? `custom_${uid}` : '';
}

export function getCustomFieldRowFromLayout(fieldId, tooltipLayout) {
  const layoutKey = getCustomFieldLayoutKey(fieldId);
  if (!layoutKey) {
    return null;
  }
  if (tooltipLayout?.row1?.includes(layoutKey)) {
    return 1;
  }
  if (tooltipLayout?.row2?.includes(layoutKey)) {
    return 2;
  }
  if (tooltipLayout?.row3?.includes(layoutKey)) {
    return 3;
  }
  return null;
}

export function normalizeCustomFields(customFields, tooltipLayout) {
  if (!Array.isArray(customFields)) {
    return [];
  }
  const seen = {};
  return customFields
    .map(field => {
      const fieldId = String(field && field.fieldId || '').trim();
      const rowFromLayout = getCustomFieldRowFromLayout(fieldId, tooltipLayout);
      return {
        fieldId,
        row: rowFromLayout || Math.min(3, Math.max(1, Number(field && field.row) || 3))
      };
    })
    .filter(field => {
      if (!field.fieldId || seen[field.fieldId]) {
        return false;
      }
      seen[field.fieldId] = true;
      return true;
    });
}

export function updateCustomFieldRow(customFields, layoutKey, zone) {
  const row = Number(String(zone || '').replace('row', ''));
  if (!layoutKey?.startsWith('custom_') || ![1, 2, 3].includes(row)) {
    return customFields;
  }
  return customFields.map(field => {
    if (getCustomFieldLayoutKey(field) !== layoutKey) {
      return field;
    }
    return {
      ...field,
      row,
    };
  });
}

export function buildOptionsSnapshot({instanceUrl, domainsText, themeMode, hoverDepth, hoverModifierKey, inlineCopyButtons, tooltipLayout, customFields}) {
  return JSON.stringify({
    instanceUrl,
    domainsText,
    themeMode,
    hoverDepth,
    hoverModifierKey,
    inlineCopyButtons,
    tooltipLayout,
    customFields: normalizeCustomFields(customFields, tooltipLayout),
  });
}

export async function fetchFieldCatalog(instanceUrl) {
  if (!instanceUrl) {
    return {};
  }
  try {
    const response = await fetch(instanceUrl + 'rest/api/2/field', {
      credentials: 'include'
    });
    if (!response.ok) {
      return {};
    }
    const fields = await response.json();
    if (!Array.isArray(fields)) {
      return {};
    }
    return fields.reduce((acc, field) => {
      if (field && field.id) {
        acc[field.id] = field.name || field.id;
      }
      return acc;
    }, {});
  } catch (ex) {
    return {};
  }
}

export function getCustomFieldError(fieldId, fieldCatalog) {
  const trimmed = String(fieldId || '').trim();
  if (!trimmed) {
    return '';
  }
  if (BUILT_IN_FIELD_IDS.has(trimmed)) {
    return 'This field is already part of the built-in layout.';
  }
  if (Object.keys(fieldCatalog).length && !fieldCatalog[trimmed]) {
    return 'This field ID was not found in Jira.';
  }
  return '';
}

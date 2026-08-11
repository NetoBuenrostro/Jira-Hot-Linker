import {buildJiraSearchRequestUrls} from 'src/jira-issue-helpers';

export function createContentIssueLinkageHelpers(options) {
  const encodeJqlValue = options?.encodeJqlValue;
  const get = options?.get;
  const getBuildEditOption = options?.getBuildEditOption;
  const getCachedValue = options?.getCachedValue;
  const getGetIssueEditMeta = options?.getIssueEditMeta;
  const getIssueSummary = options?.getIssueSummary;
  const instanceUrl = options?.instanceUrl;
  const issueSearchCache = options?.issueSearchCache;
  const issueSearchRecentCache = options?.issueSearchRecentCache;

  function extractIssueKeyFromLinkageValue(value) {
    if (!value) {
      return '';
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    if (typeof value === 'object') {
      return String(value.key || value.value || value.id || '').trim();
    }
    return '';
  }

  function findEpicLinkFieldId(issueData, editMeta) {
    const names = issueData?.names || {};
    const editMetaFields = editMeta?.fields || {};
    const fromNames = Object.keys(names).find(fieldId => {
      const fieldName = String(names[fieldId] || '').toLowerCase();
      return fieldName === 'epic link' || fieldName === 'epic';
    });
    if (fromNames) {
      return fromNames;
    }
    return Object.keys(editMetaFields).find(fieldId => {
      const fieldName = String(editMetaFields[fieldId]?.name || '').toLowerCase();
      return fieldName === 'epic link' || fieldName === 'epic';
    }) || '';
  }

  async function resolveIssueLinkage(issueData) {
    const getIssueEditMeta = getGetIssueEditMeta?.();
    if (typeof getIssueEditMeta !== 'function') {
      throw new Error('Missing getIssueEditMeta helper');
    }
    if (!issueData?.key) {
      return {
        mode: '',
        label: 'Parent',
        editable: false,
        fieldKey: '',
        currentLink: null
      };
    }
    const editMeta = await getIssueEditMeta(issueData.key).catch(() => ({fields: {}}));
    const parentValue = issueData?.fields?.parent;
    const parentFieldMeta = editMeta.fields?.parent;
    if (parentValue?.key || parentFieldMeta) {
      const currentKey = parentValue?.key || '';
      const currentSummary = parentValue?.fields?.summary || currentKey;
      return {
        mode: 'parent',
        label: 'Parent',
        editable: !!parentFieldMeta,
        fieldKey: 'parent',
        currentLink: currentKey
          ? {
              key: currentKey,
              summary: currentSummary,
              url: `${instanceUrl}browse/${currentKey}`
            }
          : null
      };
    }

    const epicFieldId = findEpicLinkFieldId(issueData, editMeta);
    const epicKey = extractIssueKeyFromLinkageValue(issueData?.fields?.[epicFieldId]);
    if (!epicFieldId && !epicKey) {
      return {
        mode: '',
        label: 'Parent',
        editable: false,
        fieldKey: '',
        currentLink: null
      };
    }
    let epicSummary = epicKey;
    if (epicKey) {
      try {
        const epicSummaryData = await getIssueSummary(epicKey);
        epicSummary = epicSummaryData?.summary || epicKey;
      } catch (error) {
        epicSummary = epicKey;
      }
    }
    return {
      mode: 'epicLink',
      label: 'Parent',
      editable: !!editMeta.fields?.[epicFieldId],
      fieldKey: epicFieldId,
      currentLink: epicKey
        ? {
            key: epicKey,
            summary: epicSummary,
            url: `${instanceUrl}browse/${epicKey}`
          }
        : null
    };
  }

  function buildIssueSearchOption(issue, extra = {}) {
    const buildEditOption = getBuildEditOption?.();
    if (typeof buildEditOption !== 'function') {
      throw new Error('Missing buildEditOption helper');
    }
    const issueKey = String(issue?.key || '').trim();
    const issueSummary = String(issue?.fields?.summary || issue?.summary || issueKey).trim();
    const statusName = issue?.fields?.status?.name || '';
    return buildEditOption(issueKey, `[${issueKey}] ${issueSummary}`.trim(), {
      id: issueKey,
      iconUrl: issue?.fields?.issuetype?.iconUrl || issue?.issuetype?.iconUrl || '',
      metaText: statusName,
      rawValue: {
        key: issueKey,
        summary: issueSummary
      },
      searchText: `${issueKey} ${issueSummary} ${statusName}`,
      ...extra
    });
  }

  function buildIssueSearchCacheKey(query, issueData, mode) {
    const projectKey = String(issueData?.key || '').split('-')[0];
    return `${projectKey}__${mode}__${String(query || '').trim().toLowerCase()}`;
  }

  async function getVisibleIssueTypes() {
    return getCachedValue(issueSearchCache, '__visible_issue_types__', async () => {
      const urls = [
        `${instanceUrl}rest/api/3/issuetype`,
        `${instanceUrl}rest/api/2/issuetype`,
      ];
      let lastError = null;
      for (const url of urls) {
        try {
          const response = await get(url);
          if (Array.isArray(response)) {
            return response;
          }
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new Error('Could not load Jira issue types.');
    });
  }

  function buildIssueTypeClause(issueTypeIds) {
    const ids = [...new Set((issueTypeIds || []).map(id => String(id || '').trim()).filter(Boolean))];
    if (!ids.length) {
      return '';
    }
    return `issuetype in (${ids.map(encodeJqlValue).join(', ')})`;
  }

  async function resolveParentCandidateConstraint(issueData, linkageMode) {
    const issueType = issueData?.fields?.issuetype || {};
    let issueTypes = [];
    try {
      issueTypes = await getVisibleIssueTypes();
    } catch (error) {
      issueTypes = [];
    }

    const currentType = issueTypes.find(type => String(type?.id || '') === String(issueType?.id || '')) || issueType;
    const hasHierarchyMetadata = issueTypes.some(type => Number.isFinite(Number(type?.hierarchyLevel)));

    if (linkageMode === 'epicLink') {
      if (hasHierarchyMetadata) {
        const typeIds = issueTypes
          .filter(type => Number(type?.hierarchyLevel) === 1)
          .map(type => type.id);
        const clause = buildIssueTypeClause(typeIds);
        if (clause) {
          return {clause, allowedTypeIds: new Set(typeIds.map(String)), sameProjectOnly: false};
        }
      }
      // Jira Data Center keeps "Epic" as the advanced-search term even when
      // administrators rename the Epic terminology.
      return {clause: 'issuetype = Epic', allowedTypeIds: null, sameProjectOnly: false};
    }

    const currentHierarchyLevel = Number(currentType?.hierarchyLevel);
    if (hasHierarchyMetadata && Number.isFinite(currentHierarchyLevel)) {
      const typeIds = issueTypes
        .filter(type => Number(type?.hierarchyLevel) === currentHierarchyLevel + 1)
        .map(type => type.id);
      const clause = buildIssueTypeClause(typeIds);
      if (clause) {
        return {clause, allowedTypeIds: new Set(typeIds.map(String)), sameProjectOnly: false};
      }
    }

    if (currentType?.subtask === true || issueType?.subtask === true) {
      // Data Center's native Parent field is used for subtasks and their parent
      // must be a standard issue in the same project.
      return {clause: 'issuetype in standardIssueTypes()', allowedTypeIds: null, sameProjectOnly: true};
    }

    // Safe compatibility fallback for Cloud instances where issue-type hierarchy
    // metadata is unavailable: a base-level work item can only select an Epic.
    return {clause: 'issuetype = Epic', allowedTypeIds: null, sameProjectOnly: false};
  }

  function getRecentIssueSearchOptions(issueData, mode) {
    const projectKey = String(issueData?.key || '').split('-')[0];
    return issueSearchRecentCache.get(`${projectKey}__${mode}`) || [];
  }

  function setRecentIssueSearchOptions(issueData, mode, options) {
    const projectKey = String(issueData?.key || '').split('-')[0];
    if (!projectKey || !mode) {
      return;
    }
    issueSearchRecentCache.set(`${projectKey}__${mode}`, (Array.isArray(options) ? options : []).slice(0, 30));
  }

  function buildSafeIssueSearchClauses(query, projectKey) {
    const normalizedQuery = String(query || '').trim();
    if (!normalizedQuery) {
      return [];
    }

    const clauses = [];
    const tokenClauses = normalizedQuery
      .split(/[^A-Za-z0-9]+/)
      .map(token => token.trim())
      .filter(token => token.length >= 2)
      .slice(0, 4)
      .map(token => {
        const escapedToken = token
          .replace(/\\/g, '\\\\')
          .replace(/"/g, '\\"');
        return `summary ~ "${escapedToken}*"`;
      });

    if (tokenClauses.length === 1) {
      clauses.push(tokenClauses[0]);
    } else if (tokenClauses.length > 1) {
      clauses.push(`(${tokenClauses.join(' AND ')})`);
    }

    if (/^\d+$/.test(normalizedQuery)) {
      clauses.push(`key = ${encodeJqlValue(`${projectKey}-${normalizedQuery}`)}`);
    } else if (/^[A-Z][A-Z0-9_]*-\d+$/i.test(normalizedQuery)) {
      clauses.push(`key = ${encodeJqlValue(normalizedQuery.toUpperCase())}`);
    }

    return clauses;
  }

  async function searchParentCandidates(query, issueData, linkageMode) {
    const issueKey = String(issueData?.key || '').trim();
    const projectKey = issueKey.split('-')[0];
    if (!issueKey || !projectKey) {
      return [];
    }
    const normalizedQuery = String(query || '').trim();
    const cacheKey = buildIssueSearchCacheKey(normalizedQuery, issueData, linkageMode || 'linkage');
    return getCachedValue(issueSearchCache, cacheKey, async () => {
      const escapedIssueKey = encodeJqlValue(issueKey);
      const escapedProjectKey = encodeJqlValue(projectKey);
      const constraint = await resolveParentCandidateConstraint(issueData, linkageMode);
      const searchClauses = buildSafeIssueSearchClauses(normalizedQuery, projectKey);
      const commonParts = [`key != ${escapedIssueKey}`, constraint.clause];
      if (searchClauses.length) {
        commonParts.push(`(${searchClauses.join(' OR ')})`);
      }

      const search = async projectClause => {
        const jql = `${projectClause} AND ${commonParts.join(' AND ')} ORDER BY summary ASC`;
        let lastError = null;
        for (const requestUrl of buildJiraSearchRequestUrls(instanceUrl, {
          maxResults: 30,
          fields: ['summary', 'issuetype', 'status', 'project'],
          jql,
        })) {
          try {
            return await get(requestUrl);
          } catch (error) {
            lastError = error;
          }
        }
        throw lastError || new Error('Issue search failed.');
      };

      const searches = [search(`project = ${escapedProjectKey}`)];
      if (!constraint.sameProjectOnly) {
        searches.push(search(`project != ${escapedProjectKey}`));
      }
      const responses = await Promise.allSettled(searches);
      const issues = responses.flatMap(result => result.status === 'fulfilled' && Array.isArray(result.value?.issues)
        ? result.value.issues
        : []);
      if (!issues.length && responses.every(result => result.status === 'rejected')) {
        throw responses[0].reason || new Error('Issue search failed.');
      }

      const seen = new Set();
      const candidates = issues.filter(issue => {
        const candidateKey = String(issue?.key || '').trim();
        const candidateTypeId = String(issue?.fields?.issuetype?.id || issue?.issuetype?.id || '');
        if (!candidateKey || seen.has(candidateKey)) {
          return false;
        }
        if (constraint.allowedTypeIds && !constraint.allowedTypeIds.has(candidateTypeId)) {
          return false;
        }
        seen.add(candidateKey);
        return true;
      });
      candidates.sort((left, right) => {
        const leftProject = String(left?.fields?.project?.key || left?.key || '').split('-')[0];
        const rightProject = String(right?.fields?.project?.key || right?.key || '').split('-')[0];
        const leftIsLocal = leftProject === projectKey;
        const rightIsLocal = rightProject === projectKey;
        if (leftIsLocal !== rightIsLocal) {
          return leftIsLocal ? -1 : 1;
        }
        return String(left?.fields?.summary || left?.key || '').localeCompare(
          String(right?.fields?.summary || right?.key || ''),
          undefined,
          {numeric: true, sensitivity: 'base'}
        );
      });
      const options = candidates.map(issue => {
        const candidateProjectKey = String(issue?.fields?.project?.key || issue?.key || '').split('-')[0];
        const isLocalProject = candidateProjectKey === projectKey;
        return buildIssueSearchOption(issue, {
          groupKey: isLocalProject ? `project:${projectKey}` : '__other_projects__',
          groupLabel: isLocalProject ? `${projectKey} project` : 'Other projects',
          groupSortKey: isLocalProject ? '0' : '1',
        });
      }).filter(option => option.id);
      setRecentIssueSearchOptions(issueData, linkageMode || 'linkage', options);
      return options;
    });
  }

  return {
    getRecentIssueSearchOptions,
    resolveIssueLinkage,
    searchParentCandidates,
  };
}

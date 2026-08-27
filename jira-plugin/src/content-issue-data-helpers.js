import {buildPopupIssueMetadataUrl} from 'src/jira-issue-helpers';

export function createContentIssueDataHelpers(options) {
  const cacheTtlMs = Number(options?.cacheTtlMs) || 0;
  const changelogCache = options?.changelogCache;
  const customFields = options?.customFields;
  const get = options?.get;
  const getEpicLinkFieldIds = options?.getEpicLinkFieldIds;
  const getSprintFieldIds = options?.getSprintFieldIds;
  const instanceUrl = options?.instanceUrl;
  const issueCache = options?.issueCache;

  async function getCachedValue(cache, key, buildValue) {
    const existing = cache.get(key);
    if (existing && (Date.now() - existing.createdAt) < cacheTtlMs) {
      return existing.value;
    }

    const pendingValue = Promise.resolve().then(buildValue);
    cache.set(key, {
      createdAt: Date.now(),
      value: pendingValue
    });
    try {
      const value = await pendingValue;
      if (cache.get(key)?.value === pendingValue) {
        cache.set(key, {
          createdAt: Date.now(),
          value
        });
      }
      return value;
    } catch (error) {
      if (cache.get(key)?.value === pendingValue) {
        cache.delete(key);
      }
      throw error;
    }
  }

  function setCachedValue(cache, key, value) {
    if (!key) {
      return;
    }
    cache.set(key, {
      createdAt: Date.now(),
      value
    });
  }

  async function getIssueChangelog(issueKey) {
    return getCachedValue(changelogCache, issueKey, async () => {
      const response = await get(`${instanceUrl}rest/api/2/issue/${encodeURIComponent(issueKey)}?expand=changelog&fields=id`);
      return response?.changelog || {histories: []};
    });
  }

  async function getIssueMetaData(issueKey, requestedInstanceUrl = instanceUrl) {
    const issueCacheKey = `${requestedInstanceUrl}__${issueKey}`;
    return getCachedValue(issueCache, issueCacheKey, async () => {
      const [sprintFieldIds, epicLinkFieldIds] = await Promise.all([
        getSprintFieldIds(requestedInstanceUrl),
        getEpicLinkFieldIds(requestedInstanceUrl)
      ]);
      return get(buildPopupIssueMetadataUrl(requestedInstanceUrl, issueKey, {
        sprintFieldIds,
        epicLinkFieldIds,
        customFields,
      }));
    });
  }

  async function getIssueSummary(issueKey) {
    if (!issueKey) {
      return null;
    }
    return getCachedValue(issueCache, `summary__${issueKey}`, async () => {
      const data = await get(`${instanceUrl}rest/api/2/issue/${issueKey}?fields=summary`);
      return {
        key: issueKey,
        summary: data?.fields?.summary || issueKey
      };
    });
  }

  return {
    getCachedValue,
    getIssueChangelog,
    getIssueMetaData,
    getIssueSummary,
    setCachedValue,
  };
}

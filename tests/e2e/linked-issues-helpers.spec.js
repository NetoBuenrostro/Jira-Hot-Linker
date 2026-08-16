const {test, expect} = require('@playwright/test');
const {
  buildIssueLinkCreatePayload,
  buildLinkedIssuesPanelView,
  buildRelationshipOptions,
  createContentLinkedIssuesHelpers,
  parseLinkedIssueKeys,
} = require('../../jira-plugin/src/content-linked-issues-helpers');

test('groups both directions of a symmetric relationship together', () => {
  const panel = buildLinkedIssuesPanelView({
    linkedIssuesState: {
      issueDetailsByKey: {},
      pendingRemoveIds: [],
      selectedIssues: [],
    },
  }, {
    fields: {
      issuelinks: [
        {
          id: 'link-1',
          type: {id: '10003', name: 'Relates', outward: 'relates to', inward: 'relates to'},
          outwardIssue: {key: 'APP-1', fields: {summary: 'First issue'}},
        },
        {
          id: 'link-2',
          type: {id: '10003', name: 'Relates', outward: 'relates to', inward: 'relates to'},
          inwardIssue: {key: 'APP-2', fields: {summary: 'Second issue'}},
        },
      ],
    },
  });

  expect(panel.groups).toHaveLength(1);
  expect(panel.groups[0]).toMatchObject({label: 'relates to', count: 2});
});

test('parses unique Jira keys from pasted comma, whitespace, and newline-separated text', () => {
  expect(parseLinkedIssueKeys('app-12, API_2-7\nAPP-12  OPS-004')).toEqual([
    'APP-12',
    'API_2-7',
    'OPS-004',
  ]);
});

test('builds directional options and maps both directions into Jira link payloads', () => {
  const options = buildRelationshipOptions([
    {id: 'blocks', name: 'Blocks', outward: 'blocks', inward: 'is blocked by'},
    {id: 'relates', name: 'Relates', outward: 'relates to', inward: 'relates to'},
  ]);

  expect(options.map(option => option.id)).toEqual([
    'blocks:outward',
    'blocks:inward',
    'relates:outward',
  ]);
  expect(buildIssueLinkCreatePayload('APP-1', options[0], 'APP-2')).toEqual({
    type: {name: 'Blocks'},
    outwardIssue: {key: 'APP-1'},
    inwardIssue: {key: 'APP-2'},
  });
  expect(buildIssueLinkCreatePayload('APP-1', options[1], 'APP-2')).toEqual({
    type: {name: 'Blocks'},
    outwardIssue: {key: 'APP-2'},
    inwardIssue: {key: 'APP-1'},
  });
});

test('falls back to Jira search when issue-picker endpoints are unavailable', async () => {
  const requestedUrls = [];
  const helpers = createContentLinkedIssuesHelpers({
    encodeJqlValue: value => `"${value}"`,
    get: async url => {
      requestedUrls.push(url);
      if (url.includes('/issue/picker')) {
        throw new Error('Picker unavailable');
      }
      return {
        issues: [{
          id: '2',
          key: 'APP-2',
          fields: {
            summary: 'Retry failed requests',
            project: {key: 'APP'},
            issuetype: {name: 'Task'},
            status: {name: 'To Do'},
          },
        }],
      };
    },
    getCachedValue: async (_cache, _key, loader) => loader(),
    instanceUrl: 'https://jira.example/',
    issueSearchCache: new Map(),
  });

  const results = await helpers.searchIssueLinkCandidates('retry', {
    key: 'APP-1',
    fields: {project: {id: '10', key: 'APP'}},
  });

  expect(results).toEqual([expect.objectContaining({key: 'APP-2', summary: 'Retry failed requests'})]);
  expect(requestedUrls.filter(url => url.includes('/issue/picker'))).toHaveLength(2);
  expect(requestedUrls.some(url => url.includes('/search'))).toBe(true);
});

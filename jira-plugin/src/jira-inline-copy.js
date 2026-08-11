const ISSUE_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,14}-\d+\b/;
const HEADER_LINK_SELECTORS = [
  '[data-testid="issue.views.issue-base.foundation.breadcrumbs.breadcrumb-current-issue-container"] a[href]',
  '#key-val',
];
const SUMMARY_SELECTORS = [
  '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
  'h1[data-test-id="issue.views.issue-base.foundation.summary.heading"]',
  '#summary-val',
  '.issue-header-content h1',
];
const RESULT_LINK_SELECTOR = 'a[href*="/browse/"]';
const RESULT_KEY_SELECTORS = [
  '[data-testid*="key"]',
  '.issue-key',
  '.card-key',
];

function getIssueKey(element) {
  const dataKey = String(element?.getAttribute?.('data-issue-key') || '').trim();
  if (ISSUE_KEY_PATTERN.test(dataKey)) {
    return dataKey.match(ISSUE_KEY_PATTERN)[0];
  }
  const href = String(element?.getAttribute?.('href') || '');
  const hrefMatch = href.match(/\/browse\/([A-Z][A-Z0-9]{1,14}-\d+)\b/i);
  if (hrefMatch) {
    return hrefMatch[1].toUpperCase();
  }
  return String(element?.textContent || '').match(ISSUE_KEY_PATTERN)?.[0] || '';
}

function getIssueSummary(documentRef) {
  for (const selector of SUMMARY_SELECTORS) {
    const summary = String(documentRef.querySelector(selector)?.textContent || '').trim();
    if (summary) {
      return summary;
    }
  }
  return '';
}

function getResultSummary(issueElement, key) {
  const container = issueElement.closest('[data-issue-key], tr, [role="row"], article, li');
  if (!container) {
    return '';
  }
  const explicitSummary = container.querySelector('[data-testid*="summary"], .issue-summary, .summary');
  if (explicitSummary) {
    return String(explicitSummary.textContent || '').trim();
  }
  const relatedLink = Array.from(container.querySelectorAll(RESULT_LINK_SELECTOR)).find(link => {
    const text = String(link.textContent || '').trim();
    return link !== issueElement && text && text !== key;
  });
  return String(relatedLink?.textContent || '').trim();
}

function findResultKeyElement(container, key) {
  for (const selector of RESULT_KEY_SELECTORS) {
    const element = container.querySelector(selector);
    if (String(element?.textContent || '').includes(key)) {
      return element;
    }
  }

  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode = walker.nextNode();
  while (textNode) {
    if (String(textNode.nodeValue || '').trim() === key) {
      return textNode.parentElement;
    }
    textNode = walker.nextNode();
  }
  return null;
}

function buildIssueUrl(instanceUrl, key) {
  const baseUrl = String(instanceUrl || '').endsWith('/') ? instanceUrl : `${instanceUrl}/`;
  return new URL(`browse/${key}`, baseUrl).toString();
}

function buildCopyIcon(documentRef) {
  const svg = documentRef.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.innerHTML = '<g fill="currentColor"><path d="M10 19h8V8h-8v11zM8 7.992C8 6.892 8.902 6 10.009 6h7.982C19.101 6 20 6.893 20 7.992v11.016c0 1.1-.902 1.992-2.009 1.992H10.01A2.001 2.001 0 0 1 8 19.008V7.992z"></path><path d="M5 16V4.992C5 3.892 5.902 3 7.009 3H15v13H5zm2 0h8V5H7v11z"></path></g>';
  return svg;
}

function createCopyButton(documentRef, reference, copy, variant) {
  const button = documentRef.createElement('button');
  button.type = 'button';
  button.className = `_JX_inline_copy_button _JX_inline_copy_button_${variant}`;
  button.dataset.jxInlineCopyKey = reference.key;
  button.dataset.testid = `jira-inline-copy-${reference.key}`;
  button.title = `Copy ${reference.key} issue link`;
  button.setAttribute('aria-label', button.title);
  button.appendChild(buildCopyIcon(documentRef));
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    Promise.resolve(copy(reference)).catch(() => {});
  });
  return button;
}

function removeStaleCopyButtons(issueElement, key) {
  let sibling = issueElement.nextElementSibling;
  while (sibling?.classList.contains('_JX_inline_copy_button')) {
    const nextSibling = sibling.nextElementSibling;
    if (sibling.dataset.jxInlineCopyKey !== key) {
      sibling.remove();
    }
    sibling = nextSibling;
  }
}

export function installJiraInlineCopyButtons({document: documentRef, instanceUrl, enabled = true, copy}) {
  if (!enabled || !documentRef?.body || typeof copy !== 'function') {
    return () => {};
  }

  let instanceOrigin = '';
  try {
    instanceOrigin = new URL(instanceUrl).origin;
  } catch (error) {
    return () => {};
  }
  if (documentRef.location.origin !== instanceOrigin) {
    return () => {};
  }

  let scanFrame = 0;
  const scan = () => {
    scanFrame = 0;
    const summary = getIssueSummary(documentRef);
    for (const selector of HEADER_LINK_SELECTORS) {
      const issueElement = documentRef.querySelector(selector);
      const key = getIssueKey(issueElement);
      if (!issueElement || !key || !summary || issueElement.closest('._JX_container')) {
        continue;
      }
      removeStaleCopyButtons(issueElement, key);
      const existing = issueElement.nextElementSibling;
      if (existing?.matches(`._JX_inline_copy_button[data-jx-inline-copy-key="${key}"]`)) {
        break;
      }
      issueElement.insertAdjacentElement('afterend', createCopyButton(documentRef, {
        key,
        summary,
        url: buildIssueUrl(instanceUrl, key),
      }, copy, 'header'));
      break;
    }

    for (const issueElement of documentRef.querySelectorAll(RESULT_LINK_SELECTOR)) {
      const key = getIssueKey(issueElement);
      const elementText = String(issueElement.textContent || '').trim();
      if (!key || !elementText.includes(key) || issueElement.closest('._JX_container')) {
        continue;
      }
      removeStaleCopyButtons(issueElement, key);
      const existing = issueElement.nextElementSibling;
      if (existing?.matches(`._JX_inline_copy_button[data-jx-inline-copy-key="${key}"]`)) {
        continue;
      }
      const resultSummary = getResultSummary(issueElement, key);
      if (!resultSummary) {
        continue;
      }
      issueElement.insertAdjacentElement('afterend', createCopyButton(documentRef, {
        key,
        summary: resultSummary,
        url: buildIssueUrl(instanceUrl, key),
      }, copy, 'result'));
    }

    for (const container of documentRef.querySelectorAll('[data-issue-key]')) {
      const key = getIssueKey(container);
      const issueElement = findResultKeyElement(container, key);
      if (!key || !issueElement || issueElement.closest('._JX_container')) {
        continue;
      }
      removeStaleCopyButtons(issueElement, key);
      const existing = issueElement.nextElementSibling;
      if (existing?.matches(`._JX_inline_copy_button[data-jx-inline-copy-key="${key}"]`)) {
        continue;
      }
      const resultSummary = getResultSummary(issueElement, key);
      if (!resultSummary) {
        continue;
      }
      issueElement.insertAdjacentElement('afterend', createCopyButton(documentRef, {
        key,
        summary: resultSummary,
        url: buildIssueUrl(instanceUrl, key),
      }, copy, 'result'));
    }
  };
  const scheduleScan = () => {
    if (!scanFrame) {
      scanFrame = documentRef.defaultView.requestAnimationFrame(scan);
    }
  };
  const observer = new MutationObserver(scheduleScan);
  observer.observe(documentRef.body, {
    attributes: true,
    attributeFilter: ['data-issue-key', 'href'],
    childList: true,
    subtree: true,
  });
  scan();

  return () => {
    observer.disconnect();
    if (scanFrame) {
      documentRef.defaultView.cancelAnimationFrame(scanFrame);
    }
  };
}

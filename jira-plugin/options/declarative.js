/*global chrome */
import defaultConfig from 'options/config';
import uniqueId from 'lodash/uniqueId';
import regexEscape from 'escape-string-regexp';
import {storageGet} from 'src/chrome';
import {getConfiguredInstanceUrls} from 'options/options-utils';

export function toMatchUrl(pattern) {
  if (pattern === '<all_urls>') {
    return '*://*/*';
  }
  if (pattern.indexOf('://') === -1) {
    pattern = '*://' + pattern;
  }
  if (!hasPathSlash.test(pattern)) {
    pattern = pattern + '/';
  }
  if (pattern.indexOf('*') === -1) {
    pattern = pattern + '*';
  }
  return pattern;
}

const token = uniqueId('__JX_WILDCARD__');
const tokenRE = new RegExp(token, 'g');

function pageStateWildCardMatcher(wildCardUrl) {
  const urlRegex = regexEscape(toMatchUrl(wildCardUrl).replace(/\*/g, token)).replace(tokenRE, '.*');
  return new chrome.declarativeContent.PageStateMatcher({
    pageUrl: {
      urlMatches: urlRegex,
      schemes: ['http', 'https'],
    }
  });
}

export const hasPathSlash = /.*:\/\/.*\//;
export const contentScript = 'build/main.js';

export async function resetDeclarativeMapping() {
  const config = await storageGet(defaultConfig);
  const activationDomains = [...(config.domains || [])];
  if (config.inlineCopyButtons !== false) {
    activationDomains.push(...getConfiguredInstanceUrls(config));
  }
  const uniqueActivationDomains = activationDomains.filter((domain, index, domains) => {
    return domains.findIndex(candidate => toMatchUrl(candidate) === toMatchUrl(domain)) === index;
  });
  chrome.declarativeContent.onPageChanged.removeRules(
    undefined,
    function () {
      chrome.declarativeContent.onPageChanged.addRules(uniqueActivationDomains.map(domain => ({
        conditions: [pageStateWildCardMatcher(domain)],
        actions: [new chrome.declarativeContent.RequestContentScript({
          js: [contentScript],
          allFrames: true,
        })]
      })));
    }
  );
}

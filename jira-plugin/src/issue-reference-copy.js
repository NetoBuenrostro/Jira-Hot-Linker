function buildIssueReferencePayload(reference, documentRef) {
  const key = String(reference?.key || '').trim();
  const summary = String(reference?.summary || '').trim();
  const url = String(reference?.url || '').trim();
  const link = documentRef.createElement('a');
  link.href = url;
  link.textContent = `[${key}] ${summary}`.trim();
  return {
    html: link.outerHTML,
    text: url,
  };
}

function copyIssueReferenceFallback(payload, documentRef) {
  return new Promise((resolve, reject) => {
    const onCopy = event => {
      event.preventDefault();
      event.clipboardData.setData('text/html', payload.html);
      event.clipboardData.setData('text/plain', payload.text);
    };
    documentRef.addEventListener('copy', onCopy, {once: true});
    let copied = false;
    try {
      copied = documentRef.execCommand('copy');
    } catch (error) {
      documentRef.removeEventListener('copy', onCopy);
      reject(error);
      return;
    }
    if (!copied) {
      documentRef.removeEventListener('copy', onCopy);
      reject(new Error('Copy command failed'));
      return;
    }
    resolve();
  });
}

export async function copyIssueReference(reference, dependencies = {}) {
  const documentRef = dependencies.document || document;
  const navigatorRef = dependencies.navigator || navigator;
  const ClipboardItemRef = dependencies.ClipboardItem || window.ClipboardItem;
  const payload = buildIssueReferencePayload(reference, documentRef);

  try {
    if (navigatorRef.clipboard && ClipboardItemRef && navigatorRef.clipboard.write) {
      await navigatorRef.clipboard.write([
        new ClipboardItemRef({
          'text/html': new Blob([payload.html], {type: 'text/html'}),
          'text/plain': new Blob([payload.text], {type: 'text/plain'}),
        })
      ]);
      return 'rich';
    }
  } catch (error) {
    // Fall through to the document copy event path.
  }

  try {
    await copyIssueReferenceFallback(payload, documentRef);
    return 'rich';
  } catch (error) {
    if (!navigatorRef.clipboard?.writeText) {
      throw error;
    }
    await navigatorRef.clipboard.writeText(payload.text);
    return 'text';
  }
}

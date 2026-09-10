'use strict';

self.onmessage = async event => {
  const data = event.data || {};
  const id = data.id;
  const file = data.file;

  if (!id || !(file instanceof Blob)) {
    self.postMessage({ id, ok: false, error: 'Invalid artwork file.' });
    return;
  }

  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    const bytes = new Uint8Array(digest);
    let hash = '';
    for (let i = 0; i < bytes.length; i++) hash += bytes[i].toString(16).padStart(2, '0');
    self.postMessage({ id, ok: true, hash });
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String(error && error.message ? error.message : error || 'Fingerprint failed.')
    });
  }
};

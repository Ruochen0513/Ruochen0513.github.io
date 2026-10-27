// A short timeout keeps the homepage usable if the content service is unavailable.
window.PLAYER_HOME_CONFIG_READY = (async () => {
  const controller = new AbortController();
  let timer;
  const timeout = new Promise(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 2200); });
  setTimeout(() => document.querySelector('.boot-screen')?.classList.add('is-hidden'), 3500);
  try {
    const endpoint = window.PLAYER_HOME_CONFIG.visitors?.endpoint;
    if (!endpoint) return;
    const result = await Promise.race([Promise.all([
      import('./config-schema.mjs'),
      fetch(`${endpoint}/site-config`, { signal: controller.signal, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' }),
    ]), timeout]);
    if (!result) return;
    const [schema, response] = result;
    if (!response.ok) return;
    const data = await response.json();
    if (controller.signal.aborted || data.version !== 1) return;
    window.PLAYER_HOME_CONFIG = schema.mergeEditable(window.PLAYER_HOME_CONFIG, data.config);
  } catch { /* Keep the checked-in content when offline. */ }
  finally { clearTimeout(timer); }
})();

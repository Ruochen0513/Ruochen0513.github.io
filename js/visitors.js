(() => {
  'use strict';
  const section = document.querySelector('#visitors');
  if (!section) return;
  const settings = window.PLAYER_HOME_CONFIG?.visitors || {};
  const message = section.querySelector('[data-visitor-message]');
  const connection = section.querySelector('[data-visitor-connection]');
  const points = section.querySelector('[data-visitor-points]');
  const regions = section.querySelector('[data-visitor-regions]');
  const regionEmpty = section.querySelector('[data-visitor-region-empty]');
  const retry = section.querySelector('[data-visitor-retry]');
  const updated = section.querySelector('[data-visitor-updated]');
  const buttons = [...section.querySelectorAll('[data-visitor-days]')];
  const formatter = new Intl.NumberFormat('zh-CN');
  let countryNames;
  try { countryNames = new Intl.DisplayNames(['zh-CN'], { type: 'region' }); } catch {}
  const countryName = code => code === 'ZZ' ? '未知地区' : countryNames?.of(code) || code;
  const number = value => Number.isSafeInteger(value) && value >= 0;
  let endpoint;
  let activeDays = 30;
  let controller;
  let started = false;
  let visitSent = false;

  function state(label, text, canRetry = false) {
    connection.textContent = label;
    message.textContent = text;
    message.hidden = !text;
    retry.hidden = !canRetry;
  }
  function clear() {
    section.querySelectorAll('[data-visitor-metric]').forEach(element => { element.textContent = '--'; });
    points.replaceChildren();
    regions.replaceChildren();
    regionEmpty.hidden = false;
    regionEmpty.textContent = '尚无统计数据';
    updated.textContent = '';
  }
  function validate(data) {
    if (data?.version !== 1 || data.days !== activeDays || !data.totals || !Array.isArray(data.points) || !Array.isArray(data.countries)) throw new Error('Invalid statistics');
    for (const key of ['visitors', 'pageviews', 'countries', 'mappedPageviews']) {
      if (!number(data.totals[key])) throw new Error('Invalid totals');
    }
    if (!Number.isFinite(Date.parse(data.updatedAt)) || data.points.length > 1000 || data.countries.length > 300) throw new Error('Invalid response');
    for (const item of [...data.points, ...data.countries]) {
      if (!/^[A-Z]{2}$/.test(item.country) || !number(item.views) || !number(item.visitors)) throw new Error('Invalid region');
    }
    for (const item of data.points) {
      if (!Number.isFinite(item.latitude) || Math.abs(item.latitude) > 90 || !Number.isFinite(item.longitude) || Math.abs(item.longitude) > 180) throw new Error('Invalid location');
    }
    return data;
  }
  function render(data) {
    section.querySelectorAll('[data-visitor-metric]').forEach(element => {
      element.textContent = formatter.format(data.totals[element.dataset.visitorMetric]);
    });
    points.replaceChildren();
    const visiblePoints = data.points.filter(item => item.views > 0 && item.latitude >= -60 && item.latitude <= 85);
    const max = Math.max(1, ...visiblePoints.map(item => item.views));
    for (const item of visiblePoints) {
      const strength = Math.log1p(item.views) / Math.log1p(max);
      const x = (item.longitude + 180) / 360 * 960;
      const y = (85 - item.latitude) / 145 * 400;
      const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      const heat = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const core = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = `${countryName(item.country)} · ${formatter.format(item.views)} 次访问 · ${formatter.format(item.visitors)} 位估算访客（大致地区）`;
      heat.setAttribute('cx', x);
      heat.setAttribute('cy', y);
      heat.setAttribute('r', 9 + strength * 19);
      heat.setAttribute('fill', 'url(#visitor-heat-gradient)');
      heat.setAttribute('opacity', .3 + strength * .7);
      core.setAttribute('cx', x);
      core.setAttribute('cy', y);
      core.setAttribute('r', 1.5 + strength * 2);
      core.setAttribute('fill', '#b5fff6');
      core.setAttribute('opacity', .45 + strength * .55);
      group.append(title, heat, core);
      points.append(group);
    }
    regions.replaceChildren();
    for (const [index, item] of data.countries.slice(0, 6).entries()) {
      const row = document.createElement('li');
      const rank = document.createElement('span');
      const name = document.createElement('span');
      const count = document.createElement('strong');
      rank.className = 'visitors-regions__rank';
      rank.textContent = String(index + 1).padStart(2, '0');
      name.textContent = countryName(item.country);
      count.textContent = formatter.format(item.views);
      row.append(rank, name, count);
      regions.append(row);
    }
    regionEmpty.hidden = data.countries.length > 0;
    updated.textContent = `更新于 ${new Date(data.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    if (!data.totals.pageviews) state('已连接', '还没有访问记录，第一位访客将点亮这张地图。');
    else if (!visiblePoints.length) state('已连接', '已记录访问，暂时没有可定位的地区。');
    else state('已连接', '');
  }
  async function refresh() {
    controller?.abort();
    const current = new AbortController();
    controller = current;
    clear();
    state('同步中', '正在读取访客分布…');
    const timer = setTimeout(() => current.abort(), 8000);
    try {
      const response = await fetch(`${endpoint}/stats?days=${activeDays}`, { signal: current.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!response.ok) throw new Error('Unavailable');
      const payload = await response.json();
      if (controller !== current) return;
      render(validate(payload));
    } catch {
      if (controller !== current) return;
      clear();
      state('暂时离线', '统计暂时无法读取，请稍后重试。', true);
    } finally { clearTimeout(timer); }
  }
  async function collect() {
    if (visitSent || navigator.doNotTrack === '1' || navigator.globalPrivacyControl === true) return;
    visitSent = true;
    const timeout = new AbortController();
    const timer = setTimeout(() => timeout.abort(), 5000);
    try {
      await fetch(`${endpoint}/visit`, { method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', signal: timeout.signal });
    } catch { /* A failed counter never blocks the page. */ }
    finally { clearTimeout(timer); }
  }
  try {
    const url = new URL(settings.endpoint);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    const localPage = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
    if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && localPage && url.protocol === 'http:'))) throw new Error('Invalid endpoint');
    endpoint = url.href.replace(/\/$/, '');
  } catch {
    buttons.forEach(button => { button.disabled = true; });
    state('等待接入', '访客地图将在接入统计后点亮。');
    return;
  }
  buttons.forEach(button => button.addEventListener('click', () => {
    const days = Number(button.dataset.visitorDays);
    if (days === activeDays) return;
    activeDays = days;
    buttons.forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    refresh();
  }));
  retry.addEventListener('click', refresh);
  // Count after the document is ready, independent of image/window.load events.
  // Loading the map's data waits until its section approaches the viewport.
  const start = () => {
    if (started) return;
    started = true;
    collect();
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => {
        if (!entries.some(entry => entry.isIntersecting)) return;
        observer.disconnect();
        refresh();
      }, { rootMargin: '300px' });
      observer.observe(section);
    } else refresh();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();

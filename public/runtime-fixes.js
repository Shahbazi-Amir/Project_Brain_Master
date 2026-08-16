(() => {
  'use strict';

  const VOICE_LIMIT_SECONDS = 15;
  const nativeFetch = window.fetch.bind(window);
  const voiceSessions = new Map();
  let activeDiscoveryController = null;
  let discoveryCancelRequested = false;

  const faNumber = value => new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(value);
  const normalize = value => String(value || '').replace(/\s+/g, ' ').trim();

  function voiceTarget(button) {
    const id = button.id;
    const known = {
      ideaVoiceBtn: ['idea', 'ideaVoiceStatus'],
      finalVoiceBtn: ['finalFeedback', 'finalVoiceStatus'],
      directiveVoiceBtn: ['directive', 'directiveVoiceStatus'],
      manualVoiceBtn: ['manualResult', 'manualVoiceStatus']
    };
    if (known[id]) {
      return {
        target: document.getElementById(known[id][0]),
        status: document.getElementById(known[id][1])
      };
    }
    const wrap = button.closest('.details-wrap');
    return {
      target: wrap?.querySelector('textarea, input') || null,
      status: wrap?.querySelector('.voice-status') || null
    };
  }

  function normalizedVoiceLabel(button) {
    const current = button.textContent || '🎙 گفتن';
    if (/·\s*[۰-۹0-9]+ث/.test(current)) return current.replace(/·\s*[۰-۹0-9]+ث/, `· ${faNumber(VOICE_LIMIT_SECONDS)}ث`);
    return `${current.replace(/\s+$/, '')} · ${faNumber(VOICE_LIMIT_SECONDS)}ث`;
  }

  function refreshVoiceLabels(root = document) {
    root.querySelectorAll?.('.voice-btn').forEach(button => {
      if (!button.classList.contains('listening')) button.textContent = normalizedVoiceLabel(button);
    });
  }

  function stopVoice(button, message = 'ضبط تمام شد؛ متن ثبت‌شده قابل ویرایش است.') {
    const session = voiceSessions.get(button);
    if (!session) return;
    session.active = false;
    if (session.pending) session.append(session.pending);
    session.pending = '';
    clearInterval(session.timer);
    try { session.recognition?.stop(); } catch {}
    button.classList.remove('listening');
    button.textContent = session.originalLabel;
    if (session.status) session.status.textContent = message;
    voiceSessions.delete(button);
  }

  function stopAllVoice(message) {
    [...voiceSessions.keys()].forEach(button => stopVoice(button, message));
  }

  function startVoice(button) {
    const { target, status } = voiceTarget(button);
    if (!target || button.disabled) return;

    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      if (status) status.textContent = 'ورودی صوتی در این مرورگر در دسترس نیست؛ متن را تایپ کن.';
      return;
    }

    if (voiceSessions.has(button)) {
      stopVoice(button);
      return;
    }

    const originalLabel = normalizedVoiceLabel(button);
    const base = normalize(target.value);
    const stableParts = [];
    const deadline = Date.now() + VOICE_LIMIT_SECONDS * 1000;
    const session = {
      active: true,
      recognition: null,
      timer: null,
      pending: '',
      status,
      originalLabel,
      append(text) {
        const clean = normalize(text);
        if (!clean) return;
        const existing = normalize(stableParts.join(' '));
        if (existing === clean || existing.endsWith(` ${clean}`) || existing.endsWith(clean)) return;
        stableParts.push(clean);
        target.value = [base, ...stableParts].map(normalize).filter(Boolean).join(' ');
        target.dispatchEvent(new Event('input', { bubbles: true }));
      }
    };
    voiceSessions.set(button, session);

    const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    const updateStatus = () => {
      const sec = remaining();
      button.textContent = `■ پایان · ${faNumber(sec)}ث`;
      if (status) {
        const preview = session.pending ? ` · «${session.pending.slice(-48)}»` : '';
        status.textContent = `در حال شنیدن… ${faNumber(sec)} ثانیه${preview}`;
      }
      if (sec <= 0) stopVoice(button, `${faNumber(VOICE_LIMIT_SECONDS)} ثانیه تمام شد. برای ادامه دوباره ضبط را بزن.`);
    };

    const startPiece = () => {
      if (!session.active || remaining() <= 0) return;
      const recognition = new Recognition();
      session.recognition = recognition;
      recognition.lang = 'fa-IR';
      recognition.interimResults = true;
      try { recognition.continuous = false; } catch {}

      recognition.onresult = event => {
        let interim = '';
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const text = normalize(event.results[i][0].transcript);
          if (!text) continue;
          if (event.results[i].isFinal) session.append(text);
          else interim = [interim, text].filter(Boolean).join(' ');
        }
        session.pending = normalize(interim);
        updateStatus();
      };

      recognition.onerror = event => {
        if (['not-allowed', 'service-not-allowed', 'audio-capture'].includes(event.error)) {
          stopVoice(button, `ضبط متوقف شد (${event.error}). دسترسی میکروفن را بررسی کن.`);
        }
      };

      recognition.onend = () => {
        if (!session.active) return;
        if (session.pending) session.append(session.pending);
        session.pending = '';
        session.recognition = null;
        if (remaining() > 0) setTimeout(startPiece, 120);
        else stopVoice(button, `${faNumber(VOICE_LIMIT_SECONDS)} ثانیه تمام شد. برای ادامه دوباره ضبط را بزن.`);
      };

      try { recognition.start(); }
      catch (error) { stopVoice(button, `شروع ضبط ممکن نشد: ${error.message}`); }
    };

    button.classList.add('listening');
    updateStatus();
    session.timer = setInterval(updateStatus, 250);
    startPiece();
  }

  function ensureCancelButton() {
    const actions = document.querySelector('.form-actions');
    if (!actions) return null;
    let button = document.getElementById('cancelDiscoveryBtn');
    if (!button) {
      button = document.createElement('button');
      button.id = 'cancelDiscoveryBtn';
      button.type = 'button';
      button.className = 'danger';
      button.textContent = 'لغو ساخت تصویر';
      button.hidden = true;
      actions.appendChild(button);
    }
    return button;
  }

  function setDiscoveryLocked(locked) {
    const ids = ['ideaVoiceBtn', 'idea', 'profileHint', 'workspacePath', 'webSearch', 'quickTestBtn'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.disabled = locked;
    });
    const cancel = ensureCancelButton();
    if (cancel) cancel.hidden = !locked;
  }

  async function cancelDiscovery() {
    discoveryCancelRequested = true;
    stopAllVoice('ضبط متوقف شد؛ حالا می‌توانی توضیحات را ویرایش کنی.');
    activeDiscoveryController?.abort();
    activeDiscoveryController = null;
    try {
      await nativeFetch('/api/discovery/cancel', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
        cache: 'no-store'
      });
    } catch {}
    setDiscoveryLocked(false);
    const status = document.getElementById('discovery');
    if (status) {
      status.className = 'success';
      status.textContent = 'ساخت تصویر لغو شد. توضیحات را کامل کن و دوباره «تصویر ایده» را بزن.';
    }
  }

  window.fetch = async function patchedFetch(input, init = {}) {
    const url = typeof input === 'string' ? input : input?.url || '';
    const path = new URL(url, window.location.href).pathname;
    const method = String(init.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (path !== '/api/discover' || method !== 'POST') return nativeFetch(input, init);

    discoveryCancelRequested = false;
    stopAllVoice('ضبط پایان یافت و متن ثبت شد.');
    const controller = new AbortController();
    activeDiscoveryController = controller;
    if (init.signal) init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    setDiscoveryLocked(true);

    try {
      return await nativeFetch(input, { ...init, signal: controller.signal, cache: 'no-store' });
    } catch (error) {
      if (controller.signal.aborted || discoveryCancelRequested) throw new Error('ساخت تصویر لغو شد؛ می‌توانی توضیحات را اصلاح کنی.');
      throw error;
    } finally {
      if (activeDiscoveryController === controller) activeDiscoveryController = null;
      setDiscoveryLocked(false);
    }
  };

  document.addEventListener('click', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;

    const voiceButton = target.closest('.voice-btn');
    if (voiceButton) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startVoice(voiceButton);
      return;
    }

    if (target.closest('#cancelDiscoveryBtn')) {
      event.preventDefault();
      event.stopImmediatePropagation();
      void cancelDiscovery();
      return;
    }

    if (target.closest('#analyzeBtn')) stopAllVoice('ضبط پایان یافت و متن ثبت شد.');
  }, true);

  const observer = new MutationObserver(() => {
    refreshVoiceLabels();
    ensureCancelButton();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener('DOMContentLoaded', () => {
    refreshVoiceLabels();
    ensureCancelButton();
  });
})();

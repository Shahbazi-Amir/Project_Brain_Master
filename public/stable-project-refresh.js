(() => {
  const nativeSetInterval = window.setInterval.bind(window);
  const statusLabels = {
    DRAFT:'پیش‌نویس', READY:'آماده', RUNNING:'در حال اجرا', PAUSED:'مکث', NEEDS_HUMAN:'منتظر تصمیم شما',
    COMPLETED:'تکمیل‌شده', BLOCKED:'مسدود', STOPPED:'متوقف‌شده', ERROR:'خطا'
  };
  const profileLabels = { coding:'نرم‌افزار / کدنویسی', writing:'نوشتن / محتوا', research:'پژوهش / تحلیل', planning:'برنامه‌ریزی', general:'عمومی / ترکیبی' };

  async function lightweightProjectRefresh() {
    const active = document.querySelector('.project-link.active');
    if (!active?.dataset?.id) return;
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(active.dataset.id)}`, {cache:'no-store'});
      if (!response.ok) return;
      const payload = await response.json();
      const project = payload.project;
      if (!project) return;

      const pill = document.querySelector('.project-hero .pill');
      if (pill) {
        pill.className = `pill status-${project.status}`;
        pill.textContent = statusLabels[project.status] || project.status;
      }

      const terminal = ['COMPLETED','STOPPED'].includes(project.status);
      for (const id of ['runLoop','runOnce']) {
        const button = document.getElementById(id);
        if (button) button.disabled = terminal || Boolean(payload.running);
      }

      const sideStatus = active.querySelector('small');
      if (sideStatus) sideStatus.textContent = `${statusLabels[project.status] || project.status} · ${profileLabels[project.profile] || project.profile}`;
    } catch {
      // Targeted refresh must never disturb the visible project page.
    }
  }

  window.setInterval = function(handler, delay, ...args) {
    const source = typeof handler === 'function' ? Function.prototype.toString.call(handler) : String(handler || '');
    if (Number(delay) === 3000 && source.includes('renderProject()')) {
      return nativeSetInterval(lightweightProjectRefresh, delay, ...args);
    }
    return nativeSetInterval(handler, delay, ...args);
  };
})();
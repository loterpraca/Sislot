(function () {
  function $(id) {
    return document.getElementById(id);
  }

  function parseCota(v) {
    if (!v) return 0;
    const s = String(v).replace(/[R$\s]/g, '').replace(/\./g, '').replace(',', '.');
    return parseFloat(s) || 0;
  }

  function fmtBR(v) {
    return parseFloat(v || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  function fmtBRL(v) {
    return parseFloat(v || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  function fmtData(s) {
    if (!s) return '—';
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split('-');
      return `${d}/${m}/${y}`;
    }
    return s;
  }

  function addDias(inputId, delta) {
    const el = $(inputId);
    if (!el) return;

    const v = el.value;
    let y, m, d;

    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      [y, m, d] = v.split('-').map(Number);
    } else {
      const n = new Date();
      y = n.getFullYear();
      m = n.getMonth() + 1;
      d = n.getDate();
    }

    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() + delta);

    el.value = dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');

    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setStatus(elOrId, msg, tipo = 'muted', icone = 'info-circle') {
    const el = typeof elOrId === 'string' ? $(elOrId) : elOrId;
    if (!el) return;
    el.className = 'status ' + tipo;
    el.innerHTML = `<i class="fas fa-${icone}"></i><span>${msg}</span>`;
  }

  function setBtnLoading(btnOrId, on) {
    const btn = typeof btnOrId === 'string' ? $(btnOrId) : btnOrId;
    if (!btn) return;

    if (on) {
      btn.classList.add('btn-loading');
      btn.disabled = true;
    } else {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
    }
  }

  function showModal({ title, body, onConfirm = null, onCancel = null }) {
    const overlay = $('modalOverlay');
    const box = $('modalBox');
    const titleEl = $('modalTitle');
    const bodyEl = $('modalBody');
    const cancelBtn = $('modalCancel');
    const confirmBtn = $('modalConfirm');

    if (!overlay || !box || !titleEl || !bodyEl || !cancelBtn || !confirmBtn) return;

    titleEl.textContent = title || 'Confirmação';
    bodyEl.textContent = body || '';

    const fechar = () => overlay.classList.remove('active');

    const cancelar = () => {
      fechar();
      if (typeof onCancel === 'function') onCancel();
    };

    cancelBtn.onclick = cancelar;
    overlay.onclick = cancelar;
    box.onclick = (e) => e.stopPropagation();

    if (!onConfirm) {
      cancelBtn.style.display = 'none';
      confirmBtn.innerHTML = '<i class="fas fa-check"></i> OK';
      confirmBtn.onclick = fechar;
    } else {
      cancelBtn.style.display = 'flex';
      confirmBtn.innerHTML = '<i class="fas fa-check"></i> Confirmar';
      confirmBtn.onclick = async (e) => {
        e.preventDefault();
        fechar();
        await onConfirm();
      };
    }

    overlay.classList.add('active');
  }

  window.SISLOT_UTILS = {
    $,
    parseCota,
    fmtBR,
    fmtBRL,
    fmtData,
    addDias,
    setStatus,
    setBtnLoading,
    showModal
  };
})();

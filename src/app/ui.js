// ==== app/ui.js ====
// 共有モーダル / サイドパネルのホスト。呼び出しのたびにホストの中身を完全に置き換えるため、
// モーダル本体の内部要素にリスナーをアタッチしても蓄積しない。

const UI = (() => {
  function openModal(html, opts) {
    opts = opts || {};
    const host = document.getElementById('modalHost');
    host.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    host.classList.remove('hidden');

    const modal = host.firstElementChild;
    const form = modal.querySelector('form');

    function close() { host.classList.add('hidden'); host.innerHTML = ''; }

    // 閉じる系
    host.onclick = (e) => { if (e.target === host) close(); };
    modal.querySelectorAll('[data-close]').forEach(b => b.onclick = close);

    if (form && opts.onSubmit) {
      form.onsubmit = (e) => {
        e.preventDefault();
        const result = opts.onSubmit(form, modal);
        if (result !== false) close();  // false のときだけ開いたまま(バリデーションエラー)
      };
    }
    if (opts.onOpen) opts.onOpen(modal);
    const first = modal.querySelector('input, select, textarea');
    if (first) first.focus();
    return { close, modal };
  }

  function openPanel(html, opts) {
    opts = opts || {};
    const host = document.getElementById('panelHost');
    host.innerHTML = `<div class="side-panel">${html}</div>`;
    host.classList.remove('hidden');
    const panel = host.firstElementChild;
    function close() { host.classList.add('hidden'); host.innerHTML = ''; }
    host.onclick = (e) => { if (e.target === host) close(); };
    panel.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
    if (opts.onOpen) opts.onOpen(panel);
    return { close, panel };
  }

  function confirm(message, opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const { close } = openModal(`
        <div class="modal-head"><h2>${escapeHtml(opts.title || '確認')}</h2></div>
        <div class="modal-body"><p>${escapeHtml(message)}</p></div>
        <div class="modal-foot">
          <button class="btn" data-act="cancel">キャンセル</button>
          <button class="btn ${opts.danger ? 'danger' : 'primary'}" data-act="ok">${escapeHtml(opts.okLabel || 'OK')}</button>
        </div>`, {
        onOpen(modal) {
          modal.querySelector('[data-act="ok"]').onclick = () => { close(); resolve(true); };
          modal.querySelector('[data-act="cancel"]').onclick = () => { close(); resolve(false); };
        }
      });
    });
  }

  return { openModal, openPanel, confirm };
})();

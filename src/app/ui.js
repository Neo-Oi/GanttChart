// ==== app/ui.js ====
// 共有モーダル / サイドパネルのホスト。呼び出しのたびにホストの中身を完全に置き換えるため、
// モーダル本体の内部要素にリスナーをアタッチしても蓄積しない。

const UI = (() => {
  // 暗幕(#modalBackdrop): メモより下のレイヤで画面を暗転させる。外側クリックで閉じる。
  function showBackdrop(onClick) {
    const b = document.getElementById('modalBackdrop');
    if (!b) return;
    b.classList.remove('hidden');
    b.onclick = onClick || null;
  }
  function hideBackdrop() {
    const b = document.getElementById('modalBackdrop');
    if (!b) return;
    b.classList.add('hidden');
    b.onclick = null;
  }

  // モーダルを「メモと極力両立」する位置に置く。
  // - メモが閉じている / 広幅で中央でも重ならない → 中央(既定)
  // - 中央だとメモに重なる幅 → メモ左端へ右揃え(左に収まる場合)。収まらなければ中央フォールバック。
  function positionModal(host) {
    const modal = host.firstElementChild;
    if (!modal) return;
    const reset = () => { host.style.justifyContent = ''; host.style.paddingRight = ''; };
    const memo = document.getElementById('notesFloatHost');
    if (!memo || memo.classList.contains('hidden')) { reset(); return; }
    const memoLeft = memo.getBoundingClientRect().left;
    const modalW = modal.getBoundingClientRect().width;
    const GAP = 12;
    const centeredRight = window.innerWidth / 2 + modalW / 2;
    if (centeredRight <= memoLeft - GAP) { reset(); return; }          // 重ならない → 中央
    if (memoLeft - GAP >= modalW) {                                     // 左に収まる → メモ左端へ右揃え
      host.style.justifyContent = 'flex-end';
      host.style.paddingRight = (window.innerWidth - memoLeft + GAP) + 'px';
    } else { reset(); }                                                // 収まらない → 中央(メモの上に出る)
  }

  function openModal(html, opts) {
    opts = opts || {};
    const host = document.getElementById('modalHost');
    host.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
    host.classList.remove('hidden');

    const modal = host.firstElementChild;
    const form = modal.querySelector('form');
    const reposition = () => positionModal(host);

    function close() {
      host.classList.add('hidden'); host.innerHTML = '';
      host.style.justifyContent = ''; host.style.paddingRight = '';
      window.removeEventListener('resize', reposition);
      hideBackdrop();
    }

    // 閉じる系: ホストは pointer-events:none なので、外側クリックは暗幕が受ける。
    showBackdrop(close);
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
    // 初期配置 + リサイズ追従(メモとの重なりを避け、広幅では中央)。
    reposition();
    window.addEventListener('resize', reposition);
    return { close, modal };
  }

  function openPanel(html, opts) {
    opts = opts || {};
    const host = document.getElementById('panelHost');
    host.innerHTML = `<div class="side-panel">${html}</div>`;
    host.classList.remove('hidden');
    const panel = host.firstElementChild;
    function close() { host.classList.add('hidden'); host.innerHTML = ''; hideBackdrop(); }
    showBackdrop(close);
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

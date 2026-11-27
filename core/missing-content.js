/**
 * Large third-party games (PvZ, Temple Run) are not in the public source repo, so an app built
 * from it starts without them and downloads them on the first ⇅ sync. Their wrappers check for
 * their files first and show this card instead of a blank screen.
 */

export async function contentAvailable(url) {
  try {
    const res = await fetch(`${url}${url.includes('?') ? '&' : '?'}probe=${Date.now()}`, { cache: 'no-store' });
    return res.ok;
  } catch {
    return false;
  }
}

export function showMissingContent(container, ctx, { title, size }) {
  container.innerHTML = `
    <div style="position:absolute;inset:0;display:grid;place-items:center;padding:24px;background:var(--bg-page);">
      <div style="max-width:360px;text-align:center;background:var(--bg-surface-solid);border-radius:24px;padding:26px 22px;box-shadow:var(--shadow-card);">
        <div style="font-size:44px;line-height:1">📦</div>
        <h2 style="margin:12px 0 6px;font-size:20px;">${title}还没下载到本机</h2>
        <p style="margin:0 0 18px;color:var(--text-secondary);font-size:14.5px;line-height:1.7;">
          回到大厅，点右上角 <b>⇅</b>「检查更新 → 立即同步」，下载一次（约 ${size}）以后就能离线玩了。
        </p>
        <button class="btn-primary" data-home>← 回到大厅</button>
      </div>
    </div>`;
  container.querySelector('[data-home]').addEventListener('click', () => {
    ctx.audio.playClick();
    ctx.goHome();
  });
  return { unmount() {} };
}

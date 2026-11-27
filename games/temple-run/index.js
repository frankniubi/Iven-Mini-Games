/**
 * Temple Run 2 (官方 HTML5 3D WebGL 原版) — Game Hall Plugin Wrapper
 * Embeds the self-hosted ad-free Temple Run 2 build with a sleek floating "← 大厅" return button.
 */

import { contentAvailable, showMissingContent } from '../../core/missing-content.js';

export default {
  async mount(container, ctx) {
    if (!(await contentAvailable('./games/temple-run/app/index.html'))) return showMissingContent(container, ctx, { title: '神庙逃亡 2', size: '45 MB' });
    const { audio: sharedAudio, goHome, setThemeColor } = ctx;
    setThemeColor('#0e0b08');

    container.innerHTML = `
      <div style="position:relative;width:100%;height:100%;background:#0e0b08;overflow:hidden;">
        <iframe
          id="tr2-frame"
          src="./games/temple-run/app/index.html"
          title="Temple Run 2"
          allow="autoplay; fullscreen"
          style="position:absolute;inset:0;width:100%;height:100%;border:none;display:block;background:#0e0b08;"
        ></iframe>
        <button
          id="tr2-back-btn"
          aria-label="返回游戏大厅"
          style="
            position:fixed;
            top:calc(10px + env(safe-area-inset-top, 0px));
            left:calc(10px + env(safe-area-inset-left, 0px));
            z-index:80;
            appearance:none;
            border:1px solid rgba(255,255,255,0.28);
            background:rgba(16,12,8,0.68);
            backdrop-filter:blur(10px);
            -webkit-backdrop-filter:blur(10px);
            color:#FFF6E5;
            height:36px;
            padding:0 13px;
            border-radius:999px;
            font-family:inherit;
            font-size:13px;
            font-weight:800;
            display:inline-flex;
            align-items:center;
            gap:5px;
            cursor:pointer;
            box-shadow:0 6px 18px rgba(0,0,0,0.4);
          "
        >← 大厅</button>
      </div>
    `;

    const backBtn = container.querySelector('#tr2-back-btn');
    const frame = container.querySelector('#tr2-frame');

    backBtn.addEventListener('click', () => {
      sharedAudio.playClick();
      goHome();
    });

    return {
      unmount() {
        if (frame) frame.src = 'about:blank';
      },
    };
  },
};

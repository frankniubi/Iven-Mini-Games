/**
 * 植物大战僵尸 · 完整版 (186关全模式：冒险/迷你/解谜/生存/图鉴/调速)
 * Embeds the complete JSPVZ 900x600 HTML5 app inside an auto-scaled iframe so
 * CSS transform automatically maps iPhone & iPad touch coordinates to native 900x600 pixels!
 */

import { contentAvailable, showMissingContent } from '../../core/missing-content.js';

const NATIVE_W = 900;
const NATIVE_H = 600;

export default {
  async mount(container, ctx) {
    if (!(await contentAvailable('./games/pvz/app/index.html'))) return showMissingContent(container, ctx, { title: '植物大战僵尸', size: '150 MB' });
    const { audio: sharedAudio, goHome, setThemeColor } = ctx;
    setThemeColor('#11160d');

    container.innerHTML = `
      <div style="
        position:relative;
        width:100%;
        height:100%;
        background:#11160d;
        display:flex;
        flex-direction:column;
        align-items:center;
        justify-content:center;
        overflow:hidden;
        padding:env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px);
      ">
        <div id="pvz-fit-box" style="position:relative;flex:1;width:100%;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden;">
          <iframe
            id="pvz-full-frame"
            src="./games/pvz/app/index.html?v=6"
            title="植物大战僵尸完整版"
            allow="autoplay; fullscreen"
            style="
              width:${NATIVE_W}px;
              height:${NATIVE_H}px;
              border:none;
              display:block;
              background:#000;
              border-radius:14px;
              box-shadow:0 18px 50px rgba(0,0,0,0.65);
              transform-origin:center center;
              flex-shrink:0;
            "
          ></iframe>
        </div>

        <button
          id="pvz-back-btn"
          aria-label="返回游戏大厅"
          style="
            position:fixed;
            top:calc(10px + env(safe-area-inset-top, 0px));
            left:calc(10px + env(safe-area-inset-left, 0px));
            z-index:80;
            appearance:none;
            border:1px solid rgba(255,255,255,0.28);
            background:rgba(16,24,12,0.74);
            backdrop-filter:blur(10px);
            -webkit-backdrop-filter:blur(10px);
            color:#F5FCEB;
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
            box-shadow:0 6px 18px rgba(0,0,0,0.42);
          "
        >← 大厅</button>
      </div>
    `;

    const fitBox = container.querySelector('#pvz-fit-box');
    const frame = container.querySelector('#pvz-full-frame');
    const backBtn = container.querySelector('#pvz-back-btn');

    function resize() {
      const rect = fitBox.getBoundingClientRect();
      if (rect.width < 10 || rect.height < 10) return;
      const scale = Math.min(rect.width / NATIVE_W, rect.height / NATIVE_H);
      frame.style.transform = `scale(${scale})`;
    }

    backBtn.addEventListener('click', () => {
      sharedAudio.playClick();
      goHome();
    });

    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', resize);
    requestAnimationFrame(resize);

    return {
      unmount() {
        window.removeEventListener('resize', resize);
        window.removeEventListener('orientationchange', resize);
        if (frame) frame.src = 'about:blank';
      },
    };
  },
};

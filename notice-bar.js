/**
 * notice-bar.js
 *
 * 功能：
 * 1. 在页面顶部显示轮播提示条，用于展示网站公告或注意事项
 * 2. 可选启用播放记录恢复功能：当用户再次打开相同视频时，会弹窗询问是否从上次进度继续播放
 * 3. 统一顶部提示条和恢复提示浮窗的高度、样式、按钮风格
 */

(function () {
  // =========== 配置项 ===========
  const enablePlaybackResume = true;       // 是否启用“播放记录恢复”功能
  const noticeList = [                     // 顶部提示条要轮播展示的文案列表
    "📢 如果播放卡顿，请切换线路或刷新页面重试",
    "📌 支持跳过片头片尾，长按左右半屏可快进快退",
    "🌟 视频广告与本站无关，请注意甄别勿上当受骗"
  ];
  const switchInterval = 8000;             // 轮播切换间隔（毫秒）
  const autoHideDelay   = 25000;           // 提示条自动隐藏时间（毫秒），0 表示不自动隐藏
  const fixedHeight     = 35;              // 顶部提示条和恢复提示浮窗统一高度（像素）

  // =========== 动态注入全局样式 ===========
  const style = document.createElement('style');
  style.textContent = `
    /* 整个提示条的外层容器 */
    #notice-bar {
      width: 100%;
      position: fixed;
      top: 10px;
      left: 0;
      text-align: center;
      z-index: 9999;
      background: transparent;
      font-size: 14px;
      pointer-events: none;               /* 只让内部按钮可点 */
    }

    /* 顶部提示条 和 播放恢复提示 统一样式 */
    #notice-bar .notice-container,
    .dplayer-resume-tip {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      background: rgba(236, 236, 236, 0.95);
      color: #666;
      height: ${fixedHeight}px;
      line-height: ${fixedHeight}px;
      padding: 0 16px;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.08);
      font-size: 14px;
      white-space: nowrap;
      max-width: 90%;
      pointer-events: auto;               /* 内部可交互 */
    }

    /* 顶部提示条中的关闭按钮 */
    #notice-bar .close-btn {
      cursor: pointer;
      font-size: 14px;
      color: #999;
      line-height: 1;
    }

    /* 播放恢复提示浮窗的位置 */
    .dplayer-resume-tip {
      position: absolute;
      left: 12px;
      bottom: 60px;   /* 进度条上方 */
      z-index: 9998;
    }

    /* 恢复提示中加粗显示的时间 */
    .dplayer-resume-tip b {
      font-weight: bold;
      color: #333;
    }

    /* 恢复提示：按钮区域横向排列 */
    .dplayer-resume-tip .btns {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin-left: 8px;
    }

    .dplayer-resume-tip #resume-timer {
      margin-left: 6px;
      color: #999;
      font-variant-numeric: tabular-nums;
    }

    /* 所有按钮统一风格（顶部提示条、恢复提示浮窗共用） */
    .dplayer-resume-tip button,
    #notice-bar .notice-container button {
      background: #e0e0e0;
      border: none;
      padding: 0 10px;
      height: 24px;
      line-height: 24px;
      font-size: 13px;
      border-radius: 4px;
      cursor: pointer;
      color: #333;
    }
    .dplayer-resume-tip button:hover,
    #notice-bar .notice-container button:hover {
      background: #d0d0d0;
    }

    /* 移动端适配：略微缩小字体和尺寸 */
    @media (max-width: 600px) {
      #notice-bar,
      .dplayer-resume-tip {
        font-size: 13px;
      }
      #notice-bar .notice-container,
      .dplayer-resume-tip {
        padding: 0 12px;
        height: ${fixedHeight - 4}px;
        line-height: ${fixedHeight - 4}px;
      }
      .dplayer-resume-tip .btns {
        gap: 6px;
        margin-left: 6px;
      }
      .dplayer-resume-tip button,
      #notice-bar .notice-container button {
        font-size: 12px;
        padding: 0 8px;
        height: 20px;
        line-height: 20px;
      }
    }
  `;
  document.head.appendChild(style);

  // =========== 创建并插入 顶部提示条 ===========
  const bar = document.createElement('div');
  bar.id = 'notice-bar';
  bar.innerHTML = `
    <div class="notice-container">
      <span class="notice-text" id="notice-text">${noticeList[0]}</span>
      <span class="close-btn" title="关闭">✖</span>
    </div>
  `;
  document.body.appendChild(bar);

  // =========== 轮播逻辑 =========== 
  let currentIndex = 0;
  const textEl = document.getElementById('notice-text');
  const switchTimer = setInterval(() => {
    currentIndex = (currentIndex + 1) % noticeList.length;
    textEl.textContent = noticeList[currentIndex];
  }, switchInterval);

  // =========== 关闭按钮事件 ===========
  bar.querySelector('.close-btn').addEventListener('click', () => {
    bar.style.display = 'none';
    clearInterval(switchTimer);
  });

  // =========== 自动隐藏 ===========
  if (autoHideDelay > 0) {
    setTimeout(() => {
      bar.style.display = 'none';
      clearInterval(switchTimer);
    }, autoHideDelay);
  }

  // =========== 播放记录恢复功能（可选） ===========
  if (enablePlaybackResume && window.dp && dp.video) {
    dp.video.addEventListener('loadedmetadata', () => {
      const key      = 'dplayer_progress_' + dp.options.video.url;       // 存储 Key
      const lastTime = parseFloat(localStorage.getItem(key) || '0');     // 上次进度（秒）

      // 等到 duration 可用再判断是否弹窗
      (function checkDuration() {
        const dur = dp.video.duration;
        if (!dur || isNaN(dur)) {
          setTimeout(checkDuration, 100);
        } else if (lastTime > 30 && lastTime < dur - 15) {
          showResumePrompt(lastTime);
        }
      })();

      // 每隔 5 秒保存一次当前播放进度
      setInterval(() => {
        if (!isNaN(dp.video.currentTime)) {
          localStorage.setItem(key, dp.video.currentTime.toFixed(1));
        }
      }, 5000);
    });

    /**
     * 弹出“是否继续播放”提示浮窗
     * @param {number} time — 上次播放的时间（秒）
     * 规则：若用户没有选择，倒计时结束仅关闭，不做 seek/play。
     */
    function showResumePrompt(time) {
      // 防重复
      if (dp.container.querySelector('.dplayer-resume-tip')) return;

      const prompt = document.createElement('div');
      prompt.className = 'dplayer-resume-tip';
      prompt.setAttribute('role', 'dialog');
      prompt.innerHTML = `
        <span>上次播放至 <b>${formatTime(time)}</b>，是否继续？</span>
        <div class="btns">
          <button id="resume-yes">继续</button>
          <button id="resume-no">重头</button>
          <button id="resume-close">关闭</button>
        </div>
        <span id="resume-timer">10s</span>
      `;
      dp.container.appendChild(prompt);

      let destroyed = false;
      let countdown = 10;
      const timerEl = prompt.querySelector('#resume-timer');

      const timer = setInterval(() => {
        if (destroyed) return;
        countdown--;
        if (countdown <= 0) {
          dismiss();                 // 只关闭，不做任何播放动作
        } else {
          timerEl.textContent = `${countdown}s`;
        }
      }, 1000);

      function dismiss() {
        if (destroyed) return;
        destroyed = true;
        clearInterval(timer);
        prompt.remove();
      }

      prompt.querySelector('#resume-close').addEventListener('click', dismiss);

      prompt.querySelector('#resume-yes').addEventListener('click', () => {
        dismiss();
        try { dp.seek(time); } catch(e) {}
        dp.play();
      });

      prompt.querySelector('#resume-no').addEventListener('click', () => {
        dismiss();
        try { dp.seek(0); } catch(e) {}
        dp.play();
      });
    }

    /**
     * 把秒数格式化为 “hh:mm:ss” 或 “mm:ss”
     * @param {number} sec — 秒数
     * @returns {string}
     */
    function formatTime(sec) {
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = Math.floor(sec % 60);
      return (h > 0 ? `${h}:` : '') +
             `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }
  }
})();

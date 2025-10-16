/* /static/player/dplayer/skipplus.js  v2025-08-13-drag-summary
 * 自动全屏 + 按 vod_id+sid 跳过 + 设置面板 + 本地优先 + HMAC(可选)
 * HUD：仅拖动/长按时显示，含“当前/片头/片尾”刻度；长按期间在 HUD 下方提示“长按快进中/快退中 ×N”
 * 清理“松手以跳转”类提示；长按左右半屏：逐步提速（松手后只提示一次）
 * 新增：桌面端拖动松手真正 seek；拖动松手后显示**自定义汇总提示**（已快进/已快退 Xs），并彻底静音系统提示
 * ES5 兼容 / XHR 实现
 * 可选：window.SKIPPLUS_API_BASE = 'https://feikuai.tv'
 */
(function(){
  'use strict';

  if (window.__SkipPlusLoaded) { try{console.warn('[SkipPlus] already loaded');}catch(e){} return; }
  window.__SkipPlusLoaded = true;

  function log(){ try{ console.log.apply(console, ['[SkipPlus]'].concat([].slice.call(arguments))); }catch(e){} }

  var API_BASE = (typeof window.SKIPPLUS_API_BASE === 'string') ? window.SKIPPLUS_API_BASE.replace(/\/+$/,'') : '';
  function api(p){ return (API_BASE ? API_BASE : '') + p; }
  var ENDPOINT = { mark: api('/api/skipmark.php'), meta: api('/api/skipmeta.php'), sign: api('/api/skiptoken.php') };

  function makeStore(){
    try{ var k='__t__'+Math.random(); window.localStorage.setItem(k,'1'); window.localStorage.removeItem(k); return window.localStorage; }
    catch(e){ var mem={}; return { getItem:function(k){return mem.hasOwnProperty(k)?mem[k]:null;}, setItem:function(k,v){mem[k]=String(v);}, removeItem:function(k){delete mem[k];} }; }
  }
  var STORE = makeStore();

  var LS = { autofs:'dp_auto_fullscreen', skipIntro:'dp_skip_intro_auto', skipOutro:'dp_skip_outro_auto' };
  function fmtTime(sec){ sec=Math.max(0,Math.floor(sec||0)); var m=Math.floor(sec/60), s=sec%60; return m+':' + (s<10?'0'+s:s); }
  function cookieDomain(){ var h=location.hostname, p=h.split('.'); return p.length>=2?'.'+p.slice(-2).join('.'):h; }
  function reEscape(s){ return String(s).replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'); }
  function getCookie(n){ var re = new RegExp('(?:^|;\\s*)' + reEscape(n) + '=([^;]+)'); var m = document.cookie.match(re); return m ? m[1] : ''; }
  function getUid(){
    var uid = STORE.getItem('dp_uid') || getCookie('dp_uid');
    if(!uid){
      var rnd; try{ if(self.crypto && typeof self.crypto.randomUUID==='function') rnd=self.crypto.randomUUID(); }catch(e){}
      uid = rnd || (Date.now().toString(36)+Math.random().toString(36).slice(2));
      try{ STORE.setItem('dp_uid',uid); }catch(e){}
      try{ document.cookie='dp_uid='+uid+'; Path=/; Domain='+cookieDomain()+'; Max-Age='+(60*60*24*3650)+'; Secure; SameSite=Lax'; }catch(e){}
    }
    return uid;
  }
  function getQ(k){ var q=location.search.replace(/^\?/,'').split('&'); for(var i=0;i<q.length;i++){ var kv=q[i].split('='); if(decodeURIComponent(kv[0]||'')===k) return decodeURIComponent(kv[1]||''); } return null; }
  function getVodSidEp(){
    var vod=null, sid=null, ep=null;
    try{
      if (parent && parent.MacPlayer && parent.MacPlayer.VodId) vod=String(parent.MacPlayer.VodId);
      if (parent && parent.MacPlayer && parent.MacPlayer.Sid!=null) sid=parseInt(parent.MacPlayer.Sid,10);
      else if (parent && parent.MacPlayer && parent.MacPlayer.sid!=null) sid=parseInt(parent.MacPlayer.sid,10);
      else if (parent && parent.MacPlayer && parent.MacPlayer.From!=null) sid=parseInt(parent.MacPlayer.From,10);
      var cs=[parent&&parent.MacPlayer?parent.MacPlayer.Nid:null,
              parent&&parent.MacPlayer?parent.MacPlayer.Episode:null,
              parent&&parent.MacPlayer?parent.MacPlayer.Part:null,
              parent&&parent.MacPlayer?parent.MacPlayer.No:null];
      for(var i=0;i<cs.length;i++){ if(ep==null && cs[i]!=null){ ep=parseInt(cs[i],10); break; } }
    }catch(e){}
    try{
      var m=top.location.pathname.match(/\/vodplay\/(\d+)-(\d+)-(\d+)/);
      if(m){ if(!vod) vod=m[1]; if(!sid && m[2]) sid=parseInt(m[2],10); if(!ep && m[3]) ep=parseInt(m[3],10); }
    }catch(e){}
    if(!sid){ var s=getQ('sid')||getQ('from'); if(s) sid=parseInt(s,10); }
    if(!ep){ var n=getQ('nid')||getQ('ep')||getQ('n'); if(n) ep=parseInt(n,10); }
    sid = (sid!==null && !isNaN(sid)) ? sid : null;
    return { vod_id: vod||'', sid: sid, ep: ep||null };
  }
  function epIdentifier(ep,url){
    if(typeof ep==='number' && isFinite(ep) && ep>0) return 'ep'+ep;
    try{ var u=(url||'').split('?')[0]; return 'u_'+btoa(unescape(encodeURIComponent(u))).replace(/=+/g,'').slice(-10); }
    catch(e){ return 'u_'+((url||'').split('?')[0]||'').slice(-20); }
  }
  function canSeek(dp){ var v=dp.video,d=v&&v.duration; return isFinite(d)&&!isNaN(d)&&d>0&&d!==Infinity; }
  function waitFor(cond, ok, timeout){
    var start=Date.now(), to=timeout||15000;
    (function loop(){
      try{ if(cond()) return ok(true); }catch(e){}
      if(Date.now()-start>=to) return ok(false);
      setTimeout(loop, 80);
    })();
  }
  function httpGet(u, cb){
    try{
      var x=new XMLHttpRequest();
      x.open('GET', u, true);
      x.onreadystatechange=function(){ if(x.readyState===4){ var j=null; try{ j=JSON.parse(x.responseText); }catch(e){} cb(x.status, j, x.responseText); } };
      x.send(null);
    }catch(e){ cb(0,null,''); }
  }
  function httpPostJson(u, bodyObj, headers, cb){
    try{
      var x=new XMLHttpRequest();
      x.open('POST', u, true);
      x.setRequestHeader('Content-Type','application/json');
      if(headers){ for(var k in headers){ if(headers.hasOwnProperty(k) && headers[k]) x.setRequestHeader(k, headers[k]); } }
      x.onreadystatechange=function(){ if(x.readyState===4){ var j=null; try{ j=JSON.parse(x.responseText); }catch(e){} cb(x.status, j, x.responseText); } };
      try{ x.send(JSON.stringify(bodyObj)); }catch(e){ x.send('{}'); }
    }catch(e){ cb(0,null,''); }
  }

  waitFor(function(){ return window.dp && dp.video && dp.options && dp.options.video && dp.options.video.url; }, function(ok){
    if(!ok){ log('dp 未就绪'); return; }
    var dp = window.dp;

    var parsed=getVodSidEp(), VOD_ID=parsed.vod_id, SID=parsed.sid, EP=parsed.ep;
    var UID=getUid(), VIDEO_URL=dp.options.video.url, EPID=epIdentifier(EP, VIDEO_URL);
    var RESUME_KEY='dp_resume_'+VOD_ID+'_'+SID+'_'+EPID+'_'+UID;
    var DONE_KEY  ='dp_done_'  +VOD_ID+'_'+SID+'_'+EPID+'_'+UID;

    var autoFS = STORE.getItem(LS.autofs)==='1';
    var autoIn = STORE.getItem(LS.skipIntro)==='1';
    var autoOu = STORE.getItem(LS.skipOutro)==='1';

    /* ===== dp.notice 管控：拖动/长按/冷静期 静音；spNotice 旁路 ===== */
    var dpNoticeOrig = dp.notice;
    var noticeBypass = false;
    var noticeCooldownUntil = 0;
    function shouldMuteNotice(){
      try{
        var c = dp.container;
        if(!c) return false;
        if (c.getAttribute('data-sp-dragging') === '1') return true;
        if (c.getAttribute('data-sp-pressing') === '1') return true;
      }catch(_){}
      if (Date.now() < noticeCooldownUntil) return true;
      return false;
    }
    dp.notice = function(msg,time,opacity,type){
      if (noticeBypass) { noticeBypass=false; return dpNoticeOrig.call(dp,msg,time,opacity,type); }
      if (shouldMuteNotice()) return;
      return dpNoticeOrig.call(dp,msg,time,opacity,type);
    };
    function spNotice(msg,time,opacity,type){
      noticeBypass = true;
      try{ return dpNoticeOrig.call(dp,msg,time,opacity,type); }
      finally{ noticeBypass = false; }
    }

    /* ===== 样式（含 HUD & 拖动/长按时屏蔽旧 notice） ===== */
    if(!document.getElementById('dp-skipplus-style')){
      var st=document.createElement('style'); st.id='dp-skipplus-style';
      st.textContent =
        '.dplayer-setting-box,.dplayer-setting-origin-panel{min-width:200px;max-width:92vw;max-height:calc(100dvh - 96px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;-webkit-overflow-scrolling:touch;}'+
        '.dplayer-setting-item{padding:10px 12px;}.dplayer-setting-item.dp-ext-item{display:flex;align-items:center;justify-content:space-between;}'+
        '.dp-switch{display:inline-flex;align-items:center;gap:10px;cursor:pointer;font-size:12px;}.dp-switch .txt{font-weight:600;font-size:13px;letter-spacing:.3px;color:rgba(255,255,255,.92);min-width:2em;text-align:right;}'+
        '.dp-switch[data-on="0"] .txt{color:rgba(255,255,255,.65);} .dp-switch .dot{width:28px;height:16px;border-radius:999px;background:#999;position:relative;transition:.2s;}'+
        '.dp-switch .dot:after{content:"";width:12px;height:12px;border-radius:50%;background:#fff;position:absolute;top:2px;left:2px;transition:.2s;box-shadow:0 1px 0 rgba(0,0,0,.2);}'+
        '.dp-switch[data-on="1"] .dot{background:#18a058;}.dp-switch[data-on="1"] .dot:after{left:14px;}'+
        '.dp-setting-btn{display:flex;flex-direction:column;gap:8px;padding:8px 0 6px;}.dp-setting-btn .btn{display:block;width:calc(100% - 8px);margin:0 4px;box-sizing:border-box;padding:8px 10px;border-radius:10px;font-size:12px;line-height:1.25;color:#fff;background:rgba(255,255,255,0.14);border:1px solid rgba(255,255,255,0.22);box-shadow:inset 0 1px 0 rgba(255,255,255,0.06),0 1px 2px rgba(0,0,0,0.25);cursor:pointer;user-select:none;text-align:center;transition:background .15s ease,transform .05s ease,border-color .15s ease;white-space:normal;word-break:break-word;}'+
        '.dp-setting-btn .btn.danger{background:rgba(255,80,80,0.16);border-color:rgba(255,80,80,0.35);} .dp-setting-btn .btn.danger:hover{background:rgba(255,80,80,0.22);}'+
        '#sp-hud-ctl.sp-hud{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);min-width:220px;max-width:86vw;background:rgba(0,0,0,.55);color:#fff;border-radius:10px;padding:8px 10px;z-index:10000;text-align:center;pointer-events:none;display:none;}'+
        '.sp-hud-time{font-size:13px;margin-bottom:6px;}'+
        '.sp-hud-track{position:relative;height:6px;background:rgba(255,255,255,.25);border-radius:3px;overflow:visible;}'+
        '.sp-hud-fill{position:absolute;left:0;top:0;height:100%;background:#fff;opacity:.95;border-radius:3px 0 0 3px;}'+
        '.sp-hud-marker{position:absolute;top:-8px;height:22px;width:0;}'+
        '.sp-hud-marker:before{content:"";position:absolute;left:0;top:8px;width:2px;height:12px;background:#ffffff;border-radius:1px;}'+
        '.sp-hud-marker span{position:absolute;left:50%;bottom:100%;transform:translate(-50%,-2px);font-size:11px;line-height:1;background:rgba(0,0,0,.65);padding:1px 4px;border-radius:6px;white-space:nowrap;}'+
        '.sp-hud-marker.cur:before{background:#ffffff;}'+
        '.sp-hud-marker.intro:before{background:#22c55e;}.sp-hud-marker.intro span{background:rgba(34,197,94,.85);}'+
        '.sp-hud-marker.outro:before{background:#ef4444;}.sp-hud-marker.outro span{background:rgba(239,68,68,.85);}'+
        '.sp-hud-hint{margin-top:6px;font-size:12px;opacity:.95;display:none;}'+
        '.dplayer[data-sp-dragging="1"] .dplayer-notice{display:none!important;}'+
        '.dplayer[data-sp-pressing="1"] .dplayer-notice{display:none!important;}'+
        '.sp-killed{display:none!important;}';
      document.head.appendChild(st);
    }

    /* ===== 设置面板 ===== */
    var firedFS=false;
    function elClosestItem(el){ while(el&&el.nodeType===1){ if(el.classList && el.classList.contains('dplayer-setting-item')) return el; el=el.parentNode; } return null; }
    function removeLoop(panel){
      if(!panel) return;
      var by=panel.querySelector('.dplayer-setting-loop'); if(by){ if(by.remove) by.remove(); else if(by.parentNode) by.parentNode.removeChild(by); return; }
      var items=panel.querySelectorAll('.dplayer-setting-item, .dplayer-setting-item span');
      for(var i=0;i<items.length;i++){ var el=items[i]; if(el.textContent && /循环/.test(el.textContent)){ var row=elClosestItem(el); if(row){ if(row.remove) row.remove(); else if(row.parentNode) row.parentNode.removeChild(row); } break; } }
    }
    function mkSwitch(label,on,onToggle){
      var w=document.createElement('div'); w.className='dplayer-setting-item dp-ext-item';
      w.innerHTML='<span class="dplayer-label">'+label+'</span>' +
                  '<div class="dp-switch" data-on="'+(on?'1':'0')+'">' +
                  '<span class="txt">'+(on?'开':'关')+'</span><div class="dot"></div></div>';
      w.addEventListener('click',function(ev){
        ev.stopPropagation();
        var sw=w.querySelector('.dp-switch');
        var cur=sw.getAttribute('data-on')==='1', nxt=!cur;
        sw.setAttribute('data-on',nxt?'1':'0'); w.querySelector('.txt').textContent=nxt?'开':'关';
        try{ onToggle(nxt); }catch(e){}
      });
      return w;
    }
    function injectSettings(){
      var panel = dp.container.querySelector('.dplayer-setting-origin-panel') || dp.container.querySelector('.dplayer-setting-box');
      if(!panel || panel.getAttribute('data-skipplus-injected')==='1') return;
      panel.setAttribute('data-skipplus-injected','1');
      removeLoop(panel);
      var autoFS = STORE.getItem(LS.autofs)==='1';
      var autoIn = STORE.getItem(LS.skipIntro)==='1';
      var autoOu = STORE.getItem(LS.skipOutro)==='1';
      panel.appendChild(mkSwitch('自动全屏',autoFS,function(v){ try{STORE.setItem(LS.autofs,v?'1':'0');}catch(e){} spNotice('自动全屏：'+(v?'已开启':'已关闭'),1200); firedFS=false; }));
      panel.appendChild(mkSwitch('自动跳过片头',autoIn,function(v){ try{STORE.setItem(LS.skipIntro,v?'1':'0');}catch(e){} spNotice('跳过片头：'+(v?'已开启':'已关闭'),1200); }));
      panel.appendChild(mkSwitch('自动跳过片尾',autoOu,function(v){ try{STORE.setItem(LS.skipOutro,v?'1':'0');}catch(e){} spNotice('跳过片尾：'+(v?'已开启':'已关闭'),1200); }));
      var btn=document.createElement('div'); btn.className='dp-setting-btn';
      btn.innerHTML='<div class="btn" data-act="mark-intro">当前时间设为片头结束</div>' +
                    '<div class="btn" data-act="mark-outro">当前时间设为片尾开始</div>' +
                    '<div class="btn danger" data-act="clear-skip">清除当前视频跳过设置</div>';
      panel.appendChild(btn);
      btn.addEventListener('click',function(e){
        e.stopPropagation();
        var t=e.target||e.srcElement, act=t && t.getAttribute('data-act') || '';
        if(!act) return;
        if(!canSeek(dp)){ spNotice('当前资源不可寻址，无法标记',1500); return; }
        if(act==='clear-skip'){
          try{ STORE.removeItem('dp_user_intro_'+VOD_ID+'_'+SID+'_'+UID); }catch(e){}
          try{ STORE.removeItem('dp_user_outro_'+VOD_ID+'_'+SID+'_'+UID); }catch(e){}
          introEnd=null; outroStart=null; updateHUDInstant();
          getAuthHeaders(function(h){
            var payload={vod_id:VOD_ID,uid:UID,action:'clear'}; if(SID!==null) payload.sid=SID;
            httpPostJson(ENDPOINT.mark, payload, h, function(){ fetchMeta(); spNotice('已清除本集跳过设置（当前用户）',1600); });
          });
          return;
        }
        var sec=Math.floor(dp.video.currentTime||0);
        if(act==='mark-intro'){ try{ STORE.setItem('dp_user_intro_'+VOD_ID+'_'+SID+'_'+UID, String(sec)); }catch(e){} introEnd=sec; spNotice('已设片头结束：'+sec+'s（已本地生效）',1200); }
        else { try{ STORE.setItem('dp_user_outro_'+VOD_ID+'_'+SID+'_'+UID, String(sec)); }catch(e){} outroStart=sec; spNotice('已设片尾开始：'+sec+'s（已本地生效）',1200); }
        updateHUDInstant();
        var body={vod_id:VOD_ID,uid:UID}; if(SID!==null) body.sid=SID;
        if(act==='mark-intro') body.intro_end=sec; else body.outro_start=sec;
        getAuthHeaders(function(h){
          httpPostJson(ENDPOINT.mark, body, h, function(status, j){
            if(!(j && j.code===0)){ log('server save failed or locked by HMAC, keep local only', status, j); }
          });
        });
      });
      log('settings injected');
    }
    (function ensureInject(){
      var tries=0, tm=setInterval(function(){ tries++; injectSettings(); if(tries>80) clearInterval(tm); }, 150);
      dp.container.addEventListener('click', function(e){
        var p=e.target;
        while(p && p!==dp.container){
          if(p.classList && (p.classList.contains('dplayer-setting') || p.classList.contains('dplayer-setting-icon'))){ setTimeout(injectSettings,0); break; }
          p=p.parentNode;
        }
      }, true);
      if (window.MutationObserver){
        try{ new MutationObserver(function(){ injectSettings(); }).observe(dp.container, {childList:true,subtree:true}); }catch(e){}
      }
    })();

    function getAuthHeaders(cb){
      var u = ENDPOINT.sign + '?vod_id='+encodeURIComponent(VOD_ID)+'&uid='+encodeURIComponent(UID);
      if(SID!==null) u += '&sid='+encodeURIComponent(SID);
      httpGet(u, function(status, j){
        if(j && j.code===0 && j.ts && j.token){ var h={}; h['X-SKIP-TS']=String(j.ts); h['X-SKIP-TOKEN']=j.token; cb(h); }
        else cb({});
      });
    }

    var introEnd=null, outroStart=null;
    function fetchMeta(){
      var u = ENDPOINT.meta + '?vod_id='+encodeURIComponent(VOD_ID) + '&uid='+encodeURIComponent(UID) + '&strict=1';
      if(SID!==null) u += '&sid='+encodeURIComponent(SID);
      httpGet(u, function(status, d){
        if(d){ introEnd=(typeof d.intro_end==='number')?d.intro_end:null; outroStart=(typeof d.outro_start==='number')?d.outro_start:null; }
        else {
          var li=parseInt(STORE.getItem('dp_user_intro_'+VOD_ID+'_'+SID+'_'+UID)||'',10);
          var lo=parseInt(STORE.getItem('dp_user_outro_'+VOD_ID+'_'+SID+'_'+UID)||'',10);
          introEnd = isFinite(li)? li : null;  outroStart = isFinite(lo)? lo : null;
        }
        updateHUDInstant();
      });
    }

    /* ===== 清理“松手以跳转”类提示（仅针对拖动提示） ===== */
    var KILL_TEXT_RE = /松手以跳转|释放.*跳转|release\s*to\s*seek/i;
    var KILL_SEL = [
      '.seek-tip','.sp-tip','[data-sp="seek-tip"]',
      '.seekHud','.seek-hud','.hud-seek','.hud-tip',
      '.drag-tip','.drag-hint','.bar-tip'
    ];
    function shouldKillEl(el){
      if (!el || el.nodeType !== 1) return false;
      var txt = (el.textContent || '');
      if (KILL_TEXT_RE.test(txt)) return true;
      try { for (var i=0;i<KILL_SEL.length;i++){ if(el.matches && el.matches(KILL_SEL[i])) return true; } } catch(_){}
      return false;
    }
    var killPending = false;
    function killForeignSeekTips(){
      if (killPending) return;
      killPending = true;
      setTimeout(function(){
        killPending = false;
        try {
          var nodes = dp.container.querySelectorAll('*');
          for (var i=0;i<nodes.length;i++){
            var el = nodes[i];
            if (!el || el.nodeType !== 1) continue;
            if (shouldKillEl(el)) { el.className += ' sp-killed'; el.style.display='none'; }
          }
        } catch(e){}
      }, 0);
    }
    killForeignSeekTips();
    if (window.MutationObserver){
      try{
        new MutationObserver(function(muts){
          for (var i=0;i<muts.length;i++){
            var nlist = muts[i].addedNodes || [];
            for (var j=0;j<nlist.length;j++){
              var el = nlist[j];
              if (el && el.nodeType === 1 && shouldKillEl(el)) {
                el.className += ' sp-killed';
                el.style.display = 'none';
              }
            }
          }
        }).observe(dp.container, {childList:true,subtree:true});
      }catch(e){}
    }

    /* ===== HUD（进度条拖动 & 半屏长按 共用） ===== */
    var HUD_ID='sp-hud-ctl';
    var hud=null, hudTime=null, hudFill=null, mkCur=null, mkIntro=null, mkOutro=null, hudHint=null;
    var dragActive=false, hideTimer=null, barEl=null, barRect=null, rafId=0, lastX=null, pointerId=null;
    var dragStartAt=0;      // ← 记录拖动开始时的时间
    var dragSummaryMsg=null;// ← 松手后要显示的一次性汇总提示

    function ensureHUD(){
      if(!hud){
        var olds = dp.container.querySelectorAll('.sp-hud, #'+HUD_ID);
        for(var j=0;j<olds.length;j++){ if(olds[j].parentNode) olds[j].parentNode.removeChild(olds[j]); }
        hud=document.createElement('div'); hud.className='sp-hud'; hud.id=HUD_ID;
        hud.innerHTML =
          '<div class="sp-hud-time"></div>' +
          '<div class="sp-hud-track">' +
            '<div class="sp-hud-fill" style="width:0%"></div>' +
            '<div class="sp-hud-marker cur"><span>当前</span></div>' +
            '<div class="sp-hud-marker intro" style="display:none"><span>片头</span></div>' +
            '<div class="sp-hud-marker outro" style="display:none"><span>片尾</span></div>' +
          '</div>' +
          '<div class="sp-hud-hint" style="display:none"></div>';
        dp.container.appendChild(hud);
        hudTime = hud.querySelector('.sp-hud-time');
        hudFill = hud.querySelector('.sp-hud-fill');
        mkCur   = hud.querySelector('.sp-hud-marker.cur');
        mkIntro = hud.querySelector('.sp-hud-marker.intro');
        mkOutro = hud.querySelector('.sp-hud-marker.outro');
        hudHint = hud.querySelector('.sp-hud-hint');
      }
    }
    function showHUD(){ ensureHUD(); hud.style.display='block'; if(hideTimer){ clearTimeout(hideTimer); hideTimer=null; } }
    function hideHUDNow(){ if(hideTimer){ clearTimeout(hideTimer); hideTimer=null; } if(hud) hud.style.display='none'; if(hudHint) hudHint.style.display='none'; }
    function hideHUDSoon(ms){ if(hideTimer) clearTimeout(hideTimer); hideTimer = setTimeout(function(){ if(!dragActive && !lpActive){ hideHUDNow(); } }, ms||360); }
    function setHUDAt(t, d){
      ensureHUD();
      if(!isFinite(d)||d<=0){
        hudTime.innerHTML='--:-- / --:--'; hudFill.style.width='0%'; mkCur.style.left='0%';
        mkIntro.style.display='none'; mkOutro.style.display='none'; return;
      }
      if(t<0) t=0; if(t>d) t=d;
      hudTime.innerHTML = fmtTime(t)+' / '+fmtTime(d);
      var pct = (t/d)*100; if(pct<0)pct=0; if(pct>100)pct=100;
      hudFill.style.width = pct + '%';
      mkCur.style.left = pct + '%';
      if(typeof introEnd==='number' && introEnd>=0 && introEnd<d){ mkIntro.style.display='block'; mkIntro.style.left=(introEnd/d*100)+'%'; } else mkIntro.style.display='none';
      if(typeof outroStart==='number' && outroStart>=0 && outroStart<=d){ mkOutro.style.display='block'; mkOutro.style.left=(outroStart/d*100)+'%'; } else mkOutro.style.display='none';
    }
    function setLongPressHint(dir, factor){
      if(!hudHint) return;
      if(lpActive){
        hudHint.style.display='block';
        hudHint.textContent = (dir>0?'长按快进中':'长按快退中') + (factor>1?(' ×'+factor):'');
      }else{
        hudHint.style.display='none';
      }
    }
    function updateHUDInstant(){ if(!hud || hud.style.display!=='block') return; var d=dp.video.duration||0, t=dp.video.currentTime||0; setHUDAt(t,d); }

    function getClientX(ev){
      if(ev && ev.touches && ev.touches.length) return ev.touches[0].clientX;
      if(ev && ev.changedTouches && ev.changedTouches.length) return ev.changedTouches[0].clientX;
      return (ev && ev.clientX!=null) ? ev.clientX : null;
    }
    function posToTimeGivenX(clientX){
      if(!barRect) return null;
      var w = Math.max(1, barRect.width), x = Math.min(Math.max(0, clientX - barRect.left), w);
      var d = dp.video.duration||0, t = (x / w) * d;
      return { t:t, d:d };
    }
    function rafLoop(){
      if(!dragActive){ rafId=0; return; }
      if(lastX!=null){
        var td = posToTimeGivenX(lastX);
        if(td) setHUDAt(td.t, td.d);
      }
      rafId = window.requestAnimationFrame(rafLoop);
    }

    // —— 进度条拖动（PC 修复 + 移动端静音系统提示 + 自定义汇总提示） —— 
    function startDrag(ev){
      dragActive=true;
      dragSummaryMsg=null;
      try{ dragStartAt = dp.video.currentTime || 0; }catch(_){ dragStartAt = 0; }   // 记录起点
      noticeCooldownUntil = Date.now() + 1200; // 拖动期间及刚开始静音
      try{ barRect = barEl.getBoundingClientRect(); }catch(_){ barRect=null; }
      try{ dp.container.setAttribute('data-sp-dragging','1'); }catch(_){}
      killForeignSeekTips();
      showHUD();
      var cx = getClientX(ev); if(cx!=null) lastX = cx;
      if(ev && ev.pointerId!=null && barEl && barEl.setPointerCapture){ try{ pointerId = ev.pointerId; barEl.setPointerCapture(pointerId); }catch(_){ } }
      try{ if(ev && typeof ev.preventDefault==='function') ev.preventDefault(); }catch(_){}
      if(!rafId){ rafId = window.requestAnimationFrame(rafLoop); }
      bindDocMove();
      try{
        var menu=dp.container.querySelector('.dplayer-menu'); if(menu) menu.style.display='none';
        var mask=dp.container.querySelector('.dplayer-mask'); if(mask) mask.style.display='none';
      }catch(_){}
      if(hudHint) hudHint.style.display='none';
    }
    function moveDrag(ev){
      if(!dragActive) return;
      var cx = getClientX(ev); if(cx!=null) lastX = cx;
      try{ if(ev && typeof ev.preventDefault==='function') ev.preventDefault(); }catch(_){}
      killForeignSeekTips();
    }
    function endDrag(){
      var target=null, d=dp.video.duration||0;
      if(lastX!=null && canSeek(dp) && barRect){
        var td = posToTimeGivenX(lastX);
        if(td && isFinite(td.t)){
          d = td.d || d;
          target = td.t;
          if(target<0) target=0; if(d>0 && target>d) target=d;
          internal(function(){ dp.seek(target); });
        }
      }
      // 生成自定义“已快进/已快退 Xs”汇总提示（相对拖动开始时）
      if(target!=null && isFinite(target)){
        var delta = target - (dragStartAt||0);
        var sec   = Math.round(Math.abs(delta));
        if (sec > 0){
          dragSummaryMsg = (delta>=0 ? '已快进 ' : '已快退 ') + sec + 's';
        }
      }
      // 松手后的冷静期：彻底屏蔽系统“快进/快退 X 秒”
      noticeCooldownUntil = Date.now() + 1000;

      dragActive=false; barRect=null;
      if(rafId){ try{ cancelAnimationFrame(rafId); }catch(_){ } rafId=0; }
      if(pointerId!=null && barEl && barEl.releasePointerCapture){ try{ barEl.releasePointerCapture(pointerId); }catch(_){} }
      pointerId=null; lastX=null;
      // 移除 dragging 标记后再显示自定义提示，避免被 CSS 隐藏
      setTimeout(function(){
        try{ dp.container.removeAttribute('data-sp-dragging'); }catch(_){}
        killForeignSeekTips();
        if (dragSummaryMsg){ spNotice(dragSummaryMsg, 1200); dragSummaryMsg=null; }
      }, 120);
      hideHUDSoon(240);
      unbindDocMove();
    }

    var moveBound=false, moveFn=null, upFn=null;
    function bindDocMove(){
      if(moveBound) return;
      moveFn = function(e){ moveDrag(e); };
      upFn   = function(){ endDrag(); };
      try{
        document.addEventListener('pointermove', moveFn, {passive:false});
        document.addEventListener('pointerup',   upFn,   {passive:true});
        document.addEventListener('pointercancel', upFn, {passive:true});
      }catch(e){}
      try{
        document.addEventListener('touchmove', moveFn, {passive:false});
        document.addEventListener('touchend',  upFn,   {passive:true});
        document.addEventListener('touchcancel', upFn, {passive:true});
      }catch(e){}
      try{
        document.addEventListener('mousemove', moveFn, false);
        document.addEventListener('mouseup',   upFn,   false);
      }catch(e){}
      moveBound=true;
    }
    function unbindDocMove(){
      if(!moveBound) return;
      try{
        document.removeEventListener('pointermove', moveFn, {passive:false});
        document.removeEventListener('pointerup',   upFn,   {passive:true});
        document.removeEventListener('pointercancel', upFn, {passive:true});
      }catch(e){}
      try{
        document.removeEventListener('touchmove', moveFn, {passive:false});
        document.removeEventListener('touchend',  upFn,   {passive:true});
        document.removeEventListener('touchcancel', upFn, {passive:true});
      }catch(e){}
      try{
        document.removeEventListener('mousemove', moveFn, false);
        document.removeEventListener('mouseup',   upFn,   false);
      }catch(e){}
      moveBound=false; moveFn=null; upFn=null;
    }

    function hookBarOnce(){
      var bar = dp.container.querySelector('.dplayer-bar-wrap');
      if(!bar) return;
      if(barEl===bar) return;
      if(barEl){
        try{ barEl.removeEventListener('pointerdown', startDrag, {passive:false}); }catch(_){}
        try{ barEl.removeEventListener('touchstart',  startDrag, {passive:false}); }catch(_){}
        try{ barEl.removeEventListener('mousedown',   startDrag, false); }catch(_){}
      }
      barEl = bar;
      try{ barEl.addEventListener('pointerdown', startDrag, {passive:false}); }catch(_){}
      try{ barEl.addEventListener('touchstart',  startDrag, {passive:false}); }catch(_){}
      try{ barEl.addEventListener('mousedown',   startDrag, false); }catch(_){}
      log('progress bar hooked (capture+rAF)');
    }
    hookBarOnce();
    if (window.MutationObserver){
      var moTimer=null;
      try{
        new MutationObserver(function(){
          if(moTimer) clearTimeout(moTimer);
          moTimer = setTimeout(function(){ hookBarOnce(); hookVideoWrapOnce(); }, 80);
        }).observe(dp.container, {childList:true,subtree:true});
      }catch(e){}
    }

    /* ===== 长按左右半屏：逐步提速快退/快进（松手后汇总提示一次） ===== */
    var vwEl=null, lpTimer=null, lpActive=false, lpDir=0, lpTickTimer=null, lpConsumedClick=false, lpStartAt=0, lpAccum=0;
    var LP_THRESHOLD=280, LP_BASE_STEP=2, LP_EVERY=160, LP_FACTOR_MS=600, LP_MAX_FACTOR=6;

    function hookVideoWrapOnce(){
      var vw = (dp.template && dp.template.videoWrap) || dp.container.querySelector('.dplayer-video-wrap');
      if(!vw || vwEl===vw) return;
      if(vwEl){
        try{ vwEl.removeEventListener('pointerdown', onVWDown, {passive:true}); }catch(_){}
        try{ vwEl.removeEventListener('touchstart',  onVWDown, {passive:true}); }catch(_){}
        try{ vwEl.removeEventListener('mousedown',   onVWDown, false); }catch(_){}
        try{ vwEl.removeEventListener('click',       onVWClickCapture, true); }catch(_){}
      }
      vwEl = vw;
      try{ vwEl.addEventListener('pointerdown', onVWDown, {passive:true}); }catch(_){}
      try{ vwEl.addEventListener('touchstart',  onVWDown, {passive:true}); }catch(_){}
      try{ vwEl.addEventListener('mousedown',   onVWDown, false); }catch(_){}
      try{ vwEl.addEventListener('click', onVWClickCapture, true); }catch(_){}
      log('video wrap hooked (long-press seek accel)');
    }
    hookVideoWrapOnce();

    function onVWClickCapture(e){
      if(lpConsumedClick){ e.stopPropagation(); try{ e.preventDefault(); }catch(_){ } lpConsumedClick=false; }
    }
    function onVWDown(ev){
      var t=ev.target;
      if(t && (closest(t,'.dplayer-controller') || closest(t,'.dplayer-bar-wrap'))) return;
      if(!canSeek(dp)) return;

      var wrapRect=null, cx=null;
      try{ wrapRect = vwEl.getBoundingClientRect(); }catch(_){}
      cx = getClientX(ev); if(cx==null || !wrapRect) return;
      var leftHalf = (cx - wrapRect.left) < (wrapRect.width/2);
      lpDir = leftHalf ? -1 : 1;

      clearLP();
      lpTimer = setTimeout(function(){
        lpActive=true; lpConsumedClick=true; lpStartAt=Date.now(); lpAccum=0;
        try{ dp.container.setAttribute('data-sp-pressing','1'); }catch(_){}
        showHUD(); updateHUDInstant();
        stepSeekLoop();
      }, LP_THRESHOLD);

      bindLPDocUp();
    }
    function closest(el, sel){
      while(el && el.nodeType===1){
        if(el.matches ? el.matches(sel) : (el.msMatchesSelector && el.msMatchesSelector(sel))) return el;
        el=el.parentNode;
      }
      return null;
    }
    function bindLPDocUp(){
      var end = function(){ endLongPress(); };
      try{ document.addEventListener('pointerup', end, {once:true, passive:true}); }catch(_){}
      try{ document.addEventListener('touchend',  end, {once:true, passive:true}); }catch(_){}
      try{ document.addEventListener('mouseup',   end, {once:true}); }catch(_){}
      try{ document.addEventListener('pointercancel', end, {once:true, passive:true}); }catch(_){}
      try{ document.addEventListener('touchcancel',  end, {once:true, passive:true}); }catch(_){}
    }
    function clearLPTimers(){ if(lpTimer){ clearTimeout(lpTimer); lpTimer=null; } if(lpTickTimer){ clearTimeout(lpTickTimer); lpTickTimer=null; } }
    function endLongPress(){
      clearLPTimers();
      var wasActive = lpActive;
      lpActive=false; lpStartAt=0;
      if(hudHint) hudHint.style.display='none';
      try{ dp.container.removeAttribute('data-sp-pressing'); }catch(_){}

      // 松手后给系统提示一个冷静期，确保不会插话
      noticeCooldownUntil = Date.now() + 600;

      if (wasActive) {
        var sec = Math.round(Math.abs(lpAccum));
        if (sec > 0) spNotice((lpAccum>0 ? '已快进 ' : '已快退 ') + sec + 's', 1200);
      }
      hideHUDSoon(220);
    }
    function clearLP(){ clearLPTimers(); lpActive=false; lpStartAt=0; lpAccum=0; if(hudHint) hudHint.style.display='none'; try{ dp.container.removeAttribute('data-sp-pressing'); }catch(_){} }
    function currentFactor(){
      if(!lpStartAt) return 1;
      var hold = Date.now() - lpStartAt;
      var f = 1 + Math.floor(hold / LP_FACTOR_MS);
      if(f < 1) f = 1;
      if(f > LP_MAX_FACTOR) f = LP_MAX_FACTOR;
      return f;
    }
    function stepSeekLoop(){
      if(!lpActive) return;
      if(!canSeek(dp)){ clearLP(); return; }
      var d=dp.video.duration||0, now=dp.video.currentTime||0;
      var factor = currentFactor();
      var step = LP_BASE_STEP * factor;
      var target = now + lpDir*step;
      if(target<0) target=0; if(target>d) target=d;
      lpAccum += (target - now);
      internal(function(){ dp.seek(target); });
      setHUDAt(target, d);
      setLongPressHint(lpDir, factor);
      lpTickTimer = setTimeout(stepSeekLoop, LP_EVERY);
    }

    /* ===== 跳过/续播 ===== */
    var introDone=false,outroDone=false,outroWarned=false,resumed=false;
    var internalSeek=false,userSeeking=false,seekT=null;
    function internal(fn){ internalSeek=true; try{ fn(); } finally{ setTimeout(function(){ internalSeek=false; },200); } }
    dp.video.addEventListener('seeking',function(){ userSeeking=!internalSeek; if(seekT) clearTimeout(seekT); });
    dp.video.addEventListener('seeked', function(){ seekT=setTimeout(function(){ userSeeking=false; },250); if(!dragActive && !lpActive) hideHUDSoon(200); });

    function attemptSkipIntro(){
      if(resumed||introDone||!autoIn||introEnd==null||userSeeking) return;
      waitFor(function(){ return canSeek(dp); }, function(ok){
        if(!ok) return;
        var now=dp.video.currentTime||0, target=introEnd;
        if(now<=target+1){ introDone=true; internal(function(){ dp.seek(target+0.1); }); spNotice('已跳过片头 → '+fmtTime(target),1500); updateHUDInstant(); }
      }, 8000);
    }

    var lastSave=0;
    dp.on('timeupdate', function(){
      if(!canSeek(dp)) return;
      var t=dp.video.currentTime||0, d=dp.video.duration||0;
      if(Math.abs(t-lastSave)>=5 && d>0){ try{ STORE.setItem(RESUME_KEY, String(Math.floor(t))); }catch(e){} lastSave=t; }
      if(!outroWarned && autoOu && outroStart!=null && !userSeeking){
        var warnAt=Math.max(0,outroStart-2);
        if(t>=warnAt && t<outroStart){ outroWarned=true; spNotice('即将跳过片尾…',1200); }
      }
      if(!outroDone && autoOu && outroStart!=null && !userSeeking){
        if(t>=Math.min(outroStart, d-0.5)){
          outroDone=true; try{ STORE.setItem(DONE_KEY,'1'); STORE.removeItem(RESUME_KEY);}catch(e){}
          spNotice('已跳过片尾，正在切换下一集…',800);
          try{ if(parent && parent.MacPlayer && parent.MacPlayer.PlayLinkNext) top.location.href=parent.MacPlayer.PlayLinkNext; else internal(function(){ dp.seek(Math.max(0,d-0.2)); }); }catch(e){}
        }
      }
      if(dragActive && lastX!=null){
        var td = posToTimeGivenX(lastX); if(td) setHUDAt(td.t, td.d);
      }
    });
    dp.on('ended', function(){ try{ STORE.setItem(DONE_KEY,'1'); STORE.removeItem(RESUME_KEY);}catch(e){} hideHUDSoon(100); });

    function maybeResume(){
      var done = (STORE.getItem(DONE_KEY)==='1');
      if(done){ internal(function(){ dp.seek(0); }); spNotice('已播放完成，正在从头播放',1500); updateHUDInstant(); return; }
      var r=parseFloat(STORE.getItem(RESUME_KEY)||'0');
      if(!r || isNaN(r) || r<=10) return;
      waitFor(function(){ return canSeek(dp); }, function(ok){
        if(!ok) return;
        internal(function(){ dp.seek(r); }); resumed=true; spNotice('已为你续播至 '+fmtTime(r),1500); updateHUDInstant();
      }, 8000);
    }

    var introTimer=null;
    dp.on('loadedmetadata', function(){
      introDone=false; outroDone=false; outroWarned=false; resumed=false;
      fetchMeta(); maybeResume();
      if(introTimer) clearTimeout(introTimer);
      introTimer=setTimeout(function(){ attemptSkipIntro(); },2000);
      updateHUDInstant();
      setTimeout(function(){ hookBarOnce(); hookVideoWrapOnce(); }, 200);
      killForeignSeekTips();
    });
    

    /* 下一集按钮（自适应尺寸 + 统一白色 + 智能探测；兼容平板/APP 延迟挂载） */
(function(){
  function getNextLink(){
    try{
      var mp = (typeof parent!=='undefined' && parent) ? parent.MacPlayer : null;
      if(!mp && typeof top!=='undefined') mp = top.MacPlayer;
      if(!mp && typeof window!=='undefined') mp = window.MacPlayer;
      var url = mp && mp.PlayLinkNext;
      return (url && typeof url==='string' && url.length>0) ? url : '';
    }catch(e){ return ''; }
  }
  function hasNext(){ return !!getNextLink(); }
  function goNext(){
    var u = getNextLink();
    if(!u) return;
    try{ top.location.href = u; }catch(e){ location.href = u; }
  }

  function ensureStyle(){
    if(document.getElementById('dp-next-ep-style')) return;
    var st=document.createElement('style'); st.id='dp-next-ep-style';
    st.textContent =
      '.dplayer .dplayer-next-ep{display:inline-flex;align-items:center;justify-content:center;cursor:pointer;margin-left:10px;border-radius:8px;outline:none;color:#fff;}' +
      '.dplayer .dplayer-next-ep svg{display:block;opacity:.95;}' +
      '.dplayer .dplayer-next-ep svg *{fill:currentColor;stroke:none;}' +
      '.dplayer .dplayer-next-ep:hover svg{opacity:1;}' +
      '.dplayer .dplayer-next-ep:focus{box-shadow:0 0 0 2px rgba(255,255,255,.35) inset;}' +
      '@media (pointer:coarse){ .dplayer .dplayer-next-ep{ margin-left:12px; } }';
    document.head.appendChild(st);
  }

  function inject(){
    if(!window.dp || !dp.container) return;
    var ctrl = dp.container.querySelector('.dplayer-controller');
    if(!ctrl) return;

    var play = ctrl.querySelector('.dplayer-play-icon') || ctrl.querySelector('.dplayer-play');
    var existing = ctrl.querySelector('.dplayer-next-ep');

    // 按需显示/移除
    if(!hasNext()){
      if(existing && existing.parentNode) existing.parentNode.removeChild(existing);
      return;
    }

    ensureStyle();
    if(existing) return;

    // 自适应尺寸（平板/APP 也能拿到）
    var baseW=28, baseH=28;
    try{
      if(play){
        var cs = window.getComputedStyle(play);
        baseW = parseFloat(cs.width)||baseW;
        baseH = parseFloat(cs.height)||baseH;
      }
    }catch(_){}
    var base  = Math.max(baseW, baseH);
    var coarse = false; try{ coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches; }catch(_){}
    var btnSize = Math.round(base * (coarse?0.35:1));
    var svgSize = Math.max(14, Math.round(btnSize*0.64)); if(svgSize%2) svgSize++;

    // 按钮
    var btn = document.createElement('div');
    btn.className = 'dplayer-icon dplayer-next-ep';
    btn.setAttribute('tabindex','0');
    btn.setAttribute('role','button');
    btn.setAttribute('aria-label','下一集');
    btn.title = '下一集';
    btn.style.width  = btn.style.height = btnSize + 'px';
    btn.innerHTML =
      '<svg viewBox="0 0 32 32" width="'+svgSize+'" height="'+svgSize+'" aria-hidden="true">'+
        '<rect x="25" y="6" width="3" height="20" rx="1" fill="currentColor"></rect>'+
        '<path d="M5 8 L16 16 L5 24 Z" fill="currentColor"></path>'+
        '<path d="M13 8 L24 16 L13 24 Z" fill="currentColor"></path>'+
      '</svg>';

    // 插到播放/暂停按钮后
    if (play && play.parentNode){
      if (play.nextSibling) play.parentNode.insertBefore(btn, play.nextSibling);
      else play.parentNode.appendChild(btn);
    } else {
      // 兜底：直接放控制条里
      ctrl.appendChild(btn);
    }

    btn.addEventListener('click', function(e){ e.stopPropagation(); goNext(); }, false);
    btn.addEventListener('keydown', function(e){
      var k=e.key||e.code;
      if(k==='Enter'||k===' '||k==='Space'){ e.preventDefault(); goNext(); }
    }, false);
  }

  // 周期注入：不要在开头就 return；反复检测 MacPlayer 是否已就绪
  var tries = 0;
  var timer = setInterval(function(){
    inject();
    // 不限制次数，避免 APP/webview 延迟很久才挂载 MacPlayer 的情况
    if(++tries>600){ tries=0; } // 轻限流
  }, 250);

  // DOM 变化也尝试注入（平板上控制条可能晚于脚本渲染）
  if (window.MutationObserver){
    try{
      new MutationObserver(function(){ inject(); })
        .observe(document.body || document.documentElement, {childList:true,subtree:true});
    }catch(_){}
  }

  // dp 事件触发时也顺手注入一次
  try{ dp.on('loadedmetadata', inject); }catch(_){}

  // 快捷键：N 跳下一集
  document.addEventListener('keydown', function(e){
    var code=e.code||e.key;
    if((code==='KeyN'||e.key==='n') && hasNext()){ e.preventDefault(); goNext(); }
  }, false);
})();


    /* ===== 自动全屏（手势触发） ===== */
    function isFSOn(){ return STORE.getItem(LS.autofs)==='1' || autoFS===true; }
    function requestFS(){
      if(firedFS || !isFSOn()) return; firedFS=true;
      var el=dp.container;
      try{ if(!document.fullscreenElement && el.requestFullscreen){ el.requestFullscreen(); return; } }catch(e){}
      try{ dp.fullScreen.request('browser'); return; }catch(e){}
      try{ var v=dp.video; if(v && v.webkitEnterFullscreen){ v.webkitEnterFullscreen(); return; } }catch(e){}
      try{ dp.fullScreen.request('web'); }catch(e){}
    }
    (function armFS(){
      var nodes=[];
      try{ if(dp.template && dp.template.videoWrap) nodes.push(dp.template.videoWrap);}catch(e){}
      try{ nodes.push(dp.container.querySelector('.dplayer-video-wrap')); }catch(e){}
      try{ nodes.push(dp.container.querySelector('.dplayer-play-icon')); }catch(e){}
      try{ nodes.push(dp.container.querySelector('.dplayer-controller .dplayer-play-icon')); }catch(e){}
      nodes=nodes.filter(function(n){return !!n;});
      var h=function(){ requestFS(); }, opts={capture:true,passive:true};
      for(var i=0;i<nodes.length;i++){ try{nodes[i].addEventListener('pointerup',h,opts);}catch(e){} try{nodes[i].addEventListener('touchend',h,opts);}catch(e){} try{nodes[i].addEventListener('click',h,opts);}catch(e){} }
      try{ window.addEventListener('keydown',function(e){ if(!isFSOn())return; if(e && (e.code==='Space'||e.code==='Enter')) requestFS(); },{capture:true,passive:true}); }catch(e){}
      dp.on('play', function(){ requestFS(); hideHUDSoon(120); });
    })();

    /* ===== 屏蔽右键 + 兜底隐藏 ===== */
    try{
      dp.container.oncontextmenu = function(){
        try{ var m=dp.container.querySelector('.dplayer-menu'); if(m) m.style.display='none';
             var mask=dp.container.querySelector('.dplayer-mask'); if(mask) mask.style.display='none'; }catch(_){}
        return false;
      };
      document.addEventListener('contextmenu', function(e){
        if (dp.container.contains(e.target)){
          e.preventDefault();
          try{ var m=dp.container.querySelector('.dplayer-menu'); if(m) m.style.display='none';
               var mask=dp.container.querySelector('.dplayer-mask'); if(mask) mask.style.display='none'; }catch(_){}
        }
      }, {capture:true, passive:false});
      document.addEventListener('visibilitychange', function(){
        if(document.hidden){
          dragActive=false; clearLP(); hideHUDNow(); unbindDocMove();
          dp.container.removeAttribute('data-sp-dragging'); dp.container.removeAttribute('data-sp-pressing');
        }
      });
      window.addEventListener('orientationchange', function(){
        dragActive=false; clearLP(); hideHUDNow(); unbindDocMove();
        dp.container.removeAttribute('data-sp-dragging'); dp.container.removeAttribute('data-sp-pressing');
      }, {passive:true});
      dp.container.addEventListener('pointerleave', function(){ if(!dragActive && !lpActive) hideHUDSoon(150); }, {passive:true});
    }catch(e){}

  });
})();

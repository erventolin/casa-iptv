(function () {
  "use strict";

  var CFG = window.CASA_IPTV_CONFIG || { playlists: [], hideInfoAfter: 4 };
  var LS_CACHE = "casaiptv:cache";
  var LS_FAVS = "casaiptv:favs";
  var LS_LAST = "casaiptv:last";
  var LS_CUSTOM = "casaiptv:customUrl";
  var ROW_H = 76;

  var app = document.getElementById("app");
  var listEl = document.getElementById("list");
  var tabName = document.getElementById("tab-name");
  var video = document.getElementById("video");
  var statusEl = document.getElementById("status");
  var osd = document.getElementById("osd");
  var osdNum = document.getElementById("osd-num");
  var osdName = document.getElementById("osd-name");

  var channels = [];   // {name, url, logo, group}
  var groups = [];     // ["Todos", "★ Favoritos", ...]
  var groupIdx = 0;
  var view = [];       // canales del grupo actual
  var sel = 0;
  var playing = null;  // url del canal en reproducción
  var full = false;
  var osdTimer = null;
  var favs = load(LS_FAVS, {});

  // ---------- utilidades ----------
  function load(k, def) {
    try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; }
  }
  function save(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {}
  }
  function status(t) {
    statusEl.textContent = t || "";
    statusEl.style.display = t ? "block" : "none";
  }
  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function get(url, cb) {
    var x = new XMLHttpRequest();
    x.open("GET", url, true);
    x.timeout = 20000;
    x.onload = function () { cb(x.status >= 200 && x.status < 300 ? null : "HTTP " + x.status, x.responseText); };
    x.onerror = function () { cb("error de red"); };
    x.ontimeout = function () { cb("tiempo agotado"); };
    x.send();
  }

  // ---------- M3U ----------
  function attr(line, name) {
    var m = line.match(new RegExp(name + '="([^"]*)"'));
    return m ? m[1] : "";
  }
  var GROUP_ES = {
    General: "Generalistas", News: "Noticias", Sports: "Deportes", Music: "Música", Series: "Series",
    Movies: "Cine", Kids: "Infantil", Animation: "Animación", Documentary: "Documentales",
    Entertainment: "Entretenimiento", Religious: "Religión", Legislative: "Parlamentos",
    Culture: "Cultura", Comedy: "Humor", Lifestyle: "Estilo de vida", Public: "Públicas",
    Classic: "Clásicos", Business: "Economía", Education: "Educación", Cooking: "Cocina",
    Auto: "Motor", Family: "Familia", Outdoor: "Naturaleza", Travel: "Viajes", Weather: "Tiempo",
    Undefined: "Otros", "": "Otros"
  };
  function groupName(g) { return GROUP_ES.hasOwnProperty(g) ? GROUP_ES[g] : g; }

  function parseM3U(text) {
    var out = [], info = null;
    text.split(/\r?\n/).forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.indexOf("#EXTINF") === 0) {
        var comma = line.lastIndexOf(",");
        info = {
          name: comma >= 0 ? line.slice(comma + 1).trim() : "Sin nombre",
          logo: attr(line, "tvg-logo"),
          group: groupName((attr(line, "group-title") || "").split(";")[0])
        };
      } else if (line.charAt(0) !== "#" && info) {
        info.url = line;
        out.push(info);
        info = null;
      }
    });
    return out;
  }

  function loadPlaylists(done) {
    var custom = load(LS_CUSTOM, "");
    var lists = custom ? [{ name: "Mi lista", url: custom }] : (CFG.playlists || []);
    var pending = lists.length, all = [], errors = [];
    if (!pending) return done(all, ["No hay listas en config.js"]);
    lists.forEach(function (pl, i) {
      get(pl.url, function (err, text) {
        if (err) errors.push(pl.name + ": " + err);
        else all[i] = parseM3U(text);
        if (--pending === 0) done([].concat.apply([], all.filter(Boolean)), errors);
      });
    });
  }

  // ---------- grupos y lista ----------
  function buildGroups() {
    var seen = {}, gs = [];
    channels.forEach(function (c) { if (!seen[c.group]) { seen[c.group] = 1; gs.push(c.group); } });
    gs.sort(function (a, b) { return a.localeCompare(b, "es"); });
    groups = ["Todos", "★ Favoritos"].concat(gs, [SETTINGS]);
  }
  var SETTINGS = "⚙ Ajustes";
  function settingsItems() {
    var custom = load(LS_CUSTOM, "");
    var items = [{ name: "Cambiar lista de canales", action: "setup" }];
    if (custom) items.push({ name: "Volver a la lista por defecto", action: "reset" });
    items.push({ name: "Lista actual: " + (custom || "por defecto (España)"), action: "none" });
    return items;
  }
  function applyGroup() {
    var g = groups[groupIdx];
    if (g === SETTINGS) {
      view = settingsItems();
      tabName.textContent = g;
    } else {
      view = channels.filter(function (c) {
        return g === "Todos" ? true : g === "★ Favoritos" ? !!favs[c.url] : c.group === g;
      });
      tabName.textContent = g + " (" + view.length + ")";
    }
    sel = Math.max(0, Math.min(sel, view.length - 1));
    render();
  }
  function render() {
    var visible = Math.floor(listEl.clientHeight / ROW_H) || 10;
    var start = Math.max(0, Math.min(sel - Math.floor(visible / 2), view.length - visible));
    var html = "";
    for (var i = start; i < Math.min(view.length, start + visible + 1); i++) {
      var c = view[i];
      html += '<li class="' + (i === sel ? "sel " : "") + (c.url === playing ? "playing" : "") + '">' +
        '<span class="n">' + (i + 1) + "</span>" +
        (c.logo ? '<img src="' + esc(c.logo) + '" onerror="this.style.visibility=\'hidden\'">' : "") +
        '<span class="t">' + esc(c.name) + "</span>" +
        (favs[c.url] ? '<span class="fav">★</span>' : "") + "</li>";
    }
    listEl.innerHTML = html || '<li><span class="t">Sin canales</span></li>';
  }

  // ---------- reproducción ----------
  // Motores, en orden según el tipo de enlace:
  //   .m3u8        -> hls.js -> nativo
  //   .ts / otros  -> mpegts.js (MPEG-TS continuo) -> hls.js -> nativo
  //   .mpd         -> nativo
  // Si un motor da error fatal se pasa al siguiente; si fallan todos, se avisa.
  var hls = null, mts = null, engine = "", playToken = null;
  function stopHls() {
    if (hls) { try { hls.destroy(); } catch (e) {} hls = null; }
    if (mts) {
      try { mts.pause(); mts.unload(); mts.detachMediaElement(); mts.destroy(); } catch (e) {}
      mts = null;
    }
  }
  function kick() {
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }
  function failed() {
    status("Este canal no funciona ahora mismo. Prueba otro.");
  }

  function engineOrder(url) {
    if (/\.mpd(\?|$)/i.test(url)) return ["native"];
    if (/\.m3u8?(\?|$)/i.test(url)) return ["hls", "native"];
    return ["mpegts", "hls", "native"];
  }

  var ENGINES = {
    hls: {
      ok: function () { return window.Hls && window.Hls.isSupported(); },
      start: function (url, next) {
        var recovered = false;
        hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 30 });
        hls.on(window.Hls.Events.MANIFEST_PARSED, kick);
        hls.on(window.Hls.Events.ERROR, function (ev, data) {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && !recovered) { recovered = true; hls.recoverMediaError(); return; }
          next();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      }
    },
    mpegts: {
      ok: function () { return window.mpegts && window.mpegts.isSupported(); },
      start: function (url, next) {
        mts = window.mpegts.createPlayer(
          { type: "mpegts", isLive: true, url: url },
          { enableWorker: true, enableStashBuffer: true, stashInitialSize: 128 * 1024,
            liveBufferLatencyChasing: true, liveBufferLatencyMaxLatency: 6, liveBufferLatencyMinRemain: 1,
            lazyLoad: false, autoCleanupSourceBuffer: true });
        // diferido: no destruir el reproductor mientras aún está emitiendo el evento de error
        mts.on(window.mpegts.Events.ERROR, function () { setTimeout(next, 0); });
        mts.attachMediaElement(video);
        mts.load();
        kick();
      }
    },
    native: {
      ok: function () { return true; },
      start: function (url) {
        video.removeAttribute("src");
        video.src = url;
        kick();
      }
    }
  };

  function play(c) {
    if (!c) return;
    playing = c.url;
    save(LS_LAST, c.url);
    status("Cargando " + c.name + "…");
    var url = c.url;
    var order = engineOrder(url).filter(function (n) { return ENGINES[n].ok(); });
    var i = -1, token = {};
    playToken = token;
    function next() {
      if (playing !== url || playToken !== token) return;   // el usuario ya cambió de canal
      stopHls();
      i++;
      if (i >= order.length) { engine = ""; return failed(); }
      engine = order[i];
      try { ENGINES[engine].start(url, next); } catch (e) { next(); }
    }
    video.onerror = function () { if (playing === url && engine === "native") failed(); };
    next();
    showOsd(c);
    render();
  }
  video.addEventListener("playing", function () { status(""); });

  function showOsd(c) {
    var idx = view.indexOf(c);
    osdNum.textContent = idx >= 0 ? idx + 1 : "";
    osdName.textContent = c.name;
    osd.className = "show";
    clearTimeout(osdTimer);
    osdTimer = setTimeout(function () { osd.className = ""; }, (CFG.hideInfoAfter || 4) * 1000);
  }
  function setFull(on) {
    full = on;
    app.className = on ? "full" : "";
    setTimeout(render, 300);
  }
  function zap(d) {
    if (!view.length) return;
    sel = (sel + d + view.length) % view.length;
    play(view[sel]);
  }

  // ---------- mando ----------
  var K = { LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
            CH_UP: 427, CH_DOWN: 428, YELLOW: 405, RED: 403, PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19,
            IME_DONE: 65376, IME_CANCEL: 65385 };
  try {
    ["ChannelUp", "ChannelDown", "ColorF0Red", "ColorF2Yellow", "MediaPlayPause", "MediaPlay", "MediaPause"]
      .forEach(function (k) { window.tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  // Dentro de TizenBrew el módulo sustituye a la pantalla de TizenBrew en la misma ventana:
  // "Atrás" debe volver a esa pantalla (history.back). Si no hay historial, cerrar la app.
  function exitApp() {
    stopHls();
    try { video.pause(); video.removeAttribute("src"); video.load(); } catch (e) {}
    if (window.history.length > 1) { window.history.back(); return; }
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  // ---------- cambiar lista (botón rojo) ----------
  var setupEl = document.getElementById("setup");
  var setupInput = document.getElementById("setup-url");
  var setupOpen = false;
  function openSetup() {
    setupOpen = true;
    setupInput.value = load(LS_CUSTOM, "");
    setupEl.className = "show";
    setTimeout(function () { setupInput.focus(); }, 50);
  }
  function closeSetup() {
    setupOpen = false;
    setupInput.blur();
    setupEl.className = "";
  }
  function saveSetup(forceUrl) {
    var url = typeof forceUrl === "string" ? forceUrl : setupInput.value.trim();
    if (url && !/^https?:\/\//i.test(url)) url = "http://" + url;
    if (url) save(LS_CUSTOM, url); else { try { localStorage.removeItem(LS_CUSTOM); } catch (e) {} }
    try { localStorage.removeItem(LS_CACHE); localStorage.removeItem(LS_LAST); } catch (e) {}
    closeSetup();
    stopHls();
    location.reload();
  }

  function toggleFav(f) {
    if (!f || !f.url) return;
    if (favs[f.url]) delete favs[f.url]; else favs[f.url] = 1;
    save(LS_FAVS, favs);
    if (groups[groupIdx] === "★ Favoritos") applyGroup(); else render();
  }
  function activate(c) {
    if (!c) return;
    if (c.action === "setup") return openSetup();
    if (c.action === "reset") return saveSetup("");
    if (c.action) return;
    if (c.url === playing) setFull(true); else play(c);
  }

  // OK = ver / pantalla completa. Mantener OK pulsado (la tele repite la tecla) = marcar/desmarcar favorito.
  // No depende de keyup: se detectan las repeticiones automáticas de keydown.
  var okLast = 0, okRepeats = 0, okFavDone = false;
  function onOk() {
    var now = Date.now();
    var isRepeat = now - okLast < 300;
    okLast = now;
    if (!isRepeat) { okRepeats = 0; okFavDone = false; activate(view[sel]); return; }
    okRepeats++;
    if (okRepeats >= 3 && !okFavDone) { okFavDone = true; toggleFav(view[sel]); }
  }

  document.addEventListener("keydown", function (e) {
    var k = e.keyCode;
    if (setupOpen) {
      if (k === K.ENTER || k === K.IME_DONE) { e.preventDefault(); saveSetup(); }
      else if (k === K.BACK || k === K.ESC || k === K.IME_CANCEL) { e.preventDefault(); closeSetup(); }
      return; // el resto de teclas van al cuadro de texto
    }
    if (k === K.RED) return openSetup();
    if (k === K.CH_UP) return zap(-1);
    if (k === K.CH_DOWN) return zap(1);
    if (k === K.PLAYPAUSE || k === K.PLAY || k === K.PAUSE) {
      if (video.paused) video.play(); else video.pause();
      return;
    }
    if (full) {
      if (k === K.UP) return zap(-1);
      if (k === K.DOWN) return zap(1);
      if (k === K.BACK || k === K.ESC || k === K.LEFT || k === K.ENTER) return setFull(false);
      return;
    }
    switch (k) {
      case K.UP: if (view.length) sel = (sel - 1 + view.length) % view.length; render(); break;
      case K.DOWN: if (view.length) sel = (sel + 1) % view.length; render(); break;
      case K.LEFT: groupIdx = (groupIdx - 1 + groups.length) % groups.length; sel = 0; applyGroup(); break;
      case K.RIGHT: groupIdx = (groupIdx + 1) % groups.length; sel = 0; applyGroup(); break;
      case K.ENTER: onOk(); break;
      case K.YELLOW: toggleFav(view[sel]); break;
      case K.BACK: case K.ESC: exitApp(); break;
    }
  });

  // ---------- arranque ----------
  function start(list) {
    channels = list;
    buildGroups();
    applyGroup();
    var last = load(LS_LAST, null);
    var idx = -1;
    for (var i = 0; i < view.length; i++) if (view[i].url === last) { idx = i; break; }
    if (idx >= 0) { sel = idx; play(view[idx]); }
    else status(channels.length ? "Elige un canal y pulsa OK" : "No hay canales");
    render();
  }

  var cached = load(LS_CACHE, null);
  if (cached && cached.length) start(cached);
  loadPlaylists(function (list, errors) {
    if (list.length) {
      save(LS_CACHE, list);
      if (!cached || !cached.length) start(list);
      else { channels = list; buildGroups(); applyGroup(); }
    } else if (!cached || !cached.length) {
      status("No se pudo cargar ninguna lista. " + errors.join(" · "));
    }
  });
})();

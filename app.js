(function () {
  "use strict";

  var CFG = window.CASA_IPTV_CONFIG || { playlists: [], hideInfoAfter: 4 };
  var LS_CACHE = "casaiptv:cache";
  var LS_FAVS = "casaiptv:favs";
  var LS_LAST = "casaiptv:last";
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
    var lists = CFG.playlists || [], pending = lists.length, all = [], errors = [];
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
    groups = ["Todos", "★ Favoritos"].concat(gs);
  }
  function applyGroup() {
    var g = groups[groupIdx];
    view = channels.filter(function (c) {
      return g === "Todos" ? true : g === "★ Favoritos" ? !!favs[c.url] : c.group === g;
    });
    tabName.textContent = g + " (" + view.length + ")";
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
  function play(c) {
    if (!c) return;
    playing = c.url;
    save(LS_LAST, c.url);
    status("Cargando " + c.name + "…");
    video.src = c.url;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
    showOsd(c);
    render();
  }
  video.addEventListener("playing", function () { status(""); });
  video.addEventListener("error", function () {
    status("Este canal no funciona ahora mismo. Prueba otro.");
  });

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
            CH_UP: 427, CH_DOWN: 428, YELLOW: 405, PLAYPAUSE: 10252, PLAY: 415, PAUSE: 19 };
  try {
    ["ChannelUp", "ChannelDown", "ColorF2Yellow", "MediaPlayPause", "MediaPlay", "MediaPause"]
      .forEach(function (k) { window.tizen.tvinputdevice.registerKey(k); });
  } catch (e) {}

  function exitApp() {
    try { window.tizen.application.getCurrentApplication().exit(); } catch (e) {}
  }

  document.addEventListener("keydown", function (e) {
    var k = e.keyCode;
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
      case K.ENTER:
        var c = view[sel];
        if (!c) break;
        if (c.url === playing) setFull(true); else play(c);
        break;
      case K.YELLOW:
        var f = view[sel];
        if (!f) break;
        if (favs[f.url]) delete favs[f.url]; else favs[f.url] = 1;
        save(LS_FAVS, favs);
        if (groups[groupIdx] === "★ Favoritos") applyGroup(); else render();
        break;
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

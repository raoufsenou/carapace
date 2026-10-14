// Draws each <template class="draw"> of the report in a frame: a document of its own that holds the template's markup
// with the app's stylesheets, laid out at data-w CSS pixels (1440 when unset) and scaled down to its column, so a
// drawing and a screenshot compare at one scale. The stylesheets are those the report names with
// <link rel="drawing-stylesheet" href="…">, or the template's own data-css, a list separated by spaces. data-h fixes
// the frame's height, for a drawing of a whole window, so viewport units mean what they do in the app; without it the
// frame is as tall as what it holds. data-theme and data-class are set on the frame's <html>, and data-style adds rules
// to that frame alone. Inside a drawing, class="x-new" or class="x-bad" with data-x labels a part, class="x-gap" stands
// for what the drawing leaves out, and <div class="x-modal"> shows the dialog it holds open in place, however the app
// positions it. A frame marks itself data-ready once its stylesheets and fonts have loaded, and data-overflow with its
// content's width when that is wider than data-w. Frames load as they near the window, or all at once when the address
// ends in ?all. Links and forms inside a drawing do nothing.
(function () {
  var MARKS = [
    '.x-bad,.x-new{position:relative;outline-offset:3px}',
    '.x-bad{outline:2px dashed #c0392b}',
    '.x-new{outline:2px dashed #2f6fb0}',
    '.x-bad[data-x]::after,.x-new[data-x]::after{content:attr(data-x);position:absolute;top:-11px;right:8px;z-index:30;padding:0 6px;border-radius:3px;font:600 10.5px/17px ui-monospace,Menlo,monospace;letter-spacing:0;text-transform:none;color:#fff;white-space:nowrap;pointer-events:none}',
    '.x-bad[data-x]::after{background:#c0392b}',
    '.x-new[data-x]::after{background:#2f6fb0}',
    '.x-gap{font:italic 12px/1.5 ui-monospace,Menlo,monospace;color:#98938a;padding:2px 0}',
    '.x-modal{display:flex;justify-content:center;padding:36px;background:rgb(26 26 23 / .45)}',
    '.x-modal>*{position:static!important;inset:auto!important;margin:0!important;transform:none!important;translate:none!important;max-height:none!important}'
  ].join('');
  // A drawing without data-h grows with what it holds, whatever height the app gives its page.
  var FLOW = 'html,body{height:auto!important;min-height:0!important}body{display:flow-root}';
  var REPORT = '<script>(function(){'
    + 'var send=function(ready){parent.postMessage({drawing:true,h:Math.ceil(document.documentElement.getBoundingClientRect().height),w:document.documentElement.scrollWidth,ready:ready},"*")};'
    + 'new ResizeObserver(function(){send(false)}).observe(document.documentElement);'
    + 'addEventListener("click",function(e){if(e.target.closest("a[href]"))e.preventDefault()});'
    + 'addEventListener("submit",function(e){e.preventDefault()});'
    + 'var loaded=new Promise(function(done){if(document.readyState==="complete")done();else addEventListener("load",done)});'
    + 'loaded.then(function(){return document.fonts.ready}).then(function(){send(true)});send(false)})()<\/script>';
  var sheets = Array.prototype.map.call(document.querySelectorAll('link[rel~="drawing-stylesheet"]'), function (link) {
    return link.getAttribute('href');
  });
  var eager = /[?&]all\b/.test(location.search);
  var frames = [];

  function attribute(text) {
    return String(text).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  }

  function fit(f) {
    var room = f.frame.clientWidth;
    if (!room) return;
    var k = Math.min(1, room / f.w);
    f.iframe.style.height = f.h + 'px';
    f.iframe.style.transform = 'scale(' + k + ')';
    f.frame.style.height = Math.ceil(f.h * k) + 'px';
  }

  function start(f) {
    if (f.started) return;
    f.started = true;
    f.iframe.srcdoc = f.doc;
  }

  var near = eager || !('IntersectionObserver' in window) ? null : new IntersectionObserver(function (entries) {
    entries.forEach(function (entry) {
      if (!entry.isIntersecting) return;
      near.unobserve(entry.target);
      start(frames[Number(entry.target.dataset.frame)]);
    });
  }, { rootMargin: '1600px 0px' });

  document.querySelectorAll('template.draw').forEach(function (tpl, i) {
    var css = tpl.dataset.css ? tpl.dataset.css.split(/\s+/).filter(Boolean) : sheets;
    var height = Number(tpl.dataset.h) || 0;
    var finding = tpl.closest('.finding');
    var figure = tpl.closest('figure');
    var caption = figure && figure.querySelector('figcaption');
    var root = (tpl.dataset.theme ? ' data-theme="' + attribute(tpl.dataset.theme) + '"' : '')
      + (tpl.dataset.class ? ' class="' + attribute(tpl.dataset.class) + '"' : '');
    var frame = document.createElement('div');
    var iframe = document.createElement('iframe');
    var f = { w: Number(tpl.dataset.w) || 1440, h: height || 140, fixed: height > 0, frame: frame, iframe: iframe, started: false };
    f.doc = '<!doctype html><html lang="' + attribute(document.documentElement.lang || 'en') + '"' + root + '><head><meta charset="utf-8">'
      + '<base href="' + attribute(document.baseURI) + '">'
      + css.map(function (href) { return '<link rel="stylesheet" href="' + attribute(href) + '">'; }).join('')
      + '<style>' + MARKS + (f.fixed ? '' : FLOW) + (tpl.dataset.style || '') + '</style></head><body>'
      + tpl.innerHTML + REPORT + '</body></html>';
    frame.className = 'frame';
    frame.dataset.frame = String(i);
    iframe.title = (finding && finding.id ? finding.id + ' · ' : '') + (caption ? caption.textContent.trim() : 'drawing');
    iframe.style.width = f.w + 'px';
    frame.appendChild(iframe);
    tpl.after(frame);
    frames.push(f);
    fit(f);
    if (near) near.observe(frame);
    else start(f);
  });

  window.addEventListener('message', function (event) {
    var data = event.data;
    if (!data || data.drawing !== true) return;
    frames.forEach(function (f) {
      if (f.iframe.contentWindow !== event.source) return;
      if (!f.fixed && data.h > 0 && data.h !== f.h) {
        f.h = data.h;
        fit(f);
      }
      if (data.w > f.w + 1) f.frame.dataset.overflow = String(data.w);
      else delete f.frame.dataset.overflow;
      if (data.ready) f.frame.dataset.ready = '1';
    });
  });
  window.addEventListener('resize', function () {
    frames.forEach(fit);
  });
})();

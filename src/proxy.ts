import * as cheerio from 'cheerio';
import { fetchPage } from './fetcher';

/**
 * Builds the visual picker script and stylesheet injected into the proxied HTML.
 * Includes a top floating toolbar with buttons:
 * Öğe, Başlık, Link, Açıklama, Görsel + Bitti
 * Hover outline, CSS selector generation (id > class > nth-of-type, max 4 levels),
 * and postMessage communication with parent.
 */
function getPickerInjection(): string {
  return `
<style id="frss-picker-styles">
  #frss-top-toolbar {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 2147483647;
    background: #0f172a;
    color: #f8fafc;
    padding: 8px 16px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.4);
    border-bottom: 2px solid #2563eb;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    user-select: none;
  }
  .frss-toolbar-left {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .frss-toolbar-title {
    font-weight: 700;
    color: #60a5fa;
    display: flex;
    align-items: center;
    gap: 6px;
    margin-right: 4px;
  }
  .frss-mode-btn {
    background: #1e293b;
    border: 1px solid #475569;
    color: #f1f5f9;
    padding: 5px 12px;
    border-radius: 6px;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.2s;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .frss-mode-btn:hover {
    background: #334155;
    border-color: #60a5fa;
  }
  .frss-mode-btn.active {
    background: #2563eb;
    border-color: #3b82f6;
    color: #ffffff;
    font-weight: 600;
    box-shadow: 0 0 8px rgba(37, 99, 235, 0.6);
  }
  .frss-btn-finish {
    background: #16a34a !important;
    border-color: #22c55e !important;
    color: white !important;
    font-weight: 600 !important;
    padding: 6px 16px !important;
    margin-left: 8px;
  }
  .frss-btn-finish:hover {
    background: #15803d !important;
  }
  #frss-status-badge {
    font-size: 12px;
    color: #94a3b8;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  body {
    padding-top: 50px !important;
  }

  .frss-hovered {
    outline: 2px dashed #2563eb !important;
    background-color: rgba(37, 99, 235, 0.1) !important;
    cursor: crosshair !important;
  }
  .frss-selected-item {
    outline: 2px solid #16a34a !important;
    background-color: rgba(22, 163, 74, 0.08) !important;
  }
  .frss-selected-title {
    outline: 2px solid #d97706 !important;
    background-color: rgba(217, 119, 6, 0.15) !important;
  }
  .frss-selected-link {
    outline: 2px solid #9333ea !important;
    background-color: rgba(147, 51, 234, 0.15) !important;
  }
  .frss-selected-desc {
    outline: 2px solid #0891b2 !important;
    background-color: rgba(8, 145, 178, 0.15) !important;
  }
  .frss-selected-image {
    outline: 2px solid #ea580c !important;
    background-color: rgba(234, 88, 12, 0.15) !important;
  }
  .frss-selected-date {
    outline: 2px solid #dc2626 !important;
    background-color: rgba(220, 38, 38, 0.15) !important;
  }
</style>

<div id="frss-top-toolbar">
  <div class="frss-toolbar-left">
    <div class="frss-toolbar-title">🎯 Seçici:</div>
    <button type="button" class="frss-mode-btn active" data-mode="item" onclick="window.frssSetMode('item')">📦 Öğe</button>
    <button type="button" class="frss-mode-btn" data-mode="title" onclick="window.frssSetMode('title')">🏷️ Başlık</button>
    <button type="button" class="frss-mode-btn" data-mode="link" onclick="window.frssSetMode('link')">🔗 Link</button>
    <button type="button" class="frss-mode-btn" data-mode="desc" onclick="window.frssSetMode('desc')">📝 Açıklama</button>
    <button type="button" class="frss-mode-btn" data-mode="image" onclick="window.frssSetMode('image')">🖼️ Görsel</button>
    <button type="button" class="frss-mode-btn" data-mode="date" onclick="window.frssSetMode('date')">📅 Tarih</button>
    <button type="button" class="frss-mode-btn frss-btn-finish" onclick="window.frssFinish()">✅ Bitti</button>
  </div>
  <div id="frss-status-badge">Mod: Öğe (Liste öğesine tıklayın)</div>
</div>

<script id="frss-picker-script">
(function() {
  var activeMode = 'item';
  var hoveredEl = null;
  var currentItemEl = null;
  var selectors = {
    itemSelector: '',
    titleSelector: '',
    linkSelector: '',
    descSelector: '',
    imageSelector: '',
    dateSelector: ''
  };

  var statusBadge = document.getElementById('frss-status-badge');
  function updateStatus(text) {
    if (statusBadge) statusBadge.innerText = text;
  }

  var modeLabels = {
    item: 'Mod: Öğe (Her bir haber/kart kutusuna tıklayın)',
    title: 'Mod: Başlık (Başlık metnine tıklayın)',
    link: 'Mod: Link (Tıklanabilir bağlantıya tıklayın)',
    desc: 'Mod: Açıklama (Özet/metne tıklayın)',
    image: 'Mod: Görsel (Resme tıklayın)',
    date: 'Mod: Tarih (Yayın tarihine tıklayın)'
  };

  window.frssSetMode = function(mode) {
    activeMode = mode;
    document.querySelectorAll('.frss-mode-btn').forEach(function(b) {
      if (b.getAttribute('data-mode') === mode) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
    updateStatus(modeLabels[mode] || ('Mod: ' + mode));
  };

  window.frssFinish = function() {
    window.parent.postMessage({
      type: 'frss-selectors',
      selectors: selectors
    }, '*');
    updateStatus('Seçimler tamamlandı ve aktarıldı!');
  };

  /**
   * Generates a CSS selector using: id > class > nth-of-type, max 4 levels
   */
  function generateCssSelector(el, root) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (root && el === root) return '';

    // Relative selector within selected item root
    if (root) {
      var tag = el.tagName.toLowerCase();
      var classes = Array.from(el.classList).filter(function(c) {
        return !c.startsWith('frss-');
      });

      // 1. Try class within root
      if (classes.length > 0) {
        var clsSel = tag + '.' + classes.slice(0, 2).map(CSS.escape).join('.');
        if (root.querySelectorAll(clsSel).length === 1) {
          return clsSel;
        }
      }

      // 2. Try simple tag within root
      if (root.querySelectorAll(tag).length === 1) {
        return tag;
      }

      // 3. Walk upwards up to 4 levels relative to root
      var path = [];
      var curr = el;
      var depth = 0;
      while (curr && curr !== root && curr !== document.body && depth < 4) {
        var cTag = curr.tagName.toLowerCase();
        if (curr.id) {
          cTag = '#' + CSS.escape(curr.id);
          path.unshift(cTag);
          break;
        }
        var cClasses = Array.from(curr.classList).filter(function(c) {
          return !c.startsWith('frss-');
        });
        if (cClasses.length > 0) {
          cTag += '.' + CSS.escape(cClasses[0]);
        } else if (curr.parentElement) {
          var siblings = Array.from(curr.parentElement.children).filter(function(s) {
            return s.tagName.toLowerCase() === cTag;
          });
          if (siblings.length > 1) {
            var index = siblings.indexOf(curr) + 1;
            cTag += ':nth-of-type(' + index + ')';
          }
        }
        path.unshift(cTag);
        curr = curr.parentElement;
        depth++;
      }
      return path.join(' > ');
    }

    // Absolute / container selector for 'item'
    var path = [];
    var curr = el;
    var depth = 0;

    while (curr && curr !== document.body && curr !== document.documentElement && depth < 4) {
      var tag = curr.tagName.toLowerCase();

      // 1. ID selector (if unique)
      if (curr.id && !/^\d/.test(curr.id)) {
        var idSel = '#' + CSS.escape(curr.id);
        if (document.querySelectorAll(idSel).length === 1) {
          path.unshift(idSel);
          break;
        }
      }

      // 2. Class selector
      var classes = Array.from(curr.classList).filter(function(c) {
        return !c.startsWith('frss-');
      });

      if (classes.length > 0) {
        var classSel = '.' + classes.slice(0, 2).map(CSS.escape).join('.');
        var matches = document.querySelectorAll(classSel);
        if (matches.length >= 2) {
          path.unshift(classSel);
          break;
        }
        var tagClassSel = tag + classSel;
        matches = document.querySelectorAll(tagClassSel);
        if (matches.length >= 2) {
          path.unshift(tagClassSel);
          break;
        }
      }

      // 3. nth-of-type fallback
      if (curr.parentElement) {
        var siblings = Array.from(curr.parentElement.children).filter(function(s) {
          return s.tagName.toLowerCase() === tag;
        });
        if (siblings.length > 1) {
          var index = siblings.indexOf(curr) + 1;
          tag += ':nth-of-type(' + index + ')';
        }
      }

      path.unshift(tag);
      curr = curr.parentElement;
      depth++;
    }

    var fullSel = path.join(' > ');
    return fullSel || el.tagName.toLowerCase();
  }

  // Hover Outline
  document.addEventListener('mouseover', function(e) {
    var target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.closest && target.closest('#frss-top-toolbar')) return;

    if (hoveredEl && hoveredEl !== target) {
      hoveredEl.classList.remove('frss-hovered');
    }
    hoveredEl = target;
    hoveredEl.classList.add('frss-hovered');
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('frss-hovered');
      hoveredEl = null;
    }
  }, true);

  // Click Selection
  document.addEventListener('click', function(e) {
    var target = e.target;
    if (!target || target === document.body || target === document.documentElement) return;
    if (target.closest && target.closest('#frss-top-toolbar')) return;

    e.preventDefault();
    e.stopPropagation();

    if (activeMode === 'item') {
      currentItemEl = target;
      var sel = generateCssSelector(target);
      selectors.itemSelector = sel;

      document.querySelectorAll('.frss-selected-item').forEach(function(el) {
        el.classList.remove('frss-selected-item');
      });
      try {
        var matches = document.querySelectorAll(sel);
        matches.forEach(function(el) {
          el.classList.add('frss-selected-item');
        });
      } catch (err) {}

      updateStatus('Öğe seçildi: ' + sel);

      // Post partial event
      window.parent.postMessage({
        type: 'frss-selectors-partial',
        mode: 'item',
        selector: sel,
        all: selectors
      }, '*');

      // Also send FETCHRSS_SELECT for compatibility
      window.parent.postMessage({
        type: 'FETCHRSS_SELECT',
        mode: 'item',
        selector: sel,
        matchedCount: document.querySelectorAll(sel).length
      }, '*');

      window.frssSetMode('title');
    } else {
      var container = currentItemEl;
      if (container && !container.contains(target)) {
        var allItems = document.querySelectorAll('.frss-selected-item');
        for (var i = 0; i < allItems.length; i++) {
          if (allItems[i].contains(target)) {
            container = allItems[i];
            break;
          }
        }
      }

      var relSel = generateCssSelector(target, container);
      var absSel = generateCssSelector(target);
      var finalSel = relSel || absSel;

      // Update selectors state
      var keyMap = {
        title: 'titleSelector',
        link: 'linkSelector',
        desc: 'descSelector',
        description: 'descSelector',
        image: 'imageSelector',
        date: 'dateSelector'
      };
      var targetKey = keyMap[activeMode] || (activeMode + 'Selector');
      selectors[targetKey] = finalSel;

      // Highlight class
      var clsMap = {
        title: 'frss-selected-title',
        link: 'frss-selected-link',
        desc: 'frss-selected-desc',
        image: 'frss-selected-image',
        date: 'frss-selected-date'
      };
      var cls = clsMap[activeMode] || 'frss-selected-title';
      document.querySelectorAll('.' + cls).forEach(function(el) {
        el.classList.remove(cls);
      });
      target.classList.add(cls);

      updateStatus(activeMode.toUpperCase() + ' seçildi: ' + finalSel);

      window.parent.postMessage({
        type: 'frss-selectors-partial',
        mode: activeMode,
        selector: finalSel,
        all: selectors
      }, '*');

      window.parent.postMessage({
        type: 'FETCHRSS_SELECT',
        mode: activeMode === 'desc' ? 'description' : activeMode,
        selector: absSel,
        relativeSelector: finalSel,
        textPreview: target.innerText ? target.innerText.trim().slice(0, 80) : ''
      }, '*');

      // Advance to next mode naturally
      var nextModes = {
        title: 'link',
        link: 'desc',
        desc: 'image',
        image: 'date'
      };
      if (nextModes[activeMode]) {
        window.frssSetMode(nextModes[activeMode]);
      }
    }
  }, true);

  // Parent message listener
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data) return;
    if (data.type === 'SET_MODE' && data.mode) {
      window.frssSetMode(data.mode);
    }
  });
})();
</script>
`;
}

/**
 * Strips script tags, meta refresh, inline handlers, adds <base href>,
 * and injects the interactive visual picker toolbar & script.
 */
export function buildProxiedHtml(originalHtml: string, targetUrl: string): string {
  const $ = cheerio.load(originalHtml);

  // Remove scripts, iframes, and embedding elements for isolation
  $('script, iframe, object, embed, noscript').remove();

  // Remove meta refresh to prevent redirection loops or bypasses
  $('meta[http-equiv="refresh" i]').remove();

  // Strip inline JavaScript attributes (onclick, onload, etc.)
  $('*').each((_, el) => {
    if (el.type === 'tag') {
      const attribs = el.attribs || {};
      for (const attr of Object.keys(attribs)) {
        if (attr.toLowerCase().startsWith('on')) {
          $(el).removeAttr(attr);
        }
      }
    }
  });

  // Ensure <base href="..."> is present in head so relative assets resolve properly
  if ($('head').length > 0) {
    $('head').prepend(`<base href="${targetUrl}">`);
  } else {
    $.root().prepend(`<head><base href="${targetUrl}"></head>`);
  }

  // Inject picker toolbar & script
  const injection = getPickerInjection();
  if ($('body').length > 0) {
    $('body').append(injection);
  } else {
    $.root().append(injection);
  }

  return $.html();
}

/**
 * Fetches page (via safeGet or Playwright browser) and produces sanitized, proxied HTML.
 */
export async function proxyHtmlForPicker(
  targetUrl: string,
  render?: boolean,
  waitSelector?: string
): Promise<string> {
  const rawHtml = await fetchPage(targetUrl, render, waitSelector);
  return buildProxiedHtml(rawHtml, targetUrl);
}

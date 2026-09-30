import * as cheerio from 'cheerio';
import { fetchPage } from './fetcher';

/**
 * Builds the visual picker script and stylesheet injected into the proxied HTML.
 */
function getPickerInjection(): string {
  return `
<style id="fetchrss-picker-styles">
  .fetchrss-hovered {
    outline: 2px dashed #2563eb !important;
    background-color: rgba(37, 99, 235, 0.08) !important;
    cursor: crosshair !important;
  }
  .fetchrss-selected-item {
    outline: 2px solid #16a34a !important;
    background-color: rgba(22, 163, 74, 0.06) !important;
  }
  .fetchrss-selected-title {
    outline: 2px solid #d97706 !important;
    background-color: rgba(217, 119, 6, 0.12) !important;
  }
  .fetchrss-selected-link {
    outline: 2px solid #9333ea !important;
    background-color: rgba(147, 51, 234, 0.12) !important;
  }
  .fetchrss-selected-desc {
    outline: 2px solid #0891b2 !important;
    background-color: rgba(8, 145, 178, 0.12) !important;
  }
  .fetchrss-selected-date {
    outline: 2px solid #dc2626 !important;
    background-color: rgba(220, 38, 38, 0.12) !important;
  }
  .fetchrss-selected-image {
    outline: 2px solid #ea580c !important;
    background-color: rgba(234, 88, 12, 0.12) !important;
  }
  #fetchrss-floating-badge {
    position: fixed;
    bottom: 12px;
    right: 12px;
    z-index: 2147483647;
    background: #1e293b;
    color: #f8fafc;
    padding: 8px 14px;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 13px;
    font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    border: 1px solid #475569;
    pointer-events: none;
    transition: opacity 0.2s;
  }
</style>
<div id="fetchrss-floating-badge">Seçici Hazır: Liste Öğesini Tıklayın</div>
<script id="fetchrss-picker-script">
(function() {
  var activeMode = 'item'; // 'item' | 'title' | 'link' | 'description' | 'date' | 'image'
  var hoveredEl = null;
  var currentItemEl = null;

  var badge = document.getElementById('fetchrss-floating-badge');
  function updateBadge(text) {
    if (badge) badge.innerText = text;
  }

  var modeLabels = {
    item: 'Seçim Modu: Liste Öğesi (Her Bir Haber/Kart)',
    title: 'Seçim Modu: Başlık',
    link: 'Seçim Modu: Bağlantı (Link)',
    description: 'Seçim Modu: Açıklama/İçerik',
    date: 'Seçim Modu: Tarih',
    image: 'Seçim Modu: Görsel (Resim)'
  };

  // Helper to generate a clean, robust CSS selector
  function getSelector(el, root) {
    if (!el || el === document.body || el === document.documentElement) return '';
    if (root && el === root) return '';

    // If root is provided, build relative selector
    if (root) {
      var tag = el.tagName.toLowerCase();
      var classes = Array.from(el.classList).filter(function(c) {
        return !c.startsWith('fetchrss-');
      });

      if (classes.length > 0) {
        var clsSel = tag + '.' + classes.slice(0, 2).map(CSS.escape).join('.');
        if (root.querySelectorAll(clsSel).length === 1) {
          return clsSel;
        }
      }

      // Check direct child or descendant tag
      if (root.querySelectorAll(tag).length === 1) {
        return tag;
      }

      // Build relative path up to root
      var path = [];
      var curr = el;
      while (curr && curr !== root && curr !== document.body) {
        var cTag = curr.tagName.toLowerCase();
        var cClasses = Array.from(curr.classList).filter(function(c) {
          return !c.startsWith('fetchrss-');
        });
        if (cClasses.length > 0) {
          cTag += '.' + cClasses.slice(0, 1).map(CSS.escape).join('.');
        }
        path.unshift(cTag);
        curr = curr.parentElement;
      }
      return path.join(' > ');
    }

    // Absolute / container selector for 'item'
    var tag = el.tagName.toLowerCase();
    var classes = Array.from(el.classList).filter(function(c) {
      return !c.startsWith('fetchrss-');
    });

    if (classes.length > 0) {
      var classSel = '.' + classes.map(CSS.escape).join('.');
      var matches = document.querySelectorAll(classSel);
      if (matches.length >= 2) {
        return classSel;
      }
      var tagClassSel = tag + classSel;
      matches = document.querySelectorAll(tagClassSel);
      if (matches.length >= 2) {
        return tagClassSel;
      }
    }

    // Check parent list item or container pattern
    if (el.parentElement) {
      var parentClasses = Array.from(el.parentElement.classList).filter(function(c) {
        return !c.startsWith('fetchrss-');
      });
      if (parentClasses.length > 0) {
        var parentSel = '.' + parentClasses.map(CSS.escape).join('.') + ' > ' + tag;
        if (document.querySelectorAll(parentSel).length >= 2) {
          return parentSel;
        }
      }
    }

    // Fallback: tag + first class or tag alone
    if (classes.length > 0) {
      return tag + '.' + CSS.escape(classes[0]);
    }
    return tag;
  }

  // Hover effect
  document.addEventListener('mouseover', function(e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('fetchrss-hovered');
    }
    var target = e.target;
    if (!target || target === document.body || target === document.documentElement || target.id === 'fetchrss-floating-badge') {
      return;
    }
    hoveredEl = target;
    hoveredEl.classList.add('fetchrss-hovered');
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (hoveredEl) {
      hoveredEl.classList.remove('fetchrss-hovered');
      hoveredEl = null;
    }
  }, true);

  // Click selection
  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();

    var target = e.target;
    if (!target || target === document.body || target === document.documentElement || target.id === 'fetchrss-floating-badge') {
      return;
    }

    if (activeMode === 'item') {
      currentItemEl = target;
      var selector = getSelector(target);

      // Highlight all matching items
      document.querySelectorAll('.fetchrss-selected-item').forEach(function(el) {
        el.classList.remove('fetchrss-selected-item');
      });
      try {
        var allItems = document.querySelectorAll(selector);
        allItems.forEach(function(el) {
          el.classList.add('fetchrss-selected-item');
        });
      } catch (err) {}

      window.parent.postMessage({
        type: 'FETCHRSS_SELECT',
        mode: 'item',
        selector: selector,
        relativeSelector: '',
        tagName: target.tagName.toLowerCase(),
        matchedCount: document.querySelectorAll(selector).length
      }, '*');

      updateBadge('Öğe Seçildi (' + selector + '). Şimdi Başlık veya Link seçebilirsiniz.');
    } else {
      // Sub-item selection relative to current item or container
      var container = currentItemEl;
      if (container && !container.contains(target)) {
        // Target is in another item or not in selected item; find closest match
        var allItems = document.querySelectorAll('.fetchrss-selected-item');
        for (var i = 0; i < allItems.length; i++) {
          if (allItems[i].contains(target)) {
            container = allItems[i];
            break;
          }
        }
      }

      var relSelector = getSelector(target, container);
      var absSelector = getSelector(target);

      // Apply highlight class for this mode
      var clsMap = {
        title: 'fetchrss-selected-title',
        link: 'fetchrss-selected-link',
        description: 'fetchrss-selected-desc',
        date: 'fetchrss-selected-date',
        image: 'fetchrss-selected-image'
      };
      var cls = clsMap[activeMode] || 'fetchrss-selected-title';
      document.querySelectorAll('.' + cls).forEach(function(el) {
        el.classList.remove(cls);
      });
      target.classList.add(cls);

      var previewText = target.innerText ? target.innerText.trim().slice(0, 100) : '';
      var linkVal = target.getAttribute('href') || (target.querySelector('a') ? target.querySelector('a').getAttribute('href') : '');
      var imgVal = target.getAttribute('src') || (target.querySelector('img') ? target.querySelector('img').getAttribute('src') : '');

      window.parent.postMessage({
        type: 'FETCHRSS_SELECT',
        mode: activeMode,
        selector: absSelector,
        relativeSelector: relSelector || absSelector,
        tagName: target.tagName.toLowerCase(),
        textPreview: previewText,
        linkVal: linkVal,
        imgVal: imgVal
      }, '*');

      updateBadge(activeMode.toUpperCase() + ' seçildi: ' + (relSelector || absSelector));
    }
  }, true);

  // Listen for messages from parent application
  window.addEventListener('message', function(event) {
    var data = event.data;
    if (!data || !data.type) return;

    if (data.type === 'SET_MODE') {
      activeMode = data.mode || 'item';
      updateBadge(modeLabels[activeMode] || 'Seçim Modu: ' + activeMode);
    } else if (data.type === 'HIGHLIGHT_SELECTOR') {
      try {
        if (data.selector && data.mode === 'item') {
          document.querySelectorAll('.fetchrss-selected-item').forEach(function(el) {
            el.classList.remove('fetchrss-selected-item');
          });
          document.querySelectorAll(data.selector).forEach(function(el) {
            el.classList.add('fetchrss-selected-item');
          });
        }
      } catch (e) {}
    }
  });
})();
</script>
`;
}

/**
 * Proxies target HTML page for visual CSS selection inside the iframe:
 * 1. Fetches HTML with SSRF check (via fetchPage).
 * 2. Strips all <script>, <iframe>, <object>, <embed> tags and inline script handlers.
 * 3. Injects <base href="..."> to load images, fonts, styles accurately.
 * 4. Injects interactive picker script and styling for element selection.
 */
export async function proxyHtmlForPicker(
  targetUrl: string,
  render?: boolean,
  waitSelector?: string
): Promise<string> {
  const rawHtml = await fetchPage(targetUrl, render, waitSelector);
  const $ = cheerio.load(rawHtml);

  // Remove existing scripts, iframes, and embedding elements for security and isolation
  $('script, iframe, object, embed, noscript').remove();

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

  // Inject picker script & CSS before closing </body> or at the end of the document
  const injection = getPickerInjection();
  if ($('body').length > 0) {
    $('body').append(injection);
  } else {
    $.root().append(injection);
  }

  return $.html();
}

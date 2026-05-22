(function () {
  "use strict";

  const REPO = "AbijahKaj/notetaker";

  const yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = String(new Date().getFullYear());

  // ────────────────────────────────────────────────────────────
  // DOWNLOAD BUTTONS — resolve to direct GitHub asset URL
  // ────────────────────────────────────────────────────────────

  const downloadBtns = [
    document.getElementById("download-btn"),
    document.getElementById("download-btn-2"),
  ].filter(Boolean);
  const downloadMeta = document.getElementById("download-meta");
  const heroVersion = document.getElementById("hero-version");

  function setBtnLabel(btn, label) {
    const span = btn.querySelector(".btn-label");
    if (span) span.textContent = label;
    else btn.textContent = label;
  }

  function activateButton(btn, href, label, filename) {
    btn.href = href;
    btn.removeAttribute("aria-disabled");
    btn.setAttribute("download", filename || "");
    setBtnLabel(btn, label);
  }

  function fallbackToReleases() {
    downloadBtns.forEach((btn) => {
      btn.href = "https://github.com/" + REPO + "/releases";
      btn.removeAttribute("aria-disabled");
      btn.removeAttribute("download");
      btn.removeAttribute("target");
      btn.target = "_blank";
      setBtnLabel(btn, "Browse releases on GitHub");
    });
    if (downloadMeta) {
      downloadMeta.textContent = "No installer published yet — check back soon.";
    }
  }

  function formatBytes(n) {
    if (!n) return "";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function pickAsset(assets) {
    if (!assets || !assets.length) return null;
    return (
      assets.find((a) => /\.dmg$/i.test(a.name)) ||
      assets.find((a) => /\.zip$/i.test(a.name)) ||
      null
    );
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((r) => {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    })
    .then((release) => {
      const asset = pickAsset(release.assets || []);
      if (!asset) {
        fallbackToReleases();
        return;
      }
      const label = "Download " + release.tag_name + " for macOS";
      downloadBtns.forEach((btn) => {
        activateButton(btn, asset.browser_download_url, label, asset.name);
      });
      if (heroVersion) heroVersion.textContent = release.tag_name;
      const arch = /arm64|apple|silicon/i.test(asset.name) ? "Apple Silicon" : "Universal";
      if (downloadMeta) {
        downloadMeta.textContent = arch + " · " + formatBytes(asset.size) + " · macOS 14.2+";
      }
    })
    .catch(() => {
      fallbackToReleases();
    });

  // ────────────────────────────────────────────────────────────
  // LIVE TRANSCRIPT DEMO — mock animation
  // ────────────────────────────────────────────────────────────

  const demoBody = document.getElementById("demo-body");
  const demoCounter = document.getElementById("demo-counter");
  if (!demoBody) return;

  const SCRIPT = [
    { t: 12, who: "Anna", cls: "anna", text: "Quick standup before we kick off." },
    { t: 18, who: "You", cls: "you", text: "Sounds good — I've got the deploy ready." },
    { t: 24, who: "Anna", cls: "anna", text: "Did you finish the auth migration?" },
    { t: 31, who: "You", cls: "you", text: "Yep, rolled it out this morning. No errors so far." },
    { t: 38, who: "Mark", cls: "mark", text: "Numbers from last week — we're up 14% week-over-week." },
    { t: 46, who: "Anna", cls: "anna", text: "Nice. Let's ship the marketing email today." },
  ];

  const MAX_VISIBLE = 5;
  const TYPE_SPEED_MS = 22; // per character
  const PAUSE_AFTER_LINE_MS = 900;
  const RESTART_DELAY_MS = 2400;

  function fmtTime(secs) {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
  }

  let cancelled = false;
  let counterTimer = null;

  function startCounter(fromSec, toSec, durationMs) {
    if (counterTimer) clearInterval(counterTimer);
    const start = performance.now();
    counterTimer = setInterval(() => {
      const elapsed = performance.now() - start;
      const ratio = Math.min(1, elapsed / durationMs);
      const cur = Math.round(fromSec + (toSec - fromSec) * ratio);
      if (demoCounter) demoCounter.textContent = fmtTime(cur);
      if (ratio >= 1 && counterTimer) {
        clearInterval(counterTimer);
        counterTimer = null;
      }
    }, 80);
  }

  function createLine(entry) {
    const row = document.createElement("div");
    row.className = "demo-line";

    const time = document.createElement("span");
    time.className = "demo-time";
    time.textContent = fmtTime(entry.t);

    const speaker = document.createElement("span");
    speaker.className = "demo-speaker " + entry.cls;
    speaker.textContent = entry.who;

    const text = document.createElement("span");
    text.className = "demo-text";

    row.appendChild(time);
    row.appendChild(speaker);
    row.appendChild(text);
    return { row, textEl: text };
  }

  function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
  }

  async function typewriter(el, text) {
    const caret = document.createElement("span");
    caret.className = "demo-caret";
    el.textContent = "";
    el.appendChild(caret);
    for (let i = 0; i < text.length; i++) {
      if (cancelled) return;
      caret.before(document.createTextNode(text[i]));
      await sleep(TYPE_SPEED_MS);
    }
    if (caret.parentNode) caret.parentNode.removeChild(caret);
  }

  async function play() {
    while (!cancelled) {
      demoBody.textContent = "";
      if (demoCounter) demoCounter.textContent = "00:00";

      let prevT = 0;
      for (let i = 0; i < SCRIPT.length; i++) {
        if (cancelled) return;
        const entry = SCRIPT[i];
        const { row, textEl } = createLine(entry);
        demoBody.appendChild(row);

        // trim if too many lines
        while (demoBody.children.length > MAX_VISIBLE) {
          demoBody.removeChild(demoBody.firstElementChild);
        }

        // animate the timestamp counter while this line types
        const typeDuration = entry.text.length * TYPE_SPEED_MS + 200;
        startCounter(prevT, entry.t, typeDuration);
        prevT = entry.t;

        await typewriter(textEl, entry.text);
        await sleep(PAUSE_AFTER_LINE_MS);
      }

      await sleep(RESTART_DELAY_MS);
    }
  }

  // Only animate when visible (saves CPU when offscreen)
  let started = false;
  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && !started) {
        started = true;
        play();
      }
    }
  }, { threshold: 0.2 });

  observer.observe(demoBody);

  // Pause on tab hidden
  document.addEventListener("visibilitychange", () => {
    cancelled = document.hidden;
    if (!document.hidden && started) {
      cancelled = false;
    }
  });
})();

(function () {
  const REPO = "AbijahKaj/notetaker";
  const downloadBtn = document.getElementById("download-btn");
  const meta = document.getElementById("download-meta");
  const year = document.getElementById("year");

  if (year) year.textContent = new Date().getFullYear();

  if (!downloadBtn || !meta) return;

  function bytes(n) {
    if (!n) return "";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
    headers: { Accept: "application/vnd.github+json" },
  })
    .then((r) => {
      if (!r.ok) throw new Error("status " + r.status);
      return r.json();
    })
    .then((release) => {
      const assets = release.assets || [];
      const dmg = assets.find((a) => /\.dmg$/i.test(a.name));
      const zip = assets.find((a) => /\.zip$/i.test(a.name));
      const asset = dmg || zip;
      if (!asset) {
        meta.textContent = "No macOS installer in the latest release yet.";
        return;
      }
      downloadBtn.href = asset.browser_download_url;
      downloadBtn.textContent = "Download " + release.tag_name + " for macOS";
      const arch = /arm64|apple/i.test(asset.name) ? "Apple Silicon" : "Universal";
      meta.innerHTML =
        "<span>" +
        arch +
        " · " +
        bytes(asset.size) +
        " · </span>" +
        '<a href="https://github.com/' +
        REPO +
        '/releases" style="color: inherit; text-decoration: underline;">all releases</a>';
    })
    .catch(() => {
      meta.innerHTML =
        '<a href="https://github.com/' +
        REPO +
        '/releases" style="color: inherit; text-decoration: underline;">Browse releases on GitHub →</a>';
    });
})();

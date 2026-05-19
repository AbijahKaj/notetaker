export const PARAKEET_LANGUAGES = new Set<string>([
  "bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de",
  "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "ru",
  "sk", "sl", "es", "sv", "uk",
]);

export function isParakeetLanguage(lang: string): boolean {
  return PARAKEET_LANGUAGES.has(lang.toLowerCase().split(/[-_]/)[0] ?? "");
}

export const APP_NAMES: Record<string, string> = {
  "us.zoom.xos": "Zoom",
  "com.microsoft.teams2": "Microsoft Teams",
  "com.tinyspeck.slackmacgap": "Slack",
  "com.apple.FaceTime": "FaceTime",
  "com.hnc.Discord": "Discord",
  "com.cisco.webexmeetingsapp": "Webex",
  "com.skype.skype": "Skype",
  "com.google.Chrome": "Google Chrome",
  "company.thebrowser.Browser": "Arc",
  "com.apple.Safari": "Safari",
  "com.microsoft.edgemac": "Microsoft Edge",
  "com.brave.Browser": "Brave",
  "com.vivaldi.Vivaldi": "Vivaldi",
};

export const APP_PATHS: Record<string, string> = {
  "us.zoom.xos": "/Applications/zoom.us.app",
  "com.microsoft.teams2": "/Applications/Microsoft Teams.app",
  "com.tinyspeck.slackmacgap": "/Applications/Slack.app",
  "com.apple.FaceTime": "/System/Applications/FaceTime.app",
  "com.hnc.Discord": "/Applications/Discord.app",
  "com.cisco.webexmeetingsapp": "/Applications/Webex.app",
};

export const BROWSER_BUNDLE_IDS = new Set<string>([
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "com.apple.Safari",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
]);

/** AppleScript one-liners to read the active tab URL (requires Automation permission). */
export const BROWSER_URL_SCRIPTS: Record<string, string> = {
  "com.google.Chrome": 'tell application "Google Chrome" to get URL of active tab of front window',
  "com.apple.Safari": 'tell application "Safari" to get URL of current tab of front window',
  "com.microsoft.edgemac": 'tell application "Microsoft Edge" to get URL of active tab of front window',
  "company.thebrowser.Browser": 'tell application "Arc" to get URL of active tab of front window',
  "com.brave.Browser": 'tell application "Brave Browser" to get URL of active tab of front window',
  "com.vivaldi.Vivaldi": 'tell application "Vivaldi" to get URL of active tab of front window',
};

export function matchSiteWhitelist(url: string, sites: string[]): string | null {
  for (const site of sites) {
    const trimmed = site.trim().toLowerCase();
    if (!trimmed) continue;

    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();

      if (trimmed.includes("/")) {
        const full = `${host}${parsed.pathname}${parsed.search}`.toLowerCase();
        if (full.includes(trimmed)) return site;
        continue;
      }

      if (host === trimmed || host.endsWith(`.${trimmed}`)) return site;
    } catch {
      if (url.toLowerCase().includes(trimmed)) return site;
    }
  }

  return null;
}

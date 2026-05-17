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
};

export const BROWSER_BUNDLE_IDS = new Set<string>([
  "com.google.Chrome",
  "company.thebrowser.Browser",
  "com.apple.Safari",
  "com.microsoft.edgemac",
  "com.brave.Browser",
  "com.vivaldi.Vivaldi",
]);

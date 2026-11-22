/** Universities offered as one-click choices in the member forms. Any other name can still be typed. */
export const QUICK_UNIVERSITIES = ["Eastern University"] as const;

/** One spelling per university: surplus spaces are removed and a quick-choice name typed in any letter case is stored as written in the list. */
export function canonicalUniversity(raw: string): string {
  const name = raw.replace(/\s+/g, " ").trim();
  return QUICK_UNIVERSITIES.find((u) => u.toLowerCase() === name.toLowerCase()) ?? name;
}

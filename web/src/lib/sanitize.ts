/** PostgreSQL text cannot contain NUL (U+0000); one in a search term would turn into a 500. Search input is cleaned with this. */
export const stripNul = (s: string): string => s.replace(/\u0000/g, "");

// GitHub contribution calendar — BUILD-TIME SNAPSHOT (public data).
//
// This is a baked snapshot of Andrew Boldi's public GitHub contribution graph,
// so the static site needs no runtime API call or token. It is PUBLIC info
// (his public GitHub activity), so it is fine to publish here.
//
// TO REFRESH: re-run the authenticated `gh` CLI GraphQL query and paste the
// resulting totals/weeks back into this file:
//
//   gh api graphql -f query='query { user(login: "andrewboldi") {
//     contributionsCollection { contributionCalendar {
//       totalContributions
//       weeks { contributionDays { date contributionCount weekday } }
//     } } } }'
//
// `weeks` is a flat array of weeks; each week is an array of up to 7 daily
// contribution counts (Sunday → Saturday). The most recent week may be partial.
// `firstDay` is the date (YYYY-MM-DD) of the first cell (top-left), letting the
// renderer label/derive dates without storing one string per day.

export interface ContributionData {
  /** Total contributions across the snapshot window (the last ~year). */
  totalContributions: number;
  /** Date (YYYY-MM-DD) of the very first day cell — Sunday of the first column. */
  firstDay: string;
  /** Date (YYYY-MM-DD) of the most recent day cell. */
  lastDay: string;
  /** Weeks (columns), each a list of up to 7 daily counts (Sun→Sat). */
  weeks: number[][];
}

export const CONTRIBUTIONS: ContributionData = {
  totalContributions: 2488,
  firstDay: '2025-06-08',
  lastDay: '2026-06-11',
  weeks: [[0,0,0,0,0,0,0],[0,0,0,0,0,0,1],[0,2,0,0,0,0,0],[0,0,8,2,0,0,0],[2,2,6,0,0,0,0],[0,0,11,11,2,5,0],[0,1,0,1,0,0,2],[0,0,0,1,0,0,0],[0,0,0,0,0,0,0],[2,0,0,0,0,0,0],[0,0,2,0,1,0,0],[0,0,0,0,0,6,2],[0,0,0,3,0,0,0],[0,0,0,1,1,0,0],[0,0,0,0,4,1,4],[0,5,0,0,3,0,0],[0,0,0,0,2,0,0],[0,0,2,0,0,2,1],[0,0,0,0,1,1,0],[0,0,0,0,0,0,0],[2,8,3,0,2,0,2],[0,0,0,0,0,0,0],[0,0,11,2,5,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,2,2],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,0,0,0,0,0],[0,0,5,0,0,0,0],[0,5,9,0,5,20,0],[5,26,2,10,7,0,0],[0,0,16,2,0,2,0],[0,0,1,18,11,0,0],[0,0,0,0,0,0,0],[0,0,0,7,0,0,1],[0,0,0,0,0,0,0],[0,0,12,0,2,2,5],[5,0,0,0,26,12,40],[80,29,71,76,18,37,137],[7,6,14,5,1,108,6],[63,19,17,2,2,0,57],[29,4,21,0,2,9,5],[4,5,0,1,15,88,87],[34,48,62,14,13,37,0],[0,0,0,0,0,1,0],[1,3,36,9,28,33,3],[5,0,2,0,1,5,393],[18,130,34,157,0]],
};

/**
 * Map a raw daily contribution count to a 0–4 intensity bucket for the heatmap.
 * 0 = no contributions; 1–4 = increasing intensity. Thresholds are tuned for
 * Andrew's range (many quiet days, occasional very high days).
 */
export function intensityLevel(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count < 3) return 1;
  if (count < 8) return 2;
  if (count < 20) return 3;
  return 4;
}

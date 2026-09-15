export interface RiskSignal {
  key: string;
  label: string;
  points: number;
  detail: string;
}

/**
 * Explainable risk: returns score + contributing signals,
 * never just a bare High/Medium/Low tag.
 */
export function explainRisk(args: {
  centrality?: number;          // 0..1 network centrality
  repeatPatterns?: number;      // count of repeat modus matches
  linkedCases?: number;         // cross-case appearances
  financialFlags?: number;      // flagged transactions
  recentActivityDays?: number;  // days since last activity
}): { score: number; level: 'low' | 'medium' | 'high'; signals: RiskSignal[] } {
  const signals: RiskSignal[] = [];
  let score = 10;

  if ((args.centrality ?? 0) >= 0.8) {
    score += 30;
    signals.push({ key: 'centrality', label: 'Network centrality', points: 30, detail: `Centrality ${(args.centrality ?? 0).toFixed(2)} — removal fragments network` });
  } else if ((args.centrality ?? 0) >= 0.5) {
    score += 15;
    signals.push({ key: 'centrality', label: 'Network centrality', points: 15, detail: `Centrality ${(args.centrality ?? 0).toFixed(2)} — elevated influence` });
  }
  if ((args.repeatPatterns ?? 0) >= 3) {
    score += 25;
    signals.push({ key: 'repeat', label: 'Repeat pattern matches', points: 25, detail: `${args.repeatPatterns} repeat modus matches across events` });
  } else if ((args.repeatPatterns ?? 0) >= 1) {
    score += 10;
    signals.push({ key: 'repeat', label: 'Repeat pattern matches', points: 10, detail: `${args.repeatPatterns} modus match(es)` });
  }
  if ((args.linkedCases ?? 0) >= 2) {
    score += 20;
    signals.push({ key: 'crosscase', label: 'Links to past cases', points: 20, detail: `Appears in ${args.linkedCases} cases — possible larger network` });
  } else if ((args.linkedCases ?? 0) >= 1) {
    score += 8;
    signals.push({ key: 'crosscase', label: 'Links to past cases', points: 8, detail: `Appears in ${args.linkedCases} other case(s)` });
  }
  if ((args.financialFlags ?? 0) >= 2) {
    score += 20;
    signals.push({ key: 'financial', label: 'Flagged financial flows', points: 20, detail: `${args.financialFlags} flagged transfers (circular/rapid)` });
  } else if ((args.financialFlags ?? 0) >= 1) {
    score += 10;
    signals.push({ key: 'financial', label: 'Flagged financial flows', points: 10, detail: `${args.financialFlags} flagged transfer(s)` });
  }
  if ((args.recentActivityDays ?? 99) <= 2) {
    score += 5;
    signals.push({ key: 'recency', label: 'Recent activity', points: 5, detail: `Active within last ${args.recentActivityDays} day(s)` });
  }

  score = Math.max(0, Math.min(100, score));
  const level = score >= 75 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score, level, signals };
}

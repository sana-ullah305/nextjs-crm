export type LeadScoreInput = {
  email: string;
  phone: string;
  companyName: string;
  estimatedValue: number;
  sourceName: string;
  hasFollowUp: boolean;
};

/**
 * Lead score 0-100. Deterministic, explainable points model:
 *  - Reachability (email + phone): 30
 *  - Company association: 15
 *  - Deal size: 25
 *  - Source quality: 20
 *  - Follow-up engagement: 10
 */
export function scoreLead(lead: LeadScoreInput): number {
  let score = 0;

  if (lead.email) score += 20;
  if (lead.phone) score += 10;

  if (lead.companyName) score += 15;

  if (lead.estimatedValue >= 50_000) score += 25;
  else if (lead.estimatedValue >= 10_000) score += 18;
  else if (lead.estimatedValue >= 1_000) score += 10;
  else if (lead.estimatedValue > 0) score += 5;

  const sourceWeights: Record<string, number> = {
    Referral: 20,
    "Partner Network": 16,
    "Inbound Demo": 15,
    "Trade Show": 12,
    Website: 10,
    "Cold Call": 6,
    "Purchased List": 3,
  };
  score += lead.sourceName ? (sourceWeights[lead.sourceName] ?? 8) : 0;

  if (lead.hasFollowUp) score += 10;

  return Math.max(0, Math.min(100, score));
}

export function scoreBand(score: number): "HOT" | "WARM" | "COLD" {
  if (score >= 70) return "HOT";
  if (score >= 40) return "WARM";
  return "COLD";
}

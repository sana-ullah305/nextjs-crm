import {
  emailLocalPart,
  normalizeCompany,
  normalizeEmail,
  normalizeName,
} from "@/lib/dedupe-normalize";
import { api } from "@/lib/api-client";

export const CANDIDATE_THRESHOLD = 35;

export type DuplicateSubject = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  companyName: string;
};

export type DuplicateCandidate = {
  id: string;
  type: "contact" | "lead";
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  company: string;
  createdAt: string;
  score: number;
  matchReasons: string[];
};

type ContactRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  createdAt: string;
  company: { id: string; name: string } | null;
};

type LeadRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  status: string;
  companyName: string;
  contactId: string | null;
  createdAt: string;
};

type Scorable = {
  firstName: string;
  lastName: string;
  email: string;
  company: string;
};

function scoreCandidate(
  subject: DuplicateSubject,
  candidate: Scorable
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  const subjectEmail = normalizeEmail(subject.email);
  const candidateEmail = normalizeEmail(candidate.email);
  const subjectLastName = normalizeName(subject.lastName);
  const candidateLastName = normalizeName(candidate.lastName);

  if (subjectEmail && candidateEmail) {
    if (subjectEmail === candidateEmail) {
      score += 100;
      reasons.push("email_exact");
    } else if (
      emailLocalPart(subjectEmail) === emailLocalPart(candidateEmail) &&
      subjectLastName === candidateLastName
    ) {
      score += 55;
      reasons.push("email_local_part+last_name");
    }
  }

  const subjectFullName = normalizeName(`${subject.firstName} ${subject.lastName}`);
  const candidateFullName = normalizeName(`${candidate.firstName} ${candidate.lastName}`);
  if (subjectFullName && candidateFullName && subjectFullName === candidateFullName) {
    score += 45;
    reasons.push("first+last_name");
  }

  const subjectCompany = normalizeCompany(subject.companyName);
  const candidateCompany = normalizeCompany(candidate.company);
  if (
    subjectCompany &&
    candidateCompany &&
    subjectCompany === candidateCompany &&
    subjectLastName === candidateLastName
  ) {
    score += 35;
    reasons.push("company+last_name");
  }

  return { score: Math.min(score, 100), reasons };
}

async function searchTerm(
  term: string,
  subject: DuplicateSubject,
  byKey: Map<string, DuplicateCandidate>
): Promise<void> {
  const encoded = encodeURIComponent(term);
  const [cRes, lRes] = await Promise.allSettled([
    api.get<{ contacts: ContactRow[] }>(`/api/contacts?q=${encoded}&pageSize=100`),
    api.get<{ leads: LeadRow[] }>(`/api/leads?q=${encoded}&pageSize=100`),
  ]);

  if (cRes.status === "fulfilled") {
    for (const c of cRes.value.contacts) {
      if (subject.type === "contact" && c.id === subject.id) continue;
      const key = `contact:${c.id}`;
      if (byKey.has(key)) continue;
      const { score, reasons } = scoreCandidate(subject, {
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        company: c.company?.name ?? "",
      });
      if (score < CANDIDATE_THRESHOLD) continue;
      byKey.set(key, {
        id: c.id,
        type: "contact",
        firstName: c.firstName,
        lastName: c.lastName,
        email: c.email,
        phone: c.phone,
        status: c.status,
        company: c.company?.name ?? "",
        createdAt: c.createdAt,
        score,
        matchReasons: reasons,
      });
    }
  }

  if (lRes.status === "fulfilled") {
    for (const l of lRes.value.leads) {
      if (subject.type === "lead" && l.id === subject.id) continue;
      if (l.status === "CONVERTED" || l.contactId) continue;
      const key = `lead:${l.id}`;
      if (byKey.has(key)) continue;
      const { score, reasons } = scoreCandidate(subject, {
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        company: l.companyName,
      });
      if (score < CANDIDATE_THRESHOLD) continue;
      byKey.set(key, {
        id: l.id,
        type: "lead",
        firstName: l.firstName,
        lastName: l.lastName,
        email: l.email,
        phone: l.phone,
        status: l.status,
        company: l.companyName,
        createdAt: l.createdAt,
        score,
        matchReasons: reasons,
      });
    }
  }
}

export async function findDuplicateCandidatesClient(
  subject: DuplicateSubject
): Promise<DuplicateCandidate[]> {
  const terms = Array.from(
    new Set(
      [subject.email, subject.lastName]
        .map((t) => t.trim())
        .filter((t) => t.length >= 2)
    )
  );
  const byKey = new Map<string, DuplicateCandidate>();
  for (const term of terms) {
    try {
      await searchTerm(term, subject, byKey);
    } catch {
      // A failed search term just yields fewer candidates.
    }
  }
  return Array.from(byKey.values()).sort((a, b) => b.score - a.score);
}

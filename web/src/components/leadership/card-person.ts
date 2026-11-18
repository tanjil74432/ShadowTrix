import type { CardPerson } from "./leadership-card";

/** The public fields of one person from `getPublicTeam()`, as the card needs them. */
export interface PublicPersonLike {
  id: string;
  name: string;
  designation: string;
  term: string | null;
  department: string | null;
  bio: string | null;
  skills: string[];
  hasPhoto: boolean;
  photoVersion: string | null;
  links: { linkedin: string | null; github: string | null; portfolio: string | null };
  /** Already null unless the member made it public. */
  email: string | null;
}

/** The portrait URL is the public photo route; the version only busts the browser cache when a portrait is replaced. */
export function toCardPerson(p: PublicPersonLike, unitName: string | null): CardPerson {
  return {
    id: p.id, name: p.name, designation: p.designation, unitName, term: p.term, department: p.department, bio: p.bio, skills: p.skills, links: p.links, email: p.email,
    photoSrc: p.hasPhoto ? `/api/v1/org-members/${p.id}/photo${p.photoVersion ? `?v=${p.photoVersion}` : ""}` : null,
  };
}

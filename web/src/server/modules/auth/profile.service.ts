import "server-only";
import { getDb } from "@/server/db/client";
import { writeAudit } from "@/server/modules/audit/audit.service";

export async function updateOwnProfile(userId: string, input: { fullName: string; bio?: string | null }) {
  const user = await getDb().user.update({
    where: { id: userId },
    data: { fullName: input.fullName, ...(input.bio !== undefined ? { bio: input.bio } : {}) },
    select: { id: true, fullName: true, bio: true },
  });
  await writeAudit({ actorId: userId, action: "account.profile_updated", entityType: "user", entityId: userId });
  return user;
}

/** The signed-in user's own profile fields (never another user's). */
export async function getOwnProfile(userId: string) {
  return getDb().user.findUniqueOrThrow({ where: { id: userId }, select: { bio: true, email: true } });
}

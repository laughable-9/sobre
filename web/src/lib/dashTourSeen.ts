import { makeSeenFlag } from "@/lib/seenFlag";

/**
 * Persistence for the in-app dashboard tour (the coach-mark walkthrough
 * of the real dashboard buttons). Separate from the pre-login AppTour
 * marketing slides, which use their own key.
 */
export const dashTourSeen = makeSeenFlag("sobre-dash-tour-seen");

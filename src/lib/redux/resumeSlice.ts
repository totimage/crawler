// Shim: only the constant the OpenResume parser needs (original pulls in Redux).
import type { FeaturedSkill } from "lib/redux/types";
export const initialFeaturedSkill: FeaturedSkill = { skill: "", rating: 4 };
export const initialFeaturedSkills: FeaturedSkill[] = Array(6).fill({ ...initialFeaturedSkill });

/** Barrel for landing section components, so screens/Landing.tsx reads as a
 *  clean composition of named sections. The hero + product visual are composed
 *  directly in Landing (it owns the sticky CTA layout); SplitCard is imported
 *  on its own path since it isn't a full-width section. */

export { ProblemStats } from "./ProblemStats";
export { HowItWorks } from "./HowItWorks";
export { Trust } from "./Trust";
export { TwoSides } from "./TwoSides";
export { FinalCTA } from "./FinalCTA";
export { Footer } from "./Footer";

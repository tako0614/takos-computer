// Barrel re-export for skills modules

// Types and constants
export type {
  SkillSource,
  SkillCategory,
  SkillAvailabilityStatus,
  SkillAvailabilityContext,
  SkillCatalogEntry,
  SkillContext,
  SkillSelection,
  SkillResolutionContext,
  ResolvedSkillPlan,
} from './types.ts';

// Availability
export {
  cloneExecutionContract,
  toSkillCatalogEntry,
  evaluateSkillAvailability,
  applySkillAvailability,
} from './availability.ts';

// Scoring
export { selectRelevantSkills } from './scoring.ts';

// Activation and prompt building
export {
  activateSelectedSkills,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
} from './activation.ts';

// Loader (async, DB-dependent)
export type { SkillLoadResult } from './loader.ts';
export {
  loadEquippedSkills,
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
  emitSkillLoadOutcome,
} from './loader.ts';

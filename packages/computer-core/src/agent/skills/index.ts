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
} from './types';

// Availability
export {
  cloneExecutionContract,
  toSkillCatalogEntry,
  evaluateSkillAvailability,
  applySkillAvailability,
} from './availability';

// Scoring
export { selectRelevantSkills } from './scoring';

// Activation and prompt building
export {
  activateSelectedSkills,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,
} from './activation';

// Loader (async, DB-dependent)
export type { SkillLoadResult } from './loader';
export {
  loadEquippedSkills,
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
  emitSkillLoadOutcome,
} from './loader';

/**
 * Entry point for the skills module.
 *
 * Implementation is split across focused files under ./skills/:
 *   - types.ts        : shared interfaces, type aliases, and constants
 *   - availability.ts : availability evaluation and contract cloning
 *   - scoring.ts      : trigger/keyword matching and skill scoring
 *   - activation.ts   : skill activation, prompt building, plan resolution
 *   - loader.ts       : async DB-dependent loading and event emission
 */
export {
  // Types
  type SkillSource,
  type SkillCategory,
  type SkillAvailabilityStatus,
  type SkillAvailabilityContext,
  type SkillCatalogEntry,
  type SkillContext,
  type SkillSelection,
  type SkillResolutionContext,
  type ResolvedSkillPlan,

  // Availability
  cloneExecutionContract,
  toSkillCatalogEntry,
  evaluateSkillAvailability,
  applySkillAvailability,

  // Scoring
  selectRelevantSkills,

  // Activation
  activateSelectedSkills,
  buildSkillEnhancedPrompt,
  resolveSkillPlan,

  // Loader
  type SkillLoadResult,
  loadEquippedSkills,
  buildSkillResolutionContext,
  resolveSkillPlanForRun,
  emitSkillLoadOutcome,
} from './skills/index.ts';

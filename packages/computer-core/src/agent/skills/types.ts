import type {
  SkillCategory,
  SkillExecutionContract,
  SkillLocale,
  SkillSource,
  CustomSkillMetadata,
} from '../skill-contracts';

export type { SkillSource, SkillCategory } from '../skill-contracts';
export type SkillAvailabilityStatus = 'available' | 'warning' | 'unavailable';

export interface SkillAvailabilityContext {
  availableToolNames?: string[];
  availableMcpServerNames?: string[];
  availableTemplateIds?: string[];
}

export interface SkillCatalogEntry {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  source: SkillSource;
  category?: SkillCategory;
  locale?: SkillLocale;
  version?: string;
  activation_tags?: string[];
  execution_contract: SkillExecutionContract;
  availability: SkillAvailabilityStatus;
  availability_reasons: string[];
}

export interface SkillContext extends SkillCatalogEntry {
  instructions: string;
  priority?: number;
  metadata?: CustomSkillMetadata;
}

export interface SkillSelection {
  skill: SkillContext;
  score: number;
  reasons: string[];
}

export interface SkillResolutionContext {
  conversation: string[];
  threadTitle?: string | null;
  threadSummary?: string | null;
  threadKeyPoints?: string[];
  runInput?: Record<string, unknown>;
  agentType?: string;
  workspaceLocale?: string | null;
  preferredLocale?: string | null;
  acceptLanguage?: string | null;
  maxSelected?: number;
  availableToolNames?: string[];
  availableMcpServerNames?: string[];
  availableTemplateIds?: string[];
}

export interface ResolvedSkillPlan {
  locale: SkillLocale;
  availableSkills: SkillCatalogEntry[];
  selectableSkills: SkillCatalogEntry[];
  selectedSkills: SkillSelection[];
  activatedSkills: SkillContext[];
}

export const MAX_SKILL_NAME_LENGTH = 200;
export const MAX_SKILL_DESCRIPTION_LENGTH = 2000;
export const MAX_SKILL_INSTRUCTIONS_LENGTH = 50000;
export const MAX_SKILL_TRIGGER_LENGTH = 100;
export const MAX_SELECTED_SKILLS_PER_RUN = 8;

export const CONVERSATION_WINDOW = 8;
export const MESSAGE_RECENCY_WEIGHTS = [1.3, 1.1, 0.95, 0.8, 0.6, 0.45, 0.35, 0.25];

export const DEFAULT_EXECUTION_CONTRACT: SkillExecutionContract = {
  preferred_tools: [],
  durable_output_hints: [],
  output_modes: ['chat'],
  required_mcp_servers: [],
  template_ids: [],
};

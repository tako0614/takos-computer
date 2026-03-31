import type { SkillExecutionContract } from '../skill-contracts.ts';
import type {
  SkillAvailabilityContext,
  SkillCatalogEntry,
  SkillContext,
} from './types.ts';
import { DEFAULT_EXECUTION_CONTRACT } from './types.ts';

export function cloneExecutionContract(contract?: Partial<SkillExecutionContract> | null): SkillExecutionContract {
  return {
    preferred_tools: [...(contract?.preferred_tools ?? DEFAULT_EXECUTION_CONTRACT.preferred_tools)],
    durable_output_hints: [...(contract?.durable_output_hints ?? DEFAULT_EXECUTION_CONTRACT.durable_output_hints)],
    output_modes: [...(contract?.output_modes ?? DEFAULT_EXECUTION_CONTRACT.output_modes)],
    required_mcp_servers: [...(contract?.required_mcp_servers ?? DEFAULT_EXECUTION_CONTRACT.required_mcp_servers)],
    template_ids: [...(contract?.template_ids ?? DEFAULT_EXECUTION_CONTRACT.template_ids)],
  };
}

export function toSkillCatalogEntry(skill: SkillContext): SkillCatalogEntry {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    triggers: [...skill.triggers],
    source: skill.source,
    category: skill.category,
    locale: skill.locale,
    version: skill.version,
    activation_tags: [...(skill.activation_tags ?? [])],
    execution_contract: cloneExecutionContract(skill.execution_contract),
    availability: skill.availability,
    availability_reasons: [...skill.availability_reasons],
  };
}

export function evaluateSkillAvailability(
  skill: SkillContext,
  input: SkillAvailabilityContext,
): Pick<SkillCatalogEntry, 'availability' | 'availability_reasons'> {
  const reasons: string[] = [];
  const requiredMcpServers = new Set(input.availableMcpServerNames ?? []);
  const availableTemplateIds = new Set(input.availableTemplateIds ?? []);
  const availableToolNames = input.availableToolNames ? new Set(input.availableToolNames) : null;

  const missingRequiredMcpServers = skill.execution_contract.required_mcp_servers.filter((name) => !requiredMcpServers.has(name));
  if (missingRequiredMcpServers.length > 0) {
    reasons.push(`missing required MCP servers: ${missingRequiredMcpServers.join(', ')}`);
  }

  const missingTemplates = skill.execution_contract.template_ids.filter((templateId) => !availableTemplateIds.has(templateId));
  if (missingTemplates.length > 0) {
    reasons.push(`missing required templates: ${missingTemplates.join(', ')}`);
  }

  const missingPreferredTools = availableToolNames
    ? skill.execution_contract.preferred_tools.filter((toolName) => !availableToolNames.has(toolName))
    : [];
  if (missingPreferredTools.length > 0) {
    reasons.push(`preferred tools not currently available: ${missingPreferredTools.join(', ')}`);
  }

  if (missingRequiredMcpServers.length > 0 || missingTemplates.length > 0) {
    return {
      availability: 'unavailable',
      availability_reasons: reasons,
    };
  }

  if (missingPreferredTools.length > 0) {
    return {
      availability: 'warning',
      availability_reasons: reasons,
    };
  }

  return {
    availability: 'available',
    availability_reasons: [],
  };
}

export function applySkillAvailability(
  skills: SkillContext[],
  input: SkillAvailabilityContext,
): SkillContext[] {
  return skills.map((skill) => {
    const availability = evaluateSkillAvailability(skill, input);
    return {
      ...skill,
      triggers: [...skill.triggers],
      activation_tags: [...(skill.activation_tags ?? [])],
      execution_contract: cloneExecutionContract(skill.execution_contract),
      availability: availability.availability,
      availability_reasons: [...availability.availability_reasons],
      metadata: skill.metadata
        ? {
          ...skill.metadata,
          execution_contract: skill.metadata.execution_contract
            ? cloneExecutionContract(skill.metadata.execution_contract)
            : undefined,
        }
        : undefined,
    };
  });
}

import { extractApiReferencesFromLine } from './spec-structure.js';
import type { ApiReference } from './spec-structure.js';

export interface FieldDef {
  name: string;
  type: string;
  required: boolean;
  unique: boolean;
  description: string;
}

export interface EntityDef {
  name: string;
  fields: FieldDef[];
}

export interface StateTransition {
  from: string;
  event: string;
  to: string;
}

export interface StateMachineDef {
  entity: string;
  transitions: StateTransition[];
}

export interface ModelsSpec {
  entities: EntityDef[];
  enums: string[][];
  stateMachines: StateMachineDef[];
}

export interface FlowStepDef {
  step: string;
  apiRefs: ApiReference[];
  branches: string[];
  polling: boolean;
}

export interface FlowSpec {
  name: string;
  preconditions: string[];
  steps: FlowStepDef[];
  postconditions: string[];
  modelRefs: string[];
  configRefs: string[];
}

function tableCells(line: string): string[] {
  return line.split('|').map((part) => part.trim()).filter((part) => part !== '');
}

function isTableSeparatorOrHeader(cell: string): boolean {
  return /字段|类型|----|:--|^$/.test(cell);
}

export function parseModels(content: string): ModelsSpec {
  const lines = content.split(/\r?\n/u);
  const entities: EntityDef[] = [];
  const enums: string[][] = [];
  const stateMachines: StateMachineDef[] = [];
  let mode: 'entity' | 'enum' | 'state' | null = null;
  let currentEntity: EntityDef | null = null;
  let currentEnum: string[] | null = null;
  let currentStateMachine: StateMachineDef | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const entityMatch = /^##\s+实体[:：]\s*(.+?)\s*$/u.exec(trimmed);
    if (entityMatch) {
      currentEntity = { name: entityMatch[1], fields: [] };
      entities.push(currentEntity);
      currentEnum = null;
      currentStateMachine = null;
      mode = 'entity';
      continue;
    }

    if (/^##\s+枚举\s*$/u.test(trimmed)) {
      currentEnum = [];
      enums.push(currentEnum);
      currentEntity = null;
      currentStateMachine = null;
      mode = 'enum';
      continue;
    }

    const stateMatch = /^##\s+状态机[:：]\s*(.+?)\s*$/u.exec(trimmed);
    if (stateMatch) {
      currentStateMachine = { entity: stateMatch[1], transitions: [] };
      stateMachines.push(currentStateMachine);
      currentEntity = null;
      currentEnum = null;
      mode = 'state';
      continue;
    }

    if (/^##\s+/u.test(trimmed)) {
      mode = null;
      currentEntity = null;
      currentEnum = null;
      currentStateMachine = null;
      continue;
    }

    if (mode === 'entity' && currentEntity && line.includes('|')) {
      const cells = tableCells(line);
      if (cells.length >= 2 && !isTableSeparatorOrHeader(cells[0])) {
        currentEntity.fields.push({
          name: cells[0],
          type: cells[1] ?? '',
          required: (cells[2] ?? '') === '是',
          unique: (cells[3] ?? '') === '是',
          description: cells[4] ?? '',
        });
      }
    } else if (mode === 'enum' && currentEnum) {
      if (/^\s*[-*]\s+/u.test(line)) {
        currentEnum.push(line.replace(/^\s*[-*]\s+/u, '').trim());
      } else if (/^[0-9]+=/u.test(trimmed)) {
        currentEnum.push(trimmed);
      }
    } else if (mode === 'state' && currentStateMachine && line.includes('|')) {
      const cells = tableCells(line);
      if (cells.length >= 3 && !/状态|----|:--/.test(cells[0])) {
        currentStateMachine.transitions.push({ from: cells[0], event: cells[1], to: cells[2] });
      }
    }
  }

  return { entities, enums, stateMachines };
}

export function parseFlow(content: string, source: string): FlowSpec {
  const lines = content.split(/\r?\n/u);
  const name = (/^#\s+(.+?)\s*$/mu.exec(content) ?? [])[1] ?? source;
  const preconditions: string[] = [];
  const steps: FlowStepDef[] = [];
  const postconditions: string[] = [];
  const modelRefs: string[] = [];
  const configRefs: string[] = [];
  let section: 'pre' | 'steps' | 'post' | null = null;
  let currentStep: FlowStepDef | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^##\s+前置条件/u.test(trimmed)) { section = 'pre'; currentStep = null; continue; }
    if (/^##\s+步骤/u.test(trimmed)) { section = 'steps'; currentStep = null; continue; }
    if (/^##\s+后置条件/u.test(trimmed)) { section = 'post'; currentStep = null; continue; }
    if (/^##\s+/u.test(trimmed)) { section = null; currentStep = null; continue; }

    if (section === 'pre' && /^\s*[-*]\s+/u.test(line)) {
      preconditions.push(line.replace(/^\s*[-*]\s+/u, '').trim());
    }
    if (section === 'post' && /^\s*[-*]\s+/u.test(line)) {
      postconditions.push(line.replace(/^\s*[-*]\s+/u, '').trim());
    }

    const stepMatch = /^###\s+(步骤[^\s：:]*)/u.exec(trimmed);
    if (stepMatch && section === 'steps') {
      currentStep = { step: stepMatch[1], apiRefs: [], branches: [], polling: /轮询/u.test(trimmed) };
      steps.push(currentStep);
      continue;
    }

    if (currentStep && section === 'steps') {
      currentStep.apiRefs.push(...extractApiReferencesFromLine(line));
      const branchMatch = /^####\s+(路径[^：:]*)[:：]?\s*(.*)$/u.exec(trimmed);
      if (branchMatch) {
        currentStep.branches.push(branchMatch[1].trim() + (branchMatch[2] ? ' = ' + branchMatch[2].trim() : ''));
      }
    }

    const modelMatch = /^\s*(?:[-*]\s+)?(?:模型|实体)[:：]\s*([^\s，,]+)/u.exec(line);
    if (modelMatch) modelRefs.push(modelMatch[1]);
    const configMatch = /^\s*(?:[-*]\s+)?(?:配置键|配置)[:：]\s*([A-Za-z0-9_.]+)/u.exec(line);
    if (configMatch) configRefs.push(configMatch[1]);
  }

  return { name, preconditions, steps, postconditions, modelRefs, configRefs };
}

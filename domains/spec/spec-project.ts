import path from 'node:path';
import { promises as fs } from 'node:fs';
import { stringify } from 'yaml';
import { listSpecEntries } from './spec-index.js';
import { parseSpecContent } from './spec-parse.js';
import { parseCapability, parseFlow, parseModels, type CapFieldDef, type EntityDef, type FlowStepDef, type StateMachineDef } from './spec-model.js';
import { extractConfigKeys, extractErrorCodes, extractSectionErrorCodes } from './spec-structure.js';
import { pathExists, readTextFile } from '../../platform/fs/read-file.js';
import { ROOT_KIND_FILES } from './kind.js';

export interface ApiProjection {
  capability: string;
  heading: string;
  method: string | null;
  path: string | null;
  acceptanceIds: string[];
  requestFields: CapFieldDef[];
  responseFields: CapFieldDef[];
  modelRefs: string[];
}

export interface ModelsProjection {
  entities: EntityDef[];
  enums: string[][];
  stateMachines: StateMachineDef[];
}

export interface FlowProjection {
  name: string;
  source: string;
  preconditions: string[];
  steps: FlowStepDef[];
  postconditions: string[];
  modelRefs: string[];
  configRefs: string[];
}

export interface SpecIndexProjection {
  models: ModelsProjection | null;
  apis: ApiProjection[];
  flows: FlowProjection[];
  errors: string[];
  config: string[];
}

function parseApiHeading(heading: string): { method: string | null; path: string | null } {
  const match = /^([A-Z]{3,8})\s+(\/\S+)/u.exec(heading.trim());
  if (!match) return { method: null, path: null };
  return { method: match[1].toUpperCase(), path: match[2] };
}

export async function buildSpecIndex(projectRoot: string): Promise<SpecIndexProjection> {
  const entries = await listSpecEntries(projectRoot);

  let models: ModelsProjection | null = null;
  const modelsRel = ROOT_KIND_FILES.models;
  if (modelsRel && (await pathExists(path.join(projectRoot, modelsRel)))) {
    models = parseModels(await readTextFile(path.join(projectRoot, modelsRel)));
  }

  const apis: ApiProjection[] = [];
  const flows: FlowProjection[] = [];

  for (const entry of entries) {
    if (entry.kind === 'capability') {
      const content = await readTextFile(path.join(projectRoot, entry.path));
      const parsed = parseSpecContent(content, entry.path);
      const capability = entry.path.replace(/^specs\//u, '').replace(/\/spec\.md$/u, '');
      const endpointsByHeading = new Map(
        parseCapability(content, entry.path).endpoints.map((endpoint) => [endpoint.method + ' ' + endpoint.path, endpoint]),
      );
      for (const anchor of parsed.anchors) {
        const { method, path: apiPath } = parseApiHeading(anchor.heading);
        const acceptanceIds = (anchor.acceptance.length > 0 ? anchor.acceptance : parsed.acceptance).map((item) => item.id);
        const endpoint = method && apiPath ? endpointsByHeading.get(method + ' ' + apiPath) : undefined;
        apis.push({
          capability,
          heading: anchor.heading,
          method,
          path: apiPath,
          acceptanceIds,
          requestFields: endpoint?.requestFields ?? [],
          responseFields: endpoint?.responseFields ?? [],
          modelRefs: endpoint?.modelRefs ?? [],
        });
      }
    } else if (entry.kind === 'flow') {
      const content = await readTextFile(path.join(projectRoot, entry.path));
      flows.push({ ...parseFlow(content, entry.path), source: entry.path });
    }
  }

  const errorCodes = new Set<string>();
  const errorsRel = ROOT_KIND_FILES.errors;
  if (errorsRel && (await pathExists(path.join(projectRoot, errorsRel)))) {
    for (const code of extractErrorCodes(await readTextFile(path.join(projectRoot, errorsRel)))) errorCodes.add(code);
  }
  const protocolRel = ROOT_KIND_FILES.protocol;
  if (protocolRel && (await pathExists(path.join(projectRoot, protocolRel)))) {
    for (const code of extractSectionErrorCodes(await readTextFile(path.join(projectRoot, protocolRel)))) errorCodes.add(code);
  }
  const errors = [...errorCodes];

  let config: string[] = [];
  const configRel = ROOT_KIND_FILES.config;
  if (configRel && (await pathExists(path.join(projectRoot, configRel)))) {
    config = extractConfigKeys(await readTextFile(path.join(projectRoot, configRel)));
  }

  return { models, apis, flows, errors, config };
}

export async function writeSpecIndex(projectRoot: string): Promise<{ files: string[]; projection: SpecIndexProjection }> {
  const projection = await buildSpecIndex(projectRoot);
  const dir = path.join(projectRoot, '.cometflow', 'spec-index');
  await fs.mkdir(dir, { recursive: true });

  const files: string[] = [];
  async function writeYaml(name: string, value: unknown): Promise<void> {
    const filePath = path.join(dir, name);
    await fs.writeFile(filePath, stringify(value));
    files.push(filePath);
  }

  await writeYaml('models.yaml', projection.models ?? { entities: [], enums: [], stateMachines: [] });
  await writeYaml('apis.yaml', projection.apis);
  await writeYaml('flows.yaml', projection.flows);
  await writeYaml('errors.yaml', { codes: projection.errors });
  await writeYaml('config.yaml', { keys: projection.config });

  return { files, projection };
}

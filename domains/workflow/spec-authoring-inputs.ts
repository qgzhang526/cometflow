import { capabilitySpecFile } from '../spec/spec-index.js';
import { parseModels } from '../spec/spec-model.js';
import { buildSpecReferenceIndex } from '../spec/spec-graph.js';

/**
 * `kind: spec-authoring` 任务的输入面。
 *
 * 起草一份 capability spec 时，Agent 需要的不只是「这个 goal 想要什么」，还有
 * 「这个项目已经有哪些可用的事实可以引用」——否则它要么凭空造模型 / 错误码，
 * 要么干脆不写引用，两种都会让 `spec validate` 报 unresolved reference，
 * 或者产出一份与既有契约毫无关系的孤儿 spec。
 *
 * 事实全部取自 `buildSpecReferenceIndex`——那是 `spec validate` 与引用图共用的事实索引。
 * 本模块**不重新解析 spec**：一旦这里自己维护一套正则，就会出现
 * 「提示词说可以引用、validate 却报错」这类最难查的分歧。
 */

export interface SpecAuthoringHints {
  /** 已在 specs/ 落地的 capability（不含正在起草的这个）。 */
  capability_names: string[];
  /** `specs/models.md` 的实体及其字段名。 */
  models: { name: string; fields: string[] }[];
  /** errors.md 与 protocol.md「错误码」表中的错误码。 */
  error_codes: string[];
  /** protocol.md「请求头」表中定义的协议头。 */
  protocol_headers: string[];
  /** protocol.md「状态码总表」中定义的状态码。 */
  protocol_status_codes: string[];
  /** config.md 中定义的配置键。 */
  config_keys: string[];
  /** 哪些根 kind 文件存在——决定「引用未定义的值」是 error 还是 warning。 */
  files_exist: { models: boolean; errors: boolean; config: boolean; protocol: boolean };
  /**
   * 同一 goal 内已有的邻居 capability spec 全文（最多一份）。
   *
   * 给全文而不是摘要，是因为「这个项目怎么写字号、怎么组织 anchor 与验收」
   * 只有照着现成的一份才学得会——只给目录与文件名并不够。
   */
  neighbor: { capability: string; path: string; content: string; truncated: boolean } | null;
}

/** 邻居 spec 进入提示词的字符上界：够学会体例，又不至于把提示词撑爆。 */
export const NEIGHBOR_SPEC_LIMIT = 6000;

function neighborCapabilityOf(relativePath: string): string | null {
  const match = /^specs\/([^/]+)\/spec\.md$/u.exec(relativePath);
  if (!match) return null;
  // 根 kind 目录不是 capability；`flows/` 由 kindForSpecFile 归为 flow。
  if (match[1] === 'flows') return null;
  return match[1];
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

/**
 * 给起草任务收集「可引用的事实面」。
 *
 * 分工是刻意的：**枚举列表**回答「有哪些值可以引用」，**邻居全文**回答「这个项目怎么写」。
 * 二者都不包含「这段流程该怎么做」——那是人的决策，不是能从仓库里读出来的事实。
 */
export async function gatherSpecAuthoringHints(
  projectRoot: string,
  options: { capability: string | null; scope?: readonly string[] },
): Promise<SpecAuthoringHints> {
  const index = await buildSpecReferenceIndex(projectRoot);

  const capabilityContents = new Map<string, string>();
  for (const relativePath of index.filesByKind.get('capability') ?? []) {
    const capability = neighborCapabilityOf(relativePath);
    if (capability === null) continue;
    // 正在起草的 capability 不算「已有」：它的文件可能是上一轮留下的半成品，
    // 既不进 capability 列表，也不当体例样本（否则 Agent 会照着半成品续写）。
    if (capability === options.capability) continue;
    capabilityContents.set(capability, index.fileContents.get(relativePath) ?? '');
  }
  const capabilityNames = sorted(capabilityContents.keys());

  // 邻居优先在同一 goal 的 scope 里找：跨 goal 的 capability 未必与本次起草同族。
  const neighborName =
    (options.scope ?? []).find((name) => capabilityContents.has(name)) ?? capabilityNames[0];
  let neighbor: SpecAuthoringHints['neighbor'] = null;
  if (neighborName !== undefined) {
    const content = capabilityContents.get(neighborName) ?? '';
    neighbor = {
      capability: neighborName,
      path: capabilitySpecFile(neighborName),
      content: content.length > NEIGHBOR_SPEC_LIMIT ? content.slice(0, NEIGHBOR_SPEC_LIMIT) : content,
      truncated: content.length > NEIGHBOR_SPEC_LIMIT,
    };
  }

  const modelsContent = index.fileContents.get('specs/models.md');

  return {
    capability_names: capabilityNames,
    models: modelsContent
      ? parseModels(modelsContent).entities.map((entity) => ({
          name: entity.name,
          fields: entity.fields.map((field) => field.name),
        }))
      : [],
    error_codes: sorted(index.present.get('error') ?? []),
    protocol_headers: sorted(index.present.get('header') ?? []),
    protocol_status_codes: sorted(index.present.get('status') ?? []),
    config_keys: sorted(index.present.get('config') ?? []),
    files_exist: index.filesExist,
    neighbor,
  };
}

function listLine(label: string, values: readonly string[], absentHint: string): string {
  return '- ' + label + '：' + (values.length > 0 ? values.join(', ') : absentHint);
}

/**
 * 把事实面渲染成提示词段落。
 *
 * 段落里写的是「可以引用什么」与「写错了会怎样」，不是「应该写成什么」——
 * 判定规则留在 `spec validate`，提示词只把那份规则需要的输入摆到桌面上。
 */
export function renderSpecAuthoringInputs(hints: SpecAuthoringHints): string[] {
  const lines: string[] = [];
  const missingRootFiles = Object.entries(hints.files_exist)
    .filter(([, exists]) => !exists)
    .map(([kind]) => kind);

  lines.push('## Existing facts you may reference');
  lines.push(
    '这些值来自当前 canonical spec，是 `spec validate` **能解析到**的引用目标。' +
      '写 `- 模型：X` / `- 错误码：E_X` / `- 协议头：X-Request-Id` / `- 状态码：200` / `- 配置键：k` 这类引用行时，' +
      '只允许引用下面的值；接口字段必须来自下面列出的实体字段。',
  );
  lines.push(
    '需要在别处尚未定义的值时：先不要写引用行，把它作为待定项写进验收或正文，让人补齐——' +
      '凭空引用不存在的值会让这份 spec 过不了收口护栏（`change verify` / `change archive` 会拒绝）。',
  );
  if (missingRootFiles.length > 0) {
    lines.push(
      '注意：' +
        missingRootFiles.join(' / ') +
        ' 对应的 kind 文件当前不存在，此时引用未定义的值只会降级为 warning；' +
        '但这不改变「不要凭空引用」——契约里出现查不到出处的值，人复审时一样要退回来。',
    );
  }
  lines.push('');
  lines.push(listLine('已有 capability（specs/<name>/spec.md）', hints.capability_names, '（还没有其他 capability）'));
  lines.push(listLine('可引用的模型实体', hints.models.map((entity) => entity.name), '（specs/models.md 里还没有实体）'));
  lines.push(listLine('可引用的错误码', hints.error_codes, '（还没有定义任何错误码；需要新错误码时先记为待定项）'));
  lines.push(listLine('可引用的协议头', hints.protocol_headers, '（protocol.md 的「请求头」表里还没有条目）'));
  lines.push(listLine('可引用的状态码', hints.protocol_status_codes, '（protocol.md 的「状态码总表」里还没有条目）'));
  lines.push(listLine('可引用的配置键', hints.config_keys, '（specs/config.md 里还没有配置键）'));

  const entityFields = hints.models.filter((entity) => entity.fields.length > 0);
  if (entityFields.length > 0) {
    lines.push('');
    lines.push('实体字段（接口字段必须来自这里，否则报 unresolved-field-reference）：');
    for (const entity of entityFields) lines.push('- ' + entity.name + '：' + entity.fields.join(', '));
  }

  lines.push('');
  lines.push('## House style to follow');
  if (hints.neighbor) {
    lines.push(
      '下面是本仓库已有的一份 capability spec（' +
        hints.neighbor.path +
        '），照它的体例写：front-matter 键、一级标题措辞、anchor 粒度、验收写法。' +
        (hints.neighbor.truncated
          ? '（内容过长已截断到前 ' + NEIGHBOR_SPEC_LIMIT + ' 字符，需要全貌请直接读文件）'
          : ''),
    );
    lines.push('');
    lines.push('````markdown');
    lines.push(hints.neighbor.content.trimEnd());
    lines.push('````');
  } else {
    lines.push(
      '本仓库还没有任何 capability spec 可参照；按上面的结构要求写第一份。' +
        '它会被后来者当作体例样本，所以 front-matter 键、anchor 粒度与验收写法要写得经得起抄。',
    );
  }
  return lines;
}

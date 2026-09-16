import { promises as fs } from 'node:fs';
import path from 'node:path';
import { validateSpecs } from '../../domains/spec/spec-validate.js';
import { collectSpecAnchors } from '../../domains/spec/spec-anchors.js';
import { diffSpecs } from '../../domains/spec/spec-lock.js';
import { collectSpecDrift } from '../../domains/spec/spec-drift.js';
import { analyzeSpecImpact, formatSpecImpact } from '../../domains/spec/spec-impact.js';
import { verifySpecIntegrity } from '../../domains/spec/spec-verify.js';
import { readProposedSpecs } from '../../domains/workflow/change-execution.js';
import {
  readSpecBlob,
  readSpecHistory,
  refreshSpecBaseline,
  resolveSpecVersionRef,
  specVersionsFor,
} from '../../domains/spec/spec-version.js';
import { loadProjectContext } from '../../domains/project/context.js';
import { readInitManifest, scaffoldCapabilities, scaffoldProject } from '../../domains/project/scaffold.js';
import { importSpecsFromFile } from '../../domains/spec/spec-import.js';
import { writeSpecIndex } from '../../domains/spec/spec-project.js';
import { collectAcceptanceChecks } from '../../domains/spec/spec-checks.js';
import { approveSpec } from '../../domains/spec/spec-approval.js';
import { collectSpecGraph } from '../../domains/spec/spec-graph.js';
import { askScaffoldPrompts } from './scaffold-prompts.js';
import { collectFindings, formatFinding } from '../../domains/gates/findings.js';

export async function specValidateCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await validateSpecs(projectRoot);
  for (const finding of result.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.path, finding.message].join(' '));
  }
  console.log(result.valid ? 'spec validate: OK' : 'spec validate: FAILED');
  // 退出码即结论：CI 门禁与 git hook 都按退出码判断，只打印不设码等于门禁没有判定力。
  if (!result.valid) process.exitCode = 1;
}

export async function specLockCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  // lock 同时负责「登记版本」：只写 hash 不存内容的话，代码丢了就没有可重建的 spec 契约。
  const result = await refreshSpecBaseline(projectRoot, { note: 'spec lock' });
  console.log('wrote ' + projectRoot + '/.cometflow/spec-lock.json');
  for (const entry of result.recorded) {
    console.log('versioned ' + entry.path + ' @v' + entry.spec_version + ' ' + entry.hash.slice(0, 12));
  }
}

export async function specDiffCommand(
  targetPath: string,
  options: { impact?: boolean; json?: boolean; change?: string } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  if (options.impact) {
    const overlay = options.change ? await readProposedSpecs(projectRoot, options.change) : undefined;
    const report = await analyzeSpecImpact(projectRoot, { overlay });
    if (options.json) {
      console.log(JSON.stringify(report, null, 2));
      return;
    }
    if (options.change) {
      console.log(
        'impact of change ' +
          options.change +
          ' (' +
          Object.keys(overlay ?? {}).length +
          ' proposed spec file(s))',
      );
    }
    for (const line of formatSpecImpact(report)) console.log(line);
    if (report.summary.highest_severity === 'high') process.exitCode = 1;
    return;
  }
  const diff = await diffSpecs(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(diff, null, 2));
    return;
  }
  console.log('added: ' + diff.added.length);
  console.log('modified: ' + diff.modified.length);
  console.log('removed: ' + diff.removed.length);
  console.log('unchanged: ' + diff.unchanged.length);
  for (const entry of [...diff.added, ...diff.modified, ...diff.removed]) {
    console.log(entry.path + ' ' + (diff.added.includes(entry) ? 'added' : diff.modified.includes(entry) ? 'modified' : 'removed'));
  }
}

export async function specDriftCommand(targetPath: string, options: { json?: boolean }): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await collectSpecDrift(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log('scannedTasks: ' + report.scannedTasks);
  console.log('drift: ' + report.drift.length);
  if (report.unresolvable.length > 0) {
    console.log('unresolvable: ' + report.unresolvable.length + '（版本仓缺少冻结内容，先运行 cometflow spec lock）');
  }
  for (const entry of report.drift) {
    console.log(
      [
        entry.severity.toUpperCase(),
        entry.kind,
        entry.goal + '/' + entry.task,
        entry.spec_ref,
        entry.frozen_hash.slice(0, 8) + ' -> ' + entry.current_hash.slice(0, 8),
        entry.message,
      ].join(' '),
    );
  }
}

export async function specVersionsCommand(
  targetPath: string,
  options: { spec?: string; json?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const history = await readSpecHistory(projectRoot);
  const specs = options.spec ? { [options.spec]: specVersionsFor(history, options.spec) } : history.specs;
  if (options.json) {
    console.log(JSON.stringify({ schema: history.schema, specs }, null, 2));
    return;
  }
  let total = 0;
  for (const [specPath, versions] of Object.entries(specs).sort()) {
    console.log(specPath + ' (' + versions.length + ' versions)');
    for (const version of versions) {
      total += 1;
      console.log(
        [
          '  v' + version.spec_version,
          version.hash.slice(0, 12),
          version.recorded_at,
          version.change ?? '-',
          version.note ?? '-',
        ].join(' '),
      );
    }
  }
  if (total === 0) console.log('(no spec versions; run cometflow spec lock)');
}

export async function specShowCommand(versionRef: string, targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const resolved = await resolveSpecVersionRef(projectRoot, versionRef);
  const content = await readSpecBlob(projectRoot, resolved.record.hash);
  if (content === null) throw new Error('spec blob is missing from the version store: ' + resolved.record.hash);
  console.log(
    '# ' +
      resolved.path +
      ' @v' +
      resolved.record.spec_version +
      ' ' +
      resolved.record.hash.slice(0, 12) +
      (resolved.record.change ? ' (change: ' + resolved.record.change + ')' : ''),
  );
  console.log(content);
}

/**
 * 从版本仓恢复一份 canonical spec。
 *
 * 这是「spec 即产物」的直接体现：即使 specs/ 被误删，也能按版本号或内容哈希取回原文，
 * 然后重新 plan generate / plan freeze 生成代码。
 */
export async function specRestoreCommand(versionRef: string, targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const resolved = await resolveSpecVersionRef(projectRoot, versionRef);
  const content = await readSpecBlob(projectRoot, resolved.record.hash);
  if (content === null) {
    throw new Error('spec blob is missing from the version store: ' + resolved.record.hash);
  }
  const destination = path.join(projectRoot, resolved.path);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content);
  // 恢复本身也是一次 spec 变更，同步记账，避免 lock 与版本链脱节。
  const result = await refreshSpecBaseline(projectRoot, {
    note: 'restore from v' + resolved.record.spec_version,
  });
  const restored = result.recorded.find((entry) => entry.path === resolved.path);
  console.log(
    'restored ' +
      resolved.path +
      ' from v' +
      resolved.record.spec_version +
      ' -> v' +
      (restored?.spec_version ?? resolved.record.spec_version),
  );
}

export async function specVerifyCommand(
  targetPath: string,
  options: { json?: boolean; withDoctor?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await verifySpecIntegrity(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.valid ? 0 : 1;
    return;
  }
  for (const finding of result.findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.subject, finding.message].join(' '));
  }
  console.log(result.valid ? 'spec verify: OK' : 'spec verify: FAILED');
  process.exitCode = result.valid ? 0 : 1;

  // 显式要求时才附上 doctor 的发现：它是**另一个 scope**（项目运行健康），
  // 不掺进 spec verify 的结论，也不改这个命令的退出码。
  if (options.withDoctor === true) {
    const doctorFindings = (await collectFindings(projectRoot)).filter(
      (finding) => finding.source === 'doctor',
    );
    console.log('');
    console.log('以下是 doctor 的发现（项目运行健康，与上面的 spec verify 是两个 scope，不影响其结论）：');
    if (doctorFindings.length === 0) console.log('  （无）');
    for (const finding of doctorFindings) console.log('  ' + formatFinding(finding));
  }
}

export async function specAnchorsCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  // 与 Web 的 `GET /spec/anchors` 共用同一份投影，避免「命令行说 12 个锚点、界面说 13 个」。
  const projection = await collectSpecAnchors(projectRoot);
  for (const entry of projection.entries) {
    console.log(entry.path + '#' + entry.anchor + ' acceptance=' + entry.acceptance);
  }
}

export async function specScaffoldCommand(
  targetPath: string,
  options: { interactive?: boolean; capabilities?: string[] },
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const context = await loadProjectContext(projectRoot);
  const stack = context
    ? { frontend: context.tech_stack.frontend, backend: context.tech_stack.backend, database: context.tech_stack.database }
    : {};
  const answers = options.interactive ? (await askScaffoldPrompts(false)).answers : {};
  const result = await scaffoldProject(projectRoot, stack, answers);
  for (const filePath of result.created) console.log('scaffolded ' + filePath);
  for (const filePath of result.skipped) console.log('skipped ' + filePath);
  console.log('wrote ' + result.manifestPath);

  const capabilities = options.capabilities ?? [];
  if (capabilities.length > 0) {
    const capabilityResult = await scaffoldCapabilities(projectRoot, capabilities);
    for (const filePath of capabilityResult.created) console.log('scaffolded ' + filePath);
    for (const filePath of capabilityResult.skipped) console.log('skipped ' + filePath);
    for (const name of capabilityResult.invalid) console.log('invalid capability name: ' + name);
    if (capabilityResult.invalid.length > 0) process.exitCode = 1;
  }
}

/**
 * 列出每个 anchor 的验收项与其可执行检查。
 *
 * 没有 check 的验收项意味着「重建质量只能靠人判断」，这条命令把它显式暴露出来，
 * 便于把 spec 逐步补到「可自动判定」的程度。
 */
export async function specChecksCommand(
  targetPath: string,
  options: { json?: boolean } = {},
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const report = await collectAcceptanceChecks(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const entry of report.anchors) {
    console.log(entry.path + '#' + entry.anchor);
    for (const item of entry.acceptance) {
      console.log('  ' + item.id + ' ' + (item.check ? 'check: ' + item.check : '(no check — 需要独立 Verifier 或人工判定)'));
    }
  }
  console.log('acceptance items: ' + report.total + ' checked: ' + report.checked + ' unchecked: ' + report.unchecked);
}

/**
 * 打印跨文件引用关系图（008 §8.6②）。
 *
 * 只做投影：输出 nodes/edges 与未解析引用，**不设退出码**——门禁归 `spec validate`，
 * 这样「图」与「判定」不会变成两个各自维护的真相。
 */
export async function specGraphCommand(targetPath: string, options: { json?: boolean } = {}): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const graph = await collectSpecGraph(projectRoot);
  if (options.json) {
    console.log(JSON.stringify(graph, null, 2));
    return;
  }
  console.log(
    'spec graph: kinds=' +
      graph.summary.kinds +
      ' files=' +
      graph.summary.files +
      ' anchors=' +
      graph.summary.anchors +
      ' targets=' +
      graph.summary.targets +
      ' edges=' +
      graph.summary.edges +
      ' unresolved=' +
      graph.summary.unresolved,
  );
  for (const edge of graph.edges.filter((entry) => entry.level === 'reference' && entry.from.startsWith('kind:'))) {
    console.log(
      '  ' +
        edge.from.replace(/^kind:/u, '') +
        ' -> ' +
        edge.to.replace(/^kind:/u, '') +
        ' refs=' +
        (edge.count ?? 0) +
        (edge.resolved ? '' : ' (target kind missing)'),
    );
  }
  for (const entry of graph.unresolved) {
    console.log(
      [entry.severity.toUpperCase(), entry.code, entry.path + ':' + entry.line, entry.refKind + '=' + entry.value].join(' '),
    );
  }
}

export async function specIndexCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await writeSpecIndex(projectRoot);
  for (const filePath of result.files) console.log('wrote ' + filePath);
}

export async function specScaffoldListCommand(targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const manifest = await readInitManifest(projectRoot);
  if (!manifest) {
    console.log('(no init-manifest.yaml)');
    return;
  }
  for (const [kind, entry] of Object.entries(manifest.kinds)) {
    console.log(kind + ': ' + entry.status + ' (' + entry.reason + ')');
  }
}

// Imports a table-shaped interface inventory (CSV / TSV / markdown table, i.e. what
// you get by copying a Word or Excel table) into canonical capability specs.
export async function specImportCommand(
  sourcePath: string,
  targetPath: string,
  options: { force?: boolean; module?: string },
): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await importSpecsFromFile(projectRoot, path.resolve(sourcePath), options);

  for (const filePath of result.written) console.log('imported ' + filePath);
  for (const filePath of result.skipped) console.log('skipped ' + filePath + '（已存在，加 --force 覆盖）');
  for (const issue of result.issues) console.log('issue line ' + issue.line + ': ' + issue.reason);

  const findings = result.validation.findings.filter((finding) => finding.code !== 'deferred-kind-file');
  for (const finding of findings) {
    console.log([finding.severity.toUpperCase(), finding.code, finding.path, finding.message].join(' '));
  }
  if (findings.length === 0 && result.written.length > 0) {
    console.log('spec validate: OK（请人工审核后再 spec lock）');
  }
  if (!result.validation.valid) process.exitCode = 1;
}

/**
 * 把一份 spec 标成定稿（G1）。
 *
 * 与 `spec lock` 的分工：lock 只建立 hash 基线，不管这份契约有没有人确认过；
 * approve 改的是 `status` 字段本身，是 `plan freeze` 的前置条件。
 */
export async function specApproveCommand(specRef: string, targetPath: string): Promise<void> {
  const projectRoot = path.resolve(targetPath);
  const result = await approveSpec(projectRoot, specRef);
  if (!result.changed) {
    console.log('spec approve: ' + result.path + ' 已经是 approved，无需改动');
    return;
  }
  console.log(
    'spec approve: ' + result.path + ' ' + result.previous + ' → approved（版本 v' + (result.spec_version ?? '?') + '）',
  );
  console.log('（front-matter status 已改；spec-lock 与版本仓已同步刷新）');
}

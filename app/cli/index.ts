#!/usr/bin/env node
import { Command } from 'commander';
import { agentCheckCommand, agentListCommand } from '../commands/agent.js';
import {
  changeArchiveCommand,
  changeGcCommand,
  changeJournalCommand,
  changeListCommand,
  changeNewCommand,
  changeRebaseCommand,
  changeResumeCommand,
  changeRunCommand,
  changeScopeCommand,
  changeSelectCommand,
  changeStatusCommand,
  changeTransitionCommand,
  changeUnblockCommand,
  changeVerifyCommand,
} from '../commands/change.js';
import {
  bundleCompileCommand,
  bundleCreateCommand,
  bundleDistributeCommand,
} from '../commands/bundle.js';
import {
  skillAddCommand,
  skillImportCommand,
  skillListCommand,
  skillShowCommand,
} from '../commands/skill.js';
import { contextSyncCommand } from '../commands/context.js';
import {
  classicNewCommand,
  classicStatusCommand,
  classicTransitionCommand,
} from '../commands/classic.js';
import { dashboardCommand } from '../commands/dashboard.js';
import { serveCommand } from '../commands/serve.js';
import {
  hookCheckCommand,
  hookInstallCommand,
  hookStatusCommand,
  hookUninstallCommand,
} from '../commands/hook.js';
import { doctorCommand } from '../commands/doctor.js';
import {
  gateCheckCommand,
  gateInstallCommand,
  gateStatusCommand,
  gateUninstallCommand,
} from '../commands/gate.js';
import { evalCommand } from '../commands/eval.js';
import { projectMigrateCommand } from '../commands/migrate.js';
import { uninstallCommand, updateCommand } from '../commands/ops.js';
import {
  evolveApproveCommand,
  evolveProposeCommand,
  evolveRejectCommand,
  evolveReviewListCommand,
  evolveRollbackCommand,
  evolveStatusCommand,
  evolveSubmitCommand,
  evolveVerifyCommand,
} from '../commands/evolve.js';
import { statusCommand } from '../commands/status.js';
import { metricsCommand } from '../commands/metrics.js';
import {
  daemonBudgetCommand,
  daemonControlCommand,
  daemonQueueCommand,
  daemonRetryCommand,
  daemonStartCommand,
} from '../commands/daemon.js';
import { goalSyncCommand } from '../commands/goal.js';
import { initCommand } from '../commands/init.js';
import { runCommand } from '../commands/run.js';
import {
  specAnchorsCommand,
  specApproveCommand,
  specChecksCommand,
  specDiffCommand,
  specDriftCommand,
  specGraphCommand,
  specImportCommand,
  specIndexCommand,
  specLockCommand,
  specRestoreCommand,
  specScaffoldCommand,
  specScaffoldListCommand,
  specShowCommand,
  specValidateCommand,
  specVerifyCommand,
  specVersionsCommand,
} from '../commands/spec.js';
import {
  planApproveCommand,
  planFreezeCommand,
  planGenerateCommand,
  planRegenerateCommand,
  planReviewCommand,
  planTraceCommand,
  planValidateCommand,
} from '../commands/plan.js';

const program = new Command();

program
  .name('cometflow')
  .description('Full-time autonomous agent development platform')
  .version('0.2.0');

program
  .command('init [path]')
  .description('Initialize a CometFlow project')
  .option('--interactive', 'Ask project-type questions and scaffold spec kinds')
  .action(async (targetPath = '.', options) => {
    await initCommand(targetPath, { interactive: options.interactive === true });
  });

program
  .command('run [path]')
  .description('Run one CometFlow agent session')
  .option('--agent <agent>', 'Agent id: opencode or claude-code')
  .option('--model <model>', 'Model override')
  .option('--timeout <ms>', 'Timeout in milliseconds', (value) => Number.parseInt(value, 10))
  .action(async (targetPath = '.', options) => {
    await runCommand(targetPath, options);
  });

const agent = program.command('agent').description('Agent adapter commands');

agent
  .command('list')
  .description('List built-in agent adapters and availability')
  .action(async () => {
    await agentListCommand();
  });

agent
  .command('check <agent>')
  .description('Check whether an agent adapter is available')
  .action(async (agentId) => {
    await agentCheckCommand(agentId);
  });

const classic = program.command('classic').description('Classic workflow commands');

classic
  .command('new <name>')
  .description('Create a Classic change')
  .requiredOption('--goal <goal>', 'Goal id')
  .requiredOption('--task <task>', 'Task id')
  .option('--profile <profile>', 'full | hotfix | tweak', 'full')
  .option('--path <path>', 'Project root')
  .action(async (name, options) => {
    await classicNewCommand(name, options);
  });

classic
  .command('status <name> [path]')
  .description('Show a Classic change state')
  .action(async (name, targetPath = '.') => {
    await classicStatusCommand(name, targetPath);
  });

classic
  .command('transition <name> <event> [path]')
  .description('Apply a Classic transition: open-complete | design-complete | build-complete | verify-pass | verify-fail | archive-complete')
  .action(async (name, event, targetPath = '.') => {
    await classicTransitionCommand(name, event, targetPath);
  });

const change = program.command('change').description('Workflow change commands');

change
  .command('new <name>')
  .description('Create a change from a frozen task')
  .requiredOption('--goal <goal>', 'Goal id')
  .requiredOption('--task <task>', 'Frozen task id')
  .option('--path <path>', 'Project root')
  .action(async (name, options) => {
    await changeNewCommand(name, options);
  });

change
  .command('list [path]')
  .description('List changes')
  .option('--all', 'Include archived changes')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await changeListCommand(targetPath, options);
  });

change
  .command('resume <name> [path]')
  .description('Show the next action to resume a change')
  .option('--json', 'Output as JSON')
  .action(async (name, targetPath = '.', options) => {
    await changeResumeCommand(name, targetPath, options);
  });

change
  .command('status <name> [path]')
  .description('Show a change state')
  .action(async (name, targetPath = '.') => {
    await changeStatusCommand(name, targetPath);
  });

change
  .command('transition <name> <event> [path]')
  .description('Apply a change transition: confirm-acceptance | submit-candidate | verify-pass | verify-fail | archive-complete')
  .action(async (name, event, targetPath = '.') => {
    await changeTransitionCommand(name, event, targetPath);
  });

change
  .command('run <name> [path]')
  .description('Run the Builder agent for a change in build phase')
  .option('--agent <agent>', 'Agent id: opencode or claude-code')
  .option('--allow-drift', 'Proceed even if the git history drifted since the change was created')
  .action(async (name, targetPath = '.', options) => {
    await changeRunCommand(name, targetPath, options);
  });

change
  .command('verify <name> [path]')
  .description('Run deterministic checks and apply acceptance verdict')
  .option('--agent <agent>', 'Independent verifier agent id')
  .option('--mode <mode>', 'checks | checks+agent | agent-required')
  .option('--allow-drift', 'Proceed even if the git history drifted since the change was created')
  .action(async (name, targetPath = '.', options) => {
    await changeVerifyCommand(name, targetPath, options);
  });

change
  .command('scope <name> [path]')
  .description('Show which files this change touched and whether they stay inside the declared module')
  .option('--json', 'Output as JSON')
  .action(async (name, targetPath = '.', options) => {
    await changeScopeCommand(name, targetPath, options);
  });

change
  .command('unblock <name> [path]')
  .description('Clear a stalled repair loop after a human has reviewed the failures')
  .option('--note <text>', 'Why it is safe to retry')
  .action(async (name, targetPath = '.', options) => {
    await changeUnblockCommand(name, targetPath, options);
  });

change
  .command('select <name> [path]')
  .description('Set the current change used by the hook guard when several changes are active')
  .option('--clear', 'Remove the current-change pointer')
  .action(async (name, targetPath = '.', options) => {
    await changeSelectCommand(name, targetPath, options);
  });

change
  .command('journal <name> [path]')
  .description('Show the append-only audit trail of a change')
  .option('--json', 'Output as JSON')
  .action(async (name, targetPath = '.', options) => {
    await changeJournalCommand(name, targetPath, options);
  });

change
  .command('gc [path]')
  .description('Report (or with --apply, reclaim) change runtime evidence')
  .option('--apply', 'Actually remove reclaimable evidence')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await changeGcCommand(targetPath, options);
  });

change
  .command('archive <name> [path]')
  .description('Archive a verified change and apply proposed specs')
  .option('--allow-drift', 'Proceed even if the git history drifted since the change was created')
  .action(async (name, targetPath = '.', options) => {
    await changeArchiveCommand(name, targetPath, options);
  });

change
  .command('rebase <name> [path]')
  .description('Re-freeze a change against the current canonical spec version')
  .action(async (name, targetPath = '.') => {
    await changeRebaseCommand(name, targetPath);
  });

const skill = program.command('skill').description('Skill package commands');

skill
  .command('add <source>')
  .description('Install a local Skill package')
  .option('--project <dir>', 'Project root')
  .option('--overwrite', 'Replace existing Skill')
  .action(async (source, options) => {
    await skillAddCommand(source, options);
  });

skill
  .command('show <skill>')
  .description('Show installed Skill metadata')
  .option('--project <dir>', 'Project root')
  .action(async (name, options) => {
    await skillShowCommand(name, options);
  });

skill
  .command('list')
  .description('List installed Skills')
  .option('--project <dir>', 'Project root')
  .action(async (options) => {
    await skillListCommand(options);
  });

skill
  .command('import <source> <name>')
  .description('Import an external Skill with risk scan')
  .option('--project <dir>', 'Project root')
  .action(async (source, name, options) => {
    await skillImportCommand(source, name, options);
  });

const bundle = program.command('bundle').description('Skill bundle commands');

bundle
  .command('create <name> [path]')
  .description('Create a bundle manifest')
  .action(async (name, targetPath = '.') => {
    await bundleCreateCommand(name, targetPath);
  });

bundle
  .command('compile [path]')
  .description('Compile a bundle and print its file list')
  .action(async (targetPath = '.') => {
    await bundleCompileCommand(targetPath);
  });

bundle
  .command('distribute [path]')
  .description('Distribute a bundle to a platform')
  .requiredOption('--platform <platform>', 'opencode or claude-code')
  .action(async (targetPath = '.', options) => {
    await bundleDistributeCommand(targetPath, options);
  });

program
  .command('status [path]')
  .description('Show CometFlow project status')
  .action(async (targetPath = '.') => {
    await statusCommand(targetPath);
  });

program
  .command('metrics [path]')
  .description('Report rebuild-quality and spec-health metrics (read-only)')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await metricsCommand(targetPath, options);
  });

program
  .command('eval [path]')
  .description('Run local evaluation tasks from .cometflow/eval.yaml')
  .action(async (targetPath = '.') => {
    await evalCommand(targetPath);
  });

const hook = program.command('hook').description('Write guard commands');

hook
  .command('check <target> [path]')
  .description('Check whether a write target is allowed')
  .requiredOption('--event <event>', 'write or edit')
  .action(async (target, targetPath = '.', options) => {
    await hookCheckCommand(targetPath, { event: options.event, target });
  });

hook
  .command('install [path]')
  .description('Install the platform hook that enforces the write guard')
  .option('--platform <platform>', 'claude-code | opencode | codex')
  .action(async (targetPath = '.', options) => {
    await hookInstallCommand(targetPath, options);
  });

hook
  .command('status [path]')
  .description('Show whether the platform hook is installed and healthy')
  .option('--platform <platform>', 'clamp to one platform')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await hookStatusCommand(targetPath, options);
  });

hook
  .command('uninstall [path]')
  .description('Remove the platform hook installed by CometFlow')
  .option('--platform <platform>', 'claude-code | opencode | codex')
  .action(async (targetPath = '.', options) => {
    await hookUninstallCommand(targetPath, options);
  });

program
  .command('doctor [path]')
  .description('Diagnose CometFlow project health')
  .option('--json', 'Output as JSON')
  .option('--clean-temp', 'Remove leftover atomic-write temporary files')
  .option('--clean-jobs', 'Reclaim job evidence beyond the retention window')
  .option('--force-unlock', 'Clear a leftover transaction lock after confirming the holder is gone')
  .action(async (targetPath = '.', options) => {
    await doctorCommand(targetPath, options);
  });

const gate = program.command('gate').description('Spec gates (same implementation as CI)');

gate
  .command('check [path]')
  .description('Run the read-only spec gates')
  .option('--json', 'Output as JSON')
  .option('--update-baseline', 'Rewrite the metrics baseline instead of comparing against it')
  .option('--findings', 'Also list every finding (spec verify + doctor), deduplicated')
  .action(async (targetPath = '.', options) => {
    await gateCheckCommand(targetPath, options);
  });

gate
  .command('install [path]')
  .description('Install the gates where they run: --git-hooks for .git/hooks/pre-commit')
  .option('--git-hooks', 'Install a chained pre-commit hook')
  .action(async (targetPath = '.', options) => {
    await gateInstallCommand(targetPath, options);
  });

gate
  .command('status [path]')
  .description('Show where the gates are installed and whether they drifted')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await gateStatusCommand(targetPath, options);
  });

gate
  .command('uninstall [path]')
  .description('Remove the gates from where they were installed')
  .option('--git-hooks', 'Remove the pre-commit hook (restores the original byte-for-byte)')
  .action(async (targetPath = '.', options) => {
    await gateUninstallCommand(targetPath, options);
  });

program
  .command('project migrate [path]')
  .description('Migrate legacy NIGHTSHIFT/.nightshift project to CometFlow')
  .action(async (targetPath = '.') => {
    await projectMigrateCommand(targetPath);
  });

program
  .command('update')
  .description('Update CometFlow (MVP stub)')
  .action(async () => {
    await updateCommand();
  });

program
  .command('uninstall [path]')
  .description('Uninstall CometFlow project state')
  .option('--force', 'Confirm removal of .cometflow/')
  .action(async (targetPath = '.', options) => {
    await uninstallCommand(targetPath, options);
  });

program
  .command('dashboard [path]')
  .description('Start the local CometFlow dashboard')
  .option('--port <port>', 'HTTP port', (value) => Number.parseInt(value, 10))
  .action(async (targetPath = '.', options) => {
    await dashboardCommand(targetPath, options);
  });

program
  .command('serve')
  .description('Start the CometFlow web client (workspace + API + UI)')
  .option('--workspace <dir>', 'Workspace directory (default ~/.cometflow/workspace)')
  .option('--port <port>', 'HTTP port', (value) => Number.parseInt(value, 10))
  .option('--token <token>', 'Bearer token (default random)')
  .option('--web-dir <dir>', 'Static web assets directory (default ./web)')
  .option('--host <host>', 'Bind host (default 127.0.0.1)')
  .action(async (options) => {
    await serveCommand(options);
  });

const evolve = program.command('evolve').description('Evolution commands');

evolve
  .command('propose <name>')
  .description('Create an evolution proposal')
  .requiredOption('--summary <text>', 'Proposal summary')
  .option('--risk <text>', 'Risk and gate plan')
  .option('--path <path>', 'Project root')
  .action(async (name, options) => {
    await evolveProposeCommand(name, options);
  });

evolve
  .command('approve <name> [path]')
  .description('Approve a verified/ready-for-review evolution (terminal state)')
  .option('--note <text>', 'Review note')
  .option('--commits <csv>', 'Comma-separated merged commit hashes')
  .action(async (name, targetPath = '.', options) => {
    await evolveApproveCommand(name, targetPath, options);
  });

evolve
  .command('reject <name> [path]')
  .description('Reject an evolution with a reason (terminal state)')
  .requiredOption('--reason <text>', 'Rejection reason')
  .action(async (name, targetPath = '.', options) => {
    await evolveRejectCommand(name, targetPath, options);
  });

evolve
  .command('review-list [path]')
  .description('List all evolution proposals with review status')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await evolveReviewListCommand(targetPath, options);
  });

evolve
  .command('verify <name> [path]')
  .description('Run evolution verification gates')
  .option('--eval', 'Also run local scientific eval')
  .action(async (name, targetPath = '.', options) => {
    await evolveVerifyCommand(name, targetPath, options);
  });

evolve
  .command('submit <name> [path]')
  .description('Submit a verified evolution for human review')
  .action(async (name, targetPath = '.') => {
    await evolveSubmitCommand(name, targetPath);
  });

evolve
  .command('status <name> [path]')
  .description('Show evolution proposal status')
  .action(async (name, targetPath = '.') => {
    await evolveStatusCommand(name, targetPath);
  });

evolve
  .command('rollback <name> [path]')
  .description('Print rollback guidance for an evolution')
  .action(async (name, targetPath = '.') => {
    await evolveRollbackCommand(name, targetPath);
  });

const daemon = program.command('daemon').description('Scheduler daemon commands');

daemon
  .command('start [path]')
  .description('Start the CometFlow scheduler daemon')
  .option('--mode <mode>', 'always | idle | schedule | manual', 'always')
  .option('--budget <ms>', 'Total daemon budget in milliseconds', (value) => Number.parseInt(value, 10))
  .option('--interval <ms>', 'Iteration interval in milliseconds', (value) => Number.parseInt(value, 10))
  .option('--agent <agent>', 'Agent id: opencode or claude-code')
  .option('--model <model>', 'Model override')
  .option('--cpu-threshold <value>', 'Idle-mode CPU threshold', (value) => Number.parseFloat(value))
  .option('--start <HH:MM>', 'Schedule window start (schedule mode)')
  .option('--end <HH:MM>', 'Schedule window end (schedule mode)')
  .option('--safety-bundle', 'Create a git bundle snapshot before running')
  .option('--max-attempts <n>', 'Give up on a task after N failed starts', (value) => Number.parseInt(value, 10))
  .option('--task-timeout <ms>', 'Per-task timeout in milliseconds', (value) => Number.parseInt(value, 10))
  .action(async (targetPath = '.', options) => {
    await daemonStartCommand(targetPath, options);
  });

daemon
  .command('budget [path]')
  .description('Show (or with --reset, clear) the accumulated scheduler budget usage')
  .option('--reset', 'Reset used budget to zero')
  .action(async (targetPath = '.', options) => {
    await daemonBudgetCommand(targetPath, options);
  });

const daemonQueue = daemon.command('queue').description('Todo list maintenance');

daemonQueue
  .command('rebuild [path]')
  .description('Re-derive the todo list from facts, keeping the runtime overlay')
  .action(async (targetPath = '.') => {
    await daemonQueueCommand('rebuild', targetPath);
  });

daemonQueue
  .command('reset [path]')
  .description('Drop the runtime overlay so every non-delivered task runs again')
  .action(async (targetPath = '.') => {
    await daemonQueueCommand('reset', targetPath);
  });

daemonQueue
  .command('retry <task> [path]')
  .description('Requeue a single task (e.g. G1:T1) without touching the others')
  .action(async (task, targetPath = '.') => {
    await daemonRetryCommand(task, targetPath);
  });

for (const action of ['pause', 'resume', 'stop'] as const) {
  daemon
    .command(action + ' [path]')
    .description(action === 'pause' ? 'Ask the running daemon to pause (next iteration)' : action === 'resume' ? 'Clear a pause request' : 'Ask the running daemon to stop (next iteration)')
    .action(async (targetPath = '.') => {
      await daemonControlCommand(action, targetPath);
    });
}

const context = program.command('context').description('Project context commands');

context
  .command('sync [path]')
  .description('Sync tech stack and runtime context from COMETFLOW.md')
  .action(async (targetPath = '.') => {
    await contextSyncCommand(targetPath);
  });

const goal = program.command('goal').description('Goal commands');

goal
  .command('sync [path]')
  .description('Sync goals from COMETFLOW.md to .cometflow/goals')
  .action(async (targetPath = '.') => {
    await goalSyncCommand(targetPath);
  });

const spec = program.command('spec').description('Spec kernel commands');

spec
  .command('validate [path]')
  .description('Validate specs/ structure and acceptance coverage')
  .action(async (targetPath = '.') => {
    await specValidateCommand(targetPath);
  });

spec
  .command('anchors [path]')
  .description('List spec anchors')
  .action(async (targetPath = '.') => {
    await specAnchorsCommand(targetPath);
  });

spec
  .command('checks [path]')
  .description('List acceptance items and their executable checks')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await specChecksCommand(targetPath, options);
  });

spec
  .command('lock [path]')
  .description('Snapshot spec hashes to .cometflow/spec-lock.json')
  .action(async (targetPath = '.') => {
    await specLockCommand(targetPath);
  });

spec
  .command('diff [path]')
  .description('Diff current specs against the spec lock, or analyze impact with --impact')
  .option('--impact', 'Analyze which anchors and frozen tasks are affected')
  .option('--change <name>', 'With --impact: preview a change\'s proposed specs before archiving')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await specDiffCommand(targetPath, options);
  });

spec
  .command('drift [path]')
  .description('Find frozen tasks whose spec content has drifted')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await specDriftCommand(targetPath, options);
  });

spec
  .command('versions [path]')
  .description('List recorded spec versions')
  .option('--spec <path>', 'Only show versions for one spec path')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await specVersionsCommand(targetPath, options);
  });

spec
  .command('show <version-ref> [path]')
  .description('Print a recorded spec version (<path>@<version> or <hash>)')
  .action(async (versionRef, targetPath = '.') => {
    await specShowCommand(versionRef, targetPath);
  });

spec
  .command('restore <version-ref> [path]')
  .description('Restore a canonical spec from the version store')
  .action(async (versionRef, targetPath = '.') => {
    await specRestoreCommand(versionRef, targetPath);
  });

spec
  .command('verify [path]')
  .description('Check spec/version/lock/task consistency (exit 1 on failure)')
  .option('--json', 'Output as JSON')
  .option('--with-doctor', 'Also list doctor findings (another scope; does not change the exit code)')
  .action(async (targetPath = '.', options) => {
    await specVerifyCommand(targetPath, options);
  });

spec
  .command('approve <spec-file> [path]')
  .description('Mark a spec as approved (draft → approved); required before plan freeze')
  .action(async (specFile, targetPath = '.') => {
    await specApproveCommand(specFile, targetPath);
  });

spec
  .command('scaffold [path]')
  .description('Scaffold missing spec kinds from project type (non-destructive)')
  .option('--interactive', 'Ask interactive questions for deferred kinds')
  .option('--list', 'List spec kind states instead of scaffolding')
  .option('--capability <name>', 'Scaffold specs/<name>/spec.md (repeatable)', (value, previous: string[]) => previous.concat([value]), [] as string[])
  .action(async (targetPath = '.', options) => {
    if (options.list) await specScaffoldListCommand(targetPath);
    else await specScaffoldCommand(targetPath, { interactive: options.interactive === true, capabilities: options.capability });
  });

spec
  .command('index [path]')
  .description('Generate .cometflow/spec-index projection files')
  .action(async (targetPath = '.') => {
    await specIndexCommand(targetPath);
  });

spec
  .command('graph [path]')
  .description('Print the cross-file reference graph (projection only; spec validate owns the gate)')
  .option('--json', 'Output as JSON')
  .action(async (targetPath = '.', options) => {
    await specGraphCommand(targetPath, options);
  });

spec
  .command('import <file> [path]')
  .description('Import a table-shaped interface inventory (CSV/TSV/markdown) into capability specs')
  .option('--force', 'Overwrite existing capability specs')
  .option('--module <path>', 'Default code module boundary for imported capabilities')
  .action(async (file, targetPath = '.', options) => {
    await specImportCommand(file, targetPath, { force: options.force === true, module: options.module });
  });

const plan = program.command('plan').description('Task plan commands');

plan
  .command('generate <goal> [path]')
  .description('Generate a task plan from a goal')
  .action(async (goal, targetPath = '.') => {
    await planGenerateCommand(goal, targetPath);
  });

plan
  .command('regenerate <goal> [path]')
  .description('Regenerate a task plan, optionally preserving approved tasks')
  .option('--preserve-approved', 'Preserve unaffected approved/frozen tasks')
  .action(async (goal, targetPath = '.', options) => {
    await planRegenerateCommand(goal, targetPath, options);
  });

plan
  .command('validate <goal> [path]')
  .description('Validate a task plan')
  .action(async (goal, targetPath = '.') => {
    await planValidateCommand(goal, targetPath);
  });

plan
  .command('review <goal> [path]')
  .description('Mark a task plan as reviewed')
  .action(async (goal, targetPath = '.') => {
    await planReviewCommand(goal, targetPath);
  });

plan
  .command('approve <goal> [path]')
  .description('Approve a task plan')
  .action(async (goal, targetPath = '.') => {
    await planApproveCommand(goal, targetPath);
  });

plan
  .command('freeze <goal> [path]')
  .description('Freeze a task plan and extract acceptance IDs')
  .action(async (goal, targetPath = '.') => {
    await planFreezeCommand(goal, targetPath);
  });

plan
  .command('trace <goal> [path]')
  .description('Print task-to-spec traceability')
  .action(async (goal, targetPath = '.') => {
    await planTraceCommand(goal, targetPath);
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

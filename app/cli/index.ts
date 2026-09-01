#!/usr/bin/env node
import { Command } from 'commander';
import { agentCheckCommand, agentListCommand } from '../commands/agent.js';
import {
  changeNewCommand,
  changeStatusCommand,
  changeTransitionCommand,
} from '../commands/change.js';
import { daemonStartCommand } from '../commands/daemon.js';
import { goalSyncCommand } from '../commands/goal.js';
import { initCommand } from '../commands/init.js';
import { runCommand } from '../commands/run.js';
import {
  specAnchorsCommand,
  specDiffCommand,
  specLockCommand,
  specValidateCommand,
} from '../commands/spec.js';
import {
  planApproveCommand,
  planFreezeCommand,
  planGenerateCommand,
  planReviewCommand,
  planTraceCommand,
  planValidateCommand,
} from '../commands/plan.js';

const program = new Command();

program
  .name('cometflow')
  .description('Full-time autonomous agent development platform')
  .version('0.1.0');

program
  .command('init [path]')
  .description('Initialize a CometFlow project')
  .action(async (targetPath = '.') => {
    await initCommand(targetPath);
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
  .command('status <name> [path]')
  .description('Show a change state')
  .action(async (name, targetPath = '.') => {
    await changeStatusCommand(name, targetPath);
  });

change
  .command('transition <name> <event> [path]')
  .description('Apply a change transition: confirm-acceptance | submit-candidate | verify-pass | archive-complete')
  .action(async (name, event, targetPath = '.') => {
    await changeTransitionCommand(name, event, targetPath);
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
  .action(async (targetPath = '.', options) => {
    await daemonStartCommand(targetPath, options);
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
  .command('lock [path]')
  .description('Snapshot spec hashes to .cometflow/spec-lock.json')
  .action(async (targetPath = '.') => {
    await specLockCommand(targetPath);
  });

spec
  .command('diff [path]')
  .description('Diff current specs against the spec lock')
  .action(async (targetPath = '.') => {
    await specDiffCommand(targetPath);
  });

const plan = program.command('plan').description('Task plan commands');

plan
  .command('generate <goal> [path]')
  .description('Generate a task plan from a goal')
  .action(async (goal, targetPath = '.') => {
    await planGenerateCommand(goal, targetPath);
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

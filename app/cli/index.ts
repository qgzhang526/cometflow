#!/usr/bin/env node
import { Command } from 'commander';
import { goalSyncCommand } from '../commands/goal.js';
import { initCommand } from '../commands/init.js';
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

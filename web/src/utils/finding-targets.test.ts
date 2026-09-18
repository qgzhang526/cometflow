import { describe, expect, it } from 'vitest';
import { targetForFinding } from './finding-targets';
import type { Finding } from '../api/types';

const finding = (code: string, subject = '', source: Finding['source'] = 'spec-verify'): Finding => ({
  source,
  code,
  severity: 'error',
  subject,
  message: code,
});

/**
 * 问题清单的「去处理」必须落到**能处理它的那一页**。
 *
 * 这条映射出过错：`spec 与 spec-lock 不一致` 只映射到「规格」面板，于是落到默认的
 * 「12-kind 状态」页签——那里既看不到差异也没有「建立基线」按钮，用户只能自己找。
 */
describe('targetForFinding', () => {
  it('spec-lock 不一致 → 规格 · 影响与门禁，并带上那份 spec', () => {
    expect(targetForFinding(finding('stale-spec-lock', 'specs/report/spec.md'))).toEqual({
      panel: 'specs',
      tab: 'integrity',
      subject: 'specs/report/spec.md',
      reason: expect.stringContaining('建立基线'),
    });
    expect(targetForFinding(finding('missing-spec-lock'))?.tab).toBe('integrity');
  });

  it('版本缺失 → 版本页签；正文问题 → Spec 文件页签', () => {
    expect(targetForFinding(finding('missing-version-blob', 'specs/auth/spec.md'))?.tab).toBe('versions');
    expect(targetForFinding(finding('anchor-drift', 'specs/core/spec.md'))?.tab).toBe('files');
    expect(targetForFinding(finding('spec-is-draft', 'specs/new/spec.md'))?.tab).toBe('files');
  });

  it('change 侧的问题去「变更」，而不是被 source=spec-verify 骗去「规格」', () => {
    expect(targetForFinding(finding('change-base-conflict', 'G1-T1'))?.panel).toBe('changes');
    expect(targetForFinding(finding('change-state-integrity', 'G1-T1'))?.panel).toBe('changes');
    expect(targetForFinding(finding('multiple-active-changes', '', 'doctor'))?.panel).toBe('changes');
  });

  it('hook / 并发策略各自去资产与设置', () => {
    expect(targetForFinding(finding('hook-guard-missing', '', 'doctor'))?.tab).toBe('hook');
    // 旧映射靠 `code.includes('hook')` 兜住的三条不能丢：装了/没装/过时都有去处。
    expect(targetForFinding(finding('hook-not-installed', '', 'doctor'))?.tab).toBe('hook');
    expect(targetForFinding(finding('hook-guard-outdated', '', 'doctor'))?.tab).toBe('hook');
    expect(targetForFinding(finding('concurrency-policy-unset', '', 'doctor'))?.panel).toBe('settings');
  });

  it('计划侧与 spec validate 汇总各有去处', () => {
    expect(targetForFinding(finding('no-plans', '', 'doctor'))?.panel).toBe('plans');
    expect(targetForFinding(finding('plan-integrity', 'G1'))?.panel).toBe('plans');
    expect(targetForFinding(finding('invalid-specs', '', 'doctor'))?.tab).toBe('integrity');
  });

  it('doctor 镜像的 code 前缀也能认', () => {
    expect(targetForFinding(finding('spec-verify:stale-spec-lock', 'specs/x/spec.md', 'doctor'))?.tab).toBe('integrity');
  });

  it('说不出去处的（临时文件 / 证据占用）不给按钮，避免点进去发现处理不了', () => {
    expect(targetForFinding(finding('orphan-atomic-temp', '', 'doctor'))).toBeNull();
    expect(targetForFinding(finding('job-evidence-reclaimable', '', 'doctor'))).toBeNull();
    // 兜底：看不认识的 code，但 subject 是 spec 路径 → 至少能看正文。
    expect(targetForFinding(finding('brand-new-code', 'specs/x/spec.md'))).toEqual({
      panel: 'specs',
      tab: 'files',
      subject: 'specs/x/spec.md',
    });
    expect(targetForFinding(finding('brand-new-code', 'whatever'))).toBeNull();
  });
});

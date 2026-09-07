import type { LlmJudgeConfig, LlmJudgeSummary, EvalReport } from './types.js';

export async function runLlmJudge(report: EvalReport, config: LlmJudgeConfig): Promise<LlmJudgeSummary> {
  if (config.provider === 'mock') {
    const notes = [
      'mock judge used deterministic report-based verdict',
      'pass@k rate: ' + report.passAtKRate.toFixed(2),
      'pass^k rate: ' + report.passAllKRate.toFixed(2),
    ];
    return { provider: 'mock', verdict: report.passed ? 'pass' : 'fail', notes };
  }

  if (config.provider === 'langsmith' || config.provider === 'langfuse') {
    const apiKey = config.api_key_env ? process.env[config.api_key_env] : undefined;
    if (!apiKey) {
      return { provider: config.provider, verdict: 'blocked', notes: ['LLM judge is not configured: missing ' + (config.api_key_env ?? 'API key')] };
    }
    // 真实 LLM judge 网络调用在此接入；当前保持 contract-only，避免测试依赖外部服务。
    return { provider: config.provider, verdict: 'blocked', notes: ['real LLM judge transport not implemented in this MVP; api key detected for ' + config.provider] };
  }

  throw new Error('Unsupported LLM judge provider: ' + config.provider);
}

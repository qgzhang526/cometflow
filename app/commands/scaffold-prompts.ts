import { promptBoolean, promptChoice, promptLine, type PromptIO } from '../../platform/io/prompt.js';
import type { ScaffoldAnswers, StackHints } from '../../domains/project/scaffold.js';

export async function askScaffoldPrompts(includeStack: boolean, io?: PromptIO): Promise<{ stack: StackHints; answers: ScaffoldAnswers }> {
  const stack: StackHints = {};
  if (includeStack) {
    stack.frontend = await promptLine('前端框架（无则填 无）', '无', io);
    stack.backend = await promptLine('后端语言/框架（无则留空）', '', io);
    stack.database = await promptLine('数据库（无则填 无）', '无', io);
  }

  const answers: ScaffoldAnswers = {};
  answers.network = await promptBoolean('是否有对外网络接口 / 通信协议？', io);
  answers.runtimeConfig = await promptBoolean('是否有运行时配置键（端口/密钥/连接串）？', io);
  answers.crossApiFlow = await promptBoolean('是否有跨接口/跨模块的业务场景？', io);
  answers.backgroundProcess = await promptBoolean('是否有常驻后台进程或定时循环？', io);
  answers.domainDsl = await promptBoolean('是否有领域 DSL 或业务不变量？', io);
  answers.auth = await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const, io);
  answers.manyErrors = await promptBoolean('错误码是否较多（>20 个）？', io);

  return { stack, answers };
}

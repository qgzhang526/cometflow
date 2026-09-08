import { promptBoolean, promptChoice, promptLine } from '../../platform/io/prompt.js';
import type { ScaffoldAnswers, StackHints } from '../../domains/project/scaffold.js';

export async function askScaffoldPrompts(includeStack: boolean): Promise<{ stack: StackHints; answers: ScaffoldAnswers }> {
  const stack: StackHints = {};
  if (includeStack) {
    stack.frontend = await promptLine('前端框架（无则填 无）', '无');
    stack.backend = await promptLine('后端语言/框架（无则留空）', '');
    stack.database = await promptLine('数据库（无则填 无）', '无');
  }

  const answers: ScaffoldAnswers = {};
  answers.network = await promptBoolean('是否有对外网络接口 / 通信协议？');
  answers.runtimeConfig = await promptBoolean('是否有运行时配置键（端口/密钥/连接串）？');
  answers.crossApiFlow = await promptBoolean('是否有跨接口/跨模块的业务场景？');
  answers.backgroundProcess = await promptBoolean('是否有常驻后台进程或定时循环？');
  answers.domainDsl = await promptBoolean('是否有领域 DSL 或业务不变量？');
  answers.auth = await promptChoice('鉴权方式', ['none', 'machine', 'roles'] as const);
  answers.manyErrors = await promptBoolean('错误码是否较多（>20 个）？');

  return { stack, answers };
}

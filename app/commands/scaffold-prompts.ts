import { promptBoolean, promptChoice, promptLine, type PromptIO } from '../../platform/io/prompt.js';
import type { ScaffoldAnswers, StackHints } from '../../domains/project/scaffold.js';

export async function askScaffoldPrompts(includeStack: boolean, io?: PromptIO): Promise<{ stack: StackHints; answers: ScaffoldAnswers }> {
  const stack: StackHints = {};
  if (includeStack) {
    stack.frontend = await promptLine('前端框架（没有就直接回车）', '无', io);
    stack.backend = await promptLine('后端语言/框架（没有就直接回车）', '无', io);
    stack.database = await promptLine('数据库（没有就直接回车）', '无', io);
  }

  const answers: ScaffoldAnswers = {};
  answers.network = await promptBoolean('是否有对外网络接口，或需要调用外部 HTTP / 网络接口？', io);
  answers.runtimeConfig = await promptBoolean('是否有运行时配置键（端口/密钥/连接串）？', io);
  answers.crossApiFlow = await promptBoolean('是否有跨接口/跨模块的业务场景？', io);
  answers.backgroundProcess = await promptBoolean('是否有常驻后台进程或定时循环？', io);
  answers.domainDsl = await promptBoolean('是否有领域规则 / 业务不变量（策略、匹配判定、外部 DSL 语义）？', io);
  answers.auth = await promptChoice<'none' | 'machine' | 'roles'>('鉴权方式（none=无 / machine=机机 / roles=角色矩阵）', ['none', 'machine', 'roles'] as const, io, {
    aliases: { '无': 'none', '无需': 'none', '机机': 'machine', '机机通信': 'machine', '角色': 'roles', '角色矩阵': 'roles' },
  });
  answers.manyErrors = await promptBoolean('是否需要独立的错误码目录（跨接口错误码较多时选是）？', io);

  return { stack, answers };
}

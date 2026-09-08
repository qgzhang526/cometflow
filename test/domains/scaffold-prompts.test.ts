import { describe, expect, it, vi } from 'vitest';
import { promptBoolean, promptChoice, promptLine } from '../../platform/io/prompt.js';
import { askScaffoldPrompts } from '../../app/commands/scaffold-prompts.js';

vi.mock('../../platform/io/prompt.js', () => ({
  promptLine: vi.fn(),
  promptBoolean: vi.fn(),
  promptChoice: vi.fn(),
}));

const promptLineMock = vi.mocked(promptLine);
const promptBooleanMock = vi.mocked(promptBoolean);
const promptChoiceMock = vi.mocked(promptChoice);

describe('scaffold prompts wiring', () => {
  it('collects stack hints and answers in order', async () => {
    promptLineMock
      .mockResolvedValueOnce('Vue')
      .mockResolvedValueOnce('TypeScript')
      .mockResolvedValueOnce('PostgreSQL');
    promptBooleanMock.mockResolvedValue(true);
    promptChoiceMock.mockResolvedValue('machine');

    const { stack, answers } = await askScaffoldPrompts(true);

    expect(promptLineMock).toHaveBeenCalledTimes(3);
    expect(promptBooleanMock).toHaveBeenCalledTimes(6);
    expect(promptChoiceMock).toHaveBeenCalledTimes(1);
    expect(stack).toEqual({ frontend: 'Vue', backend: 'TypeScript', database: 'PostgreSQL' });
    expect(answers).toMatchObject({
      network: true,
      runtimeConfig: true,
      crossApiFlow: true,
      backgroundProcess: true,
      domainDsl: true,
      auth: 'machine',
      manyErrors: true,
    });
  });

  it('skips stack questions when includeStack is false', async () => {
    promptLineMock.mockClear();
    promptBooleanMock.mockResolvedValue(false);
    promptChoiceMock.mockResolvedValue('none');

    const { stack, answers } = await askScaffoldPrompts(false);

    expect(promptLineMock).not.toHaveBeenCalled();
    expect(stack).toEqual({});
    expect(answers.auth).toBe('none');
    expect(answers.network).toBe(false);
  });
});

/**
 * 按 key 串行化：同一个 key 的任务排队执行，不同 key 互不等待。
 *
 * 解决的问题是**异步写入的顺序**：`writeX()` 是异步的，"谁先发起"不等于"谁先落盘"。
 * 同一个目标连着写两次（先写 status=running、再写 result），如果第一次的 rename 落在第二次
 * 之后，磁盘上留下的就是**旧快照**——而且再也不会被修正（后面没有写入了）。
 *
 * 排队只保证**顺序**，不传播失败：前一个任务失败不能卡住后面所有任务（否则一次写失败
 * 会让这个 key 永久哑掉）。失败仍然返回给调用方。
 *
 * 注意这**不是**跨进程互斥——跨进程/跨机器的一致性继续靠 `platform/fs/file-lock.ts`。
 */
export function createKeyedSerializer(): <T>(key: string, task: () => Promise<T>) => Promise<T> {
  const chains = new Map<string, Promise<void>>();
  return <T>(key: string, task: () => Promise<T>): Promise<T> => {
    const previous = chains.get(key) ?? Promise.resolve();
    // 上一个成功或失败都往下走：entries 的顺序由这里决定。
    const next = previous.then(task, task);
    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    chains.set(key, settled);
    void settled.then(() => {
      // 只在"自己仍是队尾"时清理，避免删掉后来者的链。
      if (chains.get(key) === settled) chains.delete(key);
    });
    return next;
  };
}

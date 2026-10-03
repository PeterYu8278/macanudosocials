export const forEachMigrationMember = async <T>(
  rows: T[],
  memberKey: (row: T) => string,
  process: (row: T) => Promise<void>,
  concurrency = 4,
): Promise<void> => {
  const groups = new Map<string, T[]>()
  rows.forEach(row => {
    const key = memberKey(row)
    const group = groups.get(key) || []
    group.push(row)
    groups.set(key, group)
  })
  const queue = [...groups.values()]
  let next = 0
  // Each member has one worker, preserving order for repeated records.
  await Promise.all(Array.from({ length: Math.min(Math.max(1, Math.floor(concurrency)), queue.length) }, async () => {
    while (next < queue.length) {
      const group = queue[next++]
      for (const row of group) await process(row)
    }
  }))
}

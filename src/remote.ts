import type { ExecutionRecord } from './types'

/**
 * 模拟中心侧接收通道：
 * - 可注入“本机写入失败”，失败的回传进入待重试队列；
 * - 按 clientToken 幂等：同一施工单的重复回传只落一条记录。
 */
const seenTokens = new Set<string>()
const accepted = new Map<string, ExecutionRecord>()
let failuresQueued = 0

export function primeRemote(records: ExecutionRecord[]) {
  records.forEach((record) => {
    accepted.set(record.id, record)
    if (record.clientToken) seenTokens.add(record.clientToken)
  })
}

/** 让接下来的 n 次写入失败（模拟本机网络/磁盘故障） */
export function injectWriteFailures(n = 1) {
  failuresQueued += n
}

export function remoteHealthy() {
  return failuresQueued === 0
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function remotePostExecution(record: ExecutionRecord): Promise<{ duplicated: boolean }> {
  await delay(150)
  if (failuresQueued > 0) {
    failuresQueued -= 1
    throw new Error('本机写入失败：回传暂存本机，可按施工编号重试')
  }
  const token = record.clientToken
  if (token && seenTokens.has(token)) return { duplicated: true }
  if (token) seenTokens.add(token)
  accepted.set(record.id, record)
  return { duplicated: false }
}

export function acceptedCount() {
  return accepted.size
}

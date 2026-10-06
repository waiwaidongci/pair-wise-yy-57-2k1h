import { onBeforeUnmount, onMounted } from 'vue'

export function useExecutionSocket(onProgress: (value: number) => void, onState: (state: '在线' | '重连中') => void) {
  let socket: WebSocket | undefined
  function connect() {
    const url = import.meta.env.VITE_WS_URL as string | undefined
    if (url) {
      socket = new WebSocket(url)
      socket.onmessage = (event) => onProgress(JSON.parse(event.data).progress)
      socket.onclose = () => onState('重连中')
      return
    }
    // 无真实通道时只报告在线状态，不再伪造执行进度：进度只由实际判定驱动
    onState('在线')
  }
  onMounted(connect)
  onBeforeUnmount(() => socket?.close())
}

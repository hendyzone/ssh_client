import { create } from "zustand";

export interface Tab {
  sessionId: string;
  hostId: string;
  title: string;
}

interface SessionState {
  tabs: Tab[];
  activeId: string | null;
  /** 打开新会话标签，返回新 sessionId 并设为激活。 */
  open: (hostId: string, title: string) => string;
  /** 关闭标签；若关的是激活标签，激活回退到剩余最后一个（无则 null）。 */
  close: (sessionId: string) => void;
  /** 切换激活标签。 */
  setActive: (sessionId: string) => void;
}

let counter = 0;

export const useSessions = create<SessionState>((set, get) => ({
  tabs: [],
  activeId: null,
  open: (hostId, title) => {
    counter += 1;
    const sessionId = `${hostId}-${counter}`;
    set((s) => ({ tabs: [...s.tabs, { sessionId, hostId, title }], activeId: sessionId }));
    return sessionId;
  },
  close: (sessionId) => {
    const { tabs, activeId } = get();
    const remaining = tabs.filter((t) => t.sessionId !== sessionId);
    let nextActive = activeId;
    if (activeId === sessionId) {
      nextActive = remaining.length ? remaining[remaining.length - 1].sessionId : null;
    }
    set({ tabs: remaining, activeId: nextActive });
  },
  setActive: (sessionId) => set({ activeId: sessionId }),
}));

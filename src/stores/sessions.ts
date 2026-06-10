import { create } from "zustand";

/** 二级标签：一次具体的连接实例。 */
export interface Instance {
  sessionId: string;
  title: string; // 如 "#1"、"#2"
}

/** 一级标签：一台服务器（按 hostId 聚合），下含多个连接实例。 */
export interface ServerTab {
  hostId: string;
  title: string;
  instances: Instance[];
  activeInstanceId: string | null;
  seq: number; // 单调递增，给实例编号用（关闭后不复用编号）
}

interface SessionState {
  servers: ServerTab[];
  activeHostId: string | null;
  /** 为某主机打开一个新连接实例（必要时新建一级服务器标签），返回 sessionId 并设为激活。 */
  open: (hostId: string, title: string) => string;
  /** 关闭某服务器下的一个实例；该服务器实例清空后自动移除一级标签。 */
  closeInstance: (hostId: string, sessionId: string) => void;
  /** 关闭整个服务器（含其全部实例）。 */
  closeServer: (hostId: string) => void;
  /** 切换激活的一级服务器。 */
  setActiveServer: (hostId: string) => void;
  /** 切换某服务器下激活的二级实例。 */
  setActiveInstance: (hostId: string, sessionId: string) => void;
}

let counter = 0;

export const useSessions = create<SessionState>((set) => ({
  servers: [],
  activeHostId: null,

  open: (hostId, title) => {
    counter += 1;
    const sessionId = `${hostId}-${counter}`;
    set((s) => {
      const existing = s.servers.find((sv) => sv.hostId === hostId);
      if (existing) {
        const seq = existing.seq + 1;
        const instance: Instance = { sessionId, title: `#${seq}` };
        const servers = s.servers.map((sv) =>
          sv.hostId === hostId
            ? { ...sv, instances: [...sv.instances, instance], activeInstanceId: sessionId, seq }
            : sv,
        );
        return { servers, activeHostId: hostId };
      }
      const server: ServerTab = {
        hostId,
        title,
        instances: [{ sessionId, title: "#1" }],
        activeInstanceId: sessionId,
        seq: 1,
      };
      return { servers: [...s.servers, server], activeHostId: hostId };
    });
    return sessionId;
  },

  closeInstance: (hostId, sessionId) =>
    set((s) => {
      const updated = s.servers.map((sv) => {
        if (sv.hostId !== hostId) return sv;
        const instances = sv.instances.filter((i) => i.sessionId !== sessionId);
        let activeInstanceId = sv.activeInstanceId;
        if (activeInstanceId === sessionId) {
          activeInstanceId = instances.length ? instances[instances.length - 1].sessionId : null;
        }
        return { ...sv, instances, activeInstanceId };
      });
      // 移除实例已清空的服务器
      const servers = updated.filter((sv) => sv.instances.length > 0);
      let activeHostId = s.activeHostId;
      if (!servers.find((sv) => sv.hostId === activeHostId)) {
        activeHostId = servers.length ? servers[servers.length - 1].hostId : null;
      }
      return { servers, activeHostId };
    }),

  closeServer: (hostId) =>
    set((s) => {
      const servers = s.servers.filter((sv) => sv.hostId !== hostId);
      let activeHostId = s.activeHostId;
      if (activeHostId === hostId) {
        activeHostId = servers.length ? servers[servers.length - 1].hostId : null;
      }
      return { servers, activeHostId };
    }),

  setActiveServer: (hostId) => set({ activeHostId: hostId }),

  setActiveInstance: (hostId, sessionId) =>
    set((s) => ({
      servers: s.servers.map((sv) =>
        sv.hostId === hostId ? { ...sv, activeInstanceId: sessionId } : sv,
      ),
    })),
}));

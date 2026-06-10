import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

describe("sessions store（两级标签）", () => {
  beforeEach(() => {
    useSessions.setState({ servers: [], activeHostId: null });
  });

  it("open 新主机：建一级服务器标签 + 首个实例，并设为激活", () => {
    const id = useSessions.getState().open("hostA", "A");
    const { servers, activeHostId } = useSessions.getState();
    expect(servers).toHaveLength(1);
    expect(activeHostId).toBe("hostA");
    expect(servers[0].title).toBe("A");
    expect(servers[0].instances).toHaveLength(1);
    expect(servers[0].instances[0].sessionId).toBe(id);
    expect(servers[0].instances[0].title).toBe("#1");
    expect(servers[0].activeInstanceId).toBe(id);
  });

  it("再次 open 同一主机：在该服务器下加新实例（编号递增），不新建一级标签", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    const id2 = useSessions.getState().open("hostA", "A");
    const { servers } = useSessions.getState();
    expect(servers).toHaveLength(1);
    expect(servers[0].instances.map((i) => i.sessionId)).toEqual([id1, id2]);
    expect(servers[0].instances[1].title).toBe("#2");
    expect(servers[0].activeInstanceId).toBe(id2);
    expect(id1).not.toBe(id2);
  });

  it("open 不同主机：新增一级服务器标签并切换激活", () => {
    useSessions.getState().open("hostA", "A");
    useSessions.getState().open("hostB", "B");
    const { servers, activeHostId } = useSessions.getState();
    expect(servers.map((s) => s.hostId)).toEqual(["hostA", "hostB"]);
    expect(activeHostId).toBe("hostB");
  });

  it("setActiveServer / setActiveInstance 切换激活", () => {
    useSessions.getState().open("hostA", "A");
    const a2 = useSessions.getState().open("hostA", "A");
    useSessions.getState().open("hostB", "B");
    useSessions.getState().setActiveServer("hostA");
    expect(useSessions.getState().activeHostId).toBe("hostA");
    const first = useSessions.getState().servers[0].instances[0].sessionId;
    useSessions.getState().setActiveInstance("hostA", first);
    expect(useSessions.getState().servers[0].activeInstanceId).toBe(first);
    expect(a2).not.toBe(first);
  });

  it("closeInstance：关实例后激活回退；实例清空则移除该服务器", () => {
    const a1 = useSessions.getState().open("hostA", "A");
    const a2 = useSessions.getState().open("hostA", "A");
    useSessions.getState().closeInstance("hostA", a2);
    let sv = useSessions.getState().servers[0];
    expect(sv.instances).toHaveLength(1);
    expect(sv.activeInstanceId).toBe(a1);
    // 关掉最后一个实例 → 服务器被移除
    useSessions.getState().closeInstance("hostA", a1);
    expect(useSessions.getState().servers).toHaveLength(0);
    expect(useSessions.getState().activeHostId).toBeNull();
  });

  it("closeServer：移除整个服务器及其实例，激活回退", () => {
    useSessions.getState().open("hostA", "A");
    useSessions.getState().open("hostB", "B");
    useSessions.getState().closeServer("hostB");
    const { servers, activeHostId } = useSessions.getState();
    expect(servers.map((s) => s.hostId)).toEqual(["hostA"]);
    expect(activeHostId).toBe("hostA");
  });
});

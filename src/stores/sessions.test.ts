import { describe, it, expect, beforeEach } from "vitest";
import { useSessions } from "./sessions";

describe("sessions store", () => {
  beforeEach(() => {
    useSessions.setState({ tabs: [], activeId: null });
  });

  it("open 添加标签并设为激活，sessionId 唯一", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    const id2 = useSessions.getState().open("hostB", "B");
    const { tabs, activeId } = useSessions.getState();
    expect(tabs).toHaveLength(2);
    expect(id1).not.toBe(id2);
    expect(activeId).toBe(id2);
    expect(tabs[0]).toMatchObject({ hostId: "hostA", title: "A" });
  });

  it("setActive 切换激活标签", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    useSessions.getState().open("hostB", "B");
    useSessions.getState().setActive(id1);
    expect(useSessions.getState().activeId).toBe(id1);
  });

  it("close 移除标签；关闭激活标签后激活回退到最后一个，空了为 null", () => {
    const id1 = useSessions.getState().open("hostA", "A");
    const id2 = useSessions.getState().open("hostB", "B");
    useSessions.getState().close(id2);
    expect(useSessions.getState().tabs).toHaveLength(1);
    expect(useSessions.getState().activeId).toBe(id1);
    useSessions.getState().close(id1);
    expect(useSessions.getState().tabs).toHaveLength(0);
    expect(useSessions.getState().activeId).toBeNull();
  });
});

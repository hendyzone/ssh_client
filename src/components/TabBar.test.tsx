import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { TabBar } from "./TabBar";

const tabs = [
  { sessionId: "s1", hostId: "h1", title: "web1" },
  { sessionId: "s2", hostId: "h2", title: "db1" },
];

describe("TabBar", () => {
  it("渲染所有标签标题", () => {
    render(<TabBar tabs={tabs} activeId="s1" onSelect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("web1")).toBeInTheDocument();
    expect(screen.getByText("db1")).toBeInTheDocument();
  });

  it("点击标签触发 onSelect", () => {
    const onSelect = vi.fn();
    render(<TabBar tabs={tabs} activeId="s1" onSelect={onSelect} onClose={vi.fn()} />);
    fireEvent.click(screen.getByText("db1"));
    expect(onSelect).toHaveBeenCalledWith("s2");
  });

  it("点击关闭按钮触发 onClose 且不触发 onSelect", () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<TabBar tabs={tabs} activeId="s1" onSelect={onSelect} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText("关闭 db1"));
    expect(onClose).toHaveBeenCalledWith("s2");
    expect(onSelect).not.toHaveBeenCalled();
  });
});

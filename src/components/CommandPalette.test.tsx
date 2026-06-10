import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

import type { Host } from "../ipc";

const hosts: Host[] = [
  { id: "h1", name: "web-prod", address: "10.0.0.1", port: 22, username: "root", groupId: null, tags: ["prod"], authType: "password", credentialRef: "h1", proxyJump: null, keyPath: null, useTmux: false, tmuxSession: null },
  { id: "h2", name: "db-test", address: "10.0.0.2", port: 22, username: "root", groupId: null, tags: ["test"], authType: "password", credentialRef: "h2", proxyJump: null, keyPath: null, useTmux: false, tmuxSession: null },
];

describe("CommandPalette", () => {
  it("open=false 时不渲染", () => {
    const { container } = render(<CommandPalette open={false} hosts={hosts} onConnect={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("输入关键字过滤主机（按名称/地址/标签模糊匹配）", () => {
    render(<CommandPalette open={true} hosts={hosts} onConnect={vi.fn()} onClose={vi.fn()} />);
    expect(screen.getByText("web-prod")).toBeInTheDocument();
    expect(screen.getByText("db-test")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("搜索主机"), { target: { value: "db" } });
    expect(screen.queryByText("web-prod")).not.toBeInTheDocument();
    expect(screen.getByText("db-test")).toBeInTheDocument();
  });

  it("点击结果触发 onConnect 与 onClose", () => {
    const onConnect = vi.fn();
    const onClose = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={onConnect} onClose={onClose} />);
    fireEvent.click(screen.getByText("web-prod"));
    expect(onConnect).toHaveBeenCalledWith("h1");
    expect(onClose).toHaveBeenCalled();
  });

  it("回车连接第一个匹配项", () => {
    const onConnect = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={onConnect} onClose={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("搜索主机"), { target: { value: "db" } });
    fireEvent.keyDown(screen.getByLabelText("搜索主机"), { key: "Enter" });
    expect(onConnect).toHaveBeenCalledWith("h2");
  });

  it("Esc 触发 onClose", () => {
    const onClose = vi.fn();
    render(<CommandPalette open={true} hosts={hosts} onConnect={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByLabelText("搜索主机"), { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

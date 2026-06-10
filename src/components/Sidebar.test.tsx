import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useConnections } from "../stores/connections";

vi.mock("../stores/connections");

const removeHost = vi.fn();
const removeGroup = vi.fn();
const renameGroup = vi.fn();

describe("Sidebar", () => {
  beforeEach(() => {
    removeHost.mockClear();
    removeGroup.mockClear();
    renameGroup.mockClear();
    (useConnections as unknown as any).mockReturnValue({
      groups: [{ id: "g1", name: "生产组", parentId: null }],
      hosts: [
        { id: "h1", name: "web1", address: "10.0.0.1", port: 22, username: "root",
          groupId: "g1", tags: ["web"], authType: "password", credentialRef: null, proxyJump: null },
        { id: "h2", name: "db1", address: "10.0.0.2", port: 22, username: "root",
          groupId: "g1", tags: ["db"], authType: "password", credentialRef: null, proxyJump: null },
      ],
      load: vi.fn(),
      addGroup: vi.fn(),
      renameGroup,
      saveHost: vi.fn(),
      removeHost,
      removeGroup,
    });
  });

  it("renders groups and their hosts", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    expect(screen.getByText("生产组")).toBeInTheDocument();
    expect(screen.getByText("web1")).toBeInTheDocument();
  });

  it("calls onConnect when a host is clicked", async () => {
    const onConnect = vi.fn();
    render(<Sidebar onConnect={onConnect} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    screen.getByText("web1").click();
    expect(onConnect).toHaveBeenCalledWith("h1");
  });

  it("点击主机的编辑按钮触发 onEditHost", () => {
    const onEditHost = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={onEditHost} />);
    fireEvent.click(screen.getByLabelText("编辑 web1"));
    expect(onEditHost).toHaveBeenCalledWith("h1");
  });

  it('点击"+ 主机"触发 onNewHost', () => {
    const onNewHost = vi.fn();
    render(<Sidebar onConnect={vi.fn()} onNewHost={onNewHost} onEditHost={vi.fn()} />);
    fireEvent.click(screen.getByText("+ 主机"));
    expect(onNewHost).toHaveBeenCalled();
  });

  it("搜索框按名称过滤主机", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("过滤主机"), { target: { value: "db" } });
    expect(screen.getByText("db1")).toBeInTheDocument();
    expect(screen.queryByText("web1")).not.toBeInTheDocument();
  });

  it("点击分组标题可折叠/展开其主机", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    expect(screen.getByText("web1")).toBeInTheDocument();
    fireEvent.click(screen.getByText("生产组")); // 折叠
    expect(screen.queryByText("web1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("生产组")); // 展开
    expect(screen.getByText("web1")).toBeInTheDocument();
  });

  it("删除主机需经确认对话框后才真正删除", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("删除 web1"));
    expect(removeHost).not.toHaveBeenCalled(); // 仅弹确认，未删除
    fireEvent.click(screen.getByText("删除")); // 确认按钮
    expect(removeHost).toHaveBeenCalledWith("h1");
  });

  it("确认对话框点取消不删除", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("删除 web1"));
    fireEvent.click(screen.getByText("取消"));
    expect(removeHost).not.toHaveBeenCalled();
  });

  it("重命名分组：回车提交调用 renameGroup", () => {
    render(<Sidebar onConnect={vi.fn()} onNewHost={vi.fn()} onEditHost={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("重命名分组 生产组"));
    const input = screen.getByLabelText("分组名称");
    fireEvent.change(input, { target: { value: "线上组" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(renameGroup).toHaveBeenCalledWith("g1", "线上组");
  });
});

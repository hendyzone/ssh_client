import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Sidebar } from "./Sidebar";
import { useConnections } from "../stores/connections";

vi.mock("../stores/connections");

describe("Sidebar", () => {
  beforeEach(() => {
    (useConnections as unknown as any).mockReturnValue({
      groups: [{ id: "g1", name: "生产组", parentId: null }],
      hosts: [
        { id: "h1", name: "web1", address: "10.0.0.1", port: 22, username: "root",
          groupId: "g1", tags: [], authType: "password", credentialRef: null, proxyJump: null },
      ],
      load: vi.fn(),
      addGroup: vi.fn(),
      saveHost: vi.fn(),
      removeHost: vi.fn(),
      removeGroup: vi.fn(),
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
});

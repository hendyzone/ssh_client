import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { HostForm } from "./HostForm";

describe("HostForm", () => {
  it("新增模式：填写字段并提交，回调收到 host 与密码", () => {
    const onSubmit = vi.fn();
    render(<HostForm groups={[]} initial={null} onSubmit={onSubmit} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText("名称"), { target: { value: "web1" } });
    fireEvent.change(screen.getByLabelText("地址"), { target: { value: "10.0.0.1" } });
    fireEvent.change(screen.getByLabelText("用户名"), { target: { value: "root" } });
    fireEvent.change(screen.getByLabelText("密码"), { target: { value: "pw" } });
    fireEvent.click(screen.getByText("保存"));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    const [host, password] = onSubmit.mock.calls[0];
    expect(host.name).toBe("web1");
    expect(host.address).toBe("10.0.0.1");
    expect(host.username).toBe("root");
    expect(host.port).toBe(22);
    expect(password).toBe("pw");
    expect(host.id).toBeTruthy(); // 新增自动生成 id
  });

  it("编辑模式：预填 initial，密码留空则提交 null（不改钥匙串）", () => {
    const onSubmit = vi.fn();
    const initial = {
      id: "h1", name: "old", address: "1.1.1.1", port: 2222, username: "u",
      groupId: null, tags: [], authType: "password", credentialRef: "h1", proxyJump: null,
    };
    render(<HostForm groups={[]} initial={initial} onSubmit={onSubmit} onCancel={vi.fn()} />);
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("old");
    expect((screen.getByLabelText("端口") as HTMLInputElement).value).toBe("2222");
    fireEvent.click(screen.getByText("保存"));
    const [host, password] = onSubmit.mock.calls[0];
    expect(host.id).toBe("h1"); // 保持原 id
    expect(password).toBeNull(); // 密码留空 → null
  });
});

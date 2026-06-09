import { useState } from "react";
import type { Group, Host } from "../ipc";

// 生成新 id，兼顾 jsdom 测试环境（较老版本可能不支持 randomUUID）
function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  // fallback：仅用于测试环境兜底，生产 WebView2 里 crypto.randomUUID 一定可用
  return "h-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function HostForm({
  groups,
  initial,
  onSubmit,
  onCancel,
}: {
  groups: Group[];
  initial: Host | null;
  onSubmit: (host: Host, password: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const host: Host = {
      id: initial?.id ?? newId(),
      name,
      address,
      port: parseInt(port, 10) || 22,
      username,
      groupId: groupId || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      authType: "password",
      credentialRef: initial?.credentialRef ?? null,
      proxyJump: initial?.proxyJump ?? null,
    };
    onSubmit(host, password ? password : null);
  };

  // 统一渲染文本输入字段（带 aria-label 供测试选取）
  const field = (label: string, value: string, set: (v: string) => void, type = "text") => (
    <label style={{ display: "block", marginBottom: 8 }}>
      <span style={{ display: "inline-block", width: 64 }}>{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        onChange={(e) => set(e.target.value)}
        style={{ width: 200 }}
      />
    </label>
  );

  return (
    <form onSubmit={submit} style={{ padding: 16, border: "1px solid #444", background: "#222" }}>
      <h3>{initial ? "编辑主机" : "新增主机"}</h3>
      {field("名称", name, setName)}
      {field("地址", address, setAddress)}
      {field("端口", port, setPort)}
      {field("用户名", username, setUsername)}
      {field("密码", password, setPassword, "password")}
      <label style={{ display: "block", marginBottom: 8 }}>
        <span style={{ display: "inline-block", width: 64 }}>分组</span>
        <select aria-label="分组" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
          <option value="">未分组</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </label>
      {field("标签", tags, setTags)}
      <div style={{ marginTop: 12 }}>
        <button type="submit">保存</button>
        <button type="button" onClick={onCancel} style={{ marginLeft: 8 }}>取消</button>
      </div>
    </form>
  );
}

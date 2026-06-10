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
  // secret 含义随认证方式而定：密码登录为密码，密钥登录为私钥口令（可空）
  onSubmit: (host: Host, secret: string | null) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [port, setPort] = useState(String(initial?.port ?? 22));
  const [username, setUsername] = useState(initial?.username ?? "");
  const [authType, setAuthType] = useState(initial?.authType === "key" ? "key" : "password");
  const [password, setPassword] = useState("");
  const [keyPath, setKeyPath] = useState(initial?.keyPath ?? "");
  const [passphrase, setPassphrase] = useState("");
  const [useTmux, setUseTmux] = useState(initial?.useTmux ?? false);
  const [tmuxSession, setTmuxSession] = useState(initial?.tmuxSession ?? "");
  const [groupId, setGroupId] = useState(initial?.groupId ?? "");
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const isKey = authType === "key";
    const host: Host = {
      id: initial?.id ?? newId(),
      name,
      address,
      port: parseInt(port, 10) || 22,
      username,
      groupId: groupId || null,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      authType,
      credentialRef: initial?.credentialRef ?? null,
      proxyJump: initial?.proxyJump ?? null,
      keyPath: isKey ? (keyPath.trim() || null) : null,
      useTmux,
      tmuxSession: useTmux ? (tmuxSession.trim() || null) : null,
    };
    const secret = isKey ? passphrase : password;
    onSubmit(host, secret ? secret : null);
  };

  // 统一渲染文本输入字段（带 aria-label 供测试选取）
  const field = (label: string, value: string, set: (v: string) => void, type = "text", placeholder = "") => (
    <label className="field">
      <span className="field__label">{label}</span>
      <input
        aria-label={label}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );

  return (
    <form className="modal-card" onSubmit={submit}>
      <h3 className="modal-card__title">{initial ? "编辑主机" : "新增主机"}</h3>
      <div className="modal-card__body">
        {field("名称", name, setName, "text", "例如：生产 Web 服务器")}
        <div className="field-row">
          <div style={{ flex: 3 }}>{field("地址", address, setAddress, "text", "IP 或域名")}</div>
          <div style={{ flex: 1 }}>{field("端口", port, setPort)}</div>
        </div>
        {field("用户名", username, setUsername, "text", "root")}
        <label className="field">
          <span className="field__label">认证方式</span>
          <select aria-label="认证方式" value={authType} onChange={(e) => setAuthType(e.target.value)}>
            <option value="password">密码</option>
            <option value="key">密钥</option>
          </select>
        </label>
        {authType === "password"
          ? field("密码", password, setPassword, "password", initial ? "留空则不修改" : "")
          : (
            <>
              {field("私钥路径", keyPath, setKeyPath, "text", "如 ~/.ssh/id_ed25519")}
              {field("私钥口令", passphrase, setPassphrase, "password", initial ? "留空则不修改 / 无口令" : "无口令可留空")}
            </>
          )}
        <label className="field">
          <span className="field__label">分组</span>
          <select aria-label="分组" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            <option value="">未分组</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </label>
        {field("标签", tags, setTags, "text", "逗号分隔，如：web, 生产")}
        <label className="field-check">
          <input
            type="checkbox"
            aria-label="断线保持会话"
            checked={useTmux}
            onChange={(e) => setUseTmux(e.target.checked)}
          />
          <span>断线保持会话（tmux，重连可恢复）</span>
        </label>
        {useTmux && field("tmux 会话名", tmuxSession, setTmuxSession, "text", "默认 main")}
      </div>
      <div className="modal-card__footer">
        <button type="button" className="btn-ghost" onClick={onCancel}>取消</button>
        <button type="submit" className="btn-primary">保存</button>
      </div>
    </form>
  );
}

import { create } from "zustand";
import { api, type Group, type Host } from "../ipc";

interface ConnState {
  groups: Group[];
  hosts: Host[];
  load: () => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  renameGroup: (id: string, name: string) => Promise<void>;
  saveHost: (host: Host, password: string | null) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
  removeGroup: (id: string) => Promise<void>;
}

export const useConnections = create<ConnState>((set, get) => ({
  groups: [],
  hosts: [],
  load: async () => {
    const [groups, hosts] = await Promise.all([api.listGroups(), api.listHosts()]);
    set({ groups, hosts });
  },
  addGroup: async (name) => {
    await api.createGroup(name, null);
    await get().load();
  },
  renameGroup: async (id, name) => {
    await api.renameGroup(id, name);
    await get().load();
  },
  saveHost: async (host, password) => {
    await api.saveHost(host, password);
    await get().load();
  },
  removeHost: async (id) => {
    await api.deleteHost(id);
    await get().load();
  },
  removeGroup: async (id) => {
    await api.deleteGroup(id);
    await get().load();
  },
}));

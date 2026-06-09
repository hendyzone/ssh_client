import { create } from "zustand";
import { api, type Group, type Host } from "../ipc";

interface ConnState {
  groups: Group[];
  hosts: Host[];
  load: () => Promise<void>;
  addGroup: (name: string) => Promise<void>;
  saveHost: (host: Host) => Promise<void>;
  removeHost: (id: string) => Promise<void>;
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
  saveHost: async (host) => {
    await api.upsertHost(host);
    await get().load();
  },
  removeHost: async (id) => {
    await api.deleteHost(id);
    await get().load();
  },
}));

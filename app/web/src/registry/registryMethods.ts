export const RegistryMethods = {
  ConnectInit: 'connect.init',
  ProjectList: 'project.list',
  HubStateGet: 'hub.state.get',
  HubStateRefresh: 'hub.state.refresh',
  HubStateAction: 'hub.state.action',
  HubStateUpdated: 'hub.state.updated',
} as const;

export type RegistryMethod = typeof RegistryMethods[keyof typeof RegistryMethods];

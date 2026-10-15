import { Container, ContainerModule } from 'inversify';

// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
export interface ModuleConstructor<Module> {
  getModule(parentContainer: Container): ContainerModule;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars, unused-imports/no-unused-vars
export abstract class BaseModuleConstructor<Module> implements ModuleConstructor<Module> {
  abstract getModule(parentContainer: Container): ContainerModule;
}

export interface ExternalComponentConstructor<Component> {
  initializeContainer(mainContainer: Container): void;
  getInstance(): Component;
}

export abstract class BaseComponentConstructor<Component> implements ExternalComponentConstructor<Component> {
  abstract initializeContainer(mainContainer: Container): void;
  abstract getInstance(): Component;
}

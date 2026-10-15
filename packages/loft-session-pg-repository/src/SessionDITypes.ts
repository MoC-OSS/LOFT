export const SESSION_DI_TYPES = {
  SessionRepository: Symbol.for('SessionRepository'),
  SessionRepositoryDialect: Symbol.for('SessionDialect'),
  SessionRepositoryConfig: Symbol.for('SessionRepositoryConfig'),
  SessionRepositoryDatabase: Symbol.for('SessionRepositoryDatabase'),
  HealthCheckService: Symbol.for('HealthCheckService')
};

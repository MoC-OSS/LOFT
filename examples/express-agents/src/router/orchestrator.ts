// Main orchestrator — wires the router to all 6 flows in a single graph.
//
// Agent graph:
//   router → sommelier (simple, TERMINAL)
//   router → nutritionist → chef → presenter (chain, TERMINAL)
//   router → catering-dispatcher → [appetizers|mains|desserts] → coordinator (parallel, TERMINAL)
//   router → restaurant-visit → review-team[food-critic→ambiance-critic] → verdict (team, TERMINAL)
//   router → banquet-intake/Focus → banquet-dispatcher → [venue|menu|entertainment]
//            → planning-team[planner→budget] → proposal (full, TERMINAL)
//   router → reservation-intake/Focus(resolveFields) → availability-check(custom Node)
//            → reservation-confirmation (reservation, TERMINAL)

import { LOFT } from '@moc-global/loft';
import { Orchestrator, OrchestratorBuilder } from '@moc-global/loft-agents';
import { Agent, Chat } from '@moc-global/loft-definitions';

import { createChef, createNutritionist, createPresenter } from '../flows/chain/agents';
import {
  BANQUET_FOCUS_NAME,
  banquetFocus,
  createBanquetDispatcher,
  createBanquetIntake,
  createBanquetPlanningTeam,
  createEntertainmentFinder,
  createMenuPlanner,
  createProposalWriter,
  createVenueFinder
} from '../flows/full/agents';
import {
  createAppetizersSpecialist,
  createCateringCoordinator,
  createCateringDispatcher,
  createDessertsSpecialist,
  createMainsSpecialist
} from '../flows/parallel/agents';
import {
  AvailabilityCheckNode,
  createReservationConfirmation,
  createReservationIntake,
  RESERVATION_FOCUS_NAME,
  reservationFocus
} from '../flows/reservation/agents';
import { createSommelier } from '../flows/simple/agents';
import { createReviewTeam, createVerdictWriter, createVisitAgent } from '../flows/team/agents';
import { ConsoleTracer } from '../shared/tracer';
import { createRouter } from './agent';

function logMetrics(metrics: Agent.OrchestratorMetrics): void {
  console.log('\n========== ORCHESTRATOR METRICS ==========');
  console.log(`Total Duration: ${metrics.orchestratorDurationMs}ms`);
  console.log(`Depth Reached:  ${metrics.depthReached}`);
  console.log(`Transition Path: ${metrics.transitionPath.join(' → ')}`);
  for (const node of metrics.nodeMetrics) {
    const retry = node.retryCount > 0 ? ` (retries: ${node.retryCount})` : '';
    const error = node.error ? ` [ERROR: ${node.error.message}]` : '';
    console.log(`  ${node.nodeName}: ${node.durationMs}ms${retry}${error}`);
  }
  console.log('==========================================\n');
}

export function createMainOrchestrator(loft: LOFT<Chat.ChatInterface>): Orchestrator {
  // Register Focus configs
  loft.registerFocus(BANQUET_FOCUS_NAME, banquetFocus);
  loft.registerFocus(RESERVATION_FOCUS_NAME, reservationFocus);

  return (
    new OrchestratorBuilder()
      // Router (entry point)
      .addNode(createRouter(loft))

      // Flow 1: Simple
      .addNode(createSommelier(loft))

      // Flow 2: Chain
      .addNode(createNutritionist(loft))
      .addNode(createChef(loft))
      .addNode(createPresenter(loft))

      // Flow 3: Parallel
      .addNode(createCateringDispatcher(loft))
      .addNode(createAppetizersSpecialist(loft), { retry: { maxRetries: 2, delayMs: 1000, backoffMultiplier: 2 } })
      .addNode(createMainsSpecialist(loft))
      .addNode(createDessertsSpecialist(loft), { timeout: { timeoutMs: 30000 } })
      .addNode(createCateringCoordinator(loft))

      // Flow 4: Team
      .addNode(createVisitAgent(loft))
      .addNode(createReviewTeam(loft))
      .addNode(createVerdictWriter(loft))

      // Flow 5: Full
      .addNode(createBanquetIntake(loft))
      .addNode(createBanquetDispatcher(loft))
      .addNode(createVenueFinder(loft), { timeout: { timeoutMs: 30000 } })
      .addNode(createMenuPlanner(loft), { retry: { maxRetries: 2, delayMs: 1000, backoffMultiplier: 2 } })
      .addNode(createEntertainmentFinder(loft))
      .addNode(createBanquetPlanningTeam(loft))
      .addNode(createProposalWriter(loft))

      // Flow 6: Reservation
      .addNode(createReservationIntake(loft))
      .addNode(new AvailabilityCheckNode())
      .addNode(createReservationConfirmation(loft))

      // Orchestrator config
      .setEntry('router')
      .setMaxDepth(15)
      .setErrorStrategy(Agent.ErrorStrategy.CONTINUE)
      .setTracer(new ConsoleTracer())
      .setMetricsCallback(logMetrics)
      .setCycleDetection(true)
      .build()
  );
}

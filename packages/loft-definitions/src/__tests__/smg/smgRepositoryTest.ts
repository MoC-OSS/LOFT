import { describe, expect, test } from 'vitest';

import { Repository, Type } from '../..';
import { seedData, SeedType } from './seed';

async function appendMessagesWithStatuses(repository: Repository.SMG.SMG, messages: SeedType[]) {
  const appendedMessages = [];

  for (const message of messages) {
    const { statuses, ...messageData } = message;
    const correlatorId = messageData.correlatorId;
    const sessionId = messageData.sessionId;

    const [appendedMessage] = await repository.message.append([messageData]);

    appendedMessages.push(appendedMessage);

    for (const status of statuses) {
      await repository.state.setState(sessionId, [appendedMessage.id], status.status, [correlatorId]);
    }
  }

  return appendedMessages;
}

export function testSMGRepository(
  repository: Repository.SMG.SMG,
  helpers: {
    truncateSessionCascade: () => Promise<void>;
    getLatestStatusForMessage: (messageId: string) => Promise<Type.SMG.MessageStatus>;
    getCompletedOrFailedStatuses: () => Promise<Type.SMG.State[]>;
    getMessagesBySessionId: (sessionId: string) => Promise<Type.SMG.Message[]>;
    getSessionById: (sessionId: string) => Promise<Type.SMG.Session>;
  }
) {
  describe('StatefulMessageGatewayRepository Integration Tests', () => {
    test('performs health check', async () => {
      const health = await repository.checkHealth();
      expect(health).toBe(true);
    });

    test('creates a session with the provided session ID and verifies its inclusion', async () => {
      const sessionId = seedData.session0Messages[0].sessionId;
      const newSession = await repository.session.create(sessionId);

      expect(newSession.id).toContain(sessionId);

      await helpers.truncateSessionCascade();
    });

    test('retrieves a newly created session by ID', async () => {
      const sessionId = seedData.session0Messages[0].sessionId;
      await repository.session.create(sessionId);
      const newSession = await repository.session.getById(sessionId);
      expect(newSession).toBeDefined();
      if (newSession) {
        // This check ensures that newSession is not undefined
        expect(newSession.id).toContain(sessionId);
      }
      await helpers.truncateSessionCascade();
    });

    test('appends messages to session and updates their statuses', async () => {
      const sessionMessages = seedData.session0Messages;
      await repository.session.create(sessionMessages[0].sessionId);
      const appendedMessages = await appendMessagesWithStatuses(repository, sessionMessages);

      expect(appendedMessages).toHaveLength(sessionMessages.length);

      await helpers.truncateSessionCascade();
    });

    /**
     * Validates that a session remains unlocked after operations and counts active sessions, expecting zero active.
     */
    test('verifies session is unlocked with no active sessions', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const {
        lockStatus: { isLocked }
      } = await repository.session.getSessionState(seedData.session0Messages[0].sessionId);

      expect(isLocked).toBe(false);

      await helpers.truncateSessionCascade();
    });

    /**
     * Confirms that messages retrieved by SessionID appear in FIFO order and their statuses match specified Enum strings.
     * Also checks for each message to have an empty context and content increasing numerically.
     */
    test('retrieves messages by SessionID in FIFO order with statuses as Enum strings', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const messages = await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId);
      expect(messages).toHaveLength(2);

      let previousContent = null;
      for (const message of messages) {
        if (previousContent !== null) {
          expect(message.ctx).toEqual({}); // each message should have empty ctx
          expect(Number(message.content)).toBeGreaterThan(Number(previousContent));
        }
        previousContent = message.content;
      }

      await helpers.truncateSessionCascade();
    });

    /**
     * Tests session behavior after fetching messages by SessionID.
     * Verifies that the session locks after setting the state to IN_LLM_PROCESS,
     * and a subsequent fetch returns no messages, indicating the session is effectively locked
     * with one active session recorded.
     */
    test(`confirms session locks after setState Type.SMG.MessageStatus.IN_LLM_PROCESS or Type.SMG.MessageStatus.LLM_PROCESSED`, async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const firstlyFetchedMessages = await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId);

      const firstMessagesIds = firstlyFetchedMessages.map((message) => message.id);
      const firstCorrelatorIds = firstlyFetchedMessages.map((message) => message.correlatorId);

      await repository.state.setState(
        sessionId,
        firstMessagesIds,
        Type.SMG.MessageStatus.IN_LLM_PROCESS,
        firstCorrelatorIds
      );
      const secondlyFetchedMessages = await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId);

      const {
        lockStatus: { isLocked }
      } = await repository.session.getSessionState(sessionId);

      expect(firstlyFetchedMessages).toHaveLength(2);
      expect(secondlyFetchedMessages).toHaveLength(0);
      expect(isLocked).toBe(true);

      await helpers.truncateSessionCascade();
    });

    test('confirms session unlocks after timeout and returns messages with non-terminal statuses', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;
      const timeoutMs = 100; // this value must be settes in the test container

      await repository.session.create(sessionId);
      const appendedMessages = await appendMessagesWithStatuses(repository, sessionMessages);
      const messageIds = appendedMessages.map((message) => message.id);
      const correlatorIds = appendedMessages.map((message) => message.correlatorId);
      // Fetch messages to lock session
      await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId); // fetch messages to lock session
      await repository.state.setState(
        sessionId,
        [messageIds[0], messageIds[1]],
        Type.SMG.MessageStatus.IN_LLM_PROCESS,
        [correlatorIds[0], correlatorIds[1]]
      );

      // Check that session is locked
      const {
        lockStatus: { isLocked: isLockedBefore }
      } = await repository.session.getSessionState(sessionId);
      expect(isLockedBefore).toBe(true);

      // Wait for timeout to pass
      await new Promise((resolve) => setTimeout(resolve, timeoutMs + 100));

      // Get messages after timeout
      const {
        lockStatus: { isLocked: isLockedAfter }
      } = await repository.session.getSessionState(sessionId);
      expect(isLockedAfter).toBe(false);

      const messagesAfterTimeout = await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId);

      expect(messagesAfterTimeout.length).toBe(2);

      // Check that all returned messages have non-terminal statuses
      const latestStatuses = await Promise.all(
        messagesAfterTimeout.map((msg) => helpers.getLatestStatusForMessage(msg.id))
      );

      latestStatuses.forEach((status) => {
        expect(status).not.toBe(Type.SMG.MessageStatus.DONE);
        expect(status).not.toBe(Type.SMG.MessageStatus.FAILED);
      });

      await helpers.truncateSessionCascade();
    });

    /**
     * Checks that no messages are retrieved for a session, both by specific SessionID and without SessionID, when the session is locked.
     */
    test('ensures no messages are returned for locked sessions, with or without SessionID', async () => {
      const sessionMessages = seedData.session3Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);
      const messagesBySessionId = await repository.message.fetchFifoReadySessionMessagesBySessionId(sessionId);
      const messagesWithoutSessionId = await repository.message.fetchFifoReadySessionMessages();

      expect(messagesBySessionId).toHaveLength(0);
      expect(messagesWithoutSessionId).toHaveLength(0);

      await helpers.truncateSessionCascade();
    });

    /**
     * Verifies sequential fetching of FIFO Ready Messages across multiple sessions.
     * Ensures that messages are retrieved in the order of their session creation and confirms no messages are fetched after all sessions are processed.
     */
    test('fetches FIFO Ready Messages sequentially by session', async () => {
      const firstSessionMessages = seedData.session0Messages;
      const firstSessionId = firstSessionMessages[0].sessionId;
      const secondSessionMessages = seedData.session1Messages;
      const secondSessionId = secondSessionMessages[0].sessionId;
      const thirdSessionMessages = seedData.session2Messages;
      const thirdSessionId = thirdSessionMessages[0].sessionId;

      await repository.session.create(firstSessionId);
      await repository.session.create(secondSessionId);
      await repository.session.create(thirdSessionId);

      await appendMessagesWithStatuses(repository, firstSessionMessages);
      await appendMessagesWithStatuses(repository, secondSessionMessages);
      await appendMessagesWithStatuses(repository, thirdSessionMessages);

      const firstSessionMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      const secondSessionMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      const thirdSessionMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      const forthSessionMessagesFetched = await repository.message.fetchFifoReadySessionMessages();

      expect(firstSessionMessagesFetched[0].sessionId).toBe(firstSessionId);
      expect(secondSessionMessagesFetched[0].sessionId).toBe(secondSessionId);
      expect(thirdSessionMessagesFetched[0].sessionId).toBe(thirdSessionId);
      expect(forthSessionMessagesFetched).toHaveLength(0);

      await helpers.truncateSessionCascade();
    });

    /**
     * Tests that messages are fetched in FIFO order per session, with iterative fetching based on actions within sessions having multiple message-actions.
     * Verifies that after processing all actions for one message, the next fetch continues from the same session if more actions are pending,
     * ensuring each session is unlocked before proceeding.
     */
    test(`fetches FIFO Ready Messages sequentially by session and iteratively by action within sessions`, async () => {
      const firstSessionMessages = seedData.session0Messages;
      const firstSessionId = firstSessionMessages[0].sessionId;
      const secondSessionMessages = seedData.session4Messages;
      const secondSessionId = secondSessionMessages[0].sessionId;

      await repository.session.create(firstSessionId);
      await repository.session.create(secondSessionId);

      await appendMessagesWithStatuses(repository, firstSessionMessages);
      await appendMessagesWithStatuses(repository, secondSessionMessages);

      const firstMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      expect(firstMessagesFetched[0].sessionId).toBe(firstSessionId);

      const secondMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      expect(secondMessagesFetched[0].sessionId).toBe(secondSessionId);
      expect(secondMessagesFetched[0].action).toBe('CHAT_APPEND');

      // change status to DONE for unlock session for next fetch
      const secondMessagesIds = secondMessagesFetched.map((message) => message.id);
      const secondCorrelatorIds = secondMessagesFetched.map((message) => message.correlatorId);
      await repository.state.setState(
        secondSessionId,
        secondMessagesIds,
        Type.SMG.MessageStatus.DONE,
        secondCorrelatorIds
      );

      const thirdMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      expect(thirdMessagesFetched[0].sessionId).toBe(secondSessionId);
      expect(thirdMessagesFetched[0].action).toBe('SESSION_UPDATE');

      const forthMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      expect(forthMessagesFetched).toHaveLength(0);

      await helpers.truncateSessionCascade();
    });

    /**
     * Ensures correct session state retrieval by SessionID, status updates post-message retrieval, and confirms the session locks appropriately.
     * This includes checks on session identifiers, locked states, message counts before and after fetching, and action counts, reflecting session processing rules.
     */
    test('verifies session state changes after fetching messages and processing them', async () => {
      const forthSessionMessages = seedData.session4Messages;
      const forthSessionId = forthSessionMessages[0].sessionId;

      await repository.session.create(forthSessionId);
      await appendMessagesWithStatuses(repository, forthSessionMessages);

      const sessionStateBefore = await repository.session.getSessionState(forthSessionId);

      // Verify initial state
      expect(sessionStateBefore.sessionId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
      expect(sessionStateBefore.lockStatus.isLocked).toBe(false);
      expect(sessionStateBefore.totalInputMessages).toHaveLength(5);
      expect(sessionStateBefore.pendingMessagesByAction).toEqual({
        CHAT_APPEND: 3,
        SESSION_UPDATE: 2
      });

      // Fetch messages
      const forthMessagesFetched = await repository.message.fetchFifoReadySessionMessages();
      expect(forthMessagesFetched).toHaveLength(2);

      // Verify session is still unlocked after fetch
      const sessionStateAfterFetch = await repository.session.getSessionState(forthSessionId);
      expect(sessionStateAfterFetch.lockStatus.isLocked).toBe(false);

      // Set messages to IN_LLM_PROCESS
      await repository.state.setState(
        forthSessionId,
        forthMessagesFetched.map((m) => m.id),
        Type.SMG.MessageStatus.IN_LLM_PROCESS,
        forthMessagesFetched.map((m) => m.correlatorId)
      );

      // Now session should be locked
      const sessionStateAfterProcess = await repository.session.getSessionState(forthSessionId);
      expect(sessionStateAfterProcess.lockStatus.isLocked).toBe(true);
      expect(sessionStateAfterProcess.pendingMessagesByAction).toEqual({
        CHAT_APPEND: 1,
        SESSION_UPDATE: 2
      });

      await helpers.truncateSessionCascade();
    });

    /**
     * Verifies that the message status is updated to 'DONE' following its processing.
     * The test checks that the message is initially marked as 'LLM_PROCESSED', then explicitly sets it to 'DONE', and confirms the update.
     */
    test('sets message status to DONE after processing', async () => {
      const sessionMessage = seedData.session3Messages[1];
      const sessionId = sessionMessage.sessionId;

      await repository.session.create(sessionId);
      const [newMessage] = await appendMessagesWithStatuses(repository, [sessionMessage]);
      let latestMessageStatus = await helpers.getLatestStatusForMessage(newMessage.id);

      expect(newMessage).toBeDefined();
      expect(latestMessageStatus).toBe('LLM_PROCESSED');

      await repository.state.setState(sessionId, [newMessage.id], Type.SMG.MessageStatus.DONE, [
        newMessage.correlatorId
      ]);

      latestMessageStatus = await helpers.getLatestStatusForMessage(newMessage.id);
      expect(latestMessageStatus).toBe('DONE');

      await helpers.truncateSessionCascade();
    });

    /**
     * Checks that messages fetched by SessionID include their associated states,
     * confirming both the presence of state data and the correct count of messages retrieved.
     */
    test('retrieves messages along with their states by SessionID', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const messages = await repository.message.fetchFifoMessagesWithStateBySessionId(sessionId);

      expect(messages[0].states).toBeDefined();
      expect(messages).toHaveLength(4);

      await helpers.truncateSessionCascade();
    });

    /**
     * Verifies that SMG messages with a latest status of DONE or FAILED, along with their related statuses, are removed successfully.
     * After the removal, it confirms that no messages with those statuses remain.
     */
    test('removes SMG messages and related statuses with latest status DONE or FAILED', async () => {
      const firstSessionMessages = seedData.session0Messages;
      const firstSessionId = firstSessionMessages[0].sessionId;
      const secondSessionMessages = seedData.session1Messages;
      const secondSessionId = secondSessionMessages[0].sessionId;
      const thirdSessionMessages = seedData.session2Messages;
      const thirdSessionId = thirdSessionMessages[0].sessionId;

      await repository.session.create(firstSessionId);
      await repository.session.create(secondSessionId);
      await repository.session.create(thirdSessionId);

      await appendMessagesWithStatuses(repository, firstSessionMessages);
      await appendMessagesWithStatuses(repository, secondSessionMessages);
      await appendMessagesWithStatuses(repository, thirdSessionMessages);

      await repository.message.removeCompletedMessages();

      const statuses = await helpers.getCompletedOrFailedStatuses();

      expect(statuses).toBeDefined();
      expect(statuses).toHaveLength(0);

      await helpers.truncateSessionCascade();
    });

    test('deletes all messages by SessionID', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      await repository.message.deleteBySessionId(sessionId);

      const messages = await helpers.getMessagesBySessionId(sessionId);

      expect(messages).toBeDefined();
      expect(messages).toHaveLength(0);

      await helpers.truncateSessionCascade();
    });

    test('deletes session by ID and verifies its removal', async () => {
      const sessionMessages = seedData.session0Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);

      await repository.session.deleteById(sessionId);

      const session = await helpers.getSessionById(sessionId);

      expect(session).toBeUndefined();

      await helpers.truncateSessionCascade();
    });

    test('validates equality of enums in repository and loft-definitions', async () => {
      expect(() => repository.checkEnums()).not.toThrow();
    });

    test('returns undefined for getFirstOfPendingMessagesId when no pending messages exist', async () => {
      const sessionMessages = seedData.session0Messages.slice(0, 2); // Only messages with DONE status
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const firstPendingId = await repository.session.getSessionState(sessionId);

      expect(firstPendingId.firstOfPendingMessagesId).toBeUndefined();

      await helpers.truncateSessionCascade();
    });

    test('setState updates only existing message IDs and returns updated IDs', async () => {
      const sessionMessages = seedData.session0Messages.slice(0, 2);
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      const appendedMessages = await appendMessagesWithStatuses(repository, sessionMessages);

      // Generate some non-existing UUIDs
      const nonExistingIds = ['12345678-1234-1234-1234-123456789012', '87654321-4321-4321-4321-210987654321'];

      // Mix existing and non-existing message IDs
      const mixedIds = [...appendedMessages.map((msg) => msg.id), ...nonExistingIds];
      const correlatorIds = [...appendedMessages.map((msg) => msg.correlatorId), ...nonExistingIds];

      // Try to update all IDs
      const updatedIds = await repository.state.setState(
        sessionId,
        mixedIds,
        Type.SMG.MessageStatus.IN_LLM_PROCESS,
        correlatorIds
      );

      // Verify only existing IDs were updated
      expect(updatedIds).toHaveLength(appendedMessages.length);
      expect(updatedIds).toEqual(expect.arrayContaining(appendedMessages.map((msg) => msg.id)));
      expect(updatedIds).not.toEqual(expect.arrayContaining(nonExistingIds));

      // Verify the status was updated only for existing messages
      for (const message of appendedMessages) {
        const status = await helpers.getLatestStatusForMessage(message.id);
        expect(status).toBe(Type.SMG.MessageStatus.IN_LLM_PROCESS);
      }

      await helpers.truncateSessionCascade();
    });

    test('returns message with lowest sequenceId from pending messages', async () => {
      const sessionMessages = seedData.session1Messages;
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const sessionState = await repository.session.getSessionState(sessionId);
      const messages = await helpers.getMessagesBySessionId(sessionId);

      const MessageWithStates = [];
      for (const message of messages) {
        const latestStatus = await helpers.getLatestStatusForMessage(message.id);
        MessageWithStates.push({
          ...message,
          status: latestStatus
        });
      }

      expect(sessionState.firstOfPendingMessagesId).toBe(MessageWithStates[2].id);

      await helpers.truncateSessionCascade();
    });

    test('ignores DONE and FAILED messages when finding first pending message', async () => {
      const sessionMessages = seedData.session2Messages; // Mix of DONE, FAILED and pending messages
      const sessionId = sessionMessages[0].sessionId;

      await repository.session.create(sessionId);
      await appendMessagesWithStatuses(repository, sessionMessages);

      const sessionState = await repository.session.getSessionState(sessionId);

      const messages = await helpers.getMessagesBySessionId(sessionId);
      const MessageWithStates = [];
      for (const message of messages) {
        const latestStatus = await helpers.getLatestStatusForMessage(message.id);
        MessageWithStates.push({
          ...message,
          status: latestStatus
        });
      }

      // Should skip DONE and FAILED messages and return the first pending message
      expect(sessionState.firstOfPendingMessagesId).toBe(MessageWithStates[2].id);
      expect(MessageWithStates[0].status).toBe(Type.SMG.MessageStatus.DONE);
      expect(MessageWithStates[1].status).toBe(Type.SMG.MessageStatus.FAILED);
      expect(sessionState.firstOfPendingMessagesId).toBe(MessageWithStates[2].id);

      await helpers.truncateSessionCascade();
    });
  });
}

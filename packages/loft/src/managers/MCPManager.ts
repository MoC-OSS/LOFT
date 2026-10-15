import { DI_TYPES, Interface, Logger } from '@moc-global/loft-definitions';
import type {
  CallToolRequest,
  CallToolResult,
  CallToolResultSchema,
  CompatibilityCallToolResultSchema,
  ListToolsResult
} from '@modelcontextprotocol/sdk/types.js';
import { inject, injectable, optional } from 'inversify';

import { ChatConfig } from '../types/config';

@injectable()
export class MCPManager implements Interface.MCP.MCPManager {
  protected mcpClients = new Map<string, Interface.MCP.Client>();
  // Map client names to their metadata
  protected clientsMetadata = new Map<string, Interface.MCP.MCPClientMetadata>();
  // Map tool names to the client names that support them
  protected toolToClientMap = new Map<string, Set<string>>();
  // Map client names to their tools
  protected clientToolsCache = new Map<string, Set<string>>();
  // Track when tools were last refreshed
  protected lastToolRefresh = new Map<string, number>();
  // Store tool schemas for conflict detection and resolution
  // The first registered client's schema becomes the "canonical" schema used for validation
  // All clients supporting the same tool will have their results aggregated
  protected toolSchemas = new Map<
    string,
    {
      clientName: string; // The client that owns the canonical schema (first registered)
      tool: ListToolsResult['tools'][number];
      registrationOrder: number; // Order of registration for tie-breaking
    }
  >();
  private toolRegistrationCounter = 0;
  private readonly TOOL_CACHE_TTL: number; // 1 minute cache TTL

  // Protection against concurrent useClient calls
  private isUseClientRunning = false;

  private readonly log = new Logger('MCPManager');

  constructor(@inject(DI_TYPES.ChatConfig) @optional() chatConfig?: ChatConfig) {
    this.TOOL_CACHE_TTL = chatConfig?.mcp?.toolCacheTtl || 60000;
  }

  async useClient(
    mcpName: string,
    mcpClient: Interface.MCP.Client,
    metadata?: Partial<Interface.MCP.MCPClientMetadata>
  ): Promise<void> {
    // Check if useClient is already running
    if (this.isUseClientRunning) {
      const errorMessage = `useClient method is already running. Please use 'await' when calling useClient to ensure sequential execution.`;
      this.log.error(errorMessage, new Error('Concurrent MCPManager.useClient() call detected'));
      throw new Error(errorMessage);
    }

    // Set the flag to indicate useClient is running
    this.isUseClientRunning = true;

    try {
      this.log.info(`Registering MCP client: "${mcpName}"`);
      const clientTools: ListToolsResult = await listClientTools(mcpClient);
      this.log.debug(`MCP "${mcpName}" has ${clientTools.tools.length} tools`);

      // Map tool names to client for efficient lookups
      const clientToolNames = new Set<string>();

      // Check for duplications and update tool mappings
      for (const incomingTool of clientTools.tools) {
        // Check if this tool already exists
        const existingToolSchema = this.toolSchemas.get(incomingTool.name);

        if (existingToolSchema) {
          this.handleToolConflict(mcpName, incomingTool, existingToolSchema);
        } else {
          // First registration of this tool name
          this.toolSchemas.set(incomingTool.name, {
            clientName: mcpName,
            tool: incomingTool,
            registrationOrder: this.toolRegistrationCounter++
          });
        }

        // Add tool to client mapping
        clientToolNames.add(incomingTool.name);

        // Add client to tool mapping
        if (!this.toolToClientMap.has(incomingTool.name)) {
          this.toolToClientMap.set(incomingTool.name, new Set<string>());
        }
        this.toolToClientMap.get(incomingTool.name)?.add(mcpName);
      }

      // Store the client's tools in cache
      this.clientToolsCache.set(mcpName, clientToolNames);
      this.lastToolRefresh.set(mcpName, Date.now());

      this.mcpClients.set(mcpName, mcpClient);

      // Store client metadata (defaults to empty object if not provided)
      const clientMetadata: Interface.MCP.MCPClientMetadata = {
        // Auto-detected information
        transportType: this.detectTransportType(mcpClient.transport),
        registeredAt: new Date().toISOString(),
        toolCount: clientToolNames.size,
        // User-provided metadata (if any)
        ...metadata
      };
      this.clientsMetadata.set(mcpName, clientMetadata);

      // Log summary of tool registration for this client
      const conflictingTools = clientTools.tools.filter((tool) => {
        const existingSchema = this.toolSchemas.get(tool.name);
        if (!existingSchema || existingSchema.clientName === mcpName) return false;

        const conflictInfo = this.checkToolSchemaConflicts(existingSchema.tool, tool);
        return conflictInfo.hasConflicts;
      });

      if (conflictingTools.length > 0) {
        this.log.warn(
          `MCP client "${mcpName}" registered with ${conflictingTools.length} tools that have schema conflicts: ${conflictingTools.map((t) => t.name).join(', ')}`
        );
      }

      this.log.info(`MCP client "${mcpName}" successfully registered with ${clientToolNames.size} tools`);
    } finally {
      // Always clear the flag, even if an error occurred
      this.isUseClientRunning = false;
    }
  }

  private handleToolConflict(
    mcpName: string,
    incomingTool: ListToolsResult['tools'][number],
    existingToolSchema: {
      clientName: string;
      tool: ListToolsResult['tools'][number];
      registrationOrder: number;
    }
  ) {
    const existingTool = existingToolSchema.tool;
    const existingClientName = existingToolSchema.clientName;

    const conflictInfo = this.checkToolSchemaConflicts(existingTool, incomingTool);

    if (conflictInfo.hasConflicts) {
      // Schema conflict detected
      this.log.warn(
        `Tool Schema Conflict: "${incomingTool.name}"`,
        `Tool "${incomingTool.name}" from MCP client "${mcpName}" has conflicting schema with existing tool from MCP client "${existingClientName}". ` +
          `The canonical schema from client "${existingClientName}" (registered first) will be used for parameter validation and exposed in tool listings. ` +
          `Results from both clients will still be aggregated when the tool is called. ` +
          `Schema conflicts detected in: ${conflictInfo.conflictingFields.join(', ')}`
      );

      // Log detailed schema comparison for debugging
      this.log.debug('Tool schema conflict details', {
        toolName: incomingTool.name,
        canonicalClient: existingClientName,
        newClient: mcpName,
        schemaUsed: 'canonical (first registered)',
        canonicalSchema: {
          description: existingTool.description,
          inputSchema: existingTool.inputSchema
        },
        conflictingSchema: {
          description: incomingTool.description,
          inputSchema: incomingTool.inputSchema
        },
        conflicts: {
          description: conflictInfo.hasDifferentDescription,
          inputSchema: conflictInfo.hasDifferentInputSchema
        }
      });
    } else {
      // Same schema - just a normal duplication
      this.log.info(
        `Tool registered: "${incomingTool.name}" from MCP client "${mcpName}" has identical schema to existing tool from client "${existingClientName}". Results will be aggregated when called.`
      );
    }
  }

  /**
   * Deep equality check for objects (more reliable than JSON.stringify)
   */
  private deepEqual(obj1: any, obj2: any): boolean {
    if (obj1 === obj2) return true;

    if (obj1 == null || obj2 == null) return obj1 === obj2;

    if (typeof obj1 !== typeof obj2) return false;

    if (typeof obj1 !== 'object') return obj1 === obj2;

    if (Array.isArray(obj1) !== Array.isArray(obj2)) return false;

    const keys1 = Object.keys(obj1);
    const keys2 = Object.keys(obj2);

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
      if (!keys2.includes(key)) return false;
      if (!this.deepEqual(obj1[key], obj2[key])) return false;
    }

    return true;
  }

  /**
   * Checks for schema conflicts between two tools
   * @param tool1 First tool to compare
   * @param tool2 Second tool to compare
   * @returns Object with conflict information
   */
  private checkToolSchemaConflicts(
    tool1: ListToolsResult['tools'][number],
    tool2: ListToolsResult['tools'][number]
  ): {
    hasConflicts: boolean;
    conflictingFields: string[];
    hasDifferentDescription: boolean;
    hasDifferentInputSchema: boolean;
  } {
    const hasDifferentDescription = tool1.description !== tool2.description;
    const hasDifferentInputSchema = !this.deepEqual(tool1.inputSchema, tool2.inputSchema);

    const conflictingFields = [];
    if (hasDifferentDescription) conflictingFields.push('description');
    if (hasDifferentInputSchema) conflictingFields.push('inputSchema');

    return {
      hasConflicts: hasDifferentDescription || hasDifferentInputSchema,
      conflictingFields,
      hasDifferentDescription,
      hasDifferentInputSchema
    };
  }

  /**
   * Refreshes tool list for a specific client if it's stale
   * @param clientName The name of the client to refresh tools for
   * @returns Whether refresh was needed and performed
   */
  private async refreshClientToolsIfNeeded(clientName: string): Promise<boolean> {
    const lastRefresh = this.lastToolRefresh.get(clientName);

    if (!lastRefresh || Date.now() - lastRefresh > this.TOOL_CACHE_TTL) {
      try {
        const client = this.mcpClients.get(clientName);
        if (!client) {
          this.log.warn(`Client "${clientName}" not found during refresh`);
          return false;
        }

        this.log.debug(`Starting refresh for MCP client "${clientName}"`);
        const tools = await listClientTools(client);
        const newToolNames = new Set<string>();

        // Collect current tool mappings for this client to compare
        const currentToolsForClient = new Set<string>();
        for (const [toolName, clients] of this.toolToClientMap.entries()) {
          if (clients.has(clientName)) {
            currentToolsForClient.add(toolName);
          }
        }

        // Build new tool set
        for (const tool of tools.tools) {
          newToolNames.add(tool.name);
        }

        // Find tools to remove (were in old set but not in new set)
        const toolsToRemove = new Set<string>();
        for (const toolName of currentToolsForClient) {
          if (!newToolNames.has(toolName)) {
            toolsToRemove.add(toolName);
          }
        }

        // Find tools to add (are in new set but not in old set)
        const toolsToAdd = new Set<string>();
        for (const toolName of newToolNames) {
          if (!currentToolsForClient.has(toolName)) {
            toolsToAdd.add(toolName);
          }
        }

        // Create new tool mappings atomically
        const newToolToClientMap = new Map<string, Set<string>>();

        // Copy existing mappings except for this client
        for (const [toolName, clients] of this.toolToClientMap.entries()) {
          const newClients = new Set<string>();
          for (const client of clients) {
            if (client !== clientName) {
              newClients.add(client);
            }
          }
          if (newClients.size > 0) {
            newToolToClientMap.set(toolName, newClients);
          }
        }

        // Add new tools for this client
        for (const tool of tools.tools) {
          if (!newToolToClientMap.has(tool.name)) {
            newToolToClientMap.set(tool.name, new Set<string>());
          }
          newToolToClientMap.get(tool.name)?.add(clientName);

          // Update tool schema if this is the canonical client or if no schema exists
          const existingSchema = this.toolSchemas.get(tool.name);
          if (!existingSchema) {
            // No existing schema - register this as the first one
            this.toolSchemas.set(tool.name, {
              clientName: clientName,
              tool: tool,
              registrationOrder: this.toolRegistrationCounter++
            });
          } else if (existingSchema.clientName === clientName) {
            // This client is the canonical one - update its schema but check for changes
            const existingTool = existingSchema.tool;
            const conflictInfo = this.checkToolSchemaConflicts(existingTool, tool);

            if (conflictInfo.hasConflicts) {
              this.log.warn(
                `Tool Schema Changed: "${tool.name}"`,
                `Canonical tool "${tool.name}" from MCP client "${clientName}" has changed its schema during refresh. ` +
                  `Updated schema will be used for parameter validation. ` +
                  `Schema changes detected in: ${conflictInfo.conflictingFields.join(', ')}`
              );
            }

            // Update the schema
            this.toolSchemas.set(tool.name, {
              clientName: clientName,
              tool: tool,
              registrationOrder: existingSchema.registrationOrder
            });
          } else {
            // Different client - check for conflicts with canonical schema
            this.handleToolConflict(clientName, tool, existingSchema);
          }
        }

        // Atomically replace the tool mapping
        this.toolToClientMap = newToolToClientMap;

        // Clean up orphaned tool schemas
        for (const [toolName, schema] of this.toolSchemas.entries()) {
          if (!this.toolToClientMap.has(toolName) && schema.clientName === clientName) {
            this.toolSchemas.delete(toolName);
          }
        }

        // Update cache and timestamp atomically at the end
        this.clientToolsCache.set(clientName, newToolNames);
        this.lastToolRefresh.set(clientName, Date.now());

        this.log.debug(
          `Successfully refreshed tools for MCP client "${clientName}": added ${toolsToAdd.size}, removed ${toolsToRemove.size}, total ${newToolNames.size}`
        );
        return true;
      } catch (error) {
        this.log.warn(`Failed to refresh tools for client "${clientName}"`, error);
        return false;
      }
    }

    return false;
  }

  async listsOfTools(): Promise<ListToolsResult[]> {
    this.log.debug('Retrieving tools from all MCP clients');
    const clients = Array.from(this.mcpClients.entries());
    this.log.debug(`Found ${clients.length} MCP clients`);

    // Try to refresh all client tool lists before returning
    await Promise.all(clients.map(([clientName]) => this.refreshClientToolsIfNeeded(clientName)));

    const tools = await Promise.all(clients.map(([, client]) => listClientTools(client)));
    this.log.debug(`Retrieved ${tools.length} tool lists`);
    return tools.flat();
  }

  async listTools(): Promise<ListToolsResult['tools']> {
    this.log.debug('Listing all available tools');

    // Return canonical tools (first registered schema for each tool name)
    const canonicalTools = Array.from(this.toolSchemas.values()).map((schema) => schema.tool);

    this.log.debug(`Listed ${canonicalTools.length} canonical tools`);
    return canonicalTools;
  }

  /**
   * Get the canonical schema for a tool (first registered)
   */
  private getCanonicalToolSchema(toolName: string): ListToolsResult['tools'][number] | undefined {
    const schema = this.toolSchemas.get(toolName);
    return schema?.tool;
  }

  /**
   * Gets the list of client names that support a specific tool
   */
  public async getClientsForTool(toolName: string): Promise<string[]> {
    this.log.debug(`Looking for clients that support tool "${toolName}"`);

    // First check if we have clients for this tool in our map
    const clientNames = this.toolToClientMap.get(toolName);

    this.log.debug(
      `Initial tool mapping check for "${toolName}": ${clientNames ? Array.from(clientNames).join(', ') : 'none found'}`
    );

    if (clientNames && clientNames.size > 0) {
      // Refresh any stale clients before returning them
      this.log.debug(`Refreshing ${clientNames.size} clients that may support tool "${toolName}"`);
      await Promise.all(Array.from(clientNames).map((name) => this.refreshClientToolsIfNeeded(name)));

      // Verify clients still support the tool after refresh
      const validClients = Array.from(clientNames).filter((name) => {
        const toolSet = this.clientToolsCache.get(name);
        const hasToolInCache = toolSet?.has(toolName) ?? false;
        this.log.debug(
          `Client "${name}" tool cache check for "${toolName}": ${hasToolInCache ? 'found' : 'not found'}`
        );
        return hasToolInCache;
      });

      this.log.debug(`Valid clients after refresh for tool "${toolName}": ${validClients.join(', ')}`);

      if (validClients.length > 0) {
        return validClients;
      }

      // If no valid clients found after refresh, log warning and fall through to full scan
      this.log.warn(`No valid clients found for tool "${toolName}" after refresh, performing full client scan`);
    }

    // If no specific clients are mapped, we need to check all clients
    // This is a fallback option and should rarely happen after initial setup
    this.log.debug(`No clients cached for tool "${toolName}", checking all clients`);
    const clientEntries = Array.from(this.mcpClients.entries());
    this.log.debug(`Total MCP clients available: ${clientEntries.length}`);

    // Refresh all clients that need it
    await Promise.all(clientEntries.map(([name]) => this.refreshClientToolsIfNeeded(name)));

    // Return clients that now support the tool
    const supportingClients = clientEntries
      .filter(([name]) => {
        const toolSet = this.clientToolsCache.get(name);
        const hasToolInCache = toolSet?.has(toolName) ?? false;
        this.log.debug(
          `Full scan - Client "${name}" tool cache check for "${toolName}": ${hasToolInCache ? 'found' : 'not found'}`
        );
        return hasToolInCache;
      })
      .map(([name]) => name);

    this.log.debug(`Full scan result for tool "${toolName}": ${supportingClients.join(', ')}`);

    // If still no clients found, log detailed debugging information
    if (supportingClients.length === 0) {
      this.log.warn(`No clients found for tool "${toolName}" even after full scan. Debug info:`, {
        toolName,
        totalClients: clientEntries.length,
        clientNames: clientEntries.map(([name]) => name),
        toolToClientMapSize: this.toolToClientMap.size,
        toolSchemasSize: this.toolSchemas.size,
        clientToolsCacheSize: this.clientToolsCache.size,
        toolInSchemas: this.toolSchemas.has(toolName),
        toolInMapping: this.toolToClientMap.has(toolName),
        allToolsInMapping: Array.from(this.toolToClientMap.keys()),
        allToolsInSchemas: Array.from(this.toolSchemas.keys())
      });
    }

    return supportingClients;
  }

  /**
   * Gets the list of clients with their metadata that support a specific tool
   */
  public async getClientsInfoForTool(toolName: string): Promise<Map<string, Interface.MCP.MCPClientMetadata>> {
    const clientNames = await this.getClientsForTool(toolName);
    const clientsInfo = new Map<string, Interface.MCP.MCPClientMetadata>();

    for (const clientName of clientNames) {
      const metadata = this.clientsMetadata.get(clientName);
      if (metadata) {
        clientsInfo.set(clientName, metadata);
      }
    }

    return clientsInfo;
  }

  /**
   * Detects the transport type from an MCP client's transport
   */
  private detectTransportType(transport: any): string {
    if (!transport) return 'none';

    // Use constructor name as fallback
    const constructorName = transport.constructor?.name || 'unknown';

    // Map constructor names to readable transport types
    switch (constructorName) {
      case 'StdioClientTransport':
        return 'stdio';
      case 'SSEClientTransport':
        return 'sse';
      case 'WebSocketClientTransport':
        return 'websocket';
      case 'StreamableHTTPClientTransport':
        return 'streamable-http';
      default:
        return constructorName.toLowerCase().replace('clienttransport', '').replace('transport', '') || 'unknown';
    }
  }

  /**
   * Creates a fallback error response ensuring every tool always gets a valid response
   * @param error The error message to log
   * @param messageText The message to include in the response content
   * @returns A valid CallToolResult with error information
   */
  private createFallbackErrorResponse(error: string, messageText: string): CallToolResult {
    this.log.warn('Creating fallback error response for tool execution', { error, messageText });

    return {
      isError: true,
      error: error,
      content: [
        {
          type: 'text' as const,
          text: messageText
        }
      ]
    };
  }

  public async callTool(
    params: CallToolRequest['params'],
    resultSchema?: typeof CallToolResultSchema | typeof CompatibilityCallToolResultSchema,
    requestOptions?: Interface.MCP.RequestOptions,
    clientNames?: string[]
  ): Promise<CallToolResult> {
    // Tool arguments may hold user data, so they are logged at DEBUG only
    this.log.info(`Calling tool: "${params.name}"`, { clientNames });
    this.log.debug(`Tool "${params.name}" arguments`, { toolParams: params });

    // Get canonical tool schema for validation info
    const canonicalSchema = this.getCanonicalToolSchema(params.name);
    if (
      canonicalSchema &&
      this.toolToClientMap.get(params.name)?.size &&
      this.toolToClientMap.get(params.name)!.size > 1
    ) {
      const canonicalClientName = this.toolSchemas.get(params.name)?.clientName;
      this.log.debug(
        `Tool "${params.name}" is supported by ${this.toolToClientMap.get(params.name)!.size} clients. Using canonical schema from "${canonicalClientName}" for parameter validation.`
      );
    }

    // Get all clients that support this tool (before filtering)
    const allSupportingClientNames = await this.getClientsForTool(params.name);

    // Check if tool exists at all
    if (allSupportingClientNames.length === 0) {
      this.log.warn(`Tool "${params.name}" is not registered with any MCP client`);
      return this.createFallbackErrorResponse(
        `Tool "${params.name}" not registered`,
        `Tool "${params.name}" is not available in any registered MCP client`
      );
    }

    // Apply clientNames filter if provided
    let finalSupportingClientNames = allSupportingClientNames;
    if (clientNames && clientNames.length > 0) {
      finalSupportingClientNames = allSupportingClientNames.filter((name) => clientNames.includes(name));

      // Detailed logging for filtering results
      if (finalSupportingClientNames.length === 0) {
        this.log.warn(
          `Tool "${params.name}" filtered out: available in [${allSupportingClientNames.join(', ')}] but requested clients [${clientNames.join(', ')}] don't support it`
        );
        return this.createFallbackErrorResponse(
          `Tool "${params.name}" filtered out`,
          `Tool "${params.name}" is supported by [${allSupportingClientNames.join(', ')}] but requested clients [${clientNames.join(', ')}] don't support it`
        );
      } else if (finalSupportingClientNames.length < allSupportingClientNames.length) {
        this.log.info(
          `Tool "${params.name}" execution filtered: using ${finalSupportingClientNames.length}/${allSupportingClientNames.length} available clients [${finalSupportingClientNames.join(', ')}]`
        );
      }
    }

    this.log.debug(`Executing tool "${params.name}" on clients: ${finalSupportingClientNames.join(', ')}`);
    const supportingClientNames = finalSupportingClientNames;

    // Get the actual client instances
    const supportingClients = supportingClientNames
      .map((name) => this.mcpClients.get(name))
      .filter((client): client is Interface.MCP.Client => client !== undefined);

    if (supportingClients.length === 0) {
      this.log.warn('No valid MCP clients found for this tool');
      return this.createFallbackErrorResponse(
        'No valid MCP clients found for this tool',
        `All MCP clients supporting tool "${params.name}" are unavailable`
      );
    }

    this.log.debug(`Dispatching tool call to ${supportingClients.length} supporting MCP clients`);

    // Call the tool only on clients that support it with enhanced error handling
    const results = await Promise.all(
      supportingClients.map(async (client, index) => {
        try {
          const result = await client.callTool(params, resultSchema, requestOptions);

          // Validate result structure to ensure it's valid
          if (!result || typeof result !== 'object') {
            this.log.warn(`Tool call returned invalid result structure from client ${index}`, {
              toolName: params.name,
              resultType: typeof result
            });
            return this.createFallbackErrorResponse(
              'Invalid tool response format',
              `Tool "${params.name}" returned invalid response structure`
            );
          }

          if (result.content && !Array.isArray(result.content)) {
            this.log.warn(`Tool call returned non-array content from client ${index}`, {
              toolName: params.name,
              contentType: typeof result.content
            });
            this.log.debug(`Tool "${params.name}" content`, { content: result.content });
            return this.createFallbackErrorResponse(
              'Invalid tool response format',
              `Tool "${params.name}" returned content that is not an array`
            );
          }

          if (!Array.isArray(result.content) || result.content.length === 0) {
            if (result.isError) {
              this.log.warn(`Tool call failed with empty content from client ${index}`, { toolName: params.name });
              return this.createFallbackErrorResponse(
                'Tool returned empty content',
                `Tool "${params.name}" execution failed with no details provided`
              );
            }
            // A tool may succeed without returning anything
            this.log.debug(`Tool call returned empty content from client ${index}`, { toolName: params.name });
            return { ...result, content: [] };
          }

          return result;
        } catch (error) {
          this.log.warn(`Tool call failed on client ${index}`, error);
          return this.createFallbackErrorResponse(
            error instanceof Error ? error.message : String(error),
            `Tool "${params.name}" execution failed: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      })
    );

    this.log.debug(`Received ${results.length} results from MCP clients`);

    const aggregatedResults = this.aggregateResults(results);
    this.log.info(`Tool call completed: "${params.name}"`, {
      isError: aggregatedResults.isError,
      resultCount: aggregatedResults.content?.length || 0
    });

    return aggregatedResults;
  }

  protected aggregateResults(results: Interface.MCP.CallToolReturn[]): CallToolResult {
    this.log.debug(`Aggregating ${results.length} tool call results`);

    // Ensure we always have results to process
    if (results.length === 0) {
      this.log.warn('No results to aggregate, creating fallback response');
      return this.createFallbackErrorResponse(
        'No tool execution results received',
        'Tool execution failed: No results were returned from any MCP client'
      );
    }

    // Process all results, log errors, and filter out invalid ones in a single pass
    const validResults = results.filter((result) => {
      // Check for error status
      if (result.isError) {
        // The result content may hold user data, so it is logged at DEBUG only
        this.log.error(`Tool call failed`, undefined, {
          error: typeof result.error === 'string' ? result.error : undefined,
          contentLength: Array.isArray(result.content) ? result.content.length : 0
        });
        this.log.debug('Failed tool call result', { result });
        return false;
      }

      // Check for invalid content format
      if (!Array.isArray(result.content)) {
        this.log.error(
          `Tool call failed. All tools in chain was canceled.`,
          new Error(
            'Unexpected tool response format: content is not an array, toolResponse: ' + JSON.stringify(result, null, 2)
          )
        );
        return false;
      }

      return true;
    }) as CallToolResult[];

    this.log.debug(`Found ${validResults.length} valid results out of ${results.length}`);

    if (validResults.length === 0) {
      this.log.warn('No valid MCP results found during result aggregation');

      // A tool that reports isError explains why in its content, so the model gets that text.
      // Fallback responses created above carry an `error` field and are summarized below instead.
      const toolErrorContent = results
        .filter(
          (result): result is CallToolResult =>
            result.isError === true && !result.error && Array.isArray(result.content)
        )
        .flatMap((result) => result.content);
      if (toolErrorContent.length > 0) {
        return { isError: true, content: toolErrorContent };
      }

      // Try to extract error information from failed results
      const errorMessages = results
        .filter((result) => result.isError && result.error)
        .map((result) => result.error)
        .join('; ');

      const fallbackMessage = errorMessages
        ? `Tool execution failed with errors: ${errorMessages}`
        : 'Tool execution failed: All MCP clients returned invalid responses';

      return this.createFallbackErrorResponse('No valid MCP results found during result aggregation', fallbackMessage);
    }

    // Create a base result from the first valid result
    const baseResult = { ...validResults[0] };

    // Merge all content arrays from all valid results
    const allContent = validResults.reduce<any[]>((allContentItems, result) => {
      if (result.content && Array.isArray(result.content)) return [...allContentItems, ...result.content];

      return allContentItems;
    }, []);

    // Set the merged content array in the result
    if (allContent.length > 0) baseResult.content = allContent;

    this.log.debug(`Aggregated ${allContent.length} content items from valid results`);
    return baseResult;
  }
}

/**
 * The client's tools. A server without the tools capability has no tools/list method, so it lists none.
 * A client that is not connected has no capabilities yet; listTools() then fails with the SDK's error.
 */
async function listClientTools(client: Interface.MCP.Client): Promise<ListToolsResult> {
  const capabilities = client.getServerCapabilities();
  if (capabilities && !capabilities.tools) return { tools: [] };
  return client.listTools();
}

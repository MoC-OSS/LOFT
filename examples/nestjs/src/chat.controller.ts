import { BadRequestException, Body, Controller, Get, HttpCode, Logger, Param, Post } from '@nestjs/common';

import { LoftService } from './loft.service';

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(private readonly loftService: LoftService) {}

  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Post('sessions')
  @HttpCode(201)
  async createSession() {
    return this.loftService.createSession();
  }

  @Post()
  async chat(@Body() body: { sessionId?: string; message?: string } | undefined) {
    // Express 5 leaves the body undefined when the request has no JSON body
    const { sessionId, message } = body ?? {};

    if (!sessionId || !message?.trim()) {
      throw new BadRequestException('sessionId and message are required');
    }

    return this.loftService.sendMessage(sessionId, message);
  }

  @Get('sessions/:id/history')
  async getHistory(@Param('id') id: string) {
    return this.loftService.getChatHistory(id);
  }
}

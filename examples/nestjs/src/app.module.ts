import { Module } from '@nestjs/common';

import { ChatController } from './chat.controller';
import { LoftModule } from './loft.module';

@Module({
  imports: [LoftModule],
  controllers: [ChatController]
})
export class AppModule {}

import { Module } from '@nestjs/common';

import { LoftService } from './loft.service';

@Module({
  providers: [LoftService],
  exports: [LoftService]
})
export class LoftModule {}

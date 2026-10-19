import { Module } from '@nestjs/common';
import { ProjectsController, ServicesController } from './projects.controller';
import { ProjectsService } from './projects.service';

@Module({
  controllers: [ProjectsController, ServicesController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}

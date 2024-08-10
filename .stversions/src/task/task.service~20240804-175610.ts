import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { FileService } from '../file/file.service.js';
import { configService } from '../config/config.service';


@Injectable()
export class TaskService {
  private readonly logger = new Logger(TaskService.name);

  constructor(private readonly fileService: FileService) {}

 //TaskService 类使用了 NestJS 的调度机制，通过 @Cron 装饰器来定时执行任务。@Cron('0 */1 * * * *') 装饰器，这表示每分钟执行一次。

  //当文件很多时，ScanFile特别消耗计算资源，严重影响另两个task, 
  // 因此注释 @Cron 屏蔽task， 当添加文件后再临时打开。 
  // @Cron('*/1 * * * *') // 每 1 分钟执行一次
  // @Cron('*/10 * * * * *') // 每10秒执行一次 
  async triggerScanFile() {
    this.logger.log(
      `Starting scan files, path: ${configService.getAlbumDir()}`,
    );
    await this.fileService.scanFile();
  }
 

  @Cron('*/80 * * * * *') // 每80秒执行一次 , Azure gpt-4o约9秒识别一个图像
  async triggerExtractDesc() {
    this.logger.log('Starting extract desc');
    await this.fileService.extractDesc();
  }

  @Cron('*/80 * * * * *') // 每80秒执行一次，可以等ExtractDesc积累一批数据后，再进行批量 Embeddings 
  async triggerEmbedding() {
    this.logger.log('Starting embedding');
    await this.fileService.embedding();
  }
}

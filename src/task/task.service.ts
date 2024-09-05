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
  //@Cron('*/1 * * * *') // 每 1 分钟执行一次
  //@Cron('*/60 * * * *') // 每60分钟执行一次 
  async triggerScanFile() {
    this.logger.log(
      `Starting scan files, path: ${configService.getAlbumDir()}`,
    );
    await this.fileService.scanFile();
  }
 
  /**
   * ######## 注意 Cron 定时规则 ########
   * 不能设置 超过 60 秒 或 60 分钟， 也就是不能自动进位
   * 五颗*时，最多设置60秒，  如果超过1分钟，需要用 4颗*来实现
   * 四颗*时，最多设置60分钟，如果超过1小时，需要用 3颗*来实现
   * 
   */
  //@Cron('*/2 * * * *') //  2 分钟执行一次 , Azure gpt-4o约9秒识别一个图像
  async triggerExtractDesc() {
    this.logger.log('Starting extract desc');
    await this.fileService.extractDesc();
  }

  //@Cron('*/2 * * * *') // 每2分钟执行一次，可以等ExtractDesc积累一批数据后，再进行批量 Embeddings 
  async triggerEmbedding() {
    this.logger.log('Starting embedding');
    await this.fileService.embedding();
  }

  @Cron('*/20 * * * * *') // 每20秒执行一次heartBeating， 
  async heartBeating() {
     // heartBeating 主要用于快速开始第一次执行，不管各任务的定时如何设置
    this.logger.log('Heart Beating ...');
    //await this.fileService.heartBeating (initFileScan=false);  不能像在 Python 中那样直接在方法调用时指定参数名
    await this.fileService.heartBeating(false);
  }


}

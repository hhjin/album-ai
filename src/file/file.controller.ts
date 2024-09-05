import { Controller, Get, Param, Query, Res ,Logger } from '@nestjs/common';
import { FileService } from './file.service.js';
import { Response } from 'express';

@Controller('/api/v1/file')
export class FileController {
  private readonly logger = new Logger(FileService.name);

  constructor(private readonly fileService: FileService) {}

  @Get('/searchOld')
  public async searchOld(@Query('query') query: string) {
    return this.fileService.searchDetail(query);
  }

  @Get('/search')
public async search(@Query('searchQuery') searchQuery: string) {
  return this.fileService.searchImages(searchQuery);
}

  @Get('/:fId/download')
  public async download(@Param('fId') fId: string, @Res() response: Response) {
    const file = await this.fileService.findFile(fId);
 
    //某些情况下，相册根目录会变动（如App从Mac迁移到Windows), postgres数据表里path存放是生成数据时的路径ALBUM_PATH_OLD。 需要 重替换为当前ALBUM_PATH路径。
    if (process.env.ALBUM_PATH_OLD != null) {
      const regex = new RegExp(`^${process.env.ALBUM_PATH_OLD}`);
      if (!file.path.startsWith(process.env.ALBUM_PATH)) {
        this.logger.log(`fId ${fId} path ${file.path} not match env.ALBUM_PATH,  replaced to ${process.env.ALBUM_PATH}`);
        file.path = file.path.replace(regex, process.env.ALBUM_PATH);
        file.path = file.path.replaceAll('\\', '/');
        
      }
    }else
      this.logger.log(` download fId ${fId} path ${file.path} `);

     
    response.download(file.path, (err) => {
      if (!err) {
        return;
      }

      this.logger.error(err);
      response.send({
        code: 500,
        msg: 'download error',
      });
    });
  }
}
